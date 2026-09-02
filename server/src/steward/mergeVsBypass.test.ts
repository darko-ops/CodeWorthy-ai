// Telling a merge apart from a bypass.
//
// A squash-merge reaches the Steward as a push to the default branch, so
// isDirectToDefault sees exactly what a bypass looks like. The result was a
// record that contradicted itself about the same commit — logged as
// `pull_request.merged` and, seconds later, as "pushed straight to main — no
// pull request reviewed them" — plus a pointless steward/edit-* branch that
// re-ran the repo's entire CI suite.
import { describe, expect, it } from "vitest";
import { looksLikeMerge, toStewardEvent } from "./events.js";
import { arrivedViaPullRequest } from "./actions.js";
import { FakeGitHub } from "../testing/fakeGitHub.js";

const push = (subject: string) => ({
  ref: "refs/heads/main",
  repository: { full_name: "dana/app", default_branch: "main" },
  after: "abc123",
  commits: [{ id: "abc123" }],
  head_commit: { message: subject },
  pusher: { name: "dana" },
});

describe("how a push is described", () => {
  it("does not call a squash-merge a direct push", () => {
    expect(looksLikeMerge(push("Rules page: set what has to be true (#15)"))).toBe(true);
    expect(toStewardEvent("push", push("Rules page: set what has to be true (#15)"))).toBeNull();
  });

  it("does not call a merge commit a direct push", () => {
    expect(looksLikeMerge(push("Merge pull request #15 from darko-ops/repo-rules"))).toBe(true);
  });

  it("still records a genuine direct push", () => {
    // The failure that matters. Missing a real bypass is the one thing this
    // tier exists to notice.
    const ev = toStewardEvent("push", push("fix the retry budget"));
    expect(ev?.eventType).toBe("push.direct_to_default");
    expect(ev?.plainEnglish).toContain("no pull request reviewed them");
  });

  it("only matches the issue reference at the END of the subject", () => {
    // "(#12)" mid-sentence is someone writing prose, not GitHub writing a merge.
    expect(looksLikeMerge(push("revert the (#12) change we discussed"))).toBe(false);
    expect(looksLikeMerge(push("handle empty input"))).toBe(false);
    expect(looksLikeMerge(push(""))).toBe(false);
  });

  it("reads only the first line, so a body cannot fake it", () => {
    expect(looksLikeMerge(push("real direct push\n\nsee also (#12)"))).toBe(false);
  });
});

describe("the authoritative check, before CodeWorthy acts", () => {
  const client = (pulls: unknown[]) => {
    const c = new FakeGitHub();
    c.commitPulls = pulls;
    return c;
  };

  it("treats an open pull request containing the commit as NOT a merge", async () => {
    // A commit sits on its own PR's branch without having landed through it.
    expect(await arrivedViaPullRequest(client([{ merged_at: null, merge_commit_sha: null }]), "dana/app", "abc123")).toBe(false);
  });

  it("treats a different merge commit as NOT a merge", async () => {
    expect(await arrivedViaPullRequest(client([{ merged_at: "x", merge_commit_sha: "other99" }]), "dana/app", "abc123")).toBe(false);
  });

  it("confirms a merged pull request whose merge commit matches", async () => {
    expect(await arrivedViaPullRequest(client([{ merged_at: "x", merge_commit_sha: "abc123" }]), "dana/app", "abc123")).toBe(true);
  });

  it("says NO when GitHub cannot answer", async () => {
    // Failing toward "this was a bypass" is deliberate: a wrong yes silences
    // CodeWorthy about a change that really did skip review; a wrong no costs a
    // redundant branch and a comment. Not the same size of mistake.
    const broken = new FakeGitHub();
    broken.listPullRequestsForCommit = () => Promise.reject(new Error("502"));
    expect(await arrivedViaPullRequest(broken, "dana/app", "abc123")).toBe(false);
    expect(await arrivedViaPullRequest(new FakeGitHub(), "dana/app", undefined)).toBe(false);
  });
});
