# The Assurance Layer — Thesis, Sharpened

*Follows [`competitive-teardown.md`](competitive-teardown.md). Records where the
"attestation layer" framing holds, where it needs tightening, and two findings
that materially change how it should be built: the category it is actually
entering, and the standards it should not reinvent.*

---

## 1. Where the framing is right, and can be pushed harder

### 1.1 The separation-of-duties argument is stronger than stated

The observation that AI collapses separation of duties is correct, and it
understates itself by one role. An AI coding assistant is simultaneously:

- **author** — it writes the change;
- **reviewer** — it reviews its own or a sibling model's output;
- **explainer** — it produces the narrative that a human approver reads to decide.

Three roles collapsed into one actor. The third is the dangerous one and the one
nobody talks about: when the approver's understanding of a change comes from a
summary written by the thing that wrote the change, the human approval is no
longer independent evidence of anything. It is a signature on a document the
subject prepared.

Every existing governance framework treats this pattern as a finding. The
institution of independent audit exists *because* of it — the entity preparing
the statements cannot be the entity attesting to them. That is not a
software-industry convention; it is the structural answer that every domain
reached after its own failures.

This is the spine of the pitch, and it is worth stating in exactly those terms,
because it makes the product inevitable rather than clever.

### 1.2 The moat framing is right — with one correction that decides the company

"System of record for software assurance" is a better description than hash chains
and WORM storage, which are implementation details. Correct.

But systems of record are **won on the write path, not the read path.** An
aggregator that reads from twelve tools and renders a graph is a dashboard.
Dashboards are re-implementable and get replaced at renewal. A system of record is
only durable when something *cannot proceed without writing to it*.

For CodeWorthy that means the required status check is not a feature — it is the
entire defensibility argument. **The merge does not complete unless the record is
written.** That is the difference between owning the evidence graph and reporting
on it.

This is not theoretical. See §3: the entire incumbent category adjacent to this
thesis is read-path aggregation, and that is precisely the gap.

The corollary: whoever owns the **join key** owns the graph. Here it is the merge
commit SHA bound to an actor identity. Every downstream integration — CI, deploy,
scanner findings, ticket references — hangs off that key. Get it recorded
authoritatively and everything else can be attached later; miss it and the graph
is permanently reconstructive guesswork.

### 1.3 The inversion is right — and incomplete without a schema rule

    Deterministic control → evidence recorded → optional AI explanation

Correct, and it is the architecture the repo already half-has. But "optional AI
explanation" needs a hard rule, or it silently destroys the evidence it decorates.

**Concrete finding in the current code:** `audit_events.plain_english` is written
at event time and is **inside the hash chain** (`0002_audit_hash_chain.sql`, via
`audit_canonical`). Today that is safe, because `plain_english` is deterministic
template text composed in `events.ts`. The moment an LLM writes that field — and
`llm.reviewed` already exists as an event type — **model output is sealed inside
the evidentiary record**, indistinguishable from the control facts.

An assessor will ask, of any sentence in the record: *is this an assertion of
fact, or generated narrative?* If the schema cannot answer that, the whole record
degrades to the weaker of the two.

**Rule:** control facts and generated narrative must be separable at the schema
level, not by convention.

- Deterministic control facts → chained, canonical, evidentiary.
- Generated narrative → separate field or separate table, carrying its own
  provenance (model, version, prompt hash, timestamp), explicitly marked
  non-authoritative, and either outside the primary chain or chained separately.

The AI explains why the gate fired. It never contributes a byte to what the gate
recorded. That rule is what makes "AI explains, doesn't decide" true in the data
model rather than only in the pitch deck.

### 1.4 On not conceding review quality

The sequencing argument is right and the earlier framing was too absolute.
Evidence first, reasoning later — with the full graph (every change, approval,
exception, dependency, prior incident) a reviewer eventually has context no
diff-reader can match. Accepted.

But there is a trap that has to be designed for **now**, not later:

**The moment CodeWorthy ships a reviewer, it becomes an interested party in its
own ledger.** That is §1.1 turned back on the company — author and attester
collapsed. The mitigation is structural and cheap if built in from the start, and
near-impossible to retrofit:

- CodeWorthy's own findings carry the **same provenance labelling** in the ledger
  as CodeRabbit's, Semgrep's, or Apiiro's — a source, a version, a confidence
  class. No privileged position for first-party findings.
- The attestation layer must be able to state that a control operated **without
  reference to whether CodeWorthy's reviewer agreed.**
- Ideally, publish this as a commitment before there is a reviewer to constrain.

Done publicly, that constraint is not a limitation — it is the single most
credible thing the company can say about itself, and it is the sort of commitment
only someone from the assessor side would think to make unprompted.

---

## 2. Where to slow down — and the correction to make

The caution about FedRAMP is right: do not build a company on one government
initiative. But the conclusion should be *beachhead, not market*, rather than
*de-emphasise*.

FedRAMP 20x is the best available **forcing function** because it is mandated and
dated, and a mandated deadline is what makes an unproven artifact rigorous enough
to generalise. Build for the hardest assessor, sell to everyone else afterward.

The broader trend named — continuous assurance replacing point-in-time audit,
customers demanding proof that controls *operated* rather than that policies
*exist* — is correct, and it has a name, which leads to the first of two findings
that change the plan.

---

## 3. Finding one: this is an existing analyst category, and the incumbents are read-path

The category is **Continuous Controls Monitoring (CCM)** — an established Gartner
market with pure-play vendors and GRC platforms converging on it: Panaseer,
RegScale, Hyperproof, CyberSaint, DataBee, Quod Orbis. There is also a 2026
Gartner Market Guide for **DevOps Continuous Compliance Automation Tools**, in
which RegScale is recognised — and RegScale is *also* active in FedRAMP 20x
continuous assurance.

This matters two ways, and both are useful:

**The warning.** "Nobody owns the evidence graph" is not quite true. A category
exists, it has analyst coverage, and at least one incumbent is aiming at the same
FedRAMP 20x moment. Positioning must be written knowing that, or the first
sophisticated buyer will place CodeWorthy in a category it did not intend to enter
and compare it on the incumbents' terms.

**The wedge — and it is a good one.** Every one of those platforms is **read-path**:
they ingest from source systems, map to control frameworks, and render evidence.
None of them sit *in the merge path*. None of them can say "this change could not
have merged without producing this record." They report on controls; they do not
operate one.

That is precisely the distinction in §1.2, and the category structure confirms it
empirically rather than by argument. The defensible claim is not "we monitor
controls continuously" — that is contested. It is:

> **We are the control, and the record is a byproduct of the control operating.**

A CCM platform is a customer or a channel for that record, not a competitor to it.
Which is the same conclusion as the reviewers in `competitive-teardown.md` §5,
arrived at from the opposite direction — a good sign for the thesis.

---

## 4. Finding two: do not invent the envelope — two standards already exist

The proposed architecture — signed evidence ledger, canonical evidence object,
verifiable later — describes something that partially exists in two mature
standards. Reinventing either would undermine the "system of record" claim, since
a proprietary format is by definition not canonical.

### 4.1 in-toto / SLSA / Sigstore — the attestation stack

The **in-toto Attestation Framework (ITE-6)** defines a common envelope with three
parts: a statement type (what kind of claim), a subject (the artifact), and a
predicate (the claim data). **SLSA** is the opinionated layer specifying what
build-provenance predicates must contain. **Sigstore** provides ephemeral-key
signing bound to OIDC identity, with the **Rekor** transparency log for
verification. GitHub Actions already ships native provenance via
`actions/attest-build-provenance`.

The gap is exact and favourable:

> in-toto attests **"this artifact was built by this process."**
> Nobody attests **"these controls operated over this change, and here are the
> approvers and exceptions."**

Same envelope, unclaimed predicate. So:

- Express control operation as an **in-toto predicate type**, not a bespoke JSON
  schema. Instant interoperability, instant credibility, and a legitimate path to
  proposing it as a standard — which is the strongest possible version of "owning
  the evidence graph."
- Bind attestations to **OIDC identity** rather than GitHub logins. Logins are
  renameable and reassignable; an auditor testing attribution will find that.
- Consider **Rekor** as the transparency anchor alongside — or instead of — the
  self-run hash chain and S3 Object Lock. A third-party transparency log is
  strictly more credible than a vendor-operated chain anchored to the vendor's own
  bucket, because verification does not depend on the vendor existing. *A system
  of record that only verifies against its author's infrastructure is not a system
  of record.*

The existing chain work is not wasted — it is the internal integrity mechanism.
But the externally verifiable artifact should ride standards.

### 4.2 OSCAL — the output format, with a real caveat

**OSCAL** (NIST's Open Security Controls Assessment Language) is the
machine-readable format FedRAMP 20x is built on — SSPs, SAPs, SARs, and assessment
results in structured JSON/XML/YAML. **RFC-0024 sets a September 2026 deadline**
for machine-readable packages.

The "evidence package" in `auditor-led-strategy.md` §3.6 should therefore emit
**OSCAL assessment-results**, not a proprietary export. Same effort, lingua franca
instead of dialect.

**But the caveat is large and cuts both ways.** In 2025 FedRAMP processed **100+
Rev5 authorizations with not a single OSCAL submission**, and **no formal FedRAMP
20x Phase 1 pilot participant** used OSCAL to structure their machine-readable
materials.

Read that honestly, both directions:

- **Bullish:** a mandated format with a deadline and essentially zero supply.
  Whoever can reliably emit valid OSCAL from real engineering telemetry has
  something scarce, and the scarcity is dated.
- **Bearish:** a mandate that nobody has complied with, through a full year and a
  pilot programme, is evidence of real friction — tooling immaturity, unclear
  requirements, or a deadline likely to slip. Mandated formats with zero adoption
  have a history of slipping.

The disciplined read: **emit OSCAL because it is cheap once the evidence model is
right, but do not price or plan on the deadline holding.** It is an accelerant, not
the business case. Which is the same caution already applied to FedRAMP generally —
applied one level down.

---

## 5. On the positioning line

"CodeWorthy is the control plane for software assurance" is close, and the
reservation is narrow: *control plane* is infrastructure vocabulary aimed at an
audit and risk buyer, and it collides awkwardly with *control* in the compliance
sense — a CISO reads "control plane" as Kubernetes, not as governance.

The stronger asset is the question already written:

> **Can you prove, six months from now, that every required control actually
> operated over every production change — and that the evidence itself wasn't
> altered?**

That sentence does the work no label does: it states the timeframe (six months —
i.e. an audit period, not a sprint), the population (*every* change), the claim
(*operated*, not *existed*), and the integrity requirement — and every one of
those four is a thing no competitor can currently answer. Lead with it.

If a label is needed, "**system of record for control operation**" survives
translation to both audiences better than "control plane." But the question is the
pitch; the label is only filing.

---

## 6. What this changes in the build

Revising `auditor-led-strategy.md` §4 in light of §§1–4 above:

1. **Split control facts from generated narrative in the schema** (§1.3). Small
   change now, unfixable later, and it is what makes the deterministic-first
   inversion real rather than rhetorical.
2. **Keep the required check as the write path** (§1.2). Never let the product
   drift into read-path aggregation — that is the whole defensibility argument.
3. **Record the merge SHA + OIDC-bound identity as the join key** (§1.2, §4.1).
   Everything attaches to it later; nothing recovers it retroactively.
4. **Build completeness reconciliation** — unchanged, still the flagship gap.
5. **Express the evidence object as an in-toto predicate; anchor to a transparency
   log; emit OSCAL for assessment results** (§4).
6. **Publish the first-party-findings neutrality commitment** before there is a
   reviewer to constrain (§1.4).
7. **Write the spec** (`auditor-led-strategy.md` §R2) — now with §§3–4 in it, so it
   reads as standards-aware rather than as a vendor inventing a format.

---

## Sources

- [Gartner — Continuous Controls Monitoring (CCM) market](https://www.gartner.com/reviews/market/continuous-controls-monitoring-ccm)
- [Gartner glossary — CCM definition](https://www.gartner.com/en/information-technology/glossary/continuous-controls-monitoring-ccm)
- [RegScale in the 2026 Gartner Market Guide for DevOps Continuous Compliance Automation Tools](https://secure.businesswire.com/news/home/20260320291361/en/RegScale-Recognized-in-the-2026-Gartner-Market-Guide-for-DevOps-Continuous-Compliance-Automation-Tools)
- [Comparing continuous control monitoring solutions 2026](https://www.cybersaint.io/blog/compare-continuous-control-monitoring-solutions)
- [SLSA — in-toto and SLSA](https://slsa.dev/blog/2023/05/in-toto-and-slsa)
- [SLSA — distributing provenance](https://slsa.dev/spec/v1.0/distributing-provenance)
- [Sigstore, SLSA, and build provenance beyond SBOMs](https://aquilax.ai/blog/supply-chain-artifact-signing-slsa)
- [Legit Security — deep dive into SLSA provenance and software attestation](https://www.legitsecurity.com/blog/slsa-provenance-blog-series-part-2-deeper-dive-into-slsa-provenance)
- [FedRAMP automation and modernization](https://automate.fedramp.gov/about/fedramp-automation-and-modernization)
- [OSCAL machine-readable packages — RFC-0024, September 2026 deadline](https://quzara.com/fedramp/oscal)
- [Preparing for FedRAMP OSCAL-based assessments](https://continuumgrc.com/preparing-for-fedramp-oscal-based-assessments/)
- [RegScale / Carahsoft — FedRAMP 20x continuous assurance](https://www.carahsoft.com/blog/regscale-fedramp-20x-modernizing-cloud-security-authorization-through-automation-and-continuous-assurance-blog-2025)
