// Rules a repo can actually set — and the record of who changed them.
//
// These settings existed in stewardConfig.ts and were wired into the gate, but
// nothing could ever load them: the client has no contents-read capability, so
// a .steward.yml was unfetchable and every repo silently ran on defaults. These
// tests cover the replacement, and in particular that loosening a control reads
// like loosening a control.
import { describe, expect, it } from "vitest";
import { DEFAULT_RULES, describeChanges, parseRules, toRulesetShape, toStewardConfig, type RepoRules } from "./repoRules.js";
import { desiredRuleset } from "./rulesets.js";
import { STEWARD_CHECK } from "./protection.js";

const rules = (over: Partial<RepoRules> = {}): RepoRules => ({ ...DEFAULT_RULES, ...over });
const withGates = (g: Partial<RepoRules["gates"]>) => rules({ gates: { ...DEFAULT_RULES.gates, ...g } });

describe("parsing what the dashboard sends", () => {
  it("keeps the previous value for anything not supplied", () => {
    const previous = withGates({ secrets: "advise" });
    expect(parseRules({ protectedPaths: ["db/"] }, previous).gates.secrets).toBe("advise");
  });

  it("ignores a severity it doesn't recognise rather than storing it", () => {
    expect(parseRules({ gates: { secrets: "ignore-everything" } }).gates.secrets).toBe("gate");
  });

  it("bounds the protected-path list and drops empties", () => {
    const parsed = parseRules({ protectedPaths: ["  db/  ", "", "   ", ...Array(80).fill("x/")] });
    expect(parsed.protectedPaths[0]).toBe("db/");
    expect(parsed.protectedPaths.length).toBeLessThanOrEqual(50);
  });

  it("defaults to the safe end", () => {
    expect(DEFAULT_RULES.gates.secrets).toBe("gate");
    expect(DEFAULT_RULES.requireCodeworthyCheck).toBe(true);
  });
});

describe("saying what changed, the way a person would", () => {
  it("names a loosening AS a loosening", () => {
    // "secrets: advise" lets someone turn off the control that stops a leaked
    // key reaching main, and leaves nothing a reader would notice. The record
    // is read by people, so it has to read like one.
    const [line] = describeChanges(DEFAULT_RULES, withGates({ secrets: "advise" }));
    expect(line).toBe("committed secrets no longer block a merge — they are now only a comment");
  });

  it("is blunter still when a check is turned off entirely", () => {
    expect(describeChanges(DEFAULT_RULES, withGates({ secrets: "off" }))[0]).toBe("committed secrets are no longer checked at all");
  });

  it("names a tightening too", () => {
    expect(describeChanges(withGates({ secrets: "off" }), DEFAULT_RULES)[0]).toBe("committed secrets now block a merge");
  });

  it("reports requirement flags and protected paths", () => {
    const after = rules({ requireApproval: false, protectedPaths: ["db/migrations"] });
    const changes = describeChanges(DEFAULT_RULES, after);
    expect(changes).toContain("an approving review is no longer required");
    expect(changes).toContain("db/migrations now need a deliberate decision to change");
  });

  it("says nothing when nothing changed", () => {
    expect(describeChanges(DEFAULT_RULES, rules())).toEqual([]);
  });
});

describe("turning rules into the two things that enforce them", () => {
  it("hands the gate its severities and protected paths", () => {
    const cfg = toStewardConfig(withGates({ secrets: "advise" }));
    expect(cfg.gates.secrets).toBe("advise");
    expect(toStewardConfig(rules({ protectedPaths: ["db/"] })).protectedPaths).toEqual(["db/"]);
  });

  it("requires an approval only when the repo asks AND an approver exists", () => {
    const shape = (requireApproval: boolean, approverAvailable: boolean) =>
      toRulesetShape(rules({ requireApproval }), { checkName: STEWARD_CHECK, mode: "shared", approverAvailable });
    expect(shape(true, true).requireApproval).toBe(true);
    expect(shape(true, false).requireApproval).toBe(false); // wanting one we can't satisfy is an unmergeable repo
    expect(shape(false, true).requireApproval).toBe(false);
  });

  it("drops the required check from the ruleset when the repo turns it off", () => {
    // The review still runs and still comments — it just stops blocking. What
    // must never happen is the context staying REQUIRED with nothing posting it.
    const off = desiredRuleset({ mode: "shared", requireCheck: false });
    expect(off.rules.map((r) => (r as { type: string }).type)).not.toContain("required_status_checks");
    const on = desiredRuleset({ mode: "shared", requireCheck: true });
    expect(on.rules.map((r) => (r as { type: string }).type)).toContain("required_status_checks");
  });

  it("carries conversation resolution through to GitHub", () => {
    const pr = (v: boolean) =>
      (desiredRuleset({ mode: "shared", requireConversationResolution: v }).rules.find(
        (r) => (r as { type: string }).type === "pull_request"
      ) as any).parameters.required_review_thread_resolution;
    expect(pr(true)).toBe(true);
    expect(pr(false)).toBe(false);
  });
});
