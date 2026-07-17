// Data-access helpers that predate the service layer (2023 era).
//
// New code should live in a service under src/services/, but several routes
// still import from here. Rows are returned exactly as Postgres produces them
// (snake_case columns) — the admin dashboard depends on that shape, so don't
// "clean it up" without coordinating a dashboard release.
import { pool } from "../db";

export interface CustomerRow {
  id: string;
  company_name: string;
  contact_email: string;
  created_at: string;
}

export interface ProductRow {
  id: string;
  sku: string;
  name: string;
  unit_price_cents: number;
  stock: number;
}

export async function getCustomers(): Promise<CustomerRow[]> {
  const res = await pool.query(
    "SELECT id, company_name, contact_email, created_at FROM customers ORDER BY created_at DESC"
  );
  return res.rows;
}

export async function getCustomerById(id: string): Promise<CustomerRow | null> {
  const res = await pool.query(
    "SELECT id, company_name, contact_email, created_at FROM customers WHERE id = $1",
    [id]
  );
  return res.rows[0] ?? null;
}

export async function insertCustomer(input: {
  companyName: string;
  contactEmail: string;
}): Promise<CustomerRow> {
  const res = await pool.query(
    `INSERT INTO customers (company_name, contact_email)
     VALUES ($1, $2)
     RETURNING id, company_name, contact_email, created_at`,
    [input.companyName, input.contactEmail]
  );
  return res.rows[0];
}

export async function getProducts(): Promise<ProductRow[]> {
  const res = await pool.query(
    "SELECT id, sku, name, unit_price_cents, stock FROM products ORDER BY sku"
  );
  return res.rows;
}

export async function getProductById(id: string): Promise<ProductRow | null> {
  const res = await pool.query(
    "SELECT id, sku, name, unit_price_cents, stock FROM products WHERE id = $1",
    [id]
  );
  return res.rows[0] ?? null;
}
