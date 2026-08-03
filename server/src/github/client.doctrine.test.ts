// The hard rules as CI. If someone ever adds a merge / force-push / delete
// capability to the GitHub client, this test fails the build. The doctrine —
// "CodeWorthy never merges, force-pushes, or rewrites history; the human owns
// every merge" — is enforced mechanically here, not by reviewer vigilance.
import { describe, expect, it } from "vitest";
import { createGitHubClient, FORBIDDEN_CAPABILITY } from "./client.js";

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
});
