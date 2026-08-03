# CodeWorthy — The New Direction: Strategic Report & Business Case

*Status: strategy memo. Neither the original nor the new direction is validated
yet; this document frames the choice and recommends how to resolve it cheaply.*

---

## Executive summary

CodeWorthy began as a **hiring assessment** — prove a person can be trusted to
ship code a team relies on. Through building it, a second, possibly larger
surface emerged: **an "AI senior engineer" that stewards a repository for people
who build with AI but don't know engineering discipline.** It protects `main`,
reviews before merge, does the safe git mechanics a non-engineer can't, and
reports the repo's health like a doctor's checkup — all in plain language.

The unlock is that these are **not two companies.** CodeWorthy has spent its
effort codifying *what a trustworthy senior engineer does* (the competency
model, the rubric, the scenarios). That codified definition is the IP, and it
powers three expressions of one thesis — a **trust layer for AI-assisted
software engineering**:

| Surface | Verb | Buyer |
|---|---|---|
| **Assess** | *Measure* the behaviors | Hiring teams |
| **Steward** (new) | *Enforce* the behaviors on a live repo | Builders & small startups |
| **Learn** | *Teach* the behaviors | Individual developers |

**Recommendation up front:** don't pick by argument — both directions are one
cheap experiment away from a real signal. Run both tests in parallel this week;
let the ICP be chosen by evidence. The single highest-leverage move is to
prototype the deterministic "repo checkup" on real repos, because it reuses
assets already built, dogfoods a pain the founder personally hit, and tests
demand at once.

---

## 1. What changed, and why it's credible

The original product measures a *person*, asynchronously, for a hiring decision.
The new direction is *always-on infrastructure* on a live repo. What connects
them — and what makes the shift credible rather than a random pivot — is that
both run on the same definition of trustworthy engineering.

The trigger is real and timely: AI build tools (Cursor, Replit, Lovable, Google
Antigravity) created a wave of people who can *produce* working code but have
never learned to *steward* it — no branching discipline, no meaningful tests, no
review, secrets committed, force-pushes over their own work, insta-merges to
production. That is the exact gap CodeWorthy already defined in order to grade
it. The assessment taught us what "good" looks like; the stewardship product
*enforces* it for people who can't yet do it themselves.

---

## 2. The product

**The AI Senior Engineer** operates in three modes, and never more aggressively
than a good tech lead would:

- **Safe-mechanics** (does it silently, reversibly): create a branch when you
  edit `main`, draft commit messages, open the PR, rebase behind branches.
- **Advise** (comments, human decides): split this PR, add a test, this looks
  risky, here's a safer option.
- **Gate** (blocks until you consciously proceed, always overridable with a
  logged reason): push to `main`, commit a secret, merge on red CI, destructive
  migration.

**It never auto-merges, never force-pushes shared history, never acts
irreversibly alone. The human owns every merge.** This is CodeWorthy's own
principle — *stay in control, verify AI output* — applied to the tool itself, so
the guardrail never becomes another unreviewed actor.

**What it surfaces (the output layer):**

- **Repo health as a doctor's checkup** — not one opaque score, but a *panel of
  vitals* (branch health, test health, security, merge hygiene, dependency
  health), each 🟢🟡🔴 with a plain-language explanation and a "prescription."
  Topline is a *status* (Healthy / Needs attention / At risk), never a shaming
  letter grade or false-precision number. Each vital is its own evidence — which
  satisfies CodeWorthy's standing rule that a score must always cite its
  breakdown.
- **PR quality** (focused? tested? reviewable size? real description?) — as
  per-PR coaching, never per-person ranking.
- **Best-practice warnings, recommendations, and a configurable merge cooldown**
  (a minimum review window — a distinctive guardrail GitHub doesn't offer, aimed
  squarely at the insta-merge habit).
- **A SOC 2-grade audit log** — immutable, plain-language record of who changed
  what, who approved, when it merged, what checks ran.

**Design north star:** everything reads like a smart colleague explaining it —
**plain language for non-engineers.** That is the wedge against GitHub's native
controls, which are powerful but built *for engineers*.

**Ethics guardrails (non-negotiable, inherited from CodeWorthy's own doctrine):**
no leaderboards, no lines-of-code metrics, no ranking teammates, no surveillance,
no autonomous irreversible actions. "Who wrote the most code" is explicitly
rejected — it rewards volume (which AI makes worthless) and it's the ranking
trap the company forbids. Gamification, if used, celebrates *good habits*
(streaks for small tested PRs, catching bugs in review), positive and personal,
never competitive ranking.

---

## 3. Why it's the same company (the IP thesis)

The moat was never the assessment format or the guardrail mechanics — both are
copyable. The durable asset is **a validated definition of trustworthy
engineering behavior**, and it is reused directly:

- The **competency model** becomes the agent's rule set.
- **`baseline-check`** (already built) becomes the gate that catches meaningless
  tests ("this test passes even without your change").
- The **wrong-merge scenario's** authz finding becomes the "route missing its
  auth" warning.
- The **defense round** becomes a lightweight pre-merge "micro-defense" ("in one
  sentence, what does this do and what could break?").

Nothing built for assessment is wasted; it is the engine for stewardship.

---

## 4. Market & ideal customer

The output list quietly revealed a fork in *who* this serves:

- **Solo vibe coder** — enormous TAM, but low willingness to pay, and high risk
  the build platforms bundle safety for free.
- **The 3–20 person startup that vibe-codes and needs to "look grown up"** —
  fewer accounts, but real budget, stickier, and with a compliance trigger (SOC
  2) that creates urgency. This bucket wants *everything* the solo user wants
  **plus** merge policy, team coaching, and the audit log.

**Recommended wedge: the small startup, entered through the SOC 2 audit log.**
"Pass your security review as a byproduct of building safely" is a concrete,
budgeted pain — a far easier sale than "be a better coder." It also reframes the
whole product from a nice-to-have into a compliance necessity.

Market timing is favorable: AI-generated code volume is exploding, governance of
that code is the scarce complement, and young startups face SOC 2 pressure
earlier than ever while shipping with the least engineering maturity in history.

---

## 5. Competitive landscape (honest)

| Player | Overlap | Why CodeWorthy is different / the risk |
|---|---|---|
| **GitHub native** (rulesets, push protection) | The primitives | Built *for engineers*; invisible to non-engineers. CodeWorthy's plain-language layer sits on top, not against it. |
| **AI code review** (CodeRabbit, Greptile, Graphite, Ellipsis) | PR review | Engineer-focused, review-only; not stewardship, not plain-language, not compliance. |
| **The build platforms** (Cursor, Replit, Lovable, Antigravity) | **The real threat** | Their users *are* these builders; safety is core to their retention, so they'll bundle it. CodeWorthy's answer must be **cross-platform + compliance + an explicit behavior model** — the position a single platform can't own. |
| **Compliance/audit** (Vanta, Drata) | The SOC 2 log | They automate evidence collection broadly; CodeWorthy owns the *code-change* control specifically and could integrate with them. |

The most serious risk is **absorption by the build platform**, not competition
from GitHub or point tools. Being cross-platform and compliance-anchored is the
defensible ground.

---

## 6. Business model

- **Solo:** freemium — the health checkup free (acquisition + virality), active
  guardrails and history paid. Low ARPU; a funnel, not the revenue.
- **Startup (the real revenue):** per-repo or per-seat SaaS, with the **SOC 2
  audit log as the upsell wedge.** Plausibly $X00/month per small team — a
  budgeted line item, not a discretionary tool spend.
- **Relationship to the original model:** assessment doesn't die — it becomes
  complementary. *Hire people who are codeworthy (Assess) → they build under the
  guardrails (Steward) → the audit log proves it (compliance).* One trust story,
  three revenue lines, shared engine.

*(Figures deliberately unquantified — there is no data yet to support precise
numbers, and inventing them would repeat the "opaque score" mistake the product
rejects. Pricing is a post-validation experiment.)*

---

## 7. The two existential risks

1. **The trust paradox.** For a builder to hand `main` to an agent, they must
   trust its judgment — but the reason they need it is they *can't evaluate*
   that judgment. So **explainability + reversibility + human-owns-the-merge is
   not a feature set, it is the entire product.** This is the same validity
   problem as the assessment side, mirrored, and it has the same answer: show
   the evidence, make everything inspectable, never a black box.
2. **Platform absorption** (see §5). Mitigated only by cross-platform reach, the
   compliance anchor, and speed.

Both are survivable, but they define where the effort must go: trust-building
UX and a wedge the platforms won't rush to copy (compliance).

---

## 8. Honest assessment & recommendation

Two truths held together: the new direction is **more exciting and plausibly a
bigger market**, and it is **more contested and completely unvalidated** — as is
the original assessment product. The disciplined move is not to choose by
conviction but to **buy the answer cheaply**:

- **Assessment test:** run the standardized bug scenario past a few real people
  blind; confirm strong vs. weak produce visibly different reports and that one
  experienced manager trusts the evidence. (Days, ~$0 — already teed up.)
- **Stewardship test:** (a) interview 5 real vibe-coders / small-startup
  founders about their worst repo disaster and whether they'd pay for invisible
  guardrails + a SOC 2 log; (b) **prototype the deterministic tier of the repo
  checkup on a real repo** — the branch/test/security/merge vitals, using the
  already-built `baseline-check` and git plumbing. This dogfoods the exact git
  pain hit while building CodeWorthy and reuses existing assets, so it is the
  cheapest path to a real signal.

**What would make the case bullish:** founders light up at the SOC 2 + safety
framing and say they'd pay; the prototype checkup surfaces real problems in real
repos in language a non-engineer understands.
**What would make it bearish:** the pain is real but nobody will pay because
"the platform will just add it," or the checkup can't say anything a non-engineer
finds actionable.

Do not build the full platform before those signals. Everything already built
survives either outcome, so there is no sunk-cost pressure — only the discipline
to test before committing a quarter to either surface.

---

## 9. What this means for the existing work

Nothing is thrown away. The engine (competency model, scenarios, baseline-check,
hidden-suite, provisioning/grading scripts, the site) all feed the new
direction. The assessment product becomes one expression of the trust layer —
possibly the credibility/heritage layer ("the people who literally defined and
graded production-readiness now enforce it for you"). The pivot, if it happens,
is a change of *primary surface*, not a restart.

---

*A note on this memo's objectivity: it was written from inside the project and
should be read as a structured argument, not a verdict. The decision rests on the
cheap validation above, not on the persuasiveness of this document.*
