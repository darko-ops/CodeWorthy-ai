import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { migrate } from "../../db/migrate.js";
import { appendAuditEvent, recentChangelog } from "./audit.js";

const url = process.env.DATABASE_URL ?? "postgres://acme@localhost:55432/steward_test";
const pool = new Pool({ connectionString: url });

describe("audit spine", () => {
  beforeAll(async () => {
    await migrate(url);
    await pool.query("TRUNCATE audit_events");
  });
  afterAll(async () => { await pool.end(); });

  it("appends an event and reads it back through the change log", async () => {
    const id = await appendAuditEvent(pool, {
      installationId: 42, repo: "acme/app", eventType: "push.direct_to_default",
      actor: "dana", payload: { branch: "main", commits: 3 },
      plainEnglish: "dana pushed 3 commit(s) straight to main in acme/app — no pull request reviewed them.",
    });
    expect(id).toBeTruthy();
    const log = await recentChangelog(pool, { repo: "acme/app" });
    expect(log).toHaveLength(1);
    expect(log[0]!.plain_english).toContain("straight to main");
    expect(log[0]!.event_type).toBe("push.direct_to_default");
  });

  it("is append-only: UPDATE is blocked at the schema level", async () => {
    await expect(pool.query("UPDATE audit_events SET actor = 'tampered'")).rejects.toThrow(/append-only/i);
  });

  it("is append-only: DELETE is blocked at the schema level", async () => {
    await expect(pool.query("DELETE FROM audit_events")).rejects.toThrow(/append-only/i);
  });

  it("preserves the row after the blocked mutations", async () => {
    const log = await recentChangelog(pool);
    expect(log.length).toBeGreaterThanOrEqual(1);
    expect(log[0]!.actor).toBe("dana"); // never became 'tampered'
  });
});
