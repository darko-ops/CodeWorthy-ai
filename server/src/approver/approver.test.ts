// The approver's job is to be able to say NO. An approver that always approves
// is worse than none: it manufactures evidence that a control operated when it
// did not. Most of these tests are about the ways it must refuse.
import { describe, expect, it } from "vitest";
import { decide, parseWaivers, waiverCounts, type GateVerdict, type Waiver } from "./decide.js";
import { createApproverClient, APPROVER_FORBIDDEN } from "./client.js";
import { createGitHubClient } from "../github/client.js";

const BOT = "codeworthy-approver[bot]";
const verdict = (over: Partial<GateVerdict> = {}): GateVerdict => ({
  headSha: "abc123", decision: "clean", blocking: [], ...over,
});
const waiver = (over: Partial<Waiver> = {}): Waiver => ({
  findingId: "secret_introduced", reason: "documented test fixture, not a live key", by: "dana", human: true, ...over,
});
const run = (over: Partial<Parameters<typeof decide>[0]> = {}) =>
  decide({ headSha: "abc123", verdict: verdict(), waivers: [], approverLogin: BOT, ...over });

describe("refusing to approve blind", () => {
  it("abstains when there is no verdict for this commit", () => {
    expect(run({ verdict: null }).action).toBe("abstain");
  });

  it("abstains when the only verdict is for a DIFFERENT commit", () => {
    // The diff has changed since that verdict. Treating it as current would
    // approve code nothing has reviewed — the exact failure the gate exists to
    // prevent, reintroduced one layer up.
    expect(run({ verdict: verdict({ headSha: "older99" }) }).action).toBe("abstain");
  });
});

describe("refusing while findings are outstanding", () => {
  const blocked = verdict({ decision: "blocked", blocking: [{ id: "secret_introduced", file: "src/a.ts" }] });

  it("declines, and names what is outstanding", () => {
    const d = run({ verdict: blocked });
    expect(d.action).toBe("decline");
    expect(d.unaddressed.map((f) => f.id)).toEqual(["secret_introduced"]);
    expect(d.reason).toContain("secret_introduced");
  });

  it("approves once the finding is waived by a human with a reason", () => {
    const d = run({ verdict: blocked, waivers: [waiver()] });
    expect(d.action).toBe("approve");
    expect(d.accepted).toHaveLength(1);
    expect(d.reason).toContain("waived");
  });

  it("ignores a waiver with no real reason", () => {
    // "we waived this" tells an auditor nothing. The reason IS the evidence.
    expect(run({ verdict: blocked, waivers: [waiver({ reason: "ok" })] }).action).toBe("decline");
  });

  it("ignores a waiver from a bot", () => {
    expect(run({ verdict: blocked, waivers: [waiver({ human: false })] }).action).toBe("decline");
  });

  it("refuses to let a control excuse itself", () => {
    // The reviewer and the approver may not waive their own findings. If they
    // could, the loop closes and nobody is outside it.
    expect(waiverCounts(waiver({ by: BOT }), BOT)).toBe(false);
    expect(waiverCounts(waiver({ by: "codeworthy-steward[bot]" }), BOT)).toBe(false);
    expect(waiverCounts(waiver({ by: "dana" }), BOT)).toBe(true);
  });

  it("declines when only SOME of several findings are waived", () => {
    const two = verdict({
      decision: "blocked",
      blocking: [{ id: "secret_introduced", file: "a" }, { id: "destructive_migration", file: "b" }],
    });
    const d = run({ verdict: two, waivers: [waiver()] });
    expect(d.action).toBe("decline");
    expect(d.unaddressed.map((f) => f.id)).toEqual(["destructive_migration"]);
  });
});

describe("strict mode is a second opinion, never a shortcut", () => {
  it("can withhold approval the base rules would have granted", () => {
    const d = run({ strict: { ok: false, summary: "this changes an auth path with no test." } });
    expect(d.action).toBe("decline");
    expect(d.reason).toContain("auth path");
  });

  it("can never grant approval the base rules would have refused", () => {
    const blocked = verdict({ decision: "blocked", blocking: [{ id: "secret_introduced", file: "a" }] });
    expect(run({ verdict: blocked, strict: { ok: true, summary: "looks fine" } }).action).toBe("decline");
  });
});

describe("reading waivers out of comments", () => {
  it("takes the finding id and the reason, and who gave it", () => {
    const [w] = parseWaivers([
      { body: "@codeworthy waive secret_introduced: it's a documented test fixture", user: { login: "dana", type: "User" } },
    ]);
    expect(w).toMatchObject({ findingId: "secret_introduced", by: "dana", human: true });
    expect(w!.reason).toBe("it's a documented test fixture");
  });

  it("marks an app's comment as non-human", () => {
    const [w] = parseWaivers([{ body: "@codeworthy waive x_y: because I say so", user: { login: "bot", type: "Bot" } }]);
    expect(w!.human).toBe(false);
  });

  it("ignores ordinary conversation", () => {
    expect(parseWaivers([
      { body: "should we waive this?", user: { login: "dana", type: "User" } },
      { body: "@codeworthy waive", user: { login: "dana", type: "User" } },
      {},
    ])).toEqual([]);
  });
});

describe("separation of duties, enforced by capability", () => {
  const approver = createApproverClient("t", BOT) as unknown as Record<string, unknown>;
  const steward = createGitHubClient("t") as unknown as Record<string, unknown>;

  it("only the approver can approve", () => {
    // Stated separation is worth nothing; this is the mechanical version.
    expect(Object.keys(approver)).toContain("submitReview");
    expect(Object.keys(steward).some((m) => /review/i.test(m) && /submit|approve/i.test(m))).toBe(false);
  });

  it("only the reviewer can post the check that gates the merge", () => {
    // If one actor could both fail a check and approve past it, there would be
    // one actor, not two.
    expect(Object.keys(approver).some((m) => /checkrun|check_run|createcheck/i.test(m))).toBe(false);
    expect(Object.keys(steward)).toContain("createCheckRun");
  });

  it("the approver can't merge, force-push, delete, or change protection", () => {
    const violations = Object.keys(approver).filter((m) => APPROVER_FORBIDDEN.test(m));
    expect(violations, `forbidden on the approver: ${violations.join(", ")}`).toEqual([]);
  });
});
