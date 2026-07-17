// Seeds demo data for local development. Safe to run repeatedly.
import { Client } from "pg";
import { config } from "../src/config";

const customers = [
  { companyName: "Bluewater Supply Co", contactEmail: "purchasing@bluewater.example" },
  { companyName: "Harbor & Lane", contactEmail: "ops@harborlane.example" },
  { companyName: "Northfield Retail Group", contactEmail: "orders@northfield.example" },
];

const products = [
  { sku: "AC-1001", name: "Stainless carabiner (50 pack)", unitPriceCents: 4500, stock: 240 },
  { sku: "AC-1002", name: "Paracord reel 300m", unitPriceCents: 12900, stock: 80 },
  { sku: "AC-2200", name: "Trail lantern", unitPriceCents: 3900, stock: 150 },
  { sku: "AC-2210", name: "Trail lantern mount", unitPriceCents: 900, stock: 400 },
  { sku: "AC-3350", name: "Field repair kit", unitPriceCents: 8800, stock: 60 },
];

async function seed() {
  const client = new Client({ connectionString: config.databaseUrl });
  await client.connect();
  try {
    for (const c of customers) {
      await client.query(
        `INSERT INTO customers (company_name, contact_email)
         VALUES ($1, $2) ON CONFLICT (contact_email) DO NOTHING`,
        [c.companyName, c.contactEmail]
      );
    }
    for (const p of products) {
      await client.query(
        `INSERT INTO products (sku, name, unit_price_cents, stock)
         VALUES ($1, $2, $3, $4) ON CONFLICT (sku) DO NOTHING`,
        [p.sku, p.name, p.unitPriceCents, p.stock]
      );
    }
    console.log(`seeded ${customers.length} customers, ${products.length} products`);
  } finally {
    await client.end();
  }
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
