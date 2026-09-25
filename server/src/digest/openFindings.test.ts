// What the repo listing's flag column counts.
//
// A repo that was fully healthy still showed flags, for two reasons:
//
//   1. Every direct push produced a mechanic.retroactive_review as well —
//      CodeWorthy's RESPONSE to the finding — and both were counted. One
//      unreviewed change scored as two problems, so a repo looked twice as bad
//      for the fact that CodeWorthy had already dealt with it.
//   2. Nothing was ever uncounted. A weakening that was restored, or a push
//      from before protection went on, kept counting for the rest of the
//      window — so the number could not reach zero by fixing anything.
//
// These are DB-backed (the rule is SQL) and run in CI against real Postgres.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { migrate } from "../../db/migrate.js";
import { alertEventTypes, flaggedBucketsByRepo, flaggedCountsByRepo, openFlagEventTypes } from "./digest.js";

const url = process.env.DATABASE_URL ?? "postgres://acme@localhost:55432/steward_test";
const pool = new Pool({ connectionString: url });

/** Append an event `minutesAgo` in the past, so ordering is explicit. */
async function ev(repo: string, type: string, minutesAgo: number) {
  await pool.query(
    `INSERT INTO audit_events (installation_id, repo, event_type, actor, payload, plain_english, ts)
     VALUES (1, $1, $2, 'someone', '{}'::jsonb, $2, now() - make_interval(mins => $3))`,
    [repo, type, minutesAgo]
  );
}
const count = async (repo: string) => (await flaggedCountsByRepo(pool, [repo], 30))[repo] ?? 0;

afterAll(async () => { await pool.end(); });
beforeEach(async () => { await migrate(url); await pool.query("TRUNCATE audit_events"); });

describe("what counts as an open finding", () => {
  it("counts the whole exception.* family, not just the named ones", async () => {
    // alertEventTypes() reads the CATEGORY map; the "any exception.* is an
    // alert" contract lives in the display fallback. So these were categorised
    // as alerts everywhere a human could read them, and counted nowhere.
    await ev("a/b", "exception.protection_bypassed", 30);
    await ev("a/b", "exception.gate_unavailable", 29);
    expect(await count("a/b")).toBe(2);
    expect(openFlagEventTypes()).not.toContain("exception.protection_bypassed"); // named list doesn't have it
  });

  it("does not count CodeWorthy's own response as a second problem", async () => {
    await ev("a/b", "push.direct_to_default", 60);
    await ev("a/b", "mechanic.retroactive_review", 59); // the response, not a finding
    expect(await count("a/b")).toBe(1);
    expect(openFlagEventTypes()).not.toContain("mechanic.retroactive_review");
    // still categorised for the digest — it just isn't COUNTED
    expect(alertEventTypes()).toContain("mechanic.retroactive_review");
  });

  it("stops counting direct pushes once protection is turned on", async () => {
    await ev("a/b", "push.direct_to_default", 60);
    await ev("a/b", "push.direct_to_default", 55);
    expect(await count("a/b")).toBe(2);
    await ev("a/b", "protection.configured", 50);
    expect(await count("a/b")).toBe(0); // the cause is closed off
  });

  it("counts a push that happened AFTER protection went on", async () => {
    // That is a bypass — a real, current finding.
    await ev("a/b", "protection.configured", 60);
    await ev("a/b", "push.direct_to_default", 30);
    expect(await count("a/b")).toBe(1);
  });

  it("stops counting a weakening once protection is restored", async () => {
    await ev("a/b", "exception.protection_weakened", 40);
    expect(await count("a/b")).toBe(1);
    await ev("a/b", "protection.restored", 39);
    expect(await count("a/b")).toBe(0);
  });

  it("stops counting a gate that could not run once one runs", async () => {
    await ev("a/b", "exception.gate_unavailable", 40);
    expect(await count("a/b")).toBe(1);
    await ev("a/b", "gate.evaluated", 20);
    expect(await count("a/b")).toBe(0);
  });

  it("keeps counting what a later setting cannot undo", async () => {
    // A force-push rewrote history; a bypass put an unreviewed change live.
    // Turning protection on afterwards does not unmake either.
    await ev("a/b", "exception.force_push", 60);
    await ev("a/b", "exception.protection_bypassed", 55);
    await ev("a/b", "protection.configured", 50);
    expect(await count("a/b")).toBe(2);
  });

  it("reaches zero for a repo that is now healthy", async () => {
    // The reported bug, end to end.
    await ev("a/b", "push.direct_to_default", 120);
    await ev("a/b", "mechanic.retroactive_review", 119);
    await ev("a/b", "push.direct_to_default", 100);
    await ev("a/b", "mechanic.retroactive_review", 99);
    expect(await count("a/b")).toBe(2); // two pushes; the two responses aren't findings
    await ev("a/b", "protection.configured", 90);
    expect(await count("a/b")).toBe(0);
  });
});

describe("the trend and the number agree", () => {
  it("bars always sum to the count", async () => {
    // They are drawn from one SQL fragment for exactly this reason.
    await ev("a/b", "exception.force_push", 300);
    await ev("a/b", "push.direct_to_default", 200);
    await ev("a/b", "mechanic.retroactive_review", 199);
    await ev("a/b", "exception.protection_bypassed", 100);

    const n = await count("a/b");
    const buckets = (await flaggedBucketsByRepo(pool, ["a/b"], 30))["a/b"] ?? [];
    expect(buckets.reduce((t, x) => t + x, 0)).toBe(n);
  });

  it("a healthy repo draws no bars", async () => {
    await ev("a/b", "push.direct_to_default", 200);
    await ev("a/b", "protection.configured", 100);
    const buckets = (await flaggedBucketsByRepo(pool, ["a/b"], 30))["a/b"] ?? [];
    expect(buckets.reduce((t, x) => t + x, 0)).toBe(0);
  });
});
