// Solo mode: one maintainer pushes directly, CodeWorthy reviews afterwards.
//
// The dangerous bug in this feature isn't "solo mode doesn't work" — it's the
// reconciler deciding a solo repo is weakened and re-imposing shared rules on
// it every hour, silently overriding a deliberate choice on a schedule. Most of
// these tests exist to pin that down.
import { describe, expect, it } from "vitest";
import { desiredRuleset, detectRulesetDrift } from "./rulesets.js";
import { STEWARD_CHECK } from "./protection.js";

const ruleTypes = (shape: Parameters<typeof desiredRuleset>[0]) =>
  desiredRuleset(shape).rules.map((r) => (r as { type: string }).type);

const live = (shape: Parameters<typeof desiredRuleset>[0]) => ({ id: 77, ...desiredRuleset(shape) });

describe("what each mode asks GitHub for", () => {
  it("solo drops the pull-request requirement — that's the whole point", () => {
    const types = ruleTypes({ mode: "solo" });
    expect(types).not.toContain("pull_request");
    // A required status check also rejects a direct push, so it can't be there
    // either — leaving it would re-block the very thing solo mode allows.
    expect(types).not.toContain("required_status_checks");
  });

  it("solo still blocks the two irreversible operations", () => {
    // Speed is what solo mode buys. The ability to erase the history the audit
    // record is made of is not on the table in either mode.
    const types = ruleTypes({ mode: "solo" });
    expect(types).toEqual(expect.arrayContaining(["deletion", "non_fast_forward"]));
  });

  it("shared keeps the full rule", () => {
    const types = ruleTypes({ mode: "shared" });
    expect(types).toEqual(expect.arrayContaining(["deletion", "non_fast_forward", "pull_request", "required_status_checks"]));
  });

  it("defaults to shared when no mode is given", () => {
    // Assuming a repo is shared is the safe way to be wrong.
    expect(ruleTypes({})).toContain("pull_request");
    expect(ruleTypes(STEWARD_CHECK)).toContain("pull_request"); // legacy string form
  });

  it("only requires an approval when an approver actually exists", () => {
    const pr = (requireApproval: boolean) =>
      (desiredRuleset({ mode: "shared", requireApproval }).rules.find(
        (r) => (r as { type: string }).type === "pull_request"
      ) as any).parameters.required_approving_review_count;
    // Requiring an approval nobody can give is the same failure as requiring a
    // check nobody posts: an unmergeable repository.
    expect(pr(false)).toBe(0);
    expect(pr(true)).toBe(1);
  });
});

describe("drift, judged against the repo's own mode", () => {
  it("reads a healthy solo ruleset as healthy, not as weakened", () => {
    // The regression that would matter most: judged as shared, a solo ruleset
    // is missing two rules, so the sweep would "restore" it every hour and
    // silently undo the user's choice.
    expect(detectRulesetDrift(live({ mode: "solo" }), { mode: "solo" })).toEqual([]);
  });

  it("would have called that same ruleset weakened under shared rules", () => {
    const weak = detectRulesetDrift(live({ mode: "solo" }), { mode: "shared" });
    expect(weak).toContain("a pull request is no longer required");
    expect(weak.length).toBeGreaterThan(0);
  });

  it("still catches a solo repo losing force-push or deletion protection", () => {
    // Solo mode relaxes review, never the irreversible half.
    const rs = live({ mode: "solo" });
    rs.rules = rs.rules.filter((r) => (r as { type: string }).type !== "non_fast_forward") as typeof rs.rules;
    expect(detectRulesetDrift(rs, { mode: "solo" })).toContain("force-pushes are now allowed");
  });

  it("still catches a solo ruleset being switched off or pointed elsewhere", () => {
    expect(detectRulesetDrift({ ...live({ mode: "solo" }), enforcement: "disabled" }, { mode: "solo" })[0])
      .toContain("switched off");
    expect(detectRulesetDrift(null, { mode: "solo" })[0]).toContain("off entirely");
  });

  it("still catches bypass being widened in solo mode", () => {
    const rs = { ...live({ mode: "solo" }), bypass_actors: [{ actor_id: 9, actor_type: "Team", bypass_mode: "always" }] };
    expect(detectRulesetDrift(rs, { mode: "solo" }).some((w) => w.includes("more than repository admins"))).toBe(true);
  });

  it("reads a healthy shared ruleset as healthy", () => {
    expect(detectRulesetDrift(live({ mode: "shared" }), { mode: "shared" })).toEqual([]);
  });
});
