// What the approver decides, and why. Pure — no network, no database.
//
// The approver is a SECOND actor. Its job is not to re-review the diff (that is
// the reviewer's job, and duplicating it would just be the same judgement
// twice); its job is to answer one different question: **were the reviewer's
// blocking findings actually dealt with?** Dealt with means fixed, or waived by
// a human who gave a reason. That is a genuinely independent check, it clears
// in seconds when the work is done, and it can say no.
//
// The thing that makes an approver worth having is its ability to decline. An
// approver that always approves is worse than no approver: it manufactures
// evidence that a control operated when it did not. So the rules below are
// written to fail closed —
//
//   * No verdict for this exact commit  -> ABSTAIN. Never approve blind. A
//     verdict for an older commit says nothing about the code being approved.
//   * Blocking findings outstanding     -> DECLINE, naming them.
//   * Waived without a reason           -> the waiver does not count.
//   * Waived by the approver itself, or
//     by CodeWorthy                     -> the waiver does not count. A control
//     cannot excuse itself; only a person can accept a risk.
//
// STRICT mode adds a second, independent opinion of the diff on top of all of
// this. It can only ever withhold approval, never grant one the base rules
// would have refused.
export type ApprovalAction = "approve" | "decline" | "abstain";

export interface GateVerdict {
  headSha: string;
  decision: "blocked" | "advise" | "clean";
  /** Blocking findings only — the ones that must be dealt with. */
  blocking: Array<{ id: string; file: string | null }>;
}

export interface Waiver {
  findingId: string;
  reason: string;
  by: string;
  /** True when the waiver came from a human, not an app/bot. */
  human: boolean;
}

export interface StrictOpinion {
  ok: boolean;
  summary: string;
}

export interface DecisionInput {
  headSha: string;
  verdict: GateVerdict | null;
  waivers: Waiver[];
  /** Present only when APPROVER_STRICT is on. */
  strict?: StrictOpinion | null;
  /** The login the approver posts as — it may never waive on its own behalf. */
  approverLogin: string;
}

export interface Decision {
  action: ApprovalAction;
  /** One sentence, shown on the PR and recorded in the spine. */
  reason: string;
  /** Blocking findings still outstanding, if any. */
  unaddressed: Array<{ id: string; file: string | null }>;
  /** Waivers that were accepted, for the record. */
  accepted: Waiver[];
}

const MIN_REASON = 8;

/** A waiver only counts if a human gave one, with an actual reason. */
export function waiverCounts(w: Waiver, approverLogin: string): boolean {
  if (!w.human) return false;
  // A control cannot excuse itself. Neither the reviewer nor the approver may
  // wave away a finding — that would close the loop and leave nobody outside it.
  const by = w.by.toLowerCase().replace(/\[bot\]$/, "");
  if (by === approverLogin.toLowerCase().replace(/\[bot\]$/, "")) return false;
  if (by.includes("codeworthy")) return false;
  return w.reason.trim().length >= MIN_REASON;
}

export function decide(input: DecisionInput): Decision {
  const { verdict, approverLogin } = input;

  // Approving a commit we have no verdict for is approving blind. A verdict on
  // an earlier commit is not a verdict on this one — the diff has changed.
  if (!verdict || verdict.headSha !== input.headSha) {
    return {
      action: "abstain",
      reason: "CodeWorthy hasn't reviewed this commit yet, so there's nothing to approve against. This will resolve itself once the review lands.",
      unaddressed: [],
      accepted: [],
    };
  }

  const accepted: Waiver[] = [];
  const unaddressed: Array<{ id: string; file: string | null }> = [];
  for (const finding of verdict.blocking) {
    const waiver = input.waivers.find(
      (w) => w.findingId === finding.id && waiverCounts(w, approverLogin)
    );
    if (waiver) accepted.push(waiver);
    else unaddressed.push(finding);
  }

  if (unaddressed.length > 0) {
    const names = unaddressed.map((f) => f.id).join(", ");
    return {
      action: "decline",
      reason: `Not approving: ${unaddressed.length} blocking finding${unaddressed.length === 1 ? "" : "s"} from CodeWorthy ${unaddressed.length === 1 ? "is" : "are"} still outstanding (${names}). Fix ${unaddressed.length === 1 ? "it" : "them"}, or waive ${unaddressed.length === 1 ? "it" : "them"} with a reason.`,
      unaddressed,
      accepted,
    };
  }

  // Strict mode: a second opinion of the diff itself. It may only ever WITHHOLD
  // approval — it can never grant one the rules above would have refused.
  if (input.strict && !input.strict.ok) {
    return {
      action: "decline",
      reason: `Not approving: CodeWorthy's findings are dealt with, but on an independent read of this change ${input.strict.summary}`,
      unaddressed: [],
      accepted,
    };
  }

  const waived = accepted.length
    ? ` ${accepted.length} finding${accepted.length === 1 ? " was" : "s were"} waived with a stated reason rather than fixed.`
    : "";
  return {
    action: "approve",
    reason:
      verdict.decision === "clean"
        ? `Approved: CodeWorthy reviewed this commit and found nothing blocking.${waived}`
        : `Approved: CodeWorthy's blocking findings on this commit are dealt with.${waived}`,
    unaddressed: [],
    accepted,
  };
}

/**
 * Parse waivers out of pull-request comments.
 *
 * Shape:  @codeworthy waive <finding_id>: <reason>
 *
 * The reason is mandatory and is what makes a waiver evidence rather than a
 * dismissal — "we waived this" tells an auditor nothing; "we waived this
 * because the key is a documented test fixture" tells them everything.
 */
export function parseWaivers(
  comments: Array<{ body?: string; user?: { login?: string; type?: string } }>
): Waiver[] {
  const out: Waiver[] = [];
  const re = /@codeworthy\s+waive\s+([a-z0-9_]+)\s*:\s*(.+)/gi;
  for (const c of comments ?? []) {
    const body = typeof c?.body === "string" ? c.body : "";
    const by = c?.user?.login ?? "";
    // GitHub reports apps as type "Bot". Only a person can accept a risk.
    const human = (c?.user?.type ?? "User") === "User";
    for (const m of body.matchAll(re)) {
      const findingId = (m[1] ?? "").toLowerCase();
      const reason = (m[2] ?? "").trim();
      if (findingId && reason) out.push({ findingId, reason, by, human });
    }
  }
  return out;
}
