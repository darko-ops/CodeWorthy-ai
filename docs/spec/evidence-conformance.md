# Evidence Conformance Checklist

*What change-control evidence must demonstrate when much of the code is
AI-assisted — and, for each requirement, the command that demonstrates it
against a CodeWorthy evidence package. Written from the assessor's side of the
table: every item is phrased as the thing the auditor must be able to
establish, not as a product feature. CodeWorthy's exporter is the reference
implementation; any system that satisfies this checklist with independently
verifiable artifacts meets the same bar.*

Companion specs: [`canonical-encoding.md`](canonical-encoding.md) (the byte
contract), [`control-operation-predicate.md`](control-operation-predicate.md)
(the attestation predicate). Verifier: `npx codeworthy-verify` (zero
dependencies; read it before you trust it).

Conventions: `PKG` is a package directory or `.tar.gz`. Exit codes — `0`
clean, `2` the evidence is inconsistent with itself, `3` verified with
findings to sample.

---

## C1 — Integrity: the record cannot have been altered after recording

| | |
|---|---|
| Requirement | Every event is bound to its content and its predecessor; any edit, deletion, or reorder is detectable at a named row. |
| Spec | `canonical-encoding.md` §1–2 |
| Demonstrate | `codeworthy-verify report PKG` → `✓ chain: N row(s) recomputed and chained end to end` |
| Negative test | Alter any field of any exported row → the same command fails naming the row and the failure mode (content vs linkage). |
| Notes | The verifier RECOMPUTES every hash from raw fields per the published spec; claimed hashes are checked, never believed. |

## C2 — Independence: verification requires nothing from the vendor

| | |
|---|---|
| Requirement | A third party can verify with the vendor switched off: no accounts, no API, no vendor code. |
| Spec | `canonical-encoding.md` (the only contract); ratified invariant #1 |
| Demonstrate | Run `codeworthy-verify` offline against `PKG` alone. The tool has zero runtime dependencies and never imports exporter code. |

## C3 — External anchoring: a full rewrite is still detectable

| | |
|---|---|
| Requirement | Chain heads are pinned to write-once storage outside the recording system; a package can be checked against an independently fetched copy. |
| Spec | plan §V4.3 |
| Demonstrate | `codeworthy-verify report PKG` → anchors check; then fetch `GET /anchors.json` from the deployment and compare records — they must match the package's `anchors.json`. |
| Notes | The verifier states explicitly when it checked only the package's copy. |

## C4 — Completeness: the population is whole, and says where it is not

| | |
|---|---|
| Requirement | The record proves nothing happened outside it: reconciled against the platform's own account (GitHub), scoped to declared coverage windows, with gaps declared rather than discovered. |
| Spec | plan §V1 |
| Demonstrate | `codeworthy-verify report PKG` → completeness check reads the chained `reconciliation.completed` attestations; unattested repos, declared discrepancies, coverage gaps, and truncated enumerations are all surfaced. |
| Negative test | A repo with no reconciliation attestation → `the population is unattested`, exit 3. |

## C5 — Attribution: every change names its actors

| | |
|---|---|
| Requirement | Every merge carries author, merger, approvers with timestamps, and the merge SHA join key. |
| Spec | plan §V0.2 |
| Demonstrate | `codeworthy-verify population PKG` → one CSV row per merge with author, merged_by, approvers, flags. |

## C6 — Authorization: approvals exist, precede the merge, and self-approval is flagged

| | |
|---|---|
| Requirement | The segregation-of-duties facts are computable over the whole population, not a sample: unapproved merges, self-approvals, approvals that post-date the merge. |
| Spec | plan §V3 check 5 |
| Demonstrate | `codeworthy-verify report PKG` → control-operation check enumerates them; `population PKG` carries per-row flags for sampling. |

## C7 — Testing: check outcomes at merge are recorded, and red merges carry exceptions

| | |
|---|---|
| Requirement | CI check conclusions on the merged head are captured at merge time; merging over failures requires a first-class exception record. |
| Spec | plan §V0.2–V0.3 |
| Demonstrate | `codeworthy-verify report PKG`. A red-check merge without its `exception.merged_red_checks` event is a hard FAIL ("the exception register is incomplete"), not a finding. |

## C8 — Exceptions: control deviations are first-class, reasoned, and enumerable

| | |
|---|---|
| Requirement | Weakened protection, force-pushes, red-check merges, and gate overrides are recorded as an `exception.*` family with actors and reasons — the record telling the truth about itself is the system working. |
| Spec | plan §V0.3 |
| Demonstrate | `exceptions.json` in the package (derived view); the authoritative rows travel in `events.jsonl`; exceptions surface as findings (exit 3), never silently. |

## C9 — Walkthrough: any sampled change traces end to end

| | |
|---|---|
| Requirement | For any sampled item, the full lifecycle — open, approvals, checks, merge, exceptions, anchor sealing — reconstructs from the verified record on one page. |
| Spec | plan §V5 |
| Demonstrate | `codeworthy-verify sample PKG --merge <sha>` (or `--pr <n>`). Refuses to run on a package that fails verification. |

## C10 — AI is advisory: generated content has provenance and no evidentiary weight

| | |
|---|---|
| Requirement | AI-generated events are labeled, carry provenance (policy version, model, prompt hash), and contribute nothing to any control conclusion. |
| Spec | ratified invariant #3; `control-operation-predicate.md` |
| Demonstrate | `codeworthy-verify report PKG` — an `llm.reviewed` row missing provenance labels is a FAIL; the walkthrough marks such rows `[ADVISORY — no evidentiary weight]`. |

## C11 — Provenance of the evidence itself: who exported it, and when

| | |
|---|---|
| Requirement | The package can carry a signature binding exporter identity and time to the exact bytes — and the signature must not be able to launder content into truth. |
| Spec | `control-operation-predicate.md` |
| Demonstrate | `codeworthy-verify report PKG --pubkey key.pem` (key obtained independently of the package). Signed-then-modified files fail the digest binding even without a key. |

## C12 — Reproducibility: the artifact is stable

| | |
|---|---|
| Requirement | The same recorded state and parameters yield byte-identical packages, so two parties can compare artifacts by hash alone. |
| Spec | plan §V2 |
| Demonstrate | Export twice, `sha256sum` both `manifest.json` files (or the tarballs). |

---

*Change policy: additive only, like the specs it cites. An item may gain
demonstrations; no item's requirement weakens without a version bump of this
document.*
