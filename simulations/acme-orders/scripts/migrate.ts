// Applies db/migrations/*.sql in filename order, tracking progress in
// schema_migrations. Safe to run repeatedly.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";
import { config } from "../src/config";

export async function migrate(databaseUrl: string = config.databaseUrl) {
  // npm scripts and the test runner both execute with the package root as cwd.
  const dir = join(process.cwd(), "db", "migrations");
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
         name text PRIMARY KEY,
         applied_at timestamptz NOT NULL DEFAULT now()
       )`
    );
    for (const file of files) {
      const seen = await client.query("SELECT 1 FROM schema_migrations WHERE name = $1", [file]);
      if ((seen.rowCount ?? 0) > 0) continue;
      const sql = readFileSync(join(dir, file), "utf8");
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [file]);
        await client.query("COMMIT");
        console.log(`applied ${file}`);
      } catch (err) {
        await client.query("ROLLBACK");
        throw new Error(`migration ${file} failed: ${err instanceof Error ? err.message : err}`);
      }
    }
  } finally {
    await client.end();
  }
}

// Guarded so the test suite can import migrate() without running it.
if (typeof require !== "undefined" && require.main === module) {
  migrate().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
