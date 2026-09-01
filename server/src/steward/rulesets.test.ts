// The desired protection, and what counts as it having been weakened.
// Pure — no DB, no network. The rule this file guards is that "protected" has a
// precise definition we can diff against, rather than a vibe.
import { describe, expect, it } from "vitest";
import { STEWARD_CHECK } from "./protection.js";
import { desiredRuleset, detectRulesetDrift, RULESET_NAME } from "./rulesets.js";

const healthy = () => {
  const d = desiredRuleset();
  return {
    id: 1,
    name: d.name,
    enforcement: d.enforcement,
    conditions: d.conditions,
    bypass_actors: d.bypass_actors,
    rules: d.rules,
  };
};
const without = (type: string) => {
  const rs = healthy();
  rs.rules = rs.rules.filter((r) => r.type !== type) as typeof rs.rules;
  return rs;
};

describe("the desired ruleset", () => {
  it("requires a PR and OUR check, and blocks force-pushes and deletion", () => {
    const d = desiredRuleset();
    const types = d.rules.map((r) => r.type);
    expect(types).toEqual(expect.arrayContaining(["pull_request", "required_status_checks", "non_fast_forward", "deletion"]));

    const checks = d.rules.find((r) => r.type === "required_status_checks") as any;
    expect(checks.parameters.required_status_checks).toEqual([{ context: STEWARD_CHECK }]);
  });

  it("targets the DEFAULT branch by name-independent selector", () => {
    // The point of ~DEFAULT_BRANCH: renaming main must not silently unprotect
    // the repo, which is the classic way a legacy rule stops working.
    expect(desiredRuleset().conditions.ref_name.include).toEqual(["~DEFAULT_BRANCH"]);
  });

  it("leaves repository admins able to bypass — visibly, not secretly", () => {
    // The doctrine is 'never quietly', not 'never'. A rule nobody can override
    // gets deleted the first time it is wrong; a rule whose override is logged
    // survives, and the override is the evidence.
    expect(desiredRuleset().bypass_actors).toEqual([
      { actor_id: 5, actor_type: "RepositoryRole", bypass_mode: "always" },
    ]);
  });

  it("does not demand branches be up to date before merging", () => {
    const checks = desiredRuleset().rules.find((r) => r.type === "required_status_checks") as any;
    expect(checks.parameters.strict_required_status_checks_policy).toBe(false);
  });

  it("is identified by a stable name — that name IS how we find it later", () => {
    expect(desiredRuleset().name).toBe(RULESET_NAME);
  });
});

describe("detecting a weakened rule", () => {
  it("says nothing when the live rule matches", () => {
    expect(detectRulesetDrift(healthy())).toEqual([]);
  });

  it("reports a missing ruleset as protection being off entirely", () => {
    expect(detectRulesetDrift(null)[0]).toContain("off entirely");
  });

  it("catches each way the rule can be loosened, in plain language", () => {
    expect(detectRulesetDrift(without("non_fast_forward"))).toContain("force-pushes are now allowed");
    expect(detectRulesetDrift(without("deletion"))).toContain("branch deletion is now allowed");
    expect(detectRulesetDrift(without("pull_request"))).toContain("a pull request is no longer required");
    expect(detectRulesetDrift(without("required_status_checks"))).toContain(`the "${STEWARD_CHECK}" check is no longer required`);
  });

  it("catches enforcement being switched to report-only or off", () => {
    expect(detectRulesetDrift({ ...healthy(), enforcement: "evaluate" })).toContain(
      "protection was switched to report-only, so it no longer blocks anything"
    );
    expect(detectRulesetDrift({ ...healthy(), enforcement: "disabled" })[0]).toContain("switched off");
  });

  it("catches the rule being pointed away from the default branch", () => {
    const rs = { ...healthy(), conditions: { ref_name: { include: ["refs/heads/scratch"], exclude: [] } } };
    expect(detectRulesetDrift(rs)).toContain("it no longer covers your default branch");
  });

  it("catches the check being swapped for a different one", () => {
    const rs = healthy();
    (rs.rules.find((r) => r.type === "required_status_checks") as any).parameters.required_status_checks = [{ context: "something-else" }];
    expect(detectRulesetDrift(rs)).toContain(`the "${STEWARD_CHECK}" check is no longer required`);
  });

  it("catches bypass being widened past repository admins", () => {
    // This one is the quiet one: the rule still LOOKS on, and a whole team (or
    // a bot) can now walk past it. It is the drift an auditor asks about.
    const rs = { ...healthy(), bypass_actors: [...healthy().bypass_actors, { actor_id: 42, actor_type: "Team", bypass_mode: "always" }] };
    expect(detectRulesetDrift(rs).some((w) => w.includes("more than repository admins"))).toBe(true);
    expect(detectRulesetDrift(rs).some((w) => w.includes("Team#42"))).toBe(true);
  });

  it("reports every weakening at once, not just the first", () => {
    const rs = without("non_fast_forward");
    rs.rules = rs.rules.filter((r) => r.type !== "deletion") as typeof rs.rules;
    expect(detectRulesetDrift(rs)).toHaveLength(2);
  });
});
