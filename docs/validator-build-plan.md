# Validator Build Plan — The Independently Verifiable Half of the Attestation Platform

*Implements the "verify, don't trust" commitments of
[`assurance-layer-thesis.md`](assurance-layer-thesis.md) and the audit-grade gaps
of [`auditor-led-strategy.md`](auditor-led-strategy.md) §3. Grounded in what
exists today: the hash chain (`0002_audit_hash_chain.sql`), server-side chain
verification (`server/src/audit/tamper.ts`), and the WORM anchor job
(`anchor-job.ts`).*

---

## 0. What "validator" means here, precisely

Today every verification runs **inside the server, against the live DB**:
`verifyAuditChain()` recomputes in SQL, `verifyAgainstAnchor()` compares to S3.
That is self-verification — necessary, not sufficient. The thesis rule:

> A system of record that only verifies against its author's infrastructure is
> not a system of record.

The validator portion is everything needed so that **a third party — an auditor,
a customer's security team, a 3PAO — can verify the record with CodeWorthy
switched off**:

1. **Export** — a period-bounded, self-contained evidence package.
2. **Reconcile** — a completeness statement computed against GitHub as ground
   truth, so the package proves it is the *whole* population, not just an intact
   one.
3. **Verify** — a standalone, dependency-light CLI (`codeworthy-verify`) that
   checks integrity, anchoring, completeness, and control operation offline.
4. **Sign & log** — standard envelopes (in-toto), standard signing (Sigstore),
   a public transparency point (Rekor + published anchors).
5. **Auditor surface** — OSCAL assessment-results output and per-sample
   drill-down, shaped around how control testing actually works
   (population → sample → walkthrough).

The verifier is the **demo that closes an audit firm** — it is sales collateral
as much as software.

**Trust boundary (stated up front, and restated in the verifier's output):**
the validator proves the record was not altered *after* recording, that it is
*complete* against an independent ground truth, and that named controls
*operated*. It does not prove the recording server was honest at write time —
that residual trust is exactly what the anchors, the transparency log, and
(optionally) live GitHub cross-checks shrink. The report says what was proven
and what was assumed; an auditor reads unstated assumptions as findings.

---

## 1. Phase V0 — Evidence-model prerequisites (the validator can only validate what exists)

*Everything here is server-side schema/recording work that later phases depend
on. Ship first; it is also independently valuable.*

### V0.1 Canonicalization v2 — the contract the whole platform rests on

The chain's canonical byte-encoding (`audit_canonical`) is currently defined
only as SQL, and it has a cross-language landmine: `extract(epoch from ts)::text`
produces Postgres float formatting that a JS/Go/Python verifier must reproduce
byte-for-byte or every hash check fails. That is fixable now and painful later.

- Migration `0003_canonical_v2.sql`:
  - add `canon_version smallint NOT NULL DEFAULT 1` to `audit_events`;
  - `audit_canonical_v2(...)` — same field list, but the timestamp contributes
    as **integer epoch-microseconds** and jsonb contributes via a documented
    stable serialization; trigger stamps new rows `canon_version = 2`;
  - `verifyAuditChain()` recomputes per-row by version (existing rows stay v1
    and stay verifiable — a canonical change must never orphan history).
- Publish `docs/spec/canonical-encoding.md`: exact field order, separator
  (0x1f), encodings, versioning rules, and **test vectors** (real rows + their
  expected canonical bytes + hashes). The vectors are exported as fixtures and
  every verifier implementation must pass them. This document is the first
  brick of the auditor-authored spec (R2).

### V0.2 Merge evidence (closes `auditor-led-strategy.md` §3.2)

`pull_request.merged` currently records `{ number }`. Extend `events.ts` (and
the webhook subscriptions) to record at merge time:

- `mergeSha`, `baseBranch`, PR `author`;
- `approvers[]` with review-submission timestamps (new client read:
  `listPullRequestReviews`);
- `selfApproved` (approver == author — the first SoD exception an auditor
  samples for);
- `checksAtMerge[]`: required check names + conclusions as of the merge SHA
  (new client read: `listCheckRunsForRef`);
- `approvalPrecededMerge: boolean`.

The **merge SHA is the join key** for the whole evidence graph; from V0.2 on it
must never be absent from a merge event.

### V0.3 Exception register (closes §3.3)

Generalize `protection.weakened` into a labeled family — `exception.*`
(`exception.protection_weakened`, `exception.merged_red_checks`,
`exception.force_push`, `exception.gate_overridden`) — each carrying
`{ reason, actor, mergeSha? }`. The digest and health page get an "exceptions
this period" section for free; the validator gets a first-class population to
test.

### V0.4 Coverage windows

New table `coverage_windows (repo, covered_from, covered_to, source)`
maintained on install/uninstall/repo-added events. This is what lets the
completeness statement say "we claim completeness for exactly these intervals"
instead of implying eternity. Gaps are stated, not discovered.

**Definition of done (V0):** every merge event carries approver + SHA + checks;
exceptions are one queryable family; canonical v2 vectors published; all
existing tests green plus new ones per recording change.

---

## 2. Phase V1 — Completeness reconciliation (the flagship differentiator)

*The hash chain proves integrity of what was recorded; reconciliation proves
nothing happened outside the record. No competitor has this; an auditor samples
from populations, and this is what makes the population defensible.*

- `server/src/audit/reconcile.ts` + scheduled job (`npm run reconcile`,
  scheduler-wired like the anchor job):
  1. Ground truth per repo per window, from the GitHub API: merged PRs
     (`listPullRequests state=closed, base=default`), pushes to the default
     branch (`listCommits` on default), branch-protection state.
  2. Diff against the spine: every ground-truth change must have its event(s);
     every spine event should map back.
  3. Append the result **as an audit event** — `reconciliation.completed`,
     payload `{ window, repos, expected, found, discrepancies[] }` — so the
     completeness check is itself inside the tamper-evident chain.
  4. Discrepancies also append `reconciliation.gap` events (one per gap, capped,
     summarized past the cap) — a gap is evidence, not an error to hide.
- The **completeness statement** renderer:
  > "For acme/app, 2026-01-01 → 2026-06-30: GitHub reports 214 changes to the
  > default branch; the log contains 214; 0 unexplained discrepancies. Coverage
  > windows: …"
- Client additions (reads only; doctrine test still passes):
  `listPullRequests`, `listPullRequestReviews`, `listCheckRunsForRef`.

**Definition of done:** a seeded gap (event deleted → chain breaks; or install
gap simulated) surfaces as a `reconciliation.gap` with the right counts;
statement renders in plain language; runs idempotently on a schedule.

---

## 3. Phase V2 — The evidence package (period-bounded export)

*`recentChangelog()` caps at 500 rows with no date range — a feed, not
evidence. This phase builds the artifact an auditor actually receives.*

- `server/src/evidence/package.ts` + CLI (`npm run export -- --repo acme/app
  --from 2026-01-01 --to 2026-06-30`), producing a zip:

```
evidence-acme-app-2026H1/
  manifest.json          package version, generator version, period, repos,
                         event counts by type, POLICY_VERSIONs seen,
                         canonical versions present, sha256 of every file
  events.jsonl           full rows: all canonical fields + canon_version +
                         prev_hash + row_hash (hex) — recomputable, not trusted
  chain-binding.json     the segment's opening prev_hash, closing head
                         (seq + row_hash), and total-row count
  anchors.json           all anchor records covering the period (+ where to
                         fetch them independently)
  reconciliation.json    the reconciliation.completed/gap events + rendered
                         completeness statement + coverage windows
  exceptions.json        the exception.* population with reasons
  README.txt             what this is, what the verifier checks, where to get
                         the verifier, the trust boundary in plain language
```

- Export rules: events are the **raw chained fields** (the verifier recomputes
  hashes — it never trusts precomputed ones); no server-side filtering inside
  the period (a filtered export is a broken population by construction —
  redaction, if ever added, must be a visible, hash-preserving tombstone,
  which is out of scope for V2 and flagged as a design decision to make
  deliberately).
- A package is **reproducible**: same DB state + same parameters → identical
  bytes (stable ordering, no timestamps injected at export time except in the
  signed wrapper of Phase V4).

**Definition of done:** golden-package fixtures generated from a seeded DB;
byte-stable across runs; manifest hashes verify.

---

## 4. Phase V3 — `codeworthy-verify`, the standalone verifier

*A separate workspace/package (`verifier/`), deliberately boring: Node ≥20,
**zero runtime dependencies** (stdlib crypto/zlib only), single-file build via
esbuild, published to npm + attached to GitHub releases. Auditors must be able
to read it; short and dull is a feature. It never imports server code — the
only shared artifact is the canonical-encoding spec and its test vectors,
which is exactly the drift the vectors exist to catch.*

```
codeworthy-verify report ./evidence-acme-app-2026H1.zip
codeworthy-verify report ./pkg.zip --json      # machine-readable, for CI
codeworthy-verify report ./pkg.zip --live      # optional online cross-checks
codeworthy-verify sample ./pkg.zip --merge <sha>   # one change, full lifecycle
```

Checks, in order (each PASS / FAIL / SKIPPED-with-reason; exit 0 all pass,
2 any fail, 3 verified-but-incomplete):

1. **Package integrity** — every file matches its manifest sha256; versions
   supported.
2. **Chain recomputation** — reimplement canonical v1+v2 from the spec (never
   calling the DB); recompute every `row_hash` from fields + predecessor;
   verify linkage; verify the segment binds to `chain-binding.json` at both
   ends. First divergence reported with seq + reason (content vs linkage) —
   same semantics as `tamper.ts`, independently implemented.
3. **Anchor verification** — anchored (seq, hash) pairs must appear in the
   package and match. `--live`: fetch anchors from the published read-only
   anchor endpoint (V4.3) and, where configured, verify Rekor inclusion —
   verification that does not depend on CodeWorthy existing.
4. **Completeness** — recompute the statement from `reconciliation.json` and
   the event population (never trust the rendered text); coverage windows must
   tile the requested period or the report says exactly which intervals are
   unclaimed. `--live` + a read token: re-derive ground truth from GitHub
   directly — the auditor's own independent reconciliation.
5. **Control operation** — the tests an assessor would run by hand, run over
   the whole population instead of a sample:
   - every merge in-period has a PR event trail (no out-of-band merges);
   - every merge has ≥1 approver; `selfApproved` populations enumerated;
   - approvals precede merges;
   - checks green at merge, or a matching `exception.*` with a reason exists;
   - every gate override carries a logged reason.
6. **Report** — plain-language sections per check with counts and named
   exceptions, a "what was proven / what was assumed" trust-boundary section,
   and `--json` for pipelines.

**Testing:** the golden packages from V2 plus mutants — one edited field, one
deleted row, one reordered pair, wrong anchor, gapped reconciliation, a
self-approved merge, an override without a reason. Every mutant must fail with
the *right* message; cross-implementation vectors (V0.1) run in both the server
suite and the verifier suite so the two canonical implementations can never
drift silently.

**Definition of done:** an auditor with the zip and the npm package — no
CodeWorthy account, no network — reproduces every claim in the report.

---

## 5. Phase V4 — Signing, standards, and the public trust points

1. **in-toto statement** — wrap the package as an ITE-6 Statement: subject =
   the package files + their digests; predicate type
   `https://codeworthy.ai/attestation/control-operation/v1` — a versioned,
   published predicate schema (period, repos, completeness result, exception
   counts, policy versions, verifier version). This predicate *is* the
   "control-operation attestation" gap identified in the thesis — the unclaimed
   predicate in the in-toto ecosystem — and publishing it is the standards play.
2. **Signing** — Sigstore keyless (OIDC identity of the exporting service) with
   Rekor transparency-log entry; fallback: a KMS key with the public key
   published. `codeworthy-verify` checks signature + log inclusion under
   `--live`, and records SKIPPED (not PASS) offline.
3. **Published anchors** — a public, read-only endpoint (and mirrored static
   file) listing anchor records: `GET /anchors/:repo-group`. Anyone can pin it,
   mirror it, or check it from cron. The S3 Object Lock bucket remains the
   root; the endpoint is how third parties see it without AWS access.
4. **OSCAL emitter** — `--oscal` on the exporter: an assessment-results JSON
   mapping each verifier check to observations/findings against CC8.1-shaped
   controls (mapping table maintained in the spec repo, extendable to ISO
   27001 A.8.32 etc.). Per the thesis caveat: OSCAL is an accelerant, not the
   business case — the emitter is a thin, cheap mapping layer over the package,
   not a load-bearing dependency, and slips harmlessly if the 20x deadline does.

---

## 6. Phase V5 — Auditor workflow surface

- **`codeworthy-verify sample`** — the walkthrough artifact: given a merge SHA
  (the join key), print the full lifecycle — PR opened → reviews (who/when) →
  checks at merge → merge (who/when) → exceptions touching it → digest/anchor
  coverage — as one page an auditor staples to a workpaper.
- **Sampling helper** — `codeworthy-verify population ./pkg.zip --csv`: the
  clean population list (merge SHA, date, author, approver, flags) auditors
  sample from; deliberately boring CSV.
- **Conformance checklist** — `docs/spec/evidence-conformance.md`: the
  auditor-authored checklist (R2) with, per item, the verifier command that
  demonstrates it. The spec cites the tool; the tool implements the spec —
  the reference-implementation loop closed.

---

## 7. Sequencing, dependencies, effort

```
V0.1 canonical v2 ──┐
V0.2 merge evidence ─┼─▶ V1 reconciliation ─▶ V2 package ─▶ V3 verifier ─▶ V5 auditor surface
V0.3 exceptions ─────┘                              │
V0.4 coverage windows ──────────▶ V1                └─▶ V4 signing/standards (parallel with V3)
```

| Phase | Rough size | Risk to watch |
|---|---|---|
| V0 | 3–5 days | canonical-v2 migration correctness (old rows must keep verifying) |
| V1 | 4–6 days | GitHub API pagination/rate limits on big repos; define "change" precisely (merge commits vs squash vs rebase — squash/rebase merges MUST reconcile via the PR's `merge_commit_sha`, not commit-graph heuristics; get this wrong and every fast-forward repo reports false gaps) |
| V2 | 3–4 days | byte-stable reproducibility; zip determinism |
| V3 | 5–8 days | independent canonical reimplementation — the vectors are the safety net |
| V4 | 4–6 days | Sigstore ergonomics for a server identity; don't block V3 on it |
| V5 | 2–3 days | none — it reads what V2/V3 built |

Total: roughly **4–6 focused weeks** to an end-to-end demo: install → build
history → export → hand a zip + `npx codeworthy-verify` to someone who trusts
nothing — they get PASS, then you tamper with one row in the DB (trigger
disabled) and they get FAIL at the exact seq.
That demo, run live in front of an audit firm, is the sales motion.

## 8. What is deliberately out of scope

- **Redaction/right-to-erasure inside a package** — conflicts with completeness;
  needs its own design (tombstones that preserve the chain), decided
  deliberately, not slipped in.
- **Non-GitHub sources (CI vendors, deploy targets, other reviewers' findings)**
  — the ledger ingestion story comes after the verifier exists; the join key
  (V0.2) is what makes it attachable later.
- **The LLM tier** — nothing in the validator path may depend on model output;
  `llm.*` events travel in packages as labeled advisory events and the verifier
  ignores them for control conclusions (it verifies their *provenance* fields
  exist, nothing more). The V3 control-operation checks run on deterministic
  events only.
