// The hard rules as CI. If someone ever adds a merge / force-push / delete
// capability to the GitHub client, this test fails the build. The doctrine —
// "CodeWorthy never merges, force-pushes, or rewrites history; the human owns
// every merge" — is enforced mechanically here, not by reviewer vigilance.
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { createGitHubClient, FORBIDDEN_CAPABILITY } from "./client.js";

/** Every .ts file under a directory, recursively, as file: URLs. */
function filesUnder(dir: URL): URL[] {
  const out: URL[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const child = new URL(entry.name + (entry.isDirectory() ? "/" : ""), dir);
    if (entry.isDirectory()) out.push(...filesUnder(child));
    else if (entry.name.endsWith(".ts")) out.push(child);
  }
  return out;
}

describe("GitHub client doctrine", () => {
  const client = createGitHubClient("dummy-token") as unknown as Record<string, unknown>;
  const methods = Object.keys(client);

  it("exposes a non-empty, function-only surface", () => {
    expect(methods.length).toBeGreaterThan(0);
    for (const m of methods) expect(typeof client[m]).toBe("function");
  });

  it("exposes NO merge / force-push / delete capability", () => {
    const violations = methods.filter((m) => FORBIDDEN_CAPABILITY.test(m));
    expect(violations, `forbidden capabilities on the GitHub client: ${violations.join(", ")}`).toEqual([]);
  });

  it("does not expose the specific dangerous operations by any alias", () => {
    const banned = ["merge", "mergePullRequest", "forcePush", "deleteRef", "deleteBranch", "updateRef"];
    for (const name of banned) expect(methods).not.toContain(name);
  });

  it("still provides the safe operations Steward needs", () => {
    for (const name of ["createBranch", "openDraftPullRequest", "createReviewComment", "setBranchProtection"]) {
      expect(methods).toContain(name);
    }
  });

  it("can create and update a ruleset, but never remove one", () => {
    // Asymmetric on purpose. CodeWorthy turns protection ON and puts it back
    // when it drifts; turning it OFF is the human's call, made in GitHub. If a
    // "removeRuleset" ever existed, a bug in the reconciler could unprotect
    // every customer at once — so the capability simply does not exist. (The
    // forbidden-verb test above also catches it, this states the intent.)
    expect(methods).toContain("createRepoRuleset");
    expect(methods).toContain("updateRepoRuleset");
    expect(methods.filter((m) => /ruleset/i.test(m) && /remove|delete/i.test(m))).toEqual([]);
  });

  it("routes the merge-blocking check through exactly one module", () => {
    // Branch protection requires the check named STEWARD_CHECK, so whatever
    // posts that check decides what can merge. Keeping that to one file is what
    // makes "the LLM tier cannot gate" a structural fact rather than a promise.
    const dir = new URL("../steward/", import.meta.url);
    const posters = filesUnder(dir).filter((f) => {
      const src = readFileSync(f, "utf8");
      return /createCheckRun|updateCheckRun/.test(src) && !f.pathname.endsWith(".test.ts");
    });
    expect(posters.map((f) => f.pathname.split("/steward/")[1])).toEqual(["gate/check.ts"]);
  });

  it("can create refs but never file contents — no code-write capability", () => {
    // The manifest requests contents:write (GitHub has no refs-only scope, and
    // POST /git/refs requires it). The doctrine therefore lives HERE: the
    // client must never gain a method that writes files, blobs, trees, or
    // commits. Branch refs and PR scaffolds only.
    const source = readFileSync(new URL("./client.ts", import.meta.url), "utf8");
    for (const endpoint of ["/contents/", "git/blobs", "git/trees", "git/commits"]) {
      expect(source.includes(endpoint), `code-write endpoint in client.ts: ${endpoint}`).toBe(false);
    }
    // Write-shaped method names only — reads (getPullRequestFiles, listCommits)
    // are fine; what must never exist is a method that WRITES file content.
    for (const name of methods) {
      if (/^(get|list)/.test(name)) continue;
      expect(name).not.toMatch(/file|blob|tree|contents/i);
    }
  });
});
