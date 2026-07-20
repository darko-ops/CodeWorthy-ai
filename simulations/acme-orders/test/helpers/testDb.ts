import { randomBytes } from "node:crypto";
import { pool } from "../../src/db";
import { migrate } from "../../scripts/migrate";

let migrated = false;

export async function ensureMigrated() {
  if (!migrated) {
    await migrate();
    migrated = true;
  }
}

// Order data is cleared between suites; customers/products created by the
// factories below are unique per call, so suites don't step on each other.
export async function resetOrders() {
  await pool.query("TRUNCATE order_items, orders, idempotency_keys");
}

export async function createCustomer(name = "Test Co") {
  const email = `test-${randomBytes(6).toString("hex")}@example.test`;
  const res = await pool.query(
    `INSERT INTO customers (company_name, contact_email)
     VALUES ($1, $2) RETURNING id`,
    [name, email]
  );
  return res.rows[0].id as string;
}

export async function createProduct(input: { priceCents?: number; stock?: number } = {}) {
  const sku = `TST-${randomBytes(4).toString("hex")}`;
  const res = await pool.query(
    `INSERT INTO products (sku, name, unit_price_cents, stock)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [sku, `Test product ${sku}`, input.priceCents ?? 1000, input.stock ?? 50]
  );
  return res.rows[0].id as string;
}

export async function getStock(productId: string): Promise<number> {
  const res = await pool.query("SELECT stock FROM products WHERE id = $1", [productId]);
  return res.rows[0].stock;
}

export async function countOrdersForCustomer(customerId: string): Promise<number> {
  const res = await pool.query("SELECT count(*)::int AS n FROM orders WHERE customer_id = $1", [
    customerId,
  ]);
  return res.rows[0].n;
}
