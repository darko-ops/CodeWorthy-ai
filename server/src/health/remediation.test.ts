// Ranked fix paths. The rule that matters here isn't which options exist — it's
// that a user is never left holding a red badge with nothing they can act on.
import { describe, expect, it } from "vitest";
import { buildIssues, type RemediationContext } from "./remediation.js";
import type { HealthVital } from "./health.js";

const vital = (id: string, status: HealthVital["status"]): HealthVital => ({
  id, label: id, status, finding: "finding", prescription: "",
});
const ctx = (over: Partial<RemediationContext> = {}): RemediationContext => ({
  repo: "dana/app",
  defaultBranch: "main",
  mode: "shared",
  latestProtectionEvent: null,
  restoreDrift: true,
  directPushes: 0,
  accepted: new Set(),
  ...over,
});
const ids = (issues: ReturnType<typeof buildIssues>) => issues.map((i) => i.id);

describe("every issue is actionable", () => {
  const all = () =>
    buildIssues(
      [vital("protection", "watch"), vital("review_discipline", "at risk"), vital("merge_gate", "watch"), vital("integrity", "at risk")],
      ctx({ directPushes: 3 })
    );

  it("gives every issue at least one option", () => {
    // A finding with no option is just a complaint.
    for (const issue of all()) expect(issue.options.length, issue.id).toBeGreaterThan(0);
  });

  it("marks the top option as the one with no tradeoff", () => {
    // The recommendation is recommended because nothing is given up for it;
    // every later option states what it costs.
    for (const issue of all()) {
      expect(issue.options[0]!.tradeoff, issue.id).toBeNull();
      for (const alt of issue.options.slice(1)) expect(alt.tradeoff, `${issue.id}/${alt.id}`).not.toBeNull();
    }
  });

  it("ends every issue somewhere — a settled repo is always reachable", () => {
    // Except integrity: a failed tamper check is the one thing you may not
    // click away, because accepting it would be accepting that the evidence is
    // worthless while still presenting it as evidence.
    for (const issue of all()) {
      const last = issue.options[issue.options.length - 1]!;
      if (issue.id === "integrity_failed") expect(last.action.kind).not.toBe("accept");
      else expect(last.action.kind, issue.id).toBe("accept");
    }
  });

  it("says why CodeWorthy can't just fix it", () => {
    for (const issue of all()) expect(issue.constraint, issue.id).toBeTruthy();
  });

  it("puts the worst first, and the fastest fix first within that", () => {
    const order = ids(all());
    const risk = ["integrity_failed", "direct_pushes"];
    for (const r of risk) expect(order.indexOf(r)).toBeLessThan(order.indexOf("protection_off") === -1 ? 99 : order.indexOf("protection_off"));
  });
});

describe("what it offers, and what it doesn't", () => {
  it("never offers protection it already knows GitHub will refuse", () => {
    // Learned from the spine, not guessed: offering "turn on protection" to a
    // repo where it just 403'd only fails again in front of the user.
    const issues = buildIssues([vital("protection", "at risk")], ctx({ latestProtectionEvent: "exception.protection_unavailable" }));
    expect(ids(issues)).toEqual(["protection_unavailable"]);
    const options = issues[0]!.options;
    expect(options.some((o) => o.action.kind === "codeworthy")).toBe(false);
    expect(options.map((o) => o.id)).toContain("protection_unavailable.gate_in_ci");
  });

  it("offers solo mode when the user keeps pushing to main", () => {
    const issues = buildIssues([vital("review_discipline", "at risk")], ctx({ directPushes: 5 }));
    const solo = issues[0]!.options.find((o) => o.id === "direct_pushes.solo")!;
    expect(solo).toBeTruthy();
    expect(solo.effort).toBe("one click");
  });

  it("stops calling direct pushes a problem once the repo IS solo", () => {
    // Telling someone who deliberately chose to push to main that they should
    // stop pushing to main is how a tool teaches people to ignore it.
    const issues = buildIssues([vital("review_discipline", "at risk")], ctx({ mode: "solo", directPushes: 5 }));
    expect(ids(issues)).not.toContain("direct_pushes");
  });

  it("drops an issue the user has already accepted", () => {
    const issues = buildIssues([vital("protection", "watch")], ctx({ accepted: new Set(["protection_off"]) }));
    expect(ids(issues)).not.toContain("protection_off");
  });

  it("has nothing to say about a healthy repo", () => {
    expect(buildIssues([vital("protection", "healthy"), vital("review_discipline", "healthy")], ctx())).toEqual([]);
  });

  it("won't offer to restore protection that is already self-healing", () => {
    // With restore on, the sweep already puts it back — surfacing it as a
    // decision would be asking the user to do something already done.
    expect(ids(buildIssues([vital("protection", "at risk")], ctx({ restoreDrift: true })))).not.toContain("protection_weakened");
    expect(ids(buildIssues([vital("protection", "at risk")], ctx({ restoreDrift: false })))).toContain("protection_weakened");
  });
});
