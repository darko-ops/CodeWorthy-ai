import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { migrate } from "../db/migrate.js";
import { appendAuditEvent } from "./audit/audit.js";
import { InMemoryAnchor } from "./audit/tamper.js";
import { runScheduledJobs, startScheduler } from "./scheduler.js";

const url = process.env.DATABASE_URL ?? "postgres://acme@localhost:55432/steward_test";
const pool = new Pool({ connectionString: url });

describe("in-process scheduler", () => {
  beforeEach(async () => { await migrate(url); await pool.query("TRUNCATE audit_events"); });
  afterAll(async () => { await pool.end(); });

  it("runScheduledJobs runs the anchor job (and the digest no-ops without recipients)", async () => {
    await appendAuditEvent(pool, { installationId: 1, repo: "acme/app", eventType: "pull_request.opened", actor: "raj", payload: {}, plainEnglish: "raj opened PR #1." });
    const anchor = new InMemoryAnchor();
    const logs: string[] = [];

    await runScheduledJobs(pool, { anchor }, (l) => logs.push(l));

    // the anchor tick pinned the head to the injected anchor
    expect(await anchor.latest()).not.toBeNull();
    expect(logs.join("\n")).toMatch(/anchor: anchored/);
    // digest tick ran and reported no recipients (never threw)
    expect(logs.join("\n")).toMatch(/digest: no-recipients/);
  });

  it("keeps going if one job throws — the other still runs", async () => {
    const logs: string[] = [];
    // A broken anchor whose latest() throws makes the anchor job reject; the
    // digest job must still run.
    const brokenAnchor = { append: () => Promise.resolve(), latest: () => Promise.reject(new Error("s3 down")) } as any;
    await runScheduledJobs(pool, { anchor: brokenAnchor }, (l) => logs.push(l));
    expect(logs.join("\n")).toMatch(/anchor failed: s3 down/);
    expect(logs.join("\n")).toMatch(/digest: no-recipients/);
  });

  it("startScheduler returns a stoppable handle without blocking", () => {
    const logs: string[] = [];
    const handle = startScheduler(pool, { anchor: new InMemoryAnchor() }, { anchorMs: 3_600_000, digestMs: 7_200_000, log: (l) => logs.push(l) });
    expect(typeof handle.stop).toBe("function");
    expect(logs.join("\n")).toMatch(/scheduler] started/);
    handle.stop(); // clears the timers; no throw
  });
});
