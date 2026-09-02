// The portfolio table's own facts: the sparkline buckets, the merge count, and
// the decision headline. These are what the overview row says about a repo
// without opening it, so each one is checked against the same audit spine the
// repo's own screen reads.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { migrate } from "../../db/migrate.js";
import { buildOverview } from "./overview.js";
import { FLAGGED_BUCKETS } from "../digest/digest.js";

const url = process.env.DATABASE_URL ?? "postgres://acme@localhost:55432/steward_test";
const pool = new Pool({ connectionString: url });

// Append one back-dated event. The spine is append-only, so the timestamp goes
// in on the INSERT — the DB's own chain trigger still hashes the row, exactly as
// it would for a live event.
const ev = (repo: string, eventType: string, daysAgo = 0, payload: Record<string, unknown> = {}) =>
  pool.query(
    `INSERT INTO audit_events (ts, installation_id, repo, event_type, actor, payload, plain_english)
     VALUES (now() - make_interval(days => $1), 1, $2, $3, 'dana', $4::jsonb, $5)`,
    [daysAgo, repo, eventType, JSON.stringify(payload), `${eventType} in ${repo}`]
  );

const row = async (repo: string, days = 30) =>
  (await buildOverview(pool, [{ full_name: repo, private: true, default_branch: "trunk" }], days)).repos[0]!;

describe("portfolio overview", () => {
  beforeEach(async () => {
    await migrate(url);
    await pool.query("TRUNCATE audit_events");
  });
  afterAll(async () => {
    await pool.end();
  });

  it("carries the repo's visibility and default branch through from GitHub", async () => {
    await ev("acme/app", "protection.configured");
    const r = await row("acme/app");
    expect(r.private).toBe(true);
    expect(r.defaultBranch).toBe("trunk");
  });

  it("counts merges as everything that reached the default branch", async () => {
    await ev("acme/app", "pull_request.merged", 1);
    await ev("acme/app", "pull_request.merged", 2);
    await ev("acme/app", "push.direct_to_default", 3);
    await ev("acme/app", "pull_request.opened", 4); // opened is not a merge
    await ev("acme/app", "pull_request.merged", 40); // outside a 30-day window
    expect((await row("acme/app")).merges).toBe(3);
  });

  it("splits flagged events into buckets that sum to the flagged count", async () => {
    await ev("acme/app", "protection.weakened", 1); // newest bucket
    await ev("acme/app", "push.direct_to_default", 2);
    await ev("acme/app", "push.direct_to_default", 28); // oldest bucket
    const r = await row("acme/app");
    expect(r.flaggedBuckets).toHaveLength(FLAGGED_BUCKETS);
    expect(r.flaggedBuckets.reduce((a, b) => a + b, 0)).toBe(r.flagged);
    expect(r.flagged).toBe(3);
    expect(r.flaggedBuckets[FLAGGED_BUCKETS - 1]).toBe(2); // the two recent ones
    expect(r.flaggedBuckets[0]).toBe(1);
  });

  it("gives a repo with no history ten empty buckets rather than nothing to draw", async () => {
    const r = await row("acme/quiet");
    expect(r.flaggedBuckets).toEqual(new Array(FLAGGED_BUCKETS).fill(0));
    expect(r.merges).toBe(0);
    expect(r.flagged).toBe(0);
  });

  it("names the worst outstanding decision, with the repo's real branch", async () => {
    expect((await row("acme/app")).decision).toBe("trunk isn't protected yet");
  });

  it("says nothing to decide about drift CodeWorthy corrects itself", async () => {
    // The engine, not a lookalike table of headlines: weakened protection is
    // only a decision in report-only mode, and the default is to restore it.
    await ev("acme/app", "protection.configured", 5);
    await ev("acme/app", "protection.weakened", 1);
    expect((await row("acme/app")).decision).toBeNull();
  });

  it("says nothing to decide once the finding is accepted", async () => {
    await ev("acme/app", "protection.configured", 5);
    await ev("acme/app", "push.direct_to_default", 2);
    await ev("acme/app", "pull_request.merged", 3);
    expect((await row("acme/app")).decision).toMatch(/went straight to trunk/);

    await ev("acme/app", "issue.accepted", 1, { issueId: "direct_pushes" });
    expect((await row("acme/app")).decision).toBeNull();
  });

  it("raises an accepted finding again once the acceptance is withdrawn", async () => {
    // The acceptance is never deleted — withdrawing it appends the reversal, so
    // "is this accepted?" has to read the LATEST of the two, not just whether
    // an acceptance exists.
    await ev("acme/app", "protection.configured", 6);
    await ev("acme/app", "push.direct_to_default", 5);
    await ev("acme/app", "pull_request.merged", 5);
    await ev("acme/app", "issue.accepted", 3, { issueId: "direct_pushes" });
    expect((await row("acme/app")).decision).toBeNull();

    await ev("acme/app", "issue.unaccepted", 2, { issueId: "direct_pushes" });
    expect((await row("acme/app")).decision).toMatch(/went straight to trunk/);

    // And it can be accepted again after that.
    await ev("acme/app", "issue.accepted", 1, { issueId: "direct_pushes" });
    expect((await row("acme/app")).decision).toBeNull();
  });

  it("drops the direct-push decision in solo mode, where it is the workflow", async () => {
    await ev("acme/app", "protection.configured", 5);
    await ev("acme/app", "push.direct_to_default", 2);
    await ev("acme/app", "pull_request.merged", 3);
    await ev("acme/app", "repo.mode_set", 1, { mode: "solo" });
    expect((await row("acme/app")).decision).toBeNull();
  });

  it("counts every status band so the title row can report them", async () => {
    await ev("acme/weak", "protection.weakened", 1);
    await ev("acme/good", "protection.configured", 1);
    const o = await buildOverview(pool, ["acme/weak", "acme/good", "acme/silent"], 30);
    expect(o.totals).toMatchObject({ repos: 3, atRisk: 1, healthy: 1, needsAttention: 1 });
    expect(o.totals.atRisk + o.totals.needsAttention + o.totals.healthy + o.totals.quiet).toBe(o.totals.repos);
    // Worst first — the table is read top-down.
    expect(o.repos.map((r) => r.full_name)).toEqual(["acme/weak", "acme/silent", "acme/good"]);
  });

  it("still accepts a bare list of names, defaulting the branch to main", async () => {
    const o = await buildOverview(pool, ["acme/app"], 30);
    expect(o.repos[0]!.defaultBranch).toBe("main");
    expect(o.repos[0]!.decision).toBe("main isn't protected yet");
    expect(o.repos[0]!.private).toBe(false);
  });
});
