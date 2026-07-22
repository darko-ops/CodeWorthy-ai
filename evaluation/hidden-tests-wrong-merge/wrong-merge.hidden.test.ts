import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import {
  createCustomer,
  createProduct,
  ensureMigrated,
  getStock,
  resetOrders,
} from "../helpers/testDb";

// Hidden evaluation for the wrong-merge scenario (ACME-1490). This file never
// ships to candidates; only the sanitized summary (summarize.mjs) may reach a
// candidate-facing surface.
//
// Every check exercises LIVE behavior, never source presence: a candidate who
// restores an orphaned module without wiring it into the route must fail, and
// a candidate who rewrites an implementation that still behaves must pass.

const OPS_KEY = "hidden-eval-ops-key";

// Fresh module graph per phase so both import-time and call-time readers of
// env-driven config (flags, ops key) see the values we set.
async function freshApp(env: Record<string, string | undefined>) {
  vi.resetModules();
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  const mod = await import("../../src/app");
  return mod.createApp();
}

describe("hidden: wrong-merge integration state", () => {
  beforeAll(async () => {
    await ensureMigrated();
  });

  beforeEach(async () => {
    await resetOrders();
  });

  it("enforces the ops key on the cross-customer order listing", async () => {
    const app = await freshApp({ OPS_API_KEY: OPS_KEY, FLAG_BACKORDERS: undefined });
    const customerId = await createCustomer();

    const noKey = await request(app).get("/api/orders");
    expect(noKey.status).toBe(401);

    const badKey = await request(app).get("/api/orders").set("x-ops-key", "wrong-key");
    expect(badKey.status).toBe(403);

    const goodKey = await request(app).get("/api/orders").set("x-ops-key", OPS_KEY);
    expect(goodKey.status).toBe(200);

    // The dashboard path stays keyless.
    const scoped = await request(app).get(`/api/orders?customerId=${customerId}`);
    expect(scoped.status).toBe(200);
  });

  it("emits the order.checkout log line with the monitor fields", async () => {
    const app = await freshApp({ LOG_IN_TESTS: "1" });
    const customerId = await createCustomer();
    const productId = await createProduct({ priceCents: 700, stock: 10 });

    const lines: string[] = [];
    const original = process.stdout.write.bind(process.stdout);
    (process.stdout as unknown as { write: (chunk: unknown) => boolean }).write = (
      chunk: unknown
    ) => {
      lines.push(String(chunk));
      return true;
    };
    try {
      const first = await request(app)
        .post("/api/orders")
        .set("Idempotency-Key", "hk-log-1")
        .send({ customerId, items: [{ productId, quantity: 2 }] });
      expect(first.status).toBe(201);

      const retry = await request(app)
        .post("/api/orders")
        .set("Idempotency-Key", "hk-log-1")
        .send({ customerId, items: [{ productId, quantity: 2 }] });
      expect(retry.status).toBe(200);
    } finally {
      (process.stdout as unknown as { write: unknown }).write = original;
    }

    const checkoutLines = lines.filter((l) => l.includes(" order.checkout "));
    expect(checkoutLines.length).toBeGreaterThanOrEqual(2);
    for (const field of [
      "request_id=",
      "order_id=",
      "customer_id=",
      "total_cents=",
      "item_count=",
      "idempotency_key=",
      "replayed=",
    ]) {
      expect(checkoutLines[0]).toContain(field);
    }
    expect(checkoutLines[0]).toContain("replayed=false");
    // The duplicate-charge monitor keys on replayed=true rates.
    expect(checkoutLines.some((l) => l.includes("replayed=true"))).toBe(true);
  });

  it("gates backorders behind FLAG_BACKORDERS", async () => {
    const customerId = await createCustomer();
    const productId = await createProduct({ priceCents: 500, stock: 3 });

    const flagOn = await freshApp({ FLAG_BACKORDERS: "1" });
    const accepted = await request(flagOn)
      .post("/api/orders")
      .send({ customerId, items: [{ productId, quantity: 99 }] });
    expect(accepted.status).toBe(201);
    expect(accepted.body.status).toBe("backordered");
    expect(accepted.body.paymentCaptureId).toBeNull();
    expect(await getStock(productId)).toBe(3);

    const flagOff = await freshApp({ FLAG_BACKORDERS: undefined });
    const rejected = await request(flagOff)
      .post("/api/orders")
      .send({ customerId, items: [{ productId, quantity: 99 }] });
    expect(rejected.status).toBe(409);
    expect(rejected.body.error).toBe("insufficient_stock");
  });

  it("still serves the finance CSV export", async () => {
    // Functionality, not verbatim code: any implementation that returns the
    // orders as CSV passes. The ops key is supplied so a candidate who chose
    // to guard the export is not penalized; an unguarded export ignores it.
    const app = await freshApp({ OPS_API_KEY: OPS_KEY });
    const customerId = await createCustomer();
    const productId = await createProduct({ priceCents: 1200, stock: 10 });
    const created = await request(app)
      .post("/api/orders")
      .send({ customerId, items: [{ productId, quantity: 2 }] });
    expect(created.status).toBe(201);

    const res = await request(app).get("/api/orders/export").set("x-ops-key", OPS_KEY);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/csv");
    const lines = res.text.trim().split("\n");
    expect(lines[0]).toContain("id");
    expect(lines[0]).toContain("customer_id");
    expect(lines[0]).toContain("total_cents");
    expect(
      lines.slice(1).some((l) => l.includes(created.body.id) && l.includes("2400"))
    ).toBe(true);
  });

  it("computes totals and captures payment on a normal checkout", async () => {
    const app = await freshApp({ FLAG_BACKORDERS: undefined });
    const customerId = await createCustomer();
    const productId = await createProduct({ priceCents: 2500, stock: 20 });
    const res = await request(app)
      .post("/api/orders")
      .send({ customerId, items: [{ productId, quantity: 3 }] });
    expect(res.status).toBe(201);
    expect(res.body.totalCents).toBe(7500);
    expect(res.body.paymentCaptureId).toMatch(/^cap_/);
    expect(await getStock(productId)).toBe(17);
  });

  it("enforces stock limits and validates unknown customers", async () => {
    const app = await freshApp({ FLAG_BACKORDERS: undefined });
    const customerId = await createCustomer();
    const productId = await createProduct({ priceCents: 1000, stock: 5 });

    const tooMany = await request(app)
      .post("/api/orders")
      .send({ customerId, items: [{ productId, quantity: 999 }] });
    expect(tooMany.status).toBe(409);
    expect(await getStock(productId)).toBe(5);

    const unknown = await request(app)
      .post("/api/orders")
      .send({
        customerId: "00000000-0000-0000-0000-000000000000",
        items: [{ productId, quantity: 1 }],
      });
    expect(unknown.status).toBe(404);
  });

  it("replays sequential idempotent retries", async () => {
    const app = await freshApp({});
    const customerId = await createCustomer();
    const productId = await createProduct({ priceCents: 900, stock: 10 });
    const key = `hk-seq-${Date.now()}`;

    const first = await request(app)
      .post("/api/orders")
      .set("Idempotency-Key", key)
      .send({ customerId, items: [{ productId, quantity: 1 }] });
    expect(first.status).toBe(201);

    const retry = await request(app)
      .post("/api/orders")
      .set("Idempotency-Key", key)
      .send({ customerId, items: [{ productId, quantity: 1 }] });
    expect(retry.status).toBe(200);
    expect(retry.body.id).toBe(first.body.id);
  });
});
