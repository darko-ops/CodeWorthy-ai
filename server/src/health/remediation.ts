// Fix paths: what to do about an unhealthy repo, ranked.
//
// The old model gave each vital one `prescription` string — a single sentence
// that assumed CodeWorthy's preferred fix was available. It often isn't, and
// when it isn't the user was left with a red badge, a suggestion they couldn't
// act on, and no next move. That is the state people uninstall from.
//
// So every issue carries an ORDERED list of options instead. The first is the
// recommendation; the rest are real alternatives, each honest about what it
// costs. The user acts on one, or says "not an option for me" and moves to the
// next. The list always ends somewhere: the final option on every issue is an
// explicit, logged acceptance, so a repo can always be brought to a settled
// state even when the ideal fix is impossible. A permanently unresolvable
// warning is not a safety feature — it is noise that teaches people to ignore
// the dashboard.
//
// Two rules this module keeps:
//   1. Never offer an option we know is unavailable. If the spine already
//      recorded that protection can't be applied to this repo, "turn on branch
//      protection" is not in the list — the constraint is stated instead, and
//      the options are the ones that work around it.
//   2. Say why. Every issue names the constraint that stops CodeWorthy fixing
//      it alone, in the user's language, because "we can't" without "because"
//      reads as the tool being broken.
import type { RepoMode } from "../steward/repoMode.js";
import type { HealthVital, VitalStatus } from "./health.js";

export type Effort = "one click" | "a few minutes" | "a decision to make";

export type FixAction =
  /** CodeWorthy can do this itself, on the user's click. */
  | { kind: "codeworthy"; label: string; method: "POST"; path: string; body?: Record<string, unknown> }
  /** Only a human can do it, in GitHub's own UI. */
  | { kind: "github"; label: string; url: string }
  /** A change the user makes in their repository. */
  | { kind: "manual"; label: string; steps: string[]; snippet?: { filename: string; body: string } }
  /** Settle the issue by accepting it, on the record. */
  | { kind: "accept"; label: string; method: "POST"; path: string };

export interface FixOption {
  id: string;
  title: string;
  /** What this actually does, in plain language. */
  detail: string;
  /** What it costs, or why it isn't the recommendation. Null on the top pick. */
  tradeoff: string | null;
  effort: Effort;
  action: FixAction;
}

export interface RepoIssue {
  id: string;
  vitalId: string;
  severity: Exclude<VitalStatus, "healthy" | "unknown">;
  title: string;
  /** What is true right now. */
  finding: string;
  /** What it means if nothing changes. */
  consequence: string;
  /** Why CodeWorthy can't just fix it. Null when it simply needs a yes. */
  constraint: string | null;
  /** Ranked best-first. The first is the recommendation. */
  options: FixOption[];
}

export interface RemediationContext {
  repo: string; // "owner/name"
  defaultBranch: string;
  /** How the repo is worked on — changes what counts as a problem at all. */
  mode: RepoMode;
  /** Latest protection-family event type in the spine, if any. */
  latestProtectionEvent: string | null;
  /** Is drift restored automatically (operator setting)? */
  restoreDrift: boolean;
  /** Direct-to-default pushes in the window. */
  directPushes: number;
  /** …of those, how many happened AFTER protection was last put in place. */
  directPushesSinceProtection: number;
  /** Is protection currently in force? */
  protectionInPlace: boolean;
  /** Has the user already accepted a given issue id? */
  accepted: Set<string>;
}

const ghSettings = (repo: string, page: string) => `https://github.com/${repo}/settings${page}`;

/** The workflow that gates a repo CodeWorthy cannot protect through the API. */
const ACTIONS_GATE_SNIPPET = {
  filename: ".github/workflows/codeworthy.yml",
  body: `name: CodeWorthy PR review

on:
  pull_request:

permissions:
  contents: read
  pull-requests: write

jobs:
  review:
    name: CodeWorthy PR review
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: actions/checkout@v4
        with:
          repository: CodeWorthy-ai/CodeWorthy
          path: .codeworthy
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: |
          node .codeworthy/enforcement/pr-review.mjs \\
            --repo . --base "origin/\${{ github.base_ref }}" --head HEAD
`,
};

/**
 * Build the ranked fix paths for a repo.
 *
 * Pure: vitals + context in, issues out. Everything it needs is already known
 * from the audit spine, so producing this costs no extra GitHub calls — which
 * matters because it renders on every dashboard load.
 */
export function buildIssues(vitals: HealthVital[], ctx: RemediationContext): RepoIssue[] {
  const issues: RepoIssue[] = [];
  const byId = new Map(vitals.map((v) => [v.id, v]));
  const sev = (v: HealthVital) => (v.status === "at risk" ? "at risk" : "watch") as RepoIssue["severity"];

  const acceptOption = (issueId: string, title: string, detail: string): FixOption => ({
    id: `${issueId}.accept`,
    title,
    detail,
    tradeoff: "The risk stays. CodeWorthy records that you decided this deliberately, with the date — so it reads as a judgement call rather than something nobody noticed.",
    effort: "a decision to make",
    action: { kind: "accept", label: "Accept and stop flagging", method: "POST", path: `/api/repos/${ctx.repo}/accept/${issueId}` },
  });

  const protection = byId.get("protection");

  // ── protection can't be applied at all (the hard constraint) ──────────────
  // Discovered from evidence, not guessed: the spine records it when GitHub
  // refuses. Private repos on a free plan get a 403 for both rulesets and
  // branch protection, so the ideal fix is genuinely unavailable and offering
  // it would just fail again in front of the user.
  if (protection && ctx.latestProtectionEvent === "exception.protection_unavailable") {
    issues.push({
      id: "protection_unavailable",
      vitalId: "protection",
      severity: "at risk",
      title: `CodeWorthy can't protect ${ctx.defaultBranch} on this repository`,
      finding: "GitHub refused the request to configure branch protection here.",
      consequence: `Anyone with write access can push straight to ${ctx.defaultBranch}, force-push over history, or delete the branch, and nothing reviews it first.`,
      constraint: "Branch protection and rulesets need a paid plan on private repositories. GitHub blocks the API call, so this isn't something CodeWorthy can turn on for you.",
      options: [
        {
          id: "protection_unavailable.public",
          title: "Make the repository public",
          detail: "Branch protection and rulesets are free on public repositories. CodeWorthy will apply them the moment GitHub allows it.",
          tradeoff: null,
          effort: "a decision to make",
          action: { kind: "github", label: "Open repository settings", url: ghSettings(ctx.repo, "") },
        },
        {
          id: "protection_unavailable.gate_in_ci",
          title: "Run the gate in your own CI instead",
          detail: "Add one workflow file. It runs the same review CodeWorthy runs and fails the build on a blocking finding — no plan upgrade, no settings change.",
          tradeoff: "It reviews and reports, but without branch protection nothing stops someone merging past a red check. It's a strong signal, not a lock.",
          effort: "a few minutes",
          action: {
            kind: "manual",
            label: "Add the workflow",
            steps: [
              `Create ${ACTIONS_GATE_SNIPPET.filename} in ${ctx.repo}.`,
              "Paste the file below and commit it.",
              "Open a pull request — the CodeWorthy PR review check will run on it.",
            ],
            snippet: ACTIONS_GATE_SNIPPET,
          },
        },
        {
          id: "protection_unavailable.upgrade",
          title: "Upgrade the plan",
          detail: "GitHub Pro (or any paid plan) unlocks branch protection on private repositories. CodeWorthy applies it automatically once available.",
          tradeoff: "It costs money, and it's the only option here that does.",
          effort: "a decision to make",
          action: { kind: "github", label: "See GitHub plans", url: "https://github.com/settings/billing/plans" },
        },
        acceptOption(
          "protection_unavailable",
          "Leave this repository unprotected",
          `Reasonable if ${ctx.repo} is a scratch project or nothing depends on it. CodeWorthy keeps watching and keeps the change record — it just stops asking.`
        ),
      ],
    });
  }

  // ── protection never turned on (just needs a yes) ─────────────────────────
  else if (protection && protection.status === "watch" && !ctx.accepted.has("protection_off")) {
    issues.push({
      id: "protection_off",
      vitalId: "protection",
      severity: "watch",
      title: `${ctx.defaultBranch} isn't protected yet`,
      finding: `Work can land on ${ctx.defaultBranch} directly, with nothing reviewing it first.`,
      consequence: `A bad change reaches your live branch with no review and no check — and force-pushing over it, or deleting the branch, is still possible.`,
      constraint: "Changing repository settings is the one thing CodeWorthy will never do without you saying yes first.",
      options: [
        {
          id: "protection_off.enable",
          title: "Turn on branch protection",
          detail: `Changes to ${ctx.defaultBranch} will need a pull request that passes CodeWorthy's review. Force-pushes and branch deletion are blocked. If the rule is later weakened, CodeWorthy puts it back.`,
          tradeoff: null,
          effort: "one click",
          action: { kind: "codeworthy", label: "Protect this branch", method: "POST", path: `/api/repos/${ctx.repo}/protect` },
        },
        {
          id: "protection_off.gate_in_ci",
          title: "Review every pull request, but don't block merges",
          detail: "Add the CodeWorthy workflow to your repository. Every pull request gets a review and a check — but nothing is enforced, and your settings don't change.",
          tradeoff: "Someone can still merge past a failing check, or push straight to the branch.",
          effort: "a few minutes",
          action: {
            kind: "manual",
            label: "Add the workflow",
            steps: [
              `Create ${ACTIONS_GATE_SNIPPET.filename} in ${ctx.repo}.`,
              "Paste the file below and commit it.",
            ],
            snippet: ACTIONS_GATE_SNIPPET,
          },
        },
        {
          id: "protection_off.solo",
          title: "I'm the only one working here — switch to solo mode",
          detail: `You keep pushing straight to ${ctx.defaultBranch}. CodeWorthy reviews each change after it lands and comments on the commit, and force-pushes and branch deletion stay blocked.`,
          tradeoff: "The review happens after the change is live, not before — so it tells you about a problem rather than stopping it.",
          effort: "one click",
          action: { kind: "codeworthy", label: "Switch to solo mode", method: "POST", path: `/api/repos/${ctx.repo}/mode`, body: { mode: "solo" } },
        },
        acceptOption(
          "protection_off",
          "Keep working without protection",
          "CodeWorthy keeps the change record and keeps reviewing pull requests — it just stops suggesting this."
        ),
      ],
    });
  }

  // ── protection weakened and NOT restored (report-only mode) ───────────────
  else if (protection && protection.status === "at risk" && !ctx.restoreDrift) {
    issues.push({
      id: "protection_weakened",
      vitalId: "protection",
      severity: "at risk",
      title: `Branch protection on ${ctx.defaultBranch} was weakened`,
      finding: "The rule no longer matches what CodeWorthy put in place, and it hasn't been restored.",
      consequence: "Whatever the rule used to stop is possible again right now — and the longer it stays weakened, the less the change record means as evidence.",
      constraint: "CodeWorthy is set to report drift rather than correct it, so it's leaving the decision to you.",
      options: [
        {
          id: "protection_weakened.restore",
          title: "Put the protection back",
          detail: "Restores the rule exactly as it was. Both the weakening and the restoration stay in the record, with times.",
          tradeoff: null,
          effort: "one click",
          action: { kind: "codeworthy", label: "Restore protection", method: "POST", path: `/api/repos/${ctx.repo}/protect` },
        },
        {
          id: "protection_weakened.review",
          title: "Look at what changed first",
          detail: "Open the branch's protection settings in GitHub and compare before deciding. Useful when the change might have been deliberate.",
          tradeoff: "Nothing is enforced while you look.",
          effort: "a few minutes",
          action: { kind: "github", label: "Open branch settings", url: ghSettings(ctx.repo, "/branches") },
        },
        acceptOption(
          "protection_weakened",
          "The weakening was intentional",
          "Records that this was a deliberate change. CodeWorthy stops flagging this particular weakening."
        ),
      ],
    });
  }

  // ── work is bypassing review ──────────────────────────────────────────────
  // In SOLO mode a direct push is the agreed workflow, so there is nothing to
  // remediate — the vital already reports on whether each one got reviewed.
  // Offering "stop pushing to main" to someone who deliberately chose to push
  // to main is how a tool teaches people to ignore it.
  // Only raise this when there is something left to DO about it. Pushes that
  // happened BEFORE protection went on are history: they are in the record, the
  // cause is already fixed, and no button can unmake them. Offering "make pull
  // requests required" for them meant the recommended one-click fix succeeded,
  // changed nothing visible, and the issue came straight back — the dead end
  // fix paths exist to remove, in a subtler form.
  const review = byId.get("review_discipline");
  const somethingToDo = !ctx.protectionInPlace || ctx.directPushesSinceProtection > 0;
  if (
    ctx.mode !== "solo" &&
    somethingToDo &&
    review &&
    review.status !== "healthy" &&
    review.status !== "unknown" &&
    !ctx.accepted.has("direct_pushes")
  ) {
    const n = ctx.protectionInPlace ? ctx.directPushesSinceProtection : ctx.directPushes;
    issues.push({
      id: "direct_pushes",
      vitalId: "review_discipline",
      severity: sev(review),
      title: `${n} change${n === 1 ? "" : "s"} went straight to ${ctx.defaultBranch}`,
      finding: `${n} change${n === 1 ? " was" : "s were"} pushed to ${ctx.defaultBranch} without a pull request, so nothing reviewed ${n === 1 ? "it" : "them"} first.`,
      consequence: "Nobody — and nothing — saw these before they became the live version. If one of them broke something, the first sign is usually a user telling you.",
      constraint: "CodeWorthy can't turn a push that already landed into a reviewed pull request — that would mean rewriting your history, which it never does.",
      options: [
        {
          id: "direct_pushes.protect",
          title: `Make pull requests required on ${ctx.defaultBranch}`,
          detail: "The next change physically can't skip review — GitHub blocks the direct push and asks for a pull request instead.",
          tradeoff: null,
          effort: "one click",
          action: { kind: "codeworthy", label: "Protect this branch", method: "POST", path: `/api/repos/${ctx.repo}/protect` },
        },
        {
          id: "direct_pushes.review_landed",
          title: "Review what already landed",
          detail: "CodeWorthy kept a branch pointing at each of those commits and left a note on them. Worth a read before deciding they were fine.",
          tradeoff: "It tells you what happened; it doesn't stop the next one.",
          effort: "a few minutes",
          action: { kind: "github", label: "Open the commits", url: `https://github.com/${ctx.repo}/commits/${ctx.defaultBranch}` },
        },
        {
          id: "direct_pushes.solo",
          title: "This is how I want to work — switch to solo mode",
          detail: "Says plainly that one person maintains this repo. Pushing directly stops being flagged, and CodeWorthy reviews each change after it lands instead of asking you to open a pull request against yourself.",
          tradeoff: "The review comes after the change is live. Switch back to shared the moment a second person starts landing changes here.",
          effort: "one click",
          action: { kind: "codeworthy", label: "Switch to solo mode", method: "POST", path: `/api/repos/${ctx.repo}/mode`, body: { mode: "solo" } },
        },
        // Solo mode settles this by changing the policy; accepting settles it by
        // owning the risk under the existing policy. Both are terminal, and
        // someone may want the second without the first — so the issue keeps a
        // final option that requires agreeing to nothing new.
        acceptOption(
          "direct_pushes",
          "Leave it — I know these went in unreviewed",
          "CodeWorthy keeps recording what lands on the branch. It stops raising this as something to fix."
        ),
      ],
    });
  }

  // ── nothing is testing the changes ────────────────────────────────────────
  const gate = byId.get("merge_gate");
  if (gate && gate.status === "watch" && !ctx.accepted.has("gate_unavailable")) {
    issues.push({
      id: "gate_unavailable",
      vitalId: "merge_gate",
      severity: "watch",
      title: "Some changes merged without a verdict",
      finding: "CodeWorthy couldn't read some pull requests, so it reported \"couldn't review\" rather than passing them.",
      consequence: "A change that merges without a verdict was never actually gated — the control looks like it ran when it didn't.",
      constraint: "This usually means CodeWorthy lost access to the repository, which only you can grant back.",
      options: [
        {
          id: "gate_unavailable.check_access",
          title: "Check CodeWorthy's access to this repository",
          detail: "Confirm the app is still installed here and can read the repository. Re-granting access fixes it immediately.",
          tradeoff: null,
          effort: "one click",
          action: { kind: "github", label: "Open app installation", url: "https://github.com/settings/installations" },
        },
        acceptOption(
          "gate_unavailable",
          "I'll leave it for now",
          "CodeWorthy keeps trying on every new pull request and will clear this on its own if access comes back."
        ),
      ],
    });
  }

  // ── the record itself failed verification ────────────────────────────────
  const integrity = byId.get("integrity");
  if (integrity && integrity.status === "at risk") {
    issues.push({
      id: "integrity_failed",
      vitalId: "integrity",
      severity: "at risk",
      title: "The change record failed its tamper check",
      finding: integrity.finding,
      consequence: "Until this is explained, the change history can't be used as evidence — which is the whole point of keeping it.",
      constraint: "CodeWorthy will not repair an append-only record. Rewriting it to make the check pass would destroy exactly the property that makes it worth anything.",
      options: [
        {
          id: "integrity_failed.investigate",
          title: "Find out who can write to the database",
          detail: "The log is append-only by design and should never fail this check. A failure means something wrote to it directly — start with who holds database credentials.",
          tradeoff: null,
          effort: "a decision to make",
          action: {
            kind: "manual",
            label: "What to check",
            steps: [
              "List everyone and every service with write access to the Steward database.",
              "Compare the audit chain against the write-once anchor to find where it diverges.",
              "Treat entries after the divergence as unverified until explained.",
            ],
          },
        },
      ],
    });
  }

  // Worst first, and within a severity, fewest-clicks first — the fastest way
  // to a settled repo is at the top.
  const rank = { "at risk": 0, watch: 1 } as const;
  const effortRank: Record<Effort, number> = { "one click": 0, "a few minutes": 1, "a decision to make": 2 };
  return issues.sort(
    (a, b) =>
      rank[a.severity] - rank[b.severity] ||
      effortRank[a.options[0]!.effort] - effortRank[b.options[0]!.effort]
  );
}
