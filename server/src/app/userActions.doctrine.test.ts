// The merge doctrine, as CI.
//
// CodeWorthy's claim is "the human owns every merge". Two halves have to hold
// at once, and a test for either alone would let the other rot:
//
//   1. The App cannot merge. Asserted next door in github/client.doctrine.test.ts
//      and approver/approver.test.ts, and re-asserted here so that "we added a
//      merge for the dashboard" can never quietly become "we added a merge".
//   2. The one place a merge CAN happen is reachable only by a signed-in human,
//      on their own token. That is a property of this file's shape — every
//      function takes a token, and it imports nothing that could hand it an
//      App credential — so it is checked against the source, not the runtime.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createGitHubClient } from "../github/client.js";
import { createApproverClient } from "../approver/client.js";
import * as userActions from "./userActions.js";
import { USER_ACTION_ALLOWLIST } from "./userActions.js";

const source = readFileSync(new URL("./userActions.ts", import.meta.url), "utf8");

describe("the human's action surface", () => {
  it("is the ONLY surface with a merge — neither App has one", () => {
    const app = Object.keys(createGitHubClient("t"));
    const approver = Object.keys(createApproverClient("t", "x[bot]"));
    expect(app.filter((m) => /merge/i.test(m))).toEqual([]);
    expect(approver.filter((m) => /merge/i.test(m))).toEqual([]);
    expect(Object.keys(userActions).filter((m) => /merge/i.test(m))).toContain("mergeAsUser");
  });

  it("exports nothing beyond the allowlist", () => {
    // An allowlist rather than a banned-verb list: this is the file where a
    // privileged verb is legitimate, so the protection is that nothing else
    // creeps in beside it.
    const fns = Object.entries(userActions)
      .filter(([, v]) => typeof v === "function")
      .map(([k]) => k);
    expect(fns.sort()).toEqual([...USER_ACTION_ALLOWLIST].sort());
  });

  it("never force-pushes, deletes, or changes protection", () => {
    for (const verb of ["force", "delete", "deleteRef", "protection", "rulesets"]) {
      expect(Object.keys(userActions).some((m) => m.toLowerCase().includes(verb.toLowerCase()))).toBe(false);
    }
    // And at the transport level: no ref writes, no protection endpoints.
    for (const endpoint of ["/git/refs", "/branches/", "/rulesets", "/contents/"]) {
      expect(source.includes(endpoint), `privileged endpoint in userActions.ts: ${endpoint}`).toBe(false);
    }
  });

  it("takes a caller-supplied token and can never reach an App credential", () => {
    // getInstallationClient / config.github.privateKey / approverClientFor are
    // how an App identity would get in here. None may be imported.
    for (const forbidden of ["github/auth.js", "approver/client.js", "privateKey", "installationId"]) {
      expect(source.includes(forbidden), `App credential path in userActions.ts: ${forbidden}`).toBe(false);
    }
    // Every exported function's first parameter is the token.
    for (const name of USER_ACTION_ALLOWLIST) {
      const fn = (userActions as unknown as Record<string, (...a: unknown[]) => unknown>)[name]!;
      expect(typeof fn).toBe("function");
      expect(fn.length, `${name} must take (token, ...)`).toBeGreaterThanOrEqual(1);
    }
  });

  it("requires an explicit head SHA to merge", () => {
    // Without it, a stale dashboard tab can merge a commit nobody in the
    // conversation ever read.
    expect(source).toMatch(/sha:\s*string/);
    expect(source).toMatch(/sha:\s*opts\.sha/);
  });
});
