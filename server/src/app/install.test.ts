import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { migrate } from "../../db/migrate.js";
import { recentChangelog } from "../audit/audit.js";
import type { GitHubClient } from "../github/client.js";
import { buildAppManifest, installUrl } from "./manifest.js";
import { applyProtectionConsent, renderInstallPage, renderSetupPage, renderManifestForm } from "./install.js";

const url = process.env.DATABASE_URL ?? "postgres://acme@localhost:55432/steward_test";
const pool = new Pool({ connectionString: url });

class FakeClient implements GitHubClient {
  calls: string[] = [];
  repos: { full_name: string; default_branch: string }[] = [];
  protection: unknown = null;
  getPullRequestFiles(..._a: any[]) { this.calls.push("getPullRequestFiles"); return Promise.resolve([]); }
  listIssueComments(..._a: any[]) { this.calls.push("listIssueComments"); return Promise.resolve([]); }
  updateIssueComment(..._a: any[]) { this.calls.push("updateIssueComment"); return Promise.resolve({}); }
  listPullRequestReviews(..._a: any[]) { this.calls.push("listPullRequestReviews"); return Promise.resolve([]); }
  listPullRequests(..._a: any[]) { this.calls.push("listPullRequests"); return Promise.resolve([]); }
  listCheckRunsForRef(..._a: any[]) { this.calls.push("listCheckRunsForRef"); return Promise.resolve({ check_runs: [] }); }
  getBranch(..._a: any[]) { this.calls.push("getBranch"); return Promise.resolve({}); }
  getBranchProtection(..._a: any[]) { this.calls.push("getBranchProtection"); return Promise.resolve(this.protection); }
  listCommits(..._a: any[]) { this.calls.push("listCommits"); return Promise.resolve([]); }
  listInstallationRepositories() { this.calls.push("listInstallationRepositories"); return Promise.resolve(this.repos); }
  createBranch(..._a: any[]) { this.calls.push("createBranch"); return Promise.resolve({}); }
  openDraftPullRequest(..._a: any[]) { this.calls.push("openDraftPullRequest"); return Promise.resolve({}); }
  createReviewComment(..._a: any[]) { this.calls.push("createReviewComment"); return Promise.resolve({}); }
  createCommitComment(..._a: any[]) { this.calls.push("createCommitComment"); return Promise.resolve({}); }
  createCheckRun(..._a: any[]) { this.calls.push("createCheckRun"); return Promise.resolve({}); }
  setBranchProtection(..._a: any[]) { this.calls.push("setBranchProtection"); return Promise.resolve({}); }
}

describe("install flow — manifest & pages", () => {
  it("manifest asks for the honest minimum: no merge scope; code-write barred at the client surface", () => {
    const m = buildAppManifest("https://cw.example.com/");
    // contents:write is required for safe-mechanics branch creation (GitHub
    // has no refs-only scope — POST /git/refs needs it; read-only would 403
    // createBranch at runtime). The "never write code" guarantee lives in the
    // client capability surface instead: no file/blob/tree/commit-creation
    // method exists (see client.doctrine.test.ts).
    expect(m.default_permissions.contents).toBe("write");
    expect(m.default_permissions.administration).toBe("write"); // branch protection
    expect(m.default_permissions).not.toHaveProperty("merge");
    expect(m.hook_attributes.url).toBe("https://cw.example.com/webhooks/github");
    expect(m.setup_url).toBe("https://cw.example.com/steward/setup");
    expect(m.redirect_url).toBe("https://cw.example.com/steward/app-manifest/callback");
    expect(m.default_events).toContain("pull_request");
  });

  it("installUrl is null until a slug is configured", () => {
    expect(installUrl("")).toBeNull();
    expect(installUrl("codeworthy-steward")).toBe("https://github.com/apps/codeworthy-steward/installations/new");
  });

  it("the consent page states what it will and will NOT do", () => {
    const html = renderInstallPage({ appSlug: "codeworthy-steward", baseUrl: "https://cw.example.com" });
    expect(html).toMatch(/never do/i);
    expect(html).toMatch(/you own every merge/i);
    expect(html).toMatch(/off by default/i); // the AI tier disclosure
    expect(html).toContain("https://github.com/apps/codeworthy-steward/installations/new");
  });

  it("the setup page offers the one consent (protect) tied to the installation id", () => {
    const html = renderSetupPage({ installationId: 555, setupAction: "install" });
    expect(html).toContain('action="/steward/setup/protect"');
    expect(html).toContain('value="555"');
    expect(html).toMatch(/protect my default branch/i);
  });

  it("the manifest form posts to GitHub's app-creation endpoint", () => {
    const html = renderManifestForm(buildAppManifest("https://cw.example.com"));
    expect(html).toContain('action="https://github.com/settings/apps/new"');
    expect(html).toContain('name="manifest"');
  });
});

describe("protection consent action", () => {
  beforeEach(async () => { await migrate(url); await pool.query("TRUNCATE audit_events"); });
  afterAll(async () => { await pool.end(); });

  it("protects every repo in the installation and logs each — only on the click", async () => {
    const c = new FakeClient();
    c.repos = [
      { full_name: "dana/recipe-app", default_branch: "main" },
      { full_name: "dana/blog", default_branch: "master" },
    ];
    const results = await applyProtectionConsent(pool, 555, { client: c });
    expect(results).toEqual([
      { repo: "dana/recipe-app", ok: true },
      { repo: "dana/blog", ok: true },
    ]);
    // it listed then protected each branch — and NEVER used a forbidden op
    expect(c.calls.filter((m) => m === "setBranchProtection")).toHaveLength(2);
    expect(c.calls.some((m) => /merge|force|delete/i.test(m))).toBe(false);

    const log = await recentChangelog(pool);
    const configured = log.filter((r) => r.event_type === "protection.configured");
    expect(configured).toHaveLength(2);
  });

  it("reports per-repo failure instead of aborting the whole batch", async () => {
    const c = new FakeClient();
    c.repos = [{ full_name: "dana/ok", default_branch: "main" }, { full_name: "dana/bad", default_branch: "main" }];
    c.setBranchProtection = (...a: any[]) => {
      c.calls.push("setBranchProtection");
      if (String(a[0]).includes("bad")) return Promise.reject(new Error("403"));
      return Promise.resolve({});
    };
    const results = await applyProtectionConsent(pool, 555, { client: c });
    expect(results.find((r) => r.repo === "dana/ok")!.ok).toBe(true);
    expect(results.find((r) => r.repo === "dana/bad")!).toMatchObject({ ok: false, error: "403" });
  });
});
