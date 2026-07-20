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
  constructor(private readonly pool: Pool) {}

  async createOrder(input: CreateOrderInput): Promise<CreateOrderResult> {
    const { customerId, items, idempotencyKey, requestId } = input;

    if (!Array.isArray(items) || items.length === 0) {
      throw badRequest("empty_order", "an order needs at least one item");
    }
    for (const item of items) {
      if (!item.productId || !Number.isInteger(item.quantity) || item.quantity < 1) {
        throw badRequest("invalid_item", "each item needs a productId and a positive integer quantity");
      }
    }

    const client = await this.pool.connect();
    let orderId!: string;
    let totalCents!: number;
    let claimLost = false;
    try {
      await client.query("BEGIN");

      if (idempotencyKey) {
        // Claim the key inside the transaction (ACME-1287). The primary key on
        // idempotency_keys makes Postgres serialize concurrent requests with
        // the same key: the loser blocks here until the winner commits, then
        // sees the conflict and replays the winner's order below. Rolling back
        // (e.g. insufficient stock) releases the claim, so a failed checkout
        // can be retried with the same key.
        const claimed = await client.query(
          `INSERT INTO idempotency_keys (key) VALUES ($1)
           ON CONFLICT (key) DO NOTHING`,
          [idempotencyKey]
        );
        claimLost = claimed.rowCount === 0;
      }

      if (claimLost) {
        await client.query("ROLLBACK");
      } else {
        await this.insertOrder(client, input, (id, total) => {
          orderId = id;
          totalCents = total;
        });
      }
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }

    if (claimLost) {
      const existing = await this.findOrderByIdempotencyKey(idempotencyKey!);
      if (existing) {
        log.info("order.replayed", {
          request_id: requestId,
          order_id: existing.id,
          idempotency_key: idempotencyKey,
        });
        return { order: existing, replayed: true };
      }
      // The competing request rolled back after we observed its claim and the
      // key is free again; tell the client to retry rather than guessing.
      throw conflict(
        "idempotency_conflict",
        "another request with this Idempotency-Key is in progress; retry shortly"
      );
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

    const order = await this.getOrder(orderId);
    if (!order) throw new Error(`order ${orderId} vanished after insert`);
    return { order, replayed: false };
  }

  // Runs inside the caller's open transaction; the caller owns COMMIT/ROLLBACK
  // on error. Reports the created order via `onCreated` just before COMMIT.
  private async insertOrder(
    client: PoolClient,
    input: CreateOrderInput,
    onCreated: (orderId: string, totalCents: number) => void
  ): Promise<void> {
    const { customerId, items, idempotencyKey } = input;

    const customer = await client.query("SELECT id FROM customers WHERE id = $1", [customerId]);
    if (customer.rowCount === 0) {
      throw notFound("unknown_customer", `no customer with id ${customerId}`);
    }

    let totalCents = 0;
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
    const orderId: string = inserted.rows[0].id;

    for (const line of lineItems) {
      await client.query(
        `INSERT INTO order_items (order_id, product_id, quantity, unit_price_cents)
         VALUES ($1, $2, $3, $4)`,
        [orderId, line.productId, line.quantity, line.unitPriceCents]
      );
    }

    if (idempotencyKey) {
      // Point the claim at the order in the same transaction, so any committed
      // key row always has an order to replay.
      await client.query("UPDATE idempotency_keys SET order_id = $2 WHERE key = $1", [
        idempotencyKey,
        orderId,
      ]);
    }

    onCreated(orderId, totalCents);
    await client.query("COMMIT");
  }

  private async findOrderByIdempotencyKey(key: string): Promise<Order | null> {
    const res = await this.pool.query("SELECT order_id FROM idempotency_keys WHERE key = $1", [
      key,
    ]);
    const orderId = res.rows[0]?.order_id;
    if (!orderId) return null;
    return this.getOrder(orderId);
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
