import type { Pool, PoolClient } from "pg";
import { badRequest, conflict, notFound } from "../lib/errors";
import { log } from "../lib/logger";
import { capturePayment } from "../payments/payflow";

export interface OrderItemInput {
  productId: string;
  quantity: number;
}

export interface CreateOrderInput {
  customerId: string;
  items: OrderItemInput[];
  idempotencyKey?: string;
  requestId?: string;
}

export interface Order {
  id: string;
  customerId: string;
  status: string;
  totalCents: number;
  paymentCaptureId: string | null;
  createdAt: string;
  items: Array<{
    productId: string;
    sku: string;
    quantity: number;
    unitPriceCents: number;
  }>;
}

export interface CreateOrderResult {
  order: Order;
  replayed: boolean;
}

export class OrderService {
  // Cache of recently seen idempotency keys -> order id, so integrations that
  // retry a checkout don't create the order twice. Added in ACME-1104.
  private recentIdempotencyKeys = new Map<string, string>();

  constructor(private readonly pool: Pool) {}

  async createOrder(input: CreateOrderInput): Promise<CreateOrderResult> {
    const { customerId, items, idempotencyKey, requestId } = input;

    if (idempotencyKey) {
      const existingOrderId = this.recentIdempotencyKeys.get(idempotencyKey);
      if (existingOrderId) {
        const existing = await this.getOrder(existingOrderId);
        if (existing) {
          log.info("order.replayed", {
            request_id: requestId,
            order_id: existing.id,
            idempotency_key: idempotencyKey,
          });
          return { order: existing, replayed: true };
        }
      }
    }

    if (!Array.isArray(items) || items.length === 0) {
      throw badRequest("empty_order", "an order needs at least one item");
    }
    for (const item of items) {
      if (!item.productId || !Number.isInteger(item.quantity) || item.quantity < 1) {
        throw badRequest("invalid_item", "each item needs a productId and a positive integer quantity");
      }
    }

    const client = await this.pool.connect();
    let orderId: string;
    let totalCents: number;
    try {
      await client.query("BEGIN");

      const customer = await client.query("SELECT id FROM customers WHERE id = $1", [customerId]);
      if (customer.rowCount === 0) {
        throw notFound("unknown_customer", `no customer with id ${customerId}`);
      }

      totalCents = 0;
      const lineItems: Array<{ productId: string; quantity: number; unitPriceCents: number }> = [];
      for (const item of items) {
        // Decrement stock up front; the WHERE clause stops us going negative.
        const updated = await client.query(
          `UPDATE products SET stock = stock - $2
           WHERE id = $1 AND stock >= $2
           RETURNING unit_price_cents`,
          [item.productId, item.quantity]
        );
        if (updated.rowCount === 0) {
          const exists = await client.query("SELECT id FROM products WHERE id = $1", [item.productId]);
          if (exists.rowCount === 0) {
            throw notFound("unknown_product", `no product with id ${item.productId}`);
          }
          throw conflict("insufficient_stock", `not enough stock for product ${item.productId}`);
        }
        const unitPriceCents: number = updated.rows[0].unit_price_cents;
        totalCents += unitPriceCents * item.quantity;
        lineItems.push({ productId: item.productId, quantity: item.quantity, unitPriceCents });
      }

      const inserted = await client.query(
        `INSERT INTO orders (customer_id, status, total_cents)
         VALUES ($1, 'pending', $2)
         RETURNING id`,
        [customerId, totalCents]
      );
      orderId = inserted.rows[0].id;

      for (const line of lineItems) {
        await client.query(
          `INSERT INTO order_items (order_id, product_id, quantity, unit_price_cents)
           VALUES ($1, $2, $3, $4)`,
          [orderId, line.productId, line.quantity, line.unitPriceCents]
        );
      }

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }

    // Capture payment after the order row is committed, so a failed capture
    // leaves us an order to reconcile instead of a charge with no record.
    const capture = await capturePayment({
      amountCents: totalCents,
      reference: orderId,
    });
    await this.pool.query(
      "UPDATE orders SET status = 'paid', payment_capture_id = $2 WHERE id = $1",
      [orderId, capture.captureId]
    );

    log.info("order.created", {
      request_id: requestId,
      order_id: orderId,
      customer_id: customerId,
      total_cents: totalCents,
      idempotency_key: idempotencyKey,
    });

    if (idempotencyKey) {
      // Keep the cache from growing without bound.
      if (this.recentIdempotencyKeys.size >= 5000) {
        this.recentIdempotencyKeys.clear();
      }
      this.recentIdempotencyKeys.set(idempotencyKey, orderId);
    }

    const order = await this.getOrder(orderId);
    if (!order) throw new Error(`order ${orderId} vanished after insert`);
    return { order, replayed: false };
  }

  async getOrder(id: string): Promise<Order | null> {
    const res = await this.pool.query(
      `SELECT o.id, o.customer_id, o.status, o.total_cents, o.payment_capture_id, o.created_at
       FROM orders o WHERE o.id = $1`,
      [id]
    );
    const row = res.rows[0];
    if (!row) return null;

    const items = await this.pool.query(
      `SELECT oi.product_id, p.sku, oi.quantity, oi.unit_price_cents
       FROM order_items oi
       JOIN products p ON p.id = oi.product_id
       WHERE oi.order_id = $1
       ORDER BY p.sku`,
      [id]
    );

    return {
      id: row.id,
      customerId: row.customer_id,
      status: row.status,
      totalCents: row.total_cents,
      paymentCaptureId: row.payment_capture_id,
      createdAt: row.created_at,
      items: items.rows.map((i) => ({
        productId: i.product_id,
        sku: i.sku,
        quantity: i.quantity,
        unitPriceCents: i.unit_price_cents,
      })),
    };
  }

  async listOrders(customerId?: string): Promise<Order[]> {
    const res = customerId
      ? await this.pool.query(
          "SELECT id FROM orders WHERE customer_id = $1 ORDER BY created_at DESC",
          [customerId]
        )
      : await this.pool.query("SELECT id FROM orders ORDER BY created_at DESC LIMIT 100");
    const orders: Order[] = [];
    for (const row of res.rows) {
      const order = await this.getOrder(row.id);
      if (order) orders.push(order);
    }
    return orders;
  }
}
