import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import {
  countOrdersForCustomer,
  createCustomer,
  createProduct,
  ensureMigrated,
  getStock,
  resetOrders,
} from "./helpers/testDb";

describe("orders API", () => {
  const app = createApp();
  let customerId: string;
  let productId: string;

  beforeAll(async () => {
    await ensureMigrated();
  });

  beforeEach(async () => {
    await resetOrders();
    customerId = await createCustomer();
    productId = await createProduct({ priceCents: 2500, stock: 20 });
  });

  it("creates an order, captures payment, and decrements stock", async () => {
    const res = await request(app)
      .post("/api/orders")
      .send({ customerId, items: [{ productId, quantity: 3 }] });

    expect(res.status).toBe(201);
    expect(res.body.customerId).toBe(customerId);
    expect(res.body.status).toBe("paid");
    expect(res.body.totalCents).toBe(7500);
    expect(res.body.paymentCaptureId).toMatch(/^cap_/);
    expect(res.body.items).toHaveLength(1);
    expect(await getStock(productId)).toBe(17);
  });

  it("returns the existing order when a checkout is retried with the same Idempotency-Key", async () => {
    const payload = { customerId, items: [{ productId, quantity: 1 }] };
    const key = `ck_${Date.now()}`;

    const first = await request(app).post("/api/orders").set("Idempotency-Key", key).send(payload);
    expect(first.status).toBe(201);

    const retry = await request(app).post("/api/orders").set("Idempotency-Key", key).send(payload);
    expect(retry.status).toBe(200);
    expect(retry.body.id).toBe(first.body.id);

    expect(await countOrdersForCustomer(customerId)).toBe(1);
    expect(await getStock(productId)).toBe(19);
  });

  it("rejects an order with no items", async () => {
    const res = await request(app).post("/api/orders").send({ customerId, items: [] });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("empty_order");
  });

  it("rejects an order for an unknown customer", async () => {
    const res = await request(app)
      .post("/api/orders")
      .send({
        customerId: "00000000-0000-0000-0000-000000000000",
        items: [{ productId, quantity: 1 }],
      });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("unknown_customer");
  });

  it("rejects an order that exceeds available stock and leaves stock untouched", async () => {
    const res = await request(app)
      .post("/api/orders")
      .send({ customerId, items: [{ productId, quantity: 999 }] });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("insufficient_stock");
    expect(await getStock(productId)).toBe(20);
    expect(await countOrdersForCustomer(customerId)).toBe(0);
  });

  it("lists a customer's orders", async () => {
    await request(app)
      .post("/api/orders")
      .send({ customerId, items: [{ productId, quantity: 2 }] });

    const viaQuery = await request(app).get(`/api/orders?customerId=${customerId}`);
    expect(viaQuery.status).toBe(200);
    expect(viaQuery.body).toHaveLength(1);
    expect(viaQuery.body[0].totalCents).toBe(5000);

    const viaCustomer = await request(app).get(`/api/customers/${customerId}/orders`);
    expect(viaCustomer.status).toBe(200);
    expect(viaCustomer.body).toHaveLength(1);
  });

  it("fetches a single order with its line items", async () => {
    const created = await request(app)
      .post("/api/orders")
      .send({ customerId, items: [{ productId, quantity: 1 }] });

    const res = await request(app).get(`/api/orders/${created.body.id}`);
    expect(res.status).toBe(200);
    expect(res.body.items[0].quantity).toBe(1);
    expect(res.body.items[0].unitPriceCents).toBe(2500);
  });
});
