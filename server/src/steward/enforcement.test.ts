// The enforcement spine, end to end: the gate that posts the merge-blocking
// check, and the protection that makes that check mean something.
//
// The thing under test is not "did we notice" — the old behavior noticed fine.
// It is "did we ACT, and is both the deviation and the action in the record".
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { migrate } from "../../db/migrate.js";
import { GitHubHttpError } from "../github/client.js";
import { FakeGitHub } from "../testing/fakeGitHub.js";
import { runActions } from "./actions.js";
import { ensureProtection, enforceProtection, installationEverConsented, protectionEverConfigured } from "./enforce.js";
import { runGate } from "./gate/check.js";
import { runProtectionJob } from "./protection-job.js";
import { STEWARD_CHECK } from "./protection.js";
import { desiredRuleset, RULESET_NAME } from "./rulesets.js";

const url = process.env.DATABASE_URL ?? "postgres://acme@localhost:55432/steward_test";
const pool = new Pool({ connectionString: url });

class Fake extends FakeGitHub {}

const FORBIDDEN = /merge|force|delete/i;

const events = async (type?: string) =>
  (await pool.query(
    type
      ? "SELECT repo, event_type, actor, payload, plain_english FROM audit_events WHERE event_type = $1 ORDER BY id"
      : "SELECT repo, event_type, actor, payload, plain_english FROM audit_events ORDER BY id",
    type ? [type] : []
  )).rows;
const types = async () => (await events()).map((r) => r.event_type);

/** A live ruleset that matches what we want. */
const liveRuleset = () => ({ id: 77, ...desiredRuleset() });
/** …and one someone has loosened. */
const weakenedRuleset = () => {
  const rs = liveRuleset();
  rs.rules = rs.rules.filter((r) => r.type !== "non_fast_forward") as typeof rs.rules;
  return rs;
};

const protectedRepo = (c: Fake) => {
  c.rulesets = [{ id: 77, name: RULESET_NAME, enforcement: "active" }];
  c.ruleset = liveRuleset();
};

afterAll(async () => { await pool.end(); });
beforeEach(async () => {
  await migrate(url);
  await pool.query("TRUNCATE audit_events");
  await pool.query("TRUNCATE coverage_windows");
});

describe("putting protection in place", () => {
  it("creates the ruleset we designed, and records it in plain language", async () => {
    const c = new Fake();
    const r = await ensureProtection(c, pool, "dana/app", 42);

    expect(r).toMatchObject({ mechanism: "ruleset", action: "created" });
    const [, sent] = c.argsFor("createRepoRuleset")[0] as [string, any];
    expect(sent.name).toBe(RULESET_NAME);
    expect(sent.conditions.ref_name.include).toEqual(["~DEFAULT_BRANCH"]);
    expect(sent.rules.find((x: any) => x.type === "required_status_checks").parameters.required_status_checks)
      .toEqual([{ context: STEWARD_CHECK }]);

    const [ev] = await events("protection.configured");
    expect(ev.payload.mechanism).toBe("ruleset");
    expect(ev.plain_english).toContain("pull request");
    expect(ev.plain_english).toContain("admin"); // the bypass is disclosed, not hidden
    expect(c.names().some((m) => FORBIDDEN.test(m))).toBe(false);
  });

  it("updates the existing ruleset instead of stacking a second one", async () => {
    const c = new Fake();
    protectedRepo(c);
    const r = await ensureProtection(c, pool, "dana/app", 42);
    expect(r.action).toBe("updated");
    expect(c.countOf("createRepoRuleset")).toBe(0);
    expect(c.countOf("updateRepoRuleset")).toBe(1);
  });

  it("falls back to the older mechanism rather than leaving a repo unprotected", async () => {
    const c = new Fake();
    c.createRepoRuleset = (...a: any[]) => { c.calls.push({ m: "createRepoRuleset", args: a }); return Promise.reject(new Error("404 rulesets")); };

    const r = await ensureProtection(c, pool, "dana/app", 42, { defaultBranch: "trunk" });
    expect(r.mechanism).toBe("branch-protection");
    expect(c.argsFor("setBranchProtection")[0]![1]).toBe("trunk");
    expect(await types()).toContain("protection.fallback");
  });
});

describe("keeping protection in place", () => {
  it("says nothing when the rule is intact", async () => {
    const c = new Fake();
    protectedRepo(c);
    const r = await enforceProtection(c, pool, "dana/app", 42);
    expect(r.status).toBe("healthy");
    expect(await events()).toEqual([]); // a healthy check is not news
  });

  it("restores a weakened rule and records BOTH the weakening and the fix", async () => {
    const c = new Fake();
    c.rulesets = [{ id: 77, name: RULESET_NAME, enforcement: "active" }];
    c.ruleset = weakenedRuleset();

    const r = await enforceProtection(c, pool, "dana/app", 42, { trigger: "webhook:test" });
    expect(r.status).toBe("restored");
    expect(r.weakenings).toContain("force-pushes are now allowed");

    const log = await types();
    expect(log).toContain("exception.protection_weakened");
    expect(log).toContain("protection.restored");
    expect(c.countOf("updateRepoRuleset")).toBe(1); // it actually put it back

    const [exc] = await events("exception.protection_weakened");
    expect(exc.plain_english).toContain("force-pushes are now allowed");
    expect(exc.payload.trigger).toBe("webhook:test");
  });

  it("reports without correcting when the operator chose report-only", async () => {
    const c = new Fake();
    c.rulesets = [{ id: 77, name: RULESET_NAME, enforcement: "active" }];
    c.ruleset = weakenedRuleset();

    const r = await enforceProtection(c, pool, "dana/app", 42, { restore: false });
    expect(r).toMatchObject({ status: "weakened", restored: false });
    expect(c.countOf("updateRepoRuleset")).toBe(0);
    expect(c.countOf("createRepoRuleset")).toBe(0);
    expect(await types()).not.toContain("protection.restored");
  });

  it("treats a vanished ruleset as protection being off, and puts it back", async () => {
    const c = new Fake(); // no rulesets, no legacy protection
    const r = await enforceProtection(c, pool, "dana/app", 42);
    expect(r.status).toBe("restored");
    expect(r.weakenings[0]).toContain("off entirely");
    expect(c.countOf("createRepoRuleset")).toBe(1);
  });

  it("does not confuse 'we can't look' with 'there is no protection'", async () => {
    // A 403 must never be read as "unprotected" — that would have the
    // reconciler write repo settings on the strength of a permissions error.
    const c = new Fake();
    c.listRepoRulesets = () => Promise.reject(new GitHubHttpError(403, "GET", "/repos/dana/app/rulesets"));

    const r = await enforceProtection(c, pool, "dana/app", 42);
    expect(r.status).toBe("error");
    expect(c.countOf("createRepoRuleset")).toBe(0); // it touched nothing
    expect(c.countOf("setBranchProtection")).toBe(0);
    expect(await types()).toContain("exception.protection_check_failed");
  });

  it("falls through to the legacy mechanism when the rulesets API is a 404", async () => {
    // An older host has no rulesets endpoint at all. A repo protected the old
    // way must still read as healthy, not as an error every hour.
    const c = new Fake();
    c.listRepoRulesets = () => Promise.reject(new GitHubHttpError(404, "GET", "/repos/dana/app/rulesets"));
    c.protection = {
      allow_force_pushes: { enabled: false },
      allow_deletions: { enabled: false },
      required_pull_request_reviews: {},
      required_status_checks: { contexts: [STEWARD_CHECK] },
    };

    const r = await enforceProtection(c, pool, "dana/app", 42);
    expect(r.status).toBe("healthy");
    expect(await events()).toEqual([]);
  });

  it("repairs the mechanism that drifted, instead of layering a ruleset over it", async () => {
    // Found by weakening a real repo and watching. Restoring by always creating
    // a ruleset "works" — GitHub applies the most restrictive rule — but it
    // leaves the weakened legacy rule sitting there permissive and
    // contradicting the ruleset beside it, while the record claims the setting
    // was restored. Effectively right is not right when the record is the
    // product.
    const c = new Fake();
    c.rulesets = []; // no ruleset here; this repo is on the legacy mechanism
    c.protection = {
      allow_force_pushes: { enabled: true }, // ← the drift
      allow_deletions: { enabled: false },
      required_pull_request_reviews: {},
      required_status_checks: { contexts: [STEWARD_CHECK] },
    };

    const r = await enforceProtection(c, pool, "dana/legacy", 42);
    expect(r.status).toBe("restored");
    expect(r.weakenings).toContain("force-pushes are now allowed");

    expect(c.countOf("setBranchProtection")).toBe(1); // repaired in place
    expect(c.countOf("createRepoRuleset")).toBe(0); // NOT layered over
    const [restored] = await events("protection.restored");
    expect(restored.payload.mechanism).toBe("branch-protection");
    expect(restored.plain_english).toContain("not by adding a second rule on top");
  });

  it("still repairs a solo repo with a ruleset — legacy cannot express solo", async () => {
    // The one exception: the legacy mechanism can only require a pull request
    // or protect nothing, and requiring a PR is exactly what solo mode exists
    // to avoid. So a drifted solo repo is repaired with a ruleset even though
    // the drift was found on legacy.
    await pool.query(
      `INSERT INTO audit_events (installation_id, repo, event_type, actor, payload, plain_english)
       VALUES (42, 'dana/solo', 'repo.mode_set', 'dana', '{"mode":"solo"}'::jsonb, 'solo')`
    );
    const c = new Fake();
    c.rulesets = [];
    c.protection = { allow_force_pushes: { enabled: true }, allow_deletions: { enabled: false }, required_pull_request_reviews: {}, required_status_checks: { contexts: [STEWARD_CHECK] } };

    const r = await enforceProtection(c, pool, "dana/solo", 42);
    expect(r.restored).toBe(true);
    expect(c.countOf("createRepoRuleset")).toBe(1);
    expect(c.countOf("setBranchProtection")).toBe(0);
  });

  it("records an unreadable repo as an exception rather than assuming it's fine", async () => {
    const c = new Fake();
    c.listRepoRulesets = () => Promise.reject(new Error("401"));
    c.getBranchProtection = () => Promise.reject(new Error("401"));

    const r = await enforceProtection(c, pool, "dana/app", 42);
    expect(r.status).toBe("error");
    expect(await types()).toContain("exception.protection_check_failed");
  });
});

describe("noticing when someone gets past the rule", () => {
  it("calls a direct push to a protected branch what it is: a bypass", async () => {
    const c = new Fake();
    protectedRepo(c);
    await ensureProtection(c, pool, "dana/app", 42); // consent + protection on record
    expect(await protectionEverConfigured(pool, "dana/app")).toBe(true);

    await runActions(pool, "push", {
      installation: { id: 42 },
      repository: { full_name: "dana/app", default_branch: "main" },
      ref: "refs/heads/main",
      after: "abc123def456",
      commits: [{ id: "abc123def456" }],
      pusher: { name: "dana" },
    }, { client: c });

    const [bypass] = await events("exception.protection_bypassed");
    expect(bypass.actor).toBe("dana");
    expect(bypass.plain_english).toContain("while branch protection was on");
    // and it still leaves the reviewable trail the mechanic provides
    expect(await types()).toContain("mechanic.retroactive_review");
  });

  it("does not cry bypass on a repo that was never protected", async () => {
    const c = new Fake();
    await runActions(pool, "push", {
      installation: { id: 42 },
      repository: { full_name: "dana/app", default_branch: "main" },
      ref: "refs/heads/main",
      after: "abc123def456",
      commits: [{ id: "abc123def456" }],
      pusher: { name: "dana" },
    }, { client: c });

    expect(await types()).not.toContain("exception.protection_bypassed");
    expect(await types()).toContain("mechanic.retroactive_review");
  });

  it("re-checks the rule the moment a protection webhook says it changed", async () => {
    const c = new Fake();
    await ensureProtection(c, pool, "dana/app", 42);
    c.rulesets = [{ id: 77, name: RULESET_NAME, enforcement: "active" }];
    c.ruleset = weakenedRuleset();

    await runActions(pool, "repository_ruleset", {
      action: "edited",
      installation: { id: 42 },
      repository: { full_name: "dana/app", default_branch: "main" },
      repository_ruleset: { name: RULESET_NAME },
      sender: { login: "dana" },
    }, { client: c });

    expect(await types()).toContain("protection.restored");
  });
});

describe("consent", () => {
  it("extends an installation's yes to a repo added later", async () => {
    const c = new Fake();
    await ensureProtection(c, pool, "dana/first", 42); // the original consent
    expect(await installationEverConsented(pool, 42)).toBe(true);

    await runActions(pool, "installation_repositories", {
      action: "added",
      installation: { id: 42 },
      repositories_added: [{ full_name: "dana/second", default_branch: "main" }],
    }, { client: c });

    const configured = await events("protection.configured");
    expect(configured.map((r) => r.repo)).toEqual(["dana/first", "dana/second"]);
  });

  it("does not protect a repo for an installation that never said yes", async () => {
    const c = new Fake();
    await runActions(pool, "installation_repositories", {
      action: "added",
      installation: { id: 99 },
      repositories_added: [{ full_name: "dana/second", default_branch: "main" }],
    }, { client: c });

    expect(c.countOf("createRepoRuleset")).toBe(0);
    expect(await events()).toEqual([]);
  });
});

describe("the gate: the check that blocks the merge", () => {
  const prPayload = (over: any = {}) => ({
    action: "opened",
    installation: { id: 42 },
    repository: { full_name: "dana/app", default_branch: "main" },
    pull_request: { number: 7, head: { sha: "deadbeefcafe" }, user: { login: "dana" }, title: "t", body: "b" },
    ...over,
  });

  it("fails the required check when it finds something blocking", async () => {
    const c = new Fake();
    c.files = [{ filename: "src/a.ts", status: "modified", additions: 1, patch: "@@\n+const k = 'AKIAIOSFODNN7EXAMPLE';" }];

    await runActions(pool, "pull_request", prPayload(), { client: c });

    const check = c.lastCheckRun()!;
    expect(check.name).toBe(STEWARD_CHECK); // the context branch protection requires
    expect(check.conclusion).toBe("failure"); // ...and this is what disables merge
    expect(check.headSha).toBe("deadbeefcafe");

    const [ev] = await events("gate.evaluated");
    expect(ev.payload.decision).toBe("blocked");
    expect(ev.payload.findings.map((f: any) => f.id)).toContain("secret_introduced");
    expect(ev.plain_english).toContain("blocked");
    // it blocks by reporting, never by touching the merge
    expect(c.names().some((m) => FORBIDDEN.test(m))).toBe(false);
  });

  it("passes the check on a clean change, and says so on the PR", async () => {
    const c = new Fake();
    c.files = [
      { filename: "src/a.ts", status: "modified", additions: 1, patch: "@@\n+export const x = 1;" },
      { filename: "src/a.test.ts", status: "modified", additions: 1, patch: "@@\n+it('works', () => {})" },
    ];
    c.commits = [{ commit: { message: "make the order client retry idempotently" } }];
    c.checkRuns = { check_runs: [{ name: "ci", status: "completed", conclusion: "success" }] };

    await runActions(pool, "pull_request", prPayload(), { client: c });

    expect(c.lastCheckRun()!.conclusion).toBe("success");
    expect((await events("gate.evaluated"))[0].payload.decision).toBe("clean");
    // nothing to say => no comment noise on a clean PR
    expect(c.countOf("createReviewComment")).toBe(0);
  });

  it("blocks a change whose own tests are red, and unblocks it when they go green", async () => {
    const c = new Fake();
    c.files = [{ filename: "src/a.ts", status: "modified", additions: 1, patch: "@@\n+export const x = 1;" }];
    c.checkRuns = { check_runs: [{ name: "unit tests", status: "completed", conclusion: "failure" }] };

    // The repo's CI finishing is what tells us the answer changed.
    const suite = {
      action: "completed",
      installation: { id: 42 },
      repository: { full_name: "dana/app", default_branch: "main" },
      check_suite: { head_sha: "deadbeefcafe", pull_requests: [{ number: 7 }] },
    };
    await runActions(pool, "check_suite", suite, { client: c });
    expect(c.lastCheckRun()!.conclusion).toBe("failure");

    c.checkRuns = { check_runs: [{ name: "unit tests", status: "completed", conclusion: "success" }] };
    await runActions(pool, "check_suite", suite, { client: c });
    expect(c.lastCheckRun()!.conclusion).toBe("success");
  });

  it("reports 'couldn't review' rather than passing when GitHub won't answer", async () => {
    // The dangerous failure mode is a silent pass. The other dangerous one is a
    // check that never reports, which blocks the repo forever. Neither is OK.
    const c = new Fake();
    c.getPullRequestFiles = () => Promise.reject(new Error("502 upstream"));

    const outcome = await runGate(c, pool, {
      repo: "dana/app", number: 7, headSha: "deadbeefcafe", author: "dana", installationId: 42,
    });

    expect(outcome.decision).toBe("unavailable");
    expect(c.lastCheckRun()!.conclusion).toBe("neutral");
    expect(await types()).toContain("exception.gate_unavailable");
  });

  it("does not re-post an unchanged verdict when a webhook is redelivered", async () => {
    const c = new Fake();
    c.files = [{ filename: "src/a.ts", status: "modified", additions: 1, patch: "@@\n+const k = 'AKIAIOSFODNN7EXAMPLE';" }];
    const ctx = { repo: "dana/app", number: 7, headSha: "deadbeefcafe", author: "dana", installationId: 42 };

    await runGate(c, pool, ctx);
    const after = c.calls.length;
    const second = await runGate(c, pool, ctx);

    expect(second.skipped).toBe("unchanged");
    expect(await events("gate.evaluated")).toHaveLength(1);
    expect(c.calls.length).toBeGreaterThan(after); // it still READ; it just didn't re-post
    expect(c.countOf("createCheckRun") + c.countOf("updateCheckRun")).toBe(1);
  });
});

describe("the scheduled sweep", () => {
  const cover = (repo: string, installationId: number) =>
    pool.query("INSERT INTO coverage_windows (repo, installation_id, source) VALUES ($1, $2, 'test')", [repo, installationId]);

  it("restores every consented repo that drifted, and skips the ones that never consented", async () => {
    const consented = new Fake();
    await ensureProtection(consented, pool, "dana/protected", 42);
    consented.rulesets = [{ id: 77, name: RULESET_NAME, enforcement: "active" }];
    consented.ruleset = weakenedRuleset();
    consented.repos = [{ full_name: "dana/protected", default_branch: "main" }, { full_name: "dana/untouched", default_branch: "main" }];

    await cover("dana/protected", 42);
    await cover("dana/untouched", 42);

    const r = await runProtectionJob(pool, { clientFor: async () => consented });

    expect(r).toMatchObject({ status: "reconciled", repos: 1, drifted: 1, restored: 1 });
    const restored = await events("protection.restored");
    expect(restored).toHaveLength(1);
    expect(restored[0].repo).toBe("dana/protected");
  });

  it("is a no-op when nothing is under stewardship", async () => {
    const r = await runProtectionJob(pool, { clientFor: async () => new Fake() });
    expect(r.status).toBe("no-coverage");
  });
});
