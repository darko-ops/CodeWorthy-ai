# Recommendations — CodeWorthy with an Auditor as Founder

*Follows [`business-analysis.md`](business-analysis.md). That analysis was written
without knowing the founder is a SOC 2 auditor. That fact changes the answer to
its single biggest open question and rewrites the go-to-market. This document
revises the recommendations accordingly.*

*Caveat on authority: on independence rules and on what satisfies a TSC criterion,
the founder is the expert and this document is not. Those sections are framed as
the questions to resolve and why they are pivotal, not as answers.*

---

## 0. What changes

`business-analysis.md` §3.4 listed three conditions for profitability. The first —
*"an auditor will accept the log"* — was the highest-value falsifiable test and the
biggest risk. It is now answerable in-house, and more than answerable: it can be
**specified** rather than guessed at.

The second condition — *"a repeatable way to find companies at the moment the
trigger fires"* — also changes. Auditors meet companies **at exactly that moment**,
every engagement. That is the scarce thing in a dev-tools GTM, and it is now
structurally available.

And the central strategic flaw — the wedge conflict between "plain language for
non-engineers" and "SOC 2 evidence" — resolves. Founder-market fit points one
direction, decisively.

But it introduces one new constraint that is now the **binding** constraint, and
it is a GTM constraint, not a product one. See §2.

---

## 1. Strategic recommendations

### R1 — Commit to the compliance wedge. Kill the ambiguity in the front door.

Stop selling guardrails. Sell **change-control evidence for teams that build with
AI**. The plain-language layer stops being the pitch and becomes the *enabler* —
the reason a five-person team can actually operate the control instead of just
buying it. Reframe:

> *Before:* "A senior engineer for your repo."
> *After:* "Your change control, audit-ready — without an engineer to run it."

This also quietly disposes of the GitHub free-tier problem from
`business-analysis.md` §1.2(c): a company with a SOC 2 trigger is already on
GitHub Team or Enterprise, so protected branches are available. The constraint
still needs honest handling in `protection.ts`, but it stops being a funnel
problem. It becomes a *qualification signal* — if the prospect can't enable branch
protection, they aren't the buyer yet.

### R2 — The differentiated asset is the specification, not the code.

This is the strongest recommendation in this document.

Publish an **auditor-authored specification** of what change-control evidence must
contain when most code is AI-written — and a conformance checklist against it.
Nobody else in the competitive set can credibly author that document. Endor Labs
and Cycode are security vendors. Vanta and Drata are evidence aggregators.
CodeRabbit and Greptile are review tools. None of them can write "here is what I,
as the person who will test this control, need to see."

What this buys, in order of value:

1. **A credibility moat that is not code.** Everything in `checkup/` and
   `enforcement/` is reproducible in a weekend. A spec authored by the person who
   tests the control is not.
2. **Steward becomes the reference implementation of your own spec** — the
   strongest possible product framing, and one competitors have to answer on your
   terms.
3. **Distribution.** Other auditors and vCISOs will cite it. That is the channel
   in R3, seeded by a document rather than by sales calls.
4. **It is cheap.** It is the one high-leverage asset that costs writing time, not
   a quarter of engineering.

Write the spec before writing more product.

### R3 — Sell through audit firms and vCISOs, not to startups.

`business-analysis.md` assumed founder-led sales into 5–20 person startups: high
effort, ~167 accounts for $1M ARR, no obvious channel. The auditor identity opens
a materially better motion.

Auditors feel the pain of bad change-control evidence on **every engagement** —
chasing screenshots, incomplete change populations, clients who cannot produce a
list of what shipped in the period. A tool that makes a client audit-ready reduces
the audit firm's own engagement hours and write-offs. That is a peer-to-peer sale
with a real, quantified benefit to the *seller*, not just the end client.

- **B2B2B**: license to CPA firms and compliance consultancies who deploy it
  across their client book.
- **Far lower CAC** than selling $499/mo to five-person startups one at a time.
- **It sidesteps §2**: their attest clients, not yours.

A per-client-seat firm tier is plausibly a larger business than the direct SaaS
line, and it is the motion the founder is uniquely positioned to run.

### R4 — Position as depth *under* Vanta/Drata, not against them.

`business-analysis.md` §2.5 recommended integration over displacement. The auditor
identity makes this sharper: you know precisely which change-management controls
their GitHub integrations under-serve, and you can name them specifically rather
than gesturing at "depth." Build the integration, and let the evidence flow into
the GRC platform the client already pays $7.5k–$25k/yr for. Being the trusted
source for one control beats being a worse ninth GRC platform.

### R5 — Assess: shelve it as a product, keep it as credibility.

Unchanged from `business-analysis.md` §4.1, and stronger now. The auditor identity
adds nothing to a hiring-assessment sale and everything to a compliance sale. One
surface.

### R6 — Pricing recalibrates upward, and gains a second SKU.

- **Team tier at $499/mo** is now defensible rather than optimistic, because the
  artifact is auditor-designed and the buyer is spending compliance budget.
- **Add a one-off "audit-readiness evidence package"** — a period-bounded,
  reconciled evidence export plus a management-assertion-style summary. Sold per
  audit cycle, priced against the hours it saves. This monetizes companies not
  ready for a subscription and creates a natural upgrade path.
- **Firm tier** (R3): per-client-seat licensing to audit firms.

---

## 2. The new binding constraint: independence

*You will know these rules far better than this document does. It is raised
because it is now the pivotal GTM question, and because it is easy to build for
six months before confronting it.*

If you sell Steward to a company and then perform that company's SOC 2
examination, the tool is operating inside — and producing the evidence for — a
control you are testing. That is a self-review threat on its face, and there are
adjacent concerns under the AICPA independence framework: nonattest services
touching the design or operation of a client's controls, information-systems
involvement, and a financial interest in a vendor the attest client relies on.

The likely conclusion is that **you cannot sell to your own attest clients** while
retaining those engagements. That is not fatal — it is *directional*, and it
redirects to exactly the channel recommended in R3.

What to do:

1. **Get a written independence opinion from your firm's ethics partner early** —
   before the GTM is built around a motion the rules disallow.
2. **Decide the identity question consciously**: an auditor who owns a vendor, or
   a vendor who used to audit. Both are viable; drifting between them is not.
3. **Design for the perception problem too.** Other firms may be wary of a tool
   built by someone in their market. The mitigant is R2 plus §3.7 —
   an open spec and independently verifiable evidence, so an auditor never has to
   *trust* CodeWorthy, only verify it.

---

## 3. Product recommendations — closing the gap to audit-grade

What is built is a **plain-language activity log with tamper-evidence**. What an
auditor samples from is a **complete, attributable, period-bounded population of
changes**. Those are different artifacts. The gaps below are ordered by how much
each one blocks the product from being evidence.

### 3.1 Population completeness — the biggest gap, and the hash chain does not address it

The hash chain in `0002_audit_hash_chain.sql` proves the **integrity** of what was
recorded. It proves nothing about the **completeness** of what should have been
recorded. An auditor sampling changes needs assurance the population is whole, and
webhook capture has structural completeness holes:

- the App was installed mid-period, so earlier changes are absent;
- webhook deliveries failed or the service was down, and nothing records the gap;
- a repo joined the installation later;
- the App was uninstalled and reinstalled (`installation.deleted` is logged —
  good instinct — but the gap itself is not quantified);
- events not subscribed to are silently outside the record.

**Recommendation — build reconciliation, and make it the flagship feature.**
Periodically enumerate the ground truth from the GitHub API (merge commits and
pushes to protected branches, PRs closed in the period) and diff it against
`audit_events`. Then:

- record the reconciliation result **as an audit event**, so the chain covers it;
- store explicit **coverage windows** per repo (covered from T1 to T2), so gaps
  are stated rather than invisible;
- emit a **completeness statement**: *"In period X, GitHub reports N changes to
  protected branches; the log contains N; zero unexplained discrepancies."*

That statement is the single artifact that converts this from a nice log into
audit evidence. It is also the thing no competitor has, because only an auditor
would think to build it first.

### 3.2 Approver identity and segregation of duties

`server/src/steward/events.ts:47` records a merge as `{ number: num }` with the
actor being `sender.login`. For change-control testing that is not enough. Capture,
at merge time:

- the PR **author** and the **approving reviewers** (logins + review submission
  timestamps);
- whether approval **preceded** the merge;
- a **self-approval flag** (approver == author) — the SoD exception an auditor
  looks for first;
- the **merged commit SHA** and base branch;
- the **required check results as of the merge SHA**.

The merge SHA matters independently: it is the join key linking authorization to
what actually shipped.

### 3.3 Exceptions and overrides — make them first-class

`protection.weakened` is the right instinct and should be generalized. Exception
evidence is disproportionately valuable in an audit, because controls are tested
partly by how their failures are handled. Capture and label as exceptions:

- admin merge bypassing required reviews;
- merge with a required check red;
- force-push to a protected branch;
- ruleset bypass actors used;
- any Steward gate overridden — **with the logged reason**.

The doctrine in `ai-senior-engineer-policy.md` already requires gates to be
"overridable with a logged reason." That logged reason *is* the exception
documentation an auditor asks for. Promote it from an implementation detail to a
reported artifact.

### 3.4 Testing evidence

CC8.1 covers changes being **tested** before implementation. Bind CI check-run
results to the merged SHA and record them at merge time. Without this, the log
shows changes were authorized but not that they were tested — half the criterion.

### 3.5 Deployment linkage

CC8.1 also covers changes being **implemented**. Capture GitHub deployment,
release, and tag events so the record runs authorization → merge → production. A
change log that stops at merge leaves the last hop unevidenced.

### 3.6 Period-bounded evidence export

`recentChangelog()` (`server/src/audit/audit.ts:38`) caps at 500 rows with no date
range. That is a feed, not an evidence export. Add:

- **period-bounded export** (from/to, all repos or one), CSV and JSON;
- **per-change drill-down** showing the full lifecycle for a sampled item;
- an **evidence package** bundling the population, the completeness statement
  (§3.1), the exception register (§3.3), and the chain verification (§3.7).

Design the export around how an auditor actually works: pull the population,
sample from it, drill into each sample.

### 3.7 Independent verifiability

An auditor should be able to verify the chain **without trusting CodeWorthy**.
`tamper.ts` and the S3 Object Lock anchor are the right foundation. Finish it:

- ship a **standalone verifier** that recomputes the chain from an export and
  checks it against the published anchor digests;
- make anchor receipts retrievable by the client and their auditor;
- document the anchor cadence and the retention period, and hold retention
  through the full audit period plus the look-back an auditor expects.

### 3.8 Multi-framework mapping

Once the evidence model is right, map each event type to the criteria it supports
— SOC 2 CC8.1 and neighbors, and ISO 27001 change-management controls. This is
cheap once §§3.1–3.6 exist, it multiplies the addressable buyer, and it is
authoring work the founder can do faster than any competitor.

---

## 4. Sequence

1. **Write the spec** (R2). It is cheap, it is the moat, and it defines the
   backlog for everything in §3.
2. **Resolve independence in writing** (§2). It determines whether R3 is the
   channel or a violation. Do this before building GTM.
3. **Build reconciliation + completeness** (§3.1) and the **merge evidence model**
   (§3.2–3.4). These are what make the artifact evidence rather than a log.
4. **Ship the evidence export + verifier** (§3.6, §3.7). This is the demo that
   closes an audit firm.
5. **Reposition the front door** (R1) and pilot through **two or three audit
   firms** (R3).
6. **Then** revisit pricing (R6) with real usage.

Assess stays where it is. `docs/concept.md`'s differentiation table should be
updated or marked historical either way (`business-analysis.md` §1.2(f)).

---

## 5. What would still make this fail

- **Independence forecloses the channel** and the founder is unwilling to choose
  between practising and vending. This is the most likely failure mode and the
  cheapest to test.
- **Other firms treat it as a competitor's tool** rather than a peer's. Mitigated
  by R2 and §3.7 — verify, don't trust — but it is a real adoption tax.
- **Vanta or Drata deepens their GitHub change-management coverage** to the point
  that the incremental depth stops being worth $499/mo. Watch this; it is the
  most probable competitive squeeze in the compliance framing, more so than the
  build-platform bundling risk that threatened the guardrail framing.
- **The evidence model gets built before the spec**, and the product ends up being
  what was easy to instrument rather than what an auditor samples.

---

## 6. Open questions

Answers would sharpen §§1–4:

1. Solo practice, or a firm with an independence policy and an ethics partner to
   opine?
2. Is there a client book — and roughly how many engagements per year touch
   AI-heavy startup codebases?
3. SOC 2 only, or ISO 27001 / HIPAA / PCI as well? Multi-framework mapping (§3.8)
   changes the addressable market and the spec's scope.
4. Type I or Type II focus? Type II's operating-effectiveness testing over a
   period is where completeness (§3.1) becomes decisive — and where this product
   is most valuable.
