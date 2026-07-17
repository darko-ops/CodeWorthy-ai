// HIDDEN EVALUATION SUITE — never shipped to candidates.
//
// Run via evaluation/hidden-tests/run.sh, which copies this file into
// simulations/acme-orders/test/hidden/ and runs vitest there.
//
// On the unmodified baseline the idempotency tests below FAIL (that is the
// seeded bug). A correct fix makes all of them pass. Assertions deliberately
// accept several valid fix shapes: concurrent duplicates may both return the
// same order (200/201) or one may be rejected with 409 — what must hold is
// that exactly one order exists, stock moved exactly once, and the customer
// was charged exactly once.
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../../src/app";
import {
  countOrdersForCustomer,
  createCustomer,
  createProduct,
  ensureMigrated,
  getStock,
  resetOrders,
} from "../helpers/testDb";

describe("hidden: idempotency under production conditions", () => {
  let customerId: string;
  let productId: string;

  beforeAll(async () => {
    await ensureMigrated();
  });

  beforeEach(async () => {
    await resetOrders();
    customerId = await createCustomer("Hidden Eval Co");
    productId = await createProduct({ priceCents: 4850, stock: 100 });
    // Widen the race window the way the 2026-07-09 PayFlow incident did.
    process.env.PAYMENT_LATENCY_MS = "300";
  });

  it("creates exactly one order when a timed-out checkout is retried while the original is still in flight", async () => {
    const app = createApp();
    const key = `ck_hidden_${Date.now()}_a`;
    const payload = { customerId, items: [{ productId, quantity: 2 }] };

    // Client times out at 3s and retries with the same key; under provider
    // latency the retry arrives while request #1 is still processing.
    const [first, second] = await Promise.all([
      request(app).post("/api/orders").set("Idempotency-Key", key).send(payload),
      new Promise((r) => setTimeout(r, 50)).then(() =>
        request(app).post("/api/orders").set("Idempotency-Key", key).send(payload)
      ),
    ]);

    const successes = [first, second].filter((r) => r.status === 200 || r.status === 201);
    expect(successes.length).toBeGreaterThanOrEqual(1);
    for (const r of [first, second]) {
      expect([200, 201, 409]).toContain(r.status);
    }
    const orderIds = new Set(successes.map((r) => r.body.id));
    expect(orderIds.size).toBe(1);

    expect(await countOrdersForCustomer(customerId)).toBe(1);
    expect(await getStock(productId)).toBe(98); // decremented once, not twice
  });

  it("deduplicates across API replicas (or a process restart)", async () => {
    // Production runs two replicas behind a load balancer; the retry can land
    // on a different process than the original request.
    const replicaA = createApp();
    const replicaB = createApp();
    const key = `ck_hidden_${Date.now()}_b`;
    const payload = { customerId, items: [{ productId, quantity: 1 }] };

    const first = await request(replicaA).post("/api/orders").set("Idempotency-Key", key).send(payload);
    expect(first.status).toBe(201);

    const retry = await request(replicaB).post("/api/orders").set("Idempotency-Key", key).send(payload);
    expect([200, 409]).toContain(retry.status);
    if (retry.status === 200) {
      expect(retry.body.id).toBe(first.body.id);
    }

    expect(await countOrdersForCustomer(customerId)).toBe(1);
    expect(await getStock(productId)).toBe(99);
  });

  it("still accepts distinct checkouts with distinct keys", async () => {
    const app = createApp();
    const payload = { customerId, items: [{ productId, quantity: 1 }] };

    const [a, b] = await Promise.all([
      request(app).post("/api/orders").set("Idempotency-Key", `ck_hidden_${Date.now()}_c1`).send(payload),
      request(app).post("/api/orders").set("Idempotency-Key", `ck_hidden_${Date.now()}_c2`).send(payload),
    ]);

    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(a.body.id).not.toBe(b.body.id);
    expect(await countOrdersForCustomer(customerId)).toBe(2);
  });

  it("still accepts checkouts without any idempotency key", async () => {
    const app = createApp();
    const res = await request(app)
      .post("/api/orders")
      .send({ customerId, items: [{ productId, quantity: 1 }] });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("paid");
  });
});

describe("hidden: unrelated checkout behavior is not regressed", () => {
  let customerId: string;
  let productId: string;

  beforeAll(async () => {
    await ensureMigrated();
  });

  beforeEach(async () => {
    await resetOrders();
    customerId = await createCustomer("Hidden Regression Co");
    productId = await createProduct({ priceCents: 1200, stock: 5 });
    process.env.PAYMENT_LATENCY_MS = "10";
  });

  it("computes totals from line items", async () => {
    const app = createApp();
    const res = await request(app)
      .post("/api/orders")
      .send({ customerId, items: [{ productId, quantity: 3 }] });
    expect(res.status).toBe(201);
    expect(res.body.totalCents).toBe(3600);
  });

  it("still enforces stock limits", async () => {
    const app = createApp();
    const res = await request(app)
      .post("/api/orders")
      .send({ customerId, items: [{ productId, quantity: 6 }] });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("insufficient_stock");
    expect(await getStock(productId)).toBe(5);
  });

  it("still validates unknown customers with a key present", async () => {
    const app = createApp();
    const res = await request(app)
      .post("/api/orders")
      .set("Idempotency-Key", `ck_hidden_${Date.now()}_d`)
      .send({
        customerId: "00000000-0000-0000-0000-000000000000",
        items: [{ productId, quantity: 1 }],
      });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("unknown_customer");
    expect(await countOrdersForCustomer(customerId)).toBe(0);
  });
});
