// V1 — completeness reconciliation tests. The spine's population is diffed
// against a faked GitHub ground truth; every claim in the completeness
// statement is exercised, including the honest limits (coverage gaps,
// pagination caps, weakened-protection intervals).
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { migrate } from "../../db/migrate.js";
import { appendAuditEvent } from "./audit.js";
import { openCoverage } from "./coverage.js";
import { FakeGitHub as BaseFakeGitHub } from "../testing/fakeGitHub.js";
import { reconcileRepo } from "./reconcile.js";
import { runReconcileJob } from "./reconcile-job.js";

const url = process.env.DATABASE_URL ?? "postgres://acme@localhost:55432/steward_test";
const pool = new Pool({ connectionString: url });

// Ground-truth fake: pages of PRs and commits, served per the page param —
// exercises the same pagination path the real client hits.
class FakeGitHub extends BaseFakeGitHub {
  prPages: any[][] = [[]];
  commitPages: any[][] = [[]];
  override listPullRequests(repo: string, params: Record<string, string> = {}) {
    this.calls.push({ m: "listPullRequests", args: [repo, params] });
    return Promise.resolve(this.prPages[Number(params.page ?? "1") - 1] ?? []);
  }
  override listCommits(repo: string, params: Record<string, string> = {}) {
    this.calls.push({ m: "listCommits", args: [repo, params] });
    return Promise.resolve(this.commitPages[Number(params.page ?? "1") - 1] ?? []);
  }
  override repos = [{ full_name: "acme/app", default_branch: "main" }];
}

// The window must contain now(): seeded spine events are stamped by the DB
// clock, so a fixed calendar window would silently exclude them on any other
// day. from = 7 days ago, to = tomorrow; IN = one hour ago.
const NOW = Date.now();
const DAY = 24 * 60 * 60 * 1000;
const WINDOW = { from: new Date(NOW - 7 * DAY).toISOString(), to: new Date(NOW + DAY).toISOString() };
const IN = new Date(NOW - 60 * 60 * 1000).toISOString(); // inside the window

const pr = (number: number, mergeSha: string, mergedAt = IN) => ({
  number, merge_commit_sha: mergeSha, merged_at: mergedAt, updated_at: mergedAt, user: { login: "dana" },
});
const mergeCommit = (sha: string, at = IN) => ({ sha, parents: [{}, {}], commit: { committer: { date: at } } });

async function seedMerge(number: number, mergeSha: string) {
  await appendAuditEvent(pool, {
    installationId: 7, repo: "acme/app", eventType: "change.merged", actor: "dana",
    payload: { number, mergeSha, headSha: "h" + number, base: "main", approvers: [] },
    plainEnglish: `PR #${number} merged.`,
  });
}
async function seedProtectionOn() {
  await appendAuditEvent(pool, {
    installationId: 7, repo: "acme/app", eventType: "protection.configured", actor: "codeworthy-steward",
    payload: { branch: "main" }, plainEnglish: "Protection on.",
  });
}
const gaps = async () =>
  (await pool.query("SELECT payload, plain_english FROM audit_events WHERE event_type = 'reconciliation.gap' ORDER BY id")).rows;
const completedEvents = async () =>
  (await pool.query("SELECT payload, plain_english FROM audit_events WHERE event_type = 'reconciliation.completed' ORDER BY id")).rows;

afterAll(async () => { await pool.end(); });
beforeEach(async () => {
  await migrate(url);
  await pool.query("TRUNCATE audit_events");
  await pool.query("TRUNCATE coverage_windows");
  // Full coverage across the window unless a test narrows it.
  await pool.query(
    `INSERT INTO coverage_windows (repo, installation_id, covered_from, covered_to, source)
     VALUES ('acme/app', 7, $1, NULL, 'installation.created')`,
    [new Date(NOW - 30 * DAY).toISOString()]
  );
});

describe("V1 — reconciliation against GitHub ground truth", () => {
  it("clean window: every merged PR accounted, statement says 0 unexplained discrepancies", async () => {
    const gh = new FakeGitHub();
    gh.prPages = [[pr(1, "sha-1"), pr(2, "sha-2")]];
    await seedMerge(1, "sha-1");
    await seedMerge(2, "sha-2");
    await seedProtectionOn();

    const r = await reconcileRepo(gh, pool, { repo: "acme/app", defaultBranch: "main", installationId: 7, ...WINDOW });
    expect(r.expectedMergedPrs).toBe(2);
    expect(r.accountedMergedPrs).toBe(2);
    expect(r.discrepancies).toEqual([]);
    expect(r.protectionState).toBe("protected");
    expect(r.statement).toMatch(/GitHub reports 2 merged pull request\(s\)/);
    expect(r.statement).toMatch(/0 unexplained discrepancies/);
    expect(r.statement).toMatch(/out-of-band pushes were blocked/);

    // the run itself is in the chain
    const done = await completedEvents();
    expect(done).toHaveLength(1);
    expect(done[0].payload.accountedMergedPrs).toBe(2);
    expect(await gaps()).toHaveLength(0);
  });

  it("a PR merged on GitHub but absent from the log is a missing_from_log gap event", async () => {
    const gh = new FakeGitHub();
    gh.prPages = [[pr(1, "sha-1"), pr(2, "sha-2")]];
    await seedMerge(1, "sha-1"); // #2 never logged

    const r = await reconcileRepo(gh, pool, { repo: "acme/app", defaultBranch: "main", installationId: 7, ...WINDOW });
    expect(r.discrepancies).toHaveLength(1);
    expect(r.discrepancies[0]).toMatchObject({ kind: "missing_from_log", number: 2 });
    const g = await gaps();
    expect(g).toHaveLength(1);
    expect(g[0].plain_english).toMatch(/PR #2 .* no event in the log/);
  });

  it("a log merge GitHub doesn't report is missing_from_github (history rewritten)", async () => {
    const gh = new FakeGitHub();
    gh.prPages = [[pr(1, "sha-1")]];
    await seedMerge(1, "sha-1");
    await seedMerge(99, "sha-99"); // spine claims it; GitHub has no such merge

    const r = await reconcileRepo(gh, pool, { repo: "acme/app", defaultBranch: "main", installationId: 7, ...WINDOW });
    expect(r.discrepancies).toHaveLength(1);
    expect(r.discrepancies[0]).toMatchObject({ kind: "missing_from_github", number: 99 });
    expect(r.discrepancies[0]!.detail).toMatch(/history may have been rewritten/);
  });

  it("merge SHA mismatch is its own discrepancy kind", async () => {
    const gh = new FakeGitHub();
    gh.prPages = [[pr(5, "sha-real")]];
    await seedMerge(5, "sha-fake");
    const r = await reconcileRepo(gh, pool, { repo: "acme/app", defaultBranch: "main", installationId: 7, ...WINDOW });
    expect(r.discrepancies).toHaveLength(1);
    expect(r.discrepancies[0]!.kind).toBe("sha_mismatch");
  });

  it("an unaccounted merge commit on the trunk is flagged; accounted ones are not", async () => {
    const gh = new FakeGitHub();
    gh.prPages = [[pr(1, "sha-1")]];
    gh.commitPages = [[
      mergeCommit("sha-1"), // the PR's own merge — accounted
      mergeCommit("sha-rogue"), // nothing accounts for this
      { sha: "sha-plain", parents: [{}], commit: { committer: { date: IN } } }, // single-parent: not asserted in V1
    ]];
    await seedMerge(1, "sha-1");
    const r = await reconcileRepo(gh, pool, { repo: "acme/app", defaultBranch: "main", installationId: 7, ...WINDOW });
    expect(r.discrepancies).toHaveLength(1);
    expect(r.discrepancies[0]).toMatchObject({ kind: "unrecorded_merge_commit", sha: "sha-rogue" });
  });

  it("a recorded force-push head accounts for its merge commit", async () => {
    const gh = new FakeGitHub();
    gh.commitPages = [[mergeCommit("sha-pushed")]];
    await appendAuditEvent(pool, {
      installationId: 7, repo: "acme/app", eventType: "exception.force_push", actor: "dana",
      payload: { branch: "main", head: "sha-pushed" }, plainEnglish: "Exception: force push.",
    });
    const r = await reconcileRepo(gh, pool, { repo: "acme/app", defaultBranch: "main", installationId: 7, ...WINDOW });
    expect(r.discrepancies).toEqual([]);
    expect(r.recordedDirectPushes).toBe(1);
  });

  it("weakened protection changes the direct-push claim — completeness NOT overclaimed", async () => {
    const gh = new FakeGitHub();
    await seedProtectionOn();
    await appendAuditEvent(pool, {
      installationId: 7, repo: "acme/app", eventType: "exception.protection_weakened", actor: "codeworthy-steward",
      payload: { branch: "main", weakenings: ["force-pushes are now allowed"] }, plainEnglish: "Exception: weakened.",
    });
    const r = await reconcileRepo(gh, pool, { repo: "acme/app", defaultBranch: "main", installationId: 7, ...WINDOW });
    expect(r.protectionState).toBe("weakened_during_window");
    expect(r.statement).toMatch(/completeness of unrecorded direct commits is NOT claimed/);
  });

  it("merges in uncovered time are declared, never counted as gaps", async () => {
    await pool.query("TRUNCATE coverage_windows");
    // Watching only since 2 days ago — PR #1, merged 4 days ago, falls in
    // uncovered time; PR #2, merged an hour ago, is covered.
    await pool.query(
      `INSERT INTO coverage_windows (repo, installation_id, covered_from, covered_to, source)
       VALUES ('acme/app', 7, $1, NULL, 'installation.created')`,
      [new Date(NOW - 2 * DAY).toISOString()]
    );
    const gh = new FakeGitHub();
    gh.prPages = [[pr(1, "sha-1", new Date(NOW - 4 * DAY).toISOString()), pr(2, "sha-2", IN)]];
    await seedMerge(2, "sha-2");

    const r = await reconcileRepo(gh, pool, { repo: "acme/app", defaultBranch: "main", installationId: 7, ...WINDOW });
    expect(r.expectedMergedPrs).toBe(1); // only the covered one
    expect(r.accountedMergedPrs).toBe(1);
    expect(r.outsideCoverageMergedPrs).toBe(1);
    expect(r.discrepancies).toEqual([]); // the uncovered miss is NOT a gap
    expect(r.uncoveredIntervals).toHaveLength(1);
    expect(r.statement).toMatch(/Not covered .*1 merge\(s\) fell in uncovered time/);
  });

  it("pagination: full pages keep fetching; the statement flags a hit cap", async () => {
    const fullPage = Array.from({ length: 100 }, (_, i) => pr(1000 + i, `sha-${i}`, IN));
    const gh = new FakeGitHub();
    gh.prPages = Array.from({ length: 12 }, () => fullPage); // more than MAX_PAGES
    const r = await reconcileRepo(gh, pool, { repo: "acme/app", defaultBranch: "main", installationId: 7, ...WINDOW });
    expect(r.truthTruncated).toBe(true);
    expect(r.statement).toMatch(/pagination cap/);
    // and missing_from_github was NOT asserted from a truncated truth
    expect(r.discrepancies.every((d) => d.kind !== "missing_from_github")).toBe(true);
  });

  it("gap events are capped; the completed event carries the summarized overflow", async () => {
    const gh = new FakeGitHub();
    gh.prPages = [Array.from({ length: 30 }, (_, i) => pr(i + 1, `sha-${i + 1}`))]; // none logged
    const r = await reconcileRepo(gh, pool, { repo: "acme/app", defaultBranch: "main", installationId: 7, ...WINDOW });
    expect(r.discrepancies).toHaveLength(30);
    expect(await gaps()).toHaveLength(20); // GAP_EVENT_CAP
    const [done] = await completedEvents();
    expect(done.payload.gapEventsEmitted).toBe(20);
    expect(done.payload.gapEventsSummarized).toBe(10);
  });
});

describe("V1 — the reconcile job", () => {
  beforeEach(async () => {
    await pool.query("TRUNCATE audit_events");
    await pool.query("TRUNCATE coverage_windows");
  });

  it("no-ops without GitHub config, reports no-coverage when nothing is watched", async () => {
    expect((await runReconcileJob(pool)).status).toBe("no-github");
    const gh = new FakeGitHub();
    expect((await runReconcileJob(pool, { clientFor: async () => gh })).status).toBe("no-coverage");
  });

  it("reconciles every repo with an open window, one client per installation", async () => {
    await openCoverage(pool, "acme/app", 7, "installation.created");
    await openCoverage(pool, "acme/site", 7, "installation.created");
    const gh = new FakeGitHub();
    gh.listInstallationRepositories = () =>
      Promise.resolve([
        { full_name: "acme/app", default_branch: "main" },
        { full_name: "acme/site", default_branch: "master" },
      ]);
    let clientBuilds = 0;
    const res = await runReconcileJob(pool, {
      clientFor: async () => { clientBuilds++; return gh; },
      now: () => new Date("2026-08-08T00:00:00Z"),
    });
    expect(res.status).toBe("reconciled");
    expect(res.repos).toBe(2);
    expect(clientBuilds).toBe(1); // shared per installation
    expect(await completedEvents()).toHaveLength(2);
    // the per-repo default branch reached the commit enumeration
    const commitCalls = gh.calls.filter((c) => c.m === "listCommits");
    const branches = commitCalls.map((c) => (c.args[1] as Record<string, string>).sha).sort();
    expect(branches).toEqual(["main", "master"]);
  });

  it("a failing repo doesn't abort the run — it lands in detail", async () => {
    await openCoverage(pool, "acme/app", 7, "installation.created");
    await openCoverage(pool, "acme/bad", 8, "installation.created");
    const good = new FakeGitHub();
    const res = await runReconcileJob(pool, {
      clientFor: async (id) => {
        if (id === 8) throw new Error("token exchange failed");
        return good;
      },
      now: () => new Date("2026-08-08T00:00:00Z"),
    });
    expect(res.status).toBe("reconciled");
    expect(res.repos).toBe(1);
    expect(res.detail).toMatch(/acme\/bad: token exchange failed/);
  });
});
