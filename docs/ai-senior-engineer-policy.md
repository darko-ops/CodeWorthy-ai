# AI Senior Engineer — Repo Stewardship Policy (MVP sketch)

An agent that manages a builder's branches and `main` the way a senior engineer
would — for someone who doesn't know git. It is the **enforcement** surface of
the same behavior model CodeWorthy uses to **measure** engineers: the competency
rubric becomes the agent's policy.

## What it is / is not

**Is:** a tech-lead-in-a-box. It protects `main`, reviews before merge, does the
safe git mechanics a vibe coder can't, and explains every decision in plain
language.

**Is NOT:** an autonomous main-branch rewriter. It **never** auto-merges, never
force-pushes shared history, never makes an irreversible judgment call alone.
The human owns every merge. This is CodeWorthy's own core principle — *stay in
control, verify AI output* — applied to the tool itself. The guardrail must not
become another unreviewed actor.

## Three action modes (the honest MVP scope)

| Mode | Meaning | Rule of thumb |
|---|---|---|
| **SAFE-MECHANICS** | The agent just does it — silently, reversibly | Only if it's reversible and a senior would never bother asking (create a branch, draft a commit message, open a PR scaffold) |
| **ADVISE** | The agent comments/warns; the human decides | Judgment calls that aren't clear-cut (split this PR, add a test, this looks risky) |
| **GATE** | The agent blocks until the human consciously proceeds | Dangerous or irreversible actions (push to main, commit a secret, merge on red CI). Always overridable with a logged reason — it advises, it doesn't imprison |

Escalation only ever flows one way toward more human involvement. Nothing
irreversible happens without an explicit human "yes."

## The policy: competency → concrete repo rules

### Git discipline  *(core)*
| Situation | Mode | Action |
|---|---|---|
| Editing/committing directly on `main` | SAFE-MECHANICS | Move the work onto a fresh feature branch, tell them why |
| Push to `main` | GATE | Block; require a PR |
| Force-push to a shared branch | GATE | Block, always |
| Force-push to own branch | ADVISE | Suggest `--force-with-lease`, explain the risk |
| One commit doing several unrelated things | ADVISE | "This commit changes A, B, and C — want me to split it?" |
| Vague commit message ("fix", "stuff") | SAFE-MECHANICS | Draft a clear message from the diff, propose it |
| Branch behind `main` | SAFE-MECHANICS | Offer/auto-rebase (reversible); ADVISE if it would conflict |
| Long-lived stale branch | ADVISE | Nudge to merge or close before it diverges |
| Conflict markers about to be committed | GATE | Block; walk them through resolving |

### Testing  *(reuses `evaluation/baseline-check`)*
| Situation | Mode | Action |
|---|---|---|
| Product code changed, no test added | ADVISE | "Nothing tests this yet — here's a suggested test" |
| New test passes even *without* the change (test-theater) | GATE/ADVISE | Run the red/green baseline check; "this test would pass on the old code — it doesn't prove your fix works" |
| CI failing | GATE | Block merge until green |
| Flaky test detected | ADVISE | Flag it as flaky, don't let it mask a real failure |

### Security
| Situation | Mode | Action |
|---|---|---|
| Secret in the diff (API key, token, `.env`) | GATE | Block the commit/push; add to `.gitignore`; help rotate |
| New route/endpoint missing the auth its siblings have | ADVISE | "Every other order route checks a key; this one doesn't — intended?" *(the wrong-merge scenario's exact finding)* |
| Dependency added with a known critical CVE | GATE | Block; suggest a safe version |

### Data safety
| Situation | Mode | Action |
|---|---|---|
| Destructive migration (`DROP`, `NOT NULL` without default, rename) | GATE | Block; explain the data-loss / running-app risk and the safe multi-step pattern |
| Schema change with no migration | ADVISE | "The DB won't match the code on deploy" |

### Deployment judgment
| Situation | Mode | Action |
|---|---|---|
| Merge to `main` triggers a deploy | GATE | Require green CI + a passing build/preview first; show "here's what will go live" |
| No rollback path | ADVISE | "If this breaks, here's how you'd undo it" |

### Implementation · systems thinking · codebase comprehension  *(model-judgment, mostly ADVISE)*
| Situation | Mode | Action |
|---|---|---|
| New code duplicates something that exists | ADVISE | Point at the existing helper |
| Change alters a shared contract/API used elsewhere | ADVISE | "This response shape is consumed by X — you'll break it" |
| Editing a file the repo marks do-not-touch | ADVISE | Surface the warning the repo already carries |

### Communication
| Situation | Mode | Action |
|---|---|---|
| PR opened with an empty description | SAFE-MECHANICS | Draft a what/why/risk description from the diff |
| Any change | SAFE-MECHANICS | Maintain a plain-language "what changed and why it's safe" log |

### Ownership · root-cause · AI collaboration  *(can't do it FOR them — scaffold it)*
| Situation | Mode | Action |
|---|---|---|
| Before merging anything non-trivial | ADVISE | A one-question **micro-defense**: "In a sentence — what does this do, and what could break?" Keeps the human owning the change instead of merging blind. *(A lightweight echo of the assessment's defense round.)* |

## The "same engine" made concrete

Every row above traces to a competency in `docs/competency-model.md`. The rubric
that defines *what a trustworthy engineer does* is literally the agent's rule
set. Measure it → **Assess**. Enforce it → **Steward**. One IP, two products.

## What it will NOT do (guardrails on the guardrail)

- No auto-merge to `main`.
- No force-push to shared branches, ever.
- No rewriting history others have pulled.
- No silent irreversible action.
- No "trust me" — every gate and edit is explained in plain language, and every
  gate is overridable by the human with a logged reason.

## What's buildable at MVP (honest split)

**Deterministic, buildable now** — high value, low model risk. A GitHub App +
Action + local git hooks:
- direct-to-main, force-push, conflict markers, secrets, junk files → hooks + rulesets
- failing CI, test-theater → **your existing `baseline-check`**, run on the PR
- destructive migrations, missing-auth-on-a-route → pattern checks

**Judgment tier, needs an LLM reviewer** — the competency rubric becomes the
system prompt:
- duplication, contract-breaking changes, backwards-compat reasoning,
  "no test for this behavior," the micro-defense

**Shape:** a GitHub App that (1) auto-configures branch-protection rulesets so a
non-engineer gets sane defaults for free, (2) runs the deterministic + LLM checks
on every push/PR, (3) comments (advise), blocks (gate), or fixes (safe-mechanics)
via the API, always with a plain-language why.

## The one bet this rides on

For a vibe coder to hand `main` to an agent, they must trust its judgment — but
they can't evaluate its judgment (that's why they need it). So **explainability +
reversibility + human-owns-the-merge** aren't nice-to-haves; they're the entire
product. Same validity problem as the assessment side, mirrored — and the same
answer: show the evidence, make it inspectable, never a black box.
