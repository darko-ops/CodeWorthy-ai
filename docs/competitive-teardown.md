# Competitive Teardown — AI Review Layer vs. CodeWorthy

*Follows [`business-analysis.md`](business-analysis.md) and
[`auditor-led-strategy.md`](auditor-led-strategy.md). Written in response to a
proposed positioning — "The AI Security & Compliance Reviewer" — evaluated against
what the competitive set actually shipped as of mid-2026.*

**Bottom line up front:** the proposed position is correct about the *buyer* and
wrong about the *product*. Compliance-focused review is no longer an opening — it
is Qodo's June 2026 launch and Apiiro's existing product. But there is a larger,
emptier position immediately adjacent to it, and the founder's Coalfire background
is the only credential that opens it. It is in §5.

---

## 1. The set, honestly drawn

The proposed analysis names four. The real competitive set is two tiers, and the
second tier is the one that matters, because it already occupies the proposed
position.

**Tier 1 — AI reviewers (named):**

| Player | Core bet | Price |
|---|---|---|
| CodeRabbit | Low-noise inline review; path instructions + `ast-grep` custom rules | ~$24–30/dev/mo |
| Greptile | Whole-codebase graph, multi-agent cross-file reasoning | ~$30/user/mo |
| Qodo | **Governance infrastructure** — rules, standards, policy enforcement | ~$30/user/mo |
| Graphite (Diamond) | Review inside a stacked-PR workflow | ~$24–40/user/mo |

**Tier 2 — already selling the proposed position (omitted from the analysis):**

- **Semgrep** — policy-as-code. Custom YAML guardrails encoding an organization's
  secure-coding conventions, enforced in PRs with comment/warn/**block** modes,
  plus an explicit PCI DSS v4.0.1 automation play. This *is* "does this meet our
  secure coding policy," shipping, today.
- **Apiiro** — Material Code Change Detection. Continuously classifies PII/PCI/PHI
  across repos and APIs, detects authorization-logic changes, and auto-assigns a
  security champion or pen-tester to a PR when authz logic changed or PII became
  exposed through an internet-facing API.
- **Endor Labs / Cycode / Legit** — AI code governance: policy and audit trail on
  every agent, provenance per AI artifact, live AIBOM.

**This matters because the proposed differentiators map almost one-to-one onto
Tier 2's existing feature list:**

| Proposed question | Who already ships it |
|---|---|
| Does this introduce PII handling? | Apiiro (PII/PCI/PHI classification) |
| Is authorization enforced consistently? | Apiiro (authz-change detection + routing) |
| Does this meet our secure coding policy? | Semgrep (custom guardrail rules) |
| Does this violate our SOC 2 controls? | Qodo (regulated-industry governance) |
| Is every security-sensitive change independently reviewed? | Apiiro + Qodo |
| Does this break tenant isolation? | Genuinely underserved |
| Are audit logs still generated? | Genuinely underserved |

Two of seven are open. Five are contested by better-funded incumbents. Qodo alone
raised a **$70M Series B** and now markets to FedRAMP, HIPAA, PCI DSS, ISO 27001,
21 CFR Part 11, and FIPS 140-2 buyers — stating that *"every review decision, rule
change, and policy enforcement must be logged, exportable, and tied to a user
identity"* and that regulated teams need **merge blocking, not advisory comments**.

That is the proposed pitch, with capital behind it, twelve months earlier.

---

## 2. What they are all good at

1. **Diff comprehension at scale.** Greptile's codebase graph, CodeRabbit's
   AST-grep + RAG hybrid. All meaningfully better than a human skimming a 400-line
   PR at 5pm.
2. **Custom rule authoring, in two flavors** — plain-English per-path instructions
   (CodeRabbit) and deterministic pattern rules (CodeRabbit `ast-grep`, Semgrep
   YAML). Qodo's Rules Miner even infers rules from existing PR history rather
   than requiring teams to write standards first.
3. **Platform breadth.** GitHub, GitLab, Bitbucket, Azure DevOps; 30+ languages
   for Semgrep. CodeWorthy is GitHub-only and Node-centric.
4. **Time to value.** Install, get comments on the next PR. No configuration
   project.
5. **Real defect detection.** Catch rates in the 44–82% range depending on tool
   and benchmark. Not marketing — these tools find things.
6. **Capital and distribution.** Qodo's $70M; Graphite inside Cursor; CodeRabbit's
   marketplace presence.

## 3. What they are all bad at

This is the section that matters, and the weaknesses are **structural** — they
follow from the architecture, so they do not get fixed by the next release.

### 3.1 Non-determinism — disqualifying for anything called a control

Greptile reports ~82% catch with **30–50% of findings requiring manual triage**;
CodeRabbit ~44% catch with far less noise (≈2 false positives where Greptile
produced ≈11 on the same benchmark). Two serious vendors, wildly divergent
behavior, and **neither produces the same verdict twice on the same input**.

A control has to be repeatable to be testable for operating effectiveness. An LLM
making a judgment call is not repeatable. So none of these can be *the* control —
they are detective aids that improve the odds. Every one of them is selling
judgment as though it were enforcement, and no auditor should accept that framing.

**This is the single most important finding in this document**, and it points
CodeWorthy in the opposite direction from the proposed positioning.

### 3.2 Noise means the control silently stops operating

Thirty comments on a 400-line PR, with formatting nits at the same priority as
real bugs. Developers skim, real findings get buried. CodeRabbit's February 2026
changelog added an **auto-pause after 5 reviewed commits per PR** — an admission
that volume is a live product problem.

In control terms: output that is routinely ignored is a control that is not
operating, regardless of what the dashboard says.

### 3.3 They review the diff; they do not evidence the change

None of them produce a complete, period-bounded, attributable population of
changes. Findings live as PR comments on the platform — mutable, deletable,
subject to retention limits, and gone if the repo is deleted or the app removed.
Qodo's "logged and exportable" is the closest, and it covers *its own review
decisions*, not the change population an auditor samples from.

### 3.4 No completeness assurance

None reconcile against ground truth. If the app was uninstalled, a repo was never
onboarded, webhooks dropped, or a merge bypassed review entirely — nothing
quantifies the gap. Auditors sample from populations. Nobody in this set can hand
you a defensible population.

### 3.5 No tamper-evidence

Review comments can be edited or deleted by anyone with repo admin. There is zero
integrity guarantee anywhere in Tier 1.

### 3.6 Advisory by default

Most default to comment mode; blocking is a configuration choice a customer can
silently reverse. The auditor's question — *"can a developer merge over this?"* —
has the answer "yes, usually" for most of the set. Qodo and Semgrep are the
exceptions and say so explicitly, which is to their credit.

### 3.7 Independence is compromised at the top of the market

**Graphite was acquired by Cursor in December 2025.** Diamond now reviews code
substantially produced by its parent's coding agent. In any regulated framing that
is a segregation-of-duties failure: the party performing the work is attesting to
it. The same structural conflict applies to GitHub Copilot's review reviewing
Copilot's output.

The proposed "neutral verification platform" instinct is **right** — but its value
is not that a neutral reviewer reviews *better*. It is that **an interested
party's attestation is inadmissible.** That is an audit argument, and only an
auditor can make it credibly.

### 3.8 They sell to the wrong buyer with the wrong vocabulary

Priced per developer, sold to engineering leadership, budgeted as developer tools.
Qodo is repositioning, but still enters through engineering. None have auditor
relationships, and none can tell a customer what a 3PAO will actually accept.

### 3.9 They cannot testify

No one at these companies can answer *"will my assessor accept this?"* That is a
knowledge asset, not a code asset, and it is not on any of their roadmaps because
they cannot hire it easily.

---

## 4. CodeWorthy, compared

### 4.1 What it is genuinely better at

1. **The evidence spine.** Append-only, hash-chained, WORM-anchored
   (`0002_audit_hash_chain.sql`, `audit/tamper.ts`). **Nobody in the competitive
   set has integrity guarantees at all.** This is the most defensible asset in the
   repo and it is currently positioned as a supporting feature.
2. **Deterministic-first architecture — accidentally exactly right.** Gates are
   regex and diff heuristics; the LLM tier is off by default and opt-in per repo.
   That means the *testable* part is deterministic and the *judgment* part is
   advisory and labeled as such. Every competitor has this backwards: LLM judgment
   at the core, determinism bolted on. Per §3.1, CodeWorthy's layering is the only
   one that can survive control testing.
3. **Enforcement is structural.** Branch protection configuration plus a required
   check is a real merge barrier, not a comment a developer can scroll past.
4. **The safety invariant is a control property.** "Never merges, never
   force-pushes, never rewrites history" is segregation of duties, expressible in
   a control narrative. Contrast §3.7.
5. **Plain language — but reframed.** Not "for vibe coders." It is **control
   narrative in the language an assessment report requires.** Translating
   engineering artifacts into control language is the scarce skill in every audit,
   and it is already the design center of `plain_english`.
6. **The founder credential.** A Coalfire background — 3PAO and QSA work — means
   the acceptance criteria can be *authored*, not guessed. No competitor can hire
   its way to this quickly.
7. **A dated, mandated tailwind.** Under **FedRAMP 20x**, the 3PAO role shifts
   from reviewing written narratives toward *independently verifying the accuracy,
   reliability, and effectiveness of **code as compliance***, and **machine-readable
   evidence packages are mandatory, not aspirational** (Class D by November 2027).
   That is a deadline-bearing requirement for precisely the artifact this repo has
   half-built.

### 4.2 What it is worse at — plainly

1. **Review quality: not close.** Nine event types and regex secret detection
   against codebase graphs and $70M of engineering. Do not compete here.
2. **Completeness is still unbuilt** — the flagship gap from
   `auditor-led-strategy.md` §3.1, and the thing that would actually differentiate.
3. **Merge evidence is nearly empty.** `events.ts:47` records a merge as
   `{ number: num }` — no approver, no merge SHA, no check results, no
   self-approval flag.
4. **Zero coverage of the proposed capability list.** No PII classification, no
   tenant-isolation analysis, no authorization-consistency checking. Those are
   Apiiro's and Semgrep's products. Building them means losing on their turf.
5. **Breadth.** GitHub-only, Node-centric, against 30+ languages and four
   platforms.
6. **No distribution, no capital, no brand.**
7. **Still two products** (`business-analysis.md` §1.2(e)).
8. **The independence constraint** on selling to own attest clients
   (`auditor-led-strategy.md` §2).

---

## 5. The recommendation — and why it inverts the proposal

The proposal is to build a smarter reviewer that asks compliance questions.
Per §1, that race is against Qodo ($70M, launched June 2026), Apiiro, and Semgrep,
on their turf, with 3.4k LOC and no funding. It loses.

Per §3.1 it is also the *wrong shape*: a reviewer built on LLM judgment can never
be a testable control, no matter how compliance-flavored its prompts are. Adding
"does this violate SOC 2?" to a non-deterministic reviewer produces a tool that
sounds like a control and cannot be tested like one.

**The inverse is the defensible position:**

> **Don't be the reviewer. Be the attestation layer that makes any reviewer's
> output admissible.**

Let CodeRabbit, Qodo, Semgrep, and Apiiro generate findings — they are better at it
and always will be. CodeWorthy proves, to an assessor's standard, that:

- the control **operated**, on a **complete** population of changes (§3.4);
- every change is **attributable** — author, approver, self-approval flag, merge
  SHA, check results at merge (§3.3);
- every **exception** is registered with its logged reason;
- the record is **tamper-evident and independently verifiable** without trusting
  the vendor (§3.5);
- and the whole thing exports as a **machine-readable evidence package** — which
  FedRAMP 20x makes mandatory rather than optional.

This position does three things nothing else on the table does:

1. **It converts every competitor from a rival into a data source.** Ingest
   Semgrep findings, Apiiro material-change events, CodeRabbit reviews. Their
   sales become CodeWorthy's addressable market rather than its ceiling.
2. **It is the only position where the Coalfire credential is the moat** rather
   than a nice-to-have on the About page. Nobody can testify to what an assessor
   accepts; the founder can.
3. **It is structurally immune to §3.1**, because the attestation layer is
   deterministic by construction. That immunity is unavailable to anyone whose
   core is an LLM.

The neutral-verification instinct in the proposal is right and should be kept —
restated as: *the party that produced the work cannot attest to it* (§3.7). That
is a segregation-of-duties argument, it is an auditor's argument, and it is the
one sentence in this analysis that a CISO, a 3PAO, and a board member all
understand identically.

### Where to aim it

`auditor-led-strategy.md` §R3 recommended selling through audit firms. The
FedRAMP 20x finding sharpens the target further:

- **Buyer:** CSPs pursuing or maintaining FedRAMP authorization, and the 3PAOs
  assessing them.
- **Trigger:** machine-readable evidence packages becoming mandatory, on a
  published deadline.
- **Why now:** the assessor community is being told to verify *code as
  compliance*, and almost nobody has a machine-readable change-control artifact
  ready.
- **Why this founder:** the credential, the peer network, and the ability to
  author the acceptance criteria rather than await them.

That market is smaller than "every startup with a repo," far better funded, and
its buyers cannot substitute a $30/dev/mo review tool for it.

### The open two

From §1, the only proposed capabilities nobody serves well: **tenant isolation**
and **"are audit logs still generated?"** Both are notable because they are
*control-continuity* questions — did a change break a control that already
existed — rather than code-quality questions. That is the same conceptual family
as the attestation thesis, and if any detection work is done, it should be these
two and not a rerun of Apiiro's PII detection.

---

## Sources

- [CodeRabbit — AST-based path instructions](https://docs.coderabbit.ai/configuration/ast-grep-instructions)
- [CodeRabbit review instructions & customization](https://deepwiki.com/coderabbitai/coderabbit-docs/4.1-review-instructions-and-customization)
- [Qodo — best AI code review tools for regulated industries 2026](https://www.qodo.ai/blog/best-ai-code-review-tools-for-regulated-industries-in-2026/)
- [Qodo launches governance infrastructure for the AI coding era](https://www.globenewswire.com/news-release/2026/06/23/3316032/0/en/Qodo-Launches-Governance-Infrastructure-for-the-AI-Coding-Era.html)
- [Qodo $70M Series B](https://www.govinfosecurity.com/qodo-targets-ai-code-risks-quality-70m-series-b-raise-a-31317)
- [Semgrep — secure guardrails](https://semgrep.dev/docs/secure-guardrails/secure-guardrails-in-semgrep)
- [Semgrep — custom guardrail rules](https://semgrep.dev/docs/secure-guardrails/custom-guardrails-rules)
- [Semgrep — automating PCI DSS v4.0.1](https://semgrep.dev/blog/2025/from-gatekeepers-to-guardrails-automating-your-pci-v401-strategy/)
- [Apiiro — automating material code change detection for continuous compliance](https://apiiro.com/resource/automating-material-code-change-detection-and-response-for-continuous-compliance/)
- [Apiiro — AI-driven development security trade-off](https://apiiro.com/blog/faster-code-greater-risks-the-security-trade-off-of-ai-driven-development/)
- [AI code review tools compared — catch rates and noise](https://levelop.dev/blog/best-ai-code-review-tools-2026-coderabbit-greptile-qodo-compared)
- [CodeRabbit vs Qodo vs Greptile vs Copilot](https://baeseokjae.github.io/posts/ai-code-review-tools-2026/)
- [FedRAMP 20x requirements guide](https://www.workstreet.com/blog/fedramp-20x-requirements)
- [FedRAMP ConMon evidence requirements 2026](https://elevateconsult.com/insights/fedramp-conmon-deliverables-essential-evidence-requirements-guide-2026/)
- [Endor Labs — AI code governance](https://www.endorlabs.com/use-cases/ai-code-governance)
- [Cycode — enforceable AI governance](https://cycode.com/blog/enforceable-ai-governance-models-mcp/)
