// The test that did not exist.
//
// The chain's linearity was asserted by a comment ("one linear chain, no
// forks") and verified by tests that appended one row at a time — i.e. in
// exactly the condition where the property cannot be violated. Production
// violated it on the first concurrent burst: a fork at rows 1378/1379, found
// only because an unrelated audit happened to read /steward/integrity's body.
//
// Concurrency is not exotic here. `runActions` is fire-and-forget after the
// webhook response (steward/routes.ts), GitHub fans deliveries out in parallel,
// and the in-process scheduler appends on its own timers. A merge is the worst
// case: many appends at once.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { migrate } from "../../db/migrate.js";
import { appendAuditEvent } from "./audit.js";
import { verifyAuditChain } from "./tamper.js";

const url = process.env.DATABASE_URL ?? "postgres://acme@localhost:55432/steward_test";
const pool = new Pool({ connectionString: url });

describe("concurrent appends keep the chain linear", () => {
  beforeEach(async () => {
    await migrate(url);
    await pool.query("TRUNCATE audit_events");
  });
  afterAll(async () => { await pool.end(); });

  const event = (n: number) => ({
    installationId: 42,
    repo: "acme/orders",
    eventType: "push.direct_to_default",
    actor: "someone",
    payload: { n },
    plainEnglish: `concurrent append ${n}`,
  });

  /**
   * The property, asked of the database directly: every row's prev_hash is the
   * row_hash of its predecessor BY ID — which is what canonical-encoding.md §1
   * says, and what the statement-level lock in 0005 buys. Deliberately NOT
   * phrased in terms of the fork-reporting fields added alongside it, so this
   * exact file compiles against the pre-fix code and can be shown failing there.
   */
  async function misorderedRows(): Promise<number> {
    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM (
         SELECT prev_hash, lag(row_hash) OVER (ORDER BY id) AS prev_by_id FROM audit_events) q
        WHERE prev_hash IS DISTINCT FROM prev_by_id`
    );
    return rows[0].n;
  }

  it("40 simultaneous appends stay in one line", async () => {
    // A single Promise.all is the whole point: these overlap in the connection
    // pool the way real webhook deliveries do.
    await Promise.all(Array.from({ length: 40 }, (_, n) => appendAuditEvent(pool, event(n))));

    expect(await misorderedRows()).toBe(0);
    const chain = await verifyAuditChain(pool);
    expect(chain.checked).toBe(40);
    expect(chain.intact).toBe(true);
  });

  it("repeated bursts stay linear across transactions", async () => {
    for (let burst = 0; burst < 4; burst++) {
      await Promise.all(Array.from({ length: 10 }, (_, n) => appendAuditEvent(pool, event(burst * 10 + n))));
    }
    expect(await misorderedRows()).toBe(0);
    const chain = await verifyAuditChain(pool);
    expect(chain.intact).toBe(true);
    expect(chain.checked).toBe(40);
  });

  it("a burst interleaved with reads stays linear", async () => {
    // Reads take their own snapshots; the lock must not depend on writers being
    // the only traffic.
    await Promise.all([
      ...Array.from({ length: 20 }, (_, n) => appendAuditEvent(pool, event(n))),
      ...Array.from({ length: 5 }, () => pool.query("SELECT count(*) FROM audit_events")),
    ]);
    expect(await misorderedRows()).toBe(0);
  });
});
