# Integrating the Auditor Aspect into the UI

*Design doc. Follows the validator build (V0–V5) and the ratified invariants.
The question it answers: the evidence engine and verifier exist — where do they
live in the product's interface?*

---

## 0. The design principle that decides everything else

**Pixels are not evidence.** The entire thesis of the validator is that
conclusions come from recomputation of raw evidence, never from trusting the
vendor. A rich "auditor dashboard" that renders verdicts would quietly rebuild
the thing the product exists to replace: a vendor-controlled screen an auditor
is asked to believe.

So the UI's job splits cleanly by audience:

| Audience | What the UI is for | What it must never be |
|---|---|---|
| **Owner** (founder/team) | Readiness: "will I pass, what needs fixing, generate the package" | — |
| **Auditor** (third party) | **Distribution and convenience**: get the package, the verify command, the key, the anchors — and readable *previews* of what verification will show | The source of any conclusion |

Every auditor-visible claim carries a "recompute this yourself" affordance —
the exact CLI command that reproduces it. The page shows; the artifact proves.

## 1. One renderer, two surfaces (the anti-drift rule)

The verifier (`verifier/src/*.mjs`) is plain dependency-free ESM. **The server
imports those same modules** to render the auditor-facing views:

- `verifyPackage()` produces the verdict/checks the UI displays;
- `buildSample()` produces the walkthrough text the UI shows per merge;
- `buildPopulation()` produces the population table/CSV.

The UI can therefore never disagree with what the auditor's own run of
`codeworthy-verify` prints — same code, same bytes. No second implementation of
any check, ever. (This is the UI equivalent of the canonical-encoding rule:
one contract, no drift.)

## 2. Owner surface — three additions to the existing dashboard

### 2.1 An "Evidence" vital on the health card

The dashboard already speaks in vitals (🟢🟡🔴). Add one:

> **Evidence** — 🟢 "Audit-ready: reconciliation clean (0 discrepancies),
> 2 exceptions with reasons, chain anchored 6h ago."
> 🟡 "3 exceptions need reasons; coverage gap Jul 2–Jul 4 (declared)."
> 🔴 "Reconciliation found 2 discrepancies" / "chain verification failing."

Data sources already exist: latest `reconciliation.completed` payload, the
`exception.*` register, `verifyAuditChain` + anchor age. The tri-state maps to
the verifier's verdict semantics (pass / verified-with-findings / fail) — the
same three states everywhere in the product.

### 2.2 The Evidence page (per repo, owner-only)

The workflow page for "my audit is coming":

1. **Period picker** → live preview: the completeness statement **verbatim**
   (never re-summarized — the sentence is the artifact), exception count,
   coverage windows with gaps drawn, population size.
2. **"Generate evidence package"** → runs the exporter; download the
   `.tar.gz` (+ `attestation.json` when a key is configured). Shows the
   manifest sha256, the signing keyid, and the hand-off block to copy into an
   email:
   ```
   Evidence: evidence-acme-app-2026H1.tar.gz  (sha256 9da2eb98…)
   Verify:   npx codeworthy-verify report evidence-acme-app-2026H1.tar.gz \
               --pubkey codeworthy-attest.pem
   Key:      https://<host>/attest-key.pem   (keyid d8dc4918a93e409b)
   Anchors:  https://<host>/anchors.json
   ```
3. **Export history** — every generated package logged **to the spine itself**
   (`evidence.exported` event: period, manifest hash, keyid). Evidence about
   the evidence; auditors love a register of what was handed out, and it makes
   re-issuing a byte-identical package provable.
4. **Exception workbench** — the `exception.*` register as a to-do list:
   each exception shows its plain-language sentence and, where the reason is
   missing, prompts the owner to add one *as a new chained annotation event*
   (`exception.annotated`, referencing the original seq — append-only, never
   editing history). This is the one place the UI writes, and it writes the
   way everything writes: append.

### 2.3 Digest line

The weekly digest gains one sentence: "Audit-readiness: 🟢 reconciliation
clean; 1 exception this week (force-push by dana — reason on file)." The
digest is already the founder artifact; readiness belongs in it.

## 3. Auditor surface — the evidence room, not a portal

**No auditor accounts.** Accounts create sales friction, imply the auditor
works *inside* the vendor's system (bad independence optics), and add an auth
surface to a read-only need. Instead:

### 3.1 A shareable, tokenized, read-only evidence room

Owner clicks "Share with auditor" on a generated package → capability URL
(`/evidence/<token>`), revocable, expiring, no login. The room contains:

- **The package**: download, sha256, byte size; the attestation keyid and a
  link to the published public key (served at a stable URL *outside* the room).
- **The verify block**: the copy-paste `npx codeworthy-verify …` command,
  stated as the authority: *"This page is a convenience view. Your conclusion
  should come from running the verifier on the package — everything below is
  reproducible from it."*
- **Verification preview**: the six checks as the server ran them (same
  modules, §1), each row expandable to findings, each row footed with the CLI
  command that reproduces it.
- **The completeness statement, verbatim.**
- **Population** — the sampling frame rendered as a table + "Download CSV"
  (exactly `populationCsv()` output). Click a row →
- **Walkthrough pages** — `buildSample()` text rendered monospace, one page
  per sampled merge, print-stylesheet'd so it staples to a workpaper. Print
  is a first-class feature here, not an afterthought.
- **Conformance checklist** — the C1–C12 table from
  `docs/spec/evidence-conformance.md`, each row linking to its demonstrating
  command and its negative test.
- **Anchors**: link to `/anchors.json` with one line of instruction ("fetch
  this yourself; the package can never legitimately disagree with it").

Room accesses append `evidence.room_accessed` events (token id, not IP
fingerprinting — no surveillance doctrine applies to auditors too).

### 3.2 What the room deliberately does NOT have

- No "approve/accept" buttons — the auditor's conclusion lives in their
  workpapers, not in our database.
- No re-rendered AI content as findings: `llm.*` rows appear only inside
  walkthrough lifecycles, styled as the CLI prints them —
  `[ADVISORY — no evidentiary weight]`, visually muted.
- No charts of "compliance score." The verdict trio and the counts, nothing
  invented.

## 4. Visual language

- Reuse the existing tokens: the checkup's 🟢🟡🔴 and the dashboard's rating
  chips. New semantics, same vocabulary: **pass / verified-with-findings /
  fail** everywhere the evidence appears.
- Findings are *neutral-serious*, not shaming: a self-approval is rendered as
  a fact with a "why this matters" line, consistent with the no-leaderboards
  doctrine — repos have health; people are never ranked or scored.
- Monospace for anything that is verbatim artifact (statements, walkthroughs,
  hashes, commands); proportional for explanation. The typography itself
  teaches which text is evidence and which is narration.

## 5. Build order (smallest honest increments)

1. **Evidence vital** on the health card + digest line (reads existing data;
   ~a day).
2. **Evidence page** with export + hand-off block + `evidence.exported` spine
   events.
3. **Evidence room** (token link, package download, verify block,
   verification preview via imported verifier modules).
4. **Population table + walkthrough pages** (reuse `workpaper.mjs`; add print
   stylesheet).
5. **Exception workbench** with `exception.annotated` append-only reasons.

Each step ships alone; nothing blocks on the next.

## 6. Open questions (owner's call, not blocking step 1)

- Token lifetime/revocation policy for evidence rooms (suggest: 90 days,
  revocable list on the Evidence page).
- Whether the public attestation key lives at `/{well-known}/attest-key.pem`
  on the app host or on a separate static host (separate is stronger — key
  distribution shouldn't share fate with the thing it vouches for).
- Whether walkthrough pages should be included in the exported package as
  static HTML (nice: the room's content survives the vendor entirely).
