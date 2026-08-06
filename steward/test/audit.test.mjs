import { test } from "node:test";
import assert from "node:assert/strict";
import { canonical, chainHash, GENESIS, appendEvent, verifyChain } from "../src/audit.mjs";

// A minimal in-memory pool implementing the exact queries audit.mjs issues.
function fakePool() {
  const rows = [];
  let nextId = 1;
  const client = {
    async query(sql, params) {
      if (sql.startsWith("BEGIN") || sql.startsWith("COMMIT") || sql.startsWith("ROLLBACK")) return {};
      if (sql.includes("pg_advisory_xact_lock")) return {};
      if (sql.startsWith("SELECT hash FROM audit_events")) {
        const repoRows = rows.filter((r) => r.repo === params[0]);
        const last = repoRows[repoRows.length - 1];
        return { rows: last ? [{ hash: last.hash }] : [] };
      }
      if (sql.startsWith("INSERT INTO audit_events")) {
        const row = {
          id: nextId++,
          installation_id: params[0],
          repo: params[1],
          actor: params[2],
          event_type: params[3],
          payload: params[4],
          plain_english: params[5],
          prev_hash: params[6],
          hash: params[7],
        };
        rows.push(row);
        return { rows: [{ id: row.id, occurred_at: new Date().toISOString() }] };
      }
      throw new Error(`unexpected client sql: ${sql}`);
    },
    release() {},
  };
  return {
    rows,
    async connect() {
      return client;
    },
    async query(sql, params) {
      if (sql.includes("ORDER BY id ASC")) {
        return { rows: rows.filter((r) => r.repo === params[0]) };
      }
      throw new Error(`unexpected pool sql: ${sql}`);
    },
  };
}

const evt = (n) => ({
  installationId: 1,
  repo: "acme/shop",
  actor: "dana",
  eventType: "direct_push_to_default",
  payload: { n },
  plainEnglish: `event ${n}`,
});

test("canonical serialization is key-order independent", () => {
  assert.equal(canonical({ b: 1, a: { d: 2, c: 3 } }), canonical({ a: { c: 3, d: 2 }, b: 1 }));
});

test("chain links: each hash depends on the previous", async () => {
  const pool = fakePool();
  const first = await appendEvent(pool, evt(1));
  const second = await appendEvent(pool, evt(2));
  assert.equal(first.prevHash, GENESIS);
  assert.equal(second.prevHash, first.hash);
  assert.notEqual(first.hash, second.hash);
});

test("verifyChain passes on an intact chain and localizes tampering", async () => {
  const pool = fakePool();
  for (let i = 1; i <= 5; i++) await appendEvent(pool, evt(i));
  assert.equal((await verifyChain(pool, "acme/shop")).ok, true);

  // Tamper with row 3's plain-language line (what a cover-up would edit).
  pool.rows[2].plain_english = "nothing happened here";
  const result = await verifyChain(pool, "acme/shop");
  assert.equal(result.ok, false);
  assert.equal(result.brokenAtId, 3);
});

test("chains are per-repo", async () => {
  const pool = fakePool();
  await appendEvent(pool, evt(1));
  const other = await appendEvent(pool, { ...evt(2), repo: "acme/site" });
  assert.equal(other.prevHash, GENESIS);
});

test("hash changes if any hashed field changes", () => {
  const base = evt(1);
  const h = chainHash(GENESIS, base);
  assert.notEqual(h, chainHash(GENESIS, { ...base, actor: "mallory" }));
  assert.notEqual(h, chainHash(GENESIS, { ...base, plainEnglish: "edited" }));
  assert.notEqual(h, chainHash(GENESIS, { ...base, payload: { n: 999 } }));
});
