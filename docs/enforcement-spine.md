# The enforcement spine

*How CodeWorthy stopped describing branch protection and became it.*

---

## The problem this fixes

Before this tier, CodeWorthy could tell you your `main` branch was unprotected,
that someone had weakened a rule, and that a change had gone straight to the
default branch. All true, all after the fact. It was a very well-written
monitoring tool for a control it did not operate.

Worse, the one place it *did* touch protection was a trap. The configurator
required a status check named `CodeWorthy PR review` — and nothing in the hosted
service ever posted a check by that name. A user who clicked "protect my default
branch" got a repository where every pull request sat forever at *"Expected —
waiting for status to be reported."* Not unenforced: **bricked**. The
Actions-based gate didn't rescue it either, because a workflow's check context is
its **job** name (`review`), not the workflow name.

## The chain

Enforcement is one chain, and every link is now present:

```
a rule    →  the ruleset requires the check "CodeWorthy PR review"
the check →  gate/check.ts is the only thing that ever posts it
the gate  →  a GATE finding posts conclusion: failure
GitHub    →  the merge button is disabled
```

Break any link and the product is a dashboard again. So each link has a test
that fails the build if it breaks:

| Link | Guarded by |
|---|---|
| Only one module can block a merge | `client.doctrine.test.ts` — scans `src/steward/**` for `createCheckRun`, asserts exactly `gate/check.ts` |
| The gate is deterministic | `gate/findings.test.ts` — pure in, pure out, no DB or network |
| Secret rules can't drift between the Action and the service | `gate/patterns.test.ts` — imports `checkup/secret-patterns.mjs` and compares |
| "Protected" has a precise definition | `rulesets.test.ts` — diffs every way the rule can be loosened |
| Weakening is corrected, not just logged | `enforcement.test.ts` — asserts the restore call *and* both audit events |
| CodeWorthy still can't merge | the forbidden-verb doctrine test, unchanged |

## Two modes, because one shape doesn't fit

A single maintainer forced to branch-and-PR against themselves either stops
using the tool or turns protection off entirely — and an unprotected repo with
no record is strictly worse than a fast one with a complete record. So a repo
declares how it is worked on, and the protection follows.

| | **shared** (default) | **solo** |
|---|---|---|
| Push to the default branch | pull request required | **allowed** |
| CodeWorthy | gates before merge | **reviews after it lands** |
| Force-push | blocked | **blocked** |
| Branch deletion | blocked | **blocked** |
| A direct push is… | `exception.protection_bypassed` | an ordinary event |

Speed is what solo mode buys. The ability to erase the history the record is
made of is not on the table in either mode.

Three details that took getting right:

- **Solo omits `required_status_checks`, not just the `pull_request` rule.** A
  required check rejects a direct push too, so leaving it would have re-blocked
  the exact thing solo mode exists to allow.
- **Drift detection is mode-aware.** Judged by shared rules, a healthy solo
  ruleset looks like it is missing two rules — so the hourly sweep would have
  "restored" it and silently undone a deliberate choice, on a schedule, forever.
- **A solo push is not an exception.** Recording the user's agreed workflow as a
  deviation would fill the exception register with normal activity and destroy
  the meaning of the register, which is the part an auditor actually reads.

Reviews of landed commits are recorded with `postMerge: true`, so nothing in the
record can later be read as a pre-merge gate, and they post no check run — a red
check on a commit already on `main` blocks nothing and can never be cleared.

## The approver: a second actor that can say no

The reviewer must not also be the approver, or the approval is the reviewer
agreeing with itself. So approval is a **separate GitHub App** with its own
credentials, and its job is deliberately not to re-review the diff — that is the
reviewer's job, and doing it twice is the same judgement twice. It answers a
different question: *were the reviewer's blocking findings dealt with?* Fixed,
or waived by a person who gave a reason.

What makes it worth having is that it can refuse. An approver that always
approves is worse than none: it manufactures evidence that a control operated
when it did not. So it fails closed.

| Situation | Decision |
|---|---|
| No verdict for **this exact commit** | abstain — a verdict on an earlier commit says nothing about the code being approved |
| Blocking findings outstanding | decline, naming them |
| Waiver with no stated reason | doesn't count — the reason *is* the evidence |
| Waiver from a bot | doesn't count |
| Waiver from the reviewer or approver itself | doesn't count — a control can't excuse itself |

Separation is enforced three ways rather than asserted once: the approver's
manifest grants no `checks` permission (it cannot post the check that gates a
merge) and no `administration` (it cannot change the rule it approves under);
`approver/client.ts` is a separate capability surface with a doctrine test
asserting both directions; and it authenticates with its own installation token.

Waivers are pull-request comments — `@codeworthy waive <finding_id>: <reason>` —
and a comment re-triggers the decision, so a waiver takes effect without a push.

`required_approving_review_count` follows whether an approver is actually
configured. Requiring an approval nobody can give is the same failure as
requiring a check nobody posts: an unmergeable repository.

## Why rulesets, not legacy branch protection

Both are supported (legacy is the automatic fallback when the rulesets API isn't
available), but rulesets are the primitive the product stands on:

- **They're named objects.** "CodeWorthy — protected default branch" is a thing
  you can point an auditor at, diff against a desired state, and restore. A
  legacy rule is an anonymous bag of settings on a branch.
- **They target `~DEFAULT_BRANCH`.** Renaming `main` does not silently
  unprotect the repo — the classic way a legacy rule stops working without
  anyone noticing.
- **Bypass is an enumerable list**, not one `enforce_admins` boolean. "Who can
  go around this?" becomes an answerable question, and *widening* that list is
  drift we detect.
- **Changing one emits a webhook**, so drift reaches us in seconds rather than
  at the next sweep.

## What gates and what only advises

The severity of every finding is policy, set per repo in `.steward.yml`, but the
defaults encode a rule: **gate on what is irreversible or known-broken; advise
on everything else.**

| Finding | Default | Why |
|---|---|---|
| Secret introduced | **GATE** | Leaked the moment it lands, whether or not it merges |
| `.env` / `node_modules` committed | **GATE** | Irreversible in history |
| Migration drops a table or column | **GATE** | Permanent data loss |
| Repo's own checks are red (`merge_on_red`) | **GATE** | A known-broken commit on `main` |
| Touches a declared protected path | **GATE** | The point of declaring it |
| Repo has no CI at all (`no_ci`) | ADVISE | *Never* gate — requiring a check a repo doesn't have blocks every merge forever |
| Code changed with no test | ADVISE | Judgment, not a fact |
| Large diff, vague commit messages | ADVISE | Style and reviewability |

Two failure modes are treated as equally bad, and neither is allowed:

- **Silent pass.** If GitHub won't hand us the diff, the check reports
  `neutral` — visibly "we didn't judge this" — and logs
  `exception.gate_unavailable`. It never reports success on a change it never read.
- **Latched shut.** A check that never reports blocks the repo forever, so
  every failure path still posts a conclusion. `cancelled`, `skipped` and
  `in_progress` are deliberately not treated as red: gating on unknowns is how a
  guardrail becomes something people rip out.

The same rule governs the protection side. Reading the live state has three
outcomes and conflating any two of them is how a guardrail does damage: the rule
is **there** (diff it), the rule is **absent** — a 404 — (restore it), or we
**could not look** — a 401/403/5xx — (log `exception.protection_check_failed`
and touch nothing). Only a 404 counts as absence, which is why `GitHubHttpError`
carries the status: "there is no protection here" and "we are not allowed to
look" are the same string and opposite facts.

## Consent, and its exact edges

Turning protection **on** is always a human decision — the click on
`/steward/setup`, or an operator's `STEWARD_AUTO_PROTECT=1`. Keeping it on is
the product.

- A weakened rule is **restored** by default (`STEWARD_RESTORE_PROTECTION=0`
  degrades to report-only).
- Consent is **per installation**: a repo added later to an account that already
  said yes inherits it. A repo in an account that never said yes is never
  protected by a background job — silence is not consent, and the sweep is
  exactly where that rule would quietly erode.
- CodeWorthy can create and update its ruleset. It has **no capability to remove
  one** — turning protection off is the human's call, made in GitHub, and it is
  recorded rather than fought.
- Repository admins can still bypass. That is deliberate: a rule nobody can
  override gets deleted the first time it is wrong. A bypass shows up as
  `exception.protection_bypassed` with who, when, and what landed.

## Two paths, one policy

| | GitHub Actions (`enforcement/`) | Hosted App (`server/`) |
|---|---|---|
| Runs | in the customer's CI | on our service, from webhooks |
| Sees | the full checkout | the diff via the API (metadata only) |
| Posts the check | as the job named `CodeWorthy PR review` | as a check run of the same name |
| Configures protection | no — the user does it by hand | yes, on consent, and restores drift |
| Needs | a workflow file | an install click |

Both must report the **same check context**, or a repo running one and requiring
the other never merges. The name lives in `STEWARD_CHECK`
(`server/src/steward/protection.ts`) and in the job name in
`enforcement/pr-checkup.yml`; changing one without the other is a breaking change.

## The audit vocabulary this adds

| Event | Meaning |
|---|---|
| `gate.evaluated` | a change got a verdict (with decision, findings, fingerprint) |
| `exception.gate_unavailable` | we could not review a change; reported neutral, not passed |
| `protection.configured` / `protection.restored` | the rule was put in place / put back |
| `protection.fallback` | rulesets unavailable; protected by the legacy mechanism |
| `exception.protection_weakened` | the live rule no longer matches the desired one |
| `exception.protection_bypassed` | something landed on a protected branch anyway |
| `exception.protection_rule_edited` / `_deleted` | GitHub told us a human changed a rule |
| `exception.protection_unavailable` | we could not protect a repo at all — needs a human |
| `repo.mode_set` | someone changed how a repo is worked on (solo / shared) |
| `approval.granted` / `approval.declined` | the independent approver's decision, and its reasoning |
| `issue.accepted` | a human accepted a finding deliberately, on the record |

Every one carries a plain-language sentence. The pattern an auditor cares about
is the pair: a deviation and its correction, both timestamped, in an append-only
chain neither of them can edit.

## Known gap

`.steward.yml` is parsed (`stewardConfig.ts`) but never **loaded** — the client
has no contents-read method, deliberately (the doctrine test forbids
`/contents/` endpoints so the App can never read or write arbitrary files).
Every repo therefore runs on `DEFAULT_CONFIG` today. Closing this needs a
decision about how a repo declares policy without widening the client surface —
a config endpoint on the dashboard is the likelier answer than reading the file.
