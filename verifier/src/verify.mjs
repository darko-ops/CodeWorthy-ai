// codeworthy-verify — the verification core (V3 of the validator build plan).
//
// Doctrine, implemented literally:
//   1. VERIFICATION IS INDEPENDENT — every hash and every claim is recomputed
//      from the raw evidence in the package; claimed hashes and derived views
//      are checked, never believed.
//   2. EVIDENCE IS APPEND-ONLY — any edit, removal, or reorder of the chain is
//      a hard failure with the first broken row named.
//   3. AI IS ADVISORY — llm.* events carry ZERO weight in any control
//      conclusion here; the only thing checked about them is that their
//      provenance labels exist.
//
// This package never talks to a database or imports server code. Its one
// contract with the recording system is docs/spec/canonical-encoding.md.
//
// Check results use three statuses:
//   pass  — the property held
//   fail  — the evidence is inconsistent with itself (tampering, corruption,
//           or a record that claims what its own contents contradict)
//   skip  — the check could not run (with the reason stated)
// Findings that are NOT failures — control exceptions, coverage limits,
// discrepancies the record itself declares — make the verdict
// "verified-with-findings" (exit 3): the evidence is intact and honest, and
// it says something an auditor must look at.
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { verifyAttestation } from "./attestation.mjs";
import { isoToEpochMicros, rowHashV2 } from "./canonical.mjs";
import { untarGz } from "./untar.mjs";

export const SUPPORTED_FORMATS = ["codeworthy-evidence/1"];

const sha256 = (b) => createHash("sha256").update(b).digest("hex");

/** Load a package from a directory or a .tar.gz path. @returns {Map<string,Buffer>} */
export function loadPackage(path) {
  const st = statSync(path);
  if (st.isDirectory()) {
    const files = new Map();
    for (const name of readdirSync(path).sort()) {
      const p = join(path, name);
      if (statSync(p).isFile()) files.set(name, readFileSync(p));
    }
    return files;
  }
  return untarGz(readFileSync(path));
}

/**
 * Verify a package. Pure: Map in, report out.
 * @param {Map<string, Buffer>} files
 * @param {{publicKeyPem?: string|null}} [opts] - the exporter's PUBLISHED key,
 *   obtained independently of the package (never from inside it).
 */
export function verifyPackage(files, opts = {}) {
  const checks = [];
  const add = (name, status, detail, findings = []) => {
    const c = { name, status, detail, findings };
    checks.push(c);
    return c;
  };

  // ── 1. package integrity ─────────────────────────────────────────────────
  let manifest = null;
  {
    const findings = [];
    const raw = files.get("manifest.json");
    if (!raw) {
      add("package-integrity", "fail", "manifest.json is missing — nothing vouches for the file set");
    } else {
      try { manifest = JSON.parse(raw.toString("utf8")); } catch { manifest = null; }
      if (!manifest) {
        add("package-integrity", "fail", "manifest.json is not valid JSON");
      } else if (!SUPPORTED_FORMATS.includes(manifest.format)) {
        add("package-integrity", "fail", `unsupported format "${manifest.format}" — this verifier implements: ${SUPPORTED_FORMATS.join(", ")} (refusing, not skipping)`);
        manifest = null;
      } else {
        for (const [name, expected] of Object.entries(manifest.files ?? {})) {
          const buf = files.get(name);
          if (!buf) findings.push(`listed file missing from package: ${name}`);
          else if (sha256(buf) !== expected) findings.push(`sha256 mismatch: ${name}`);
        }
        for (const name of files.keys()) {
          // attestation.json signs the manifest, so the manifest cannot list it.
          if (name === "manifest.json" || name === "attestation.json") continue;
          if (!(manifest.files ?? {})[name]) findings.push(`file present but not listed in manifest: ${name}`);
        }
        add("package-integrity", findings.length ? "fail" : "pass",
          findings.length ? `${findings.length} integrity problem(s)` : `all ${Object.keys(manifest.files ?? {}).length} files match their manifest hashes`,
          findings);
      }
    }
  }

  // ── parse events (used by every later check) ─────────────────────────────
  let rows = [];
  {
    const raw = files.get("events.jsonl");
    if (raw) {
      try {
        rows = raw.toString("utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
      } catch {
        add("chain", "fail", "events.jsonl contains an unparseable line");
        rows = null;
      }
    } else {
      add("chain", "skip", "events.jsonl is missing — chain not verifiable");
      rows = null;
    }
  }

  // ── 2. chain recomputation ───────────────────────────────────────────────
  if (rows) {
    const findings = [];
    let binding = null;
    try { binding = JSON.parse((files.get("chain-binding.json") ?? Buffer.from("null")).toString("utf8")); } catch { binding = null; }
    if (!binding) findings.push("chain-binding.json missing or unparseable — segment boundary unverifiable");

    let prev = binding ? binding.opening_prev_hash : rows[0]?.prev_hash ?? null;
    let v1Rows = 0;
    let lastId = null;
    for (const r of rows) {
      if (lastId !== null && BigInt(r.id) <= BigInt(lastId)) {
        findings.push(`row ${r.id}: ids not strictly increasing`);
        break;
      }
      lastId = r.id;
      if (r.prev_hash !== prev) {
        findings.push(`row ${r.id}: linkage broken — a row was removed, reordered, or altered before this point`);
        break;
      }
      if (r.canon_version === 2) {
        let recomputed;
        try {
          recomputed = rowHashV2(r.prev_hash, {
            id: r.id,
            tsEpochMicros: isoToEpochMicros(r.ts),
            installationId: r.installation_id,
            repo: r.repo,
            eventType: r.event_type,
            actor: r.actor,
            payloadText: r.payload_text,
            plainEnglish: r.plain_english,
          });
        } catch (err) {
          findings.push(`row ${r.id}: ${err.message}`);
          break;
        }
        if (recomputed !== r.row_hash) {
          findings.push(`row ${r.id}: content hash mismatch — a field of this row was altered after recording`);
          break;
        }
        // payload_text must itself be JSON (spec §2.2) — it is what control
        // conclusions parse.
        try { JSON.parse(r.payload_text); } catch { findings.push(`row ${r.id}: payload_text is not valid JSON`); }
      } else if (r.canon_version === 1) {
        v1Rows++; // integrity-inherited: linkage checked, content recompute is v2-only (spec §3)
      } else {
        findings.push(`row ${r.id}: unknown canon_version ${r.canon_version} — refusing (spec §5)`);
        break;
      }
      prev = r.row_hash;
    }
    if (binding && rows.length && findings.length === 0) {
      if (prev !== binding.closing_row_hash) findings.push("segment does not close at the stated closing_row_hash");
      if (binding.row_count !== rows.length) findings.push(`row_count mismatch: binding says ${binding.row_count}, package has ${rows.length}`);
    }
    add("chain", findings.length ? "fail" : "pass",
      findings.length
        ? findings[0]
        : `${rows.length} row(s) recomputed and chained end to end${v1Rows ? ` (${v1Rows} v1 row(s): linkage verified, content integrity inherited from the surrounding v2 chain)` : ""}`,
      findings);
  }

  // ── 3. anchors ───────────────────────────────────────────────────────────
  {
    let anchors = null;
    try { anchors = JSON.parse((files.get("anchors.json") ?? Buffer.from("null")).toString("utf8")); } catch { anchors = null; }
    if (!anchors || !Array.isArray(anchors.records)) {
      add("anchors", "skip", "anchors.json missing or unparseable");
    } else if (anchors.records.length === 0) {
      add("anchors", "skip", "no anchor records cover this segment — chain verification is internal-only; ask the operator for the write-once store");
    } else if (!rows) {
      add("anchors", "skip", "cannot check anchors without events.jsonl");
    } else {
      const findings = [];
      const byId = new Map(rows.map((r) => [r.id, r]));
      for (const rec of anchors.records) {
        const row = byId.get(String(rec.seq));
        if (!row) findings.push(`anchored row seq ${rec.seq} is not in the segment`);
        else if (row.row_hash !== rec.rowHash) findings.push(`anchored row seq ${rec.seq}: package hash differs from the anchored hash — history at or before this point was rewritten`);
      }
      add("anchors", findings.length ? "fail" : "pass",
        findings.length
          ? findings[0]
          : `${anchors.records.length} anchor record(s) match the recomputed chain — NOTE: verified against the package's copy; fetch the records from the write-once store (${anchors.independent_source ?? "ask the operator"}) for full assurance`,
        findings);
    }
  }

  // ── 4. completeness (recomputed from events, not from reconciliation.json) ─
  if (rows) {
    const findings = [];
    const repos = (manifest?.repos ?? [...new Set(rows.map((r) => r.repo))]).slice().sort();
    const payload = (r) => { try { return JSON.parse(r.payload_text); } catch { return {}; } };
    let declaredDiscrepancies = 0;
    for (const repo of repos) {
      const recons = rows.filter((r) => r.repo === repo && r.event_type === "reconciliation.completed");
      if (recons.length === 0) {
        findings.push(`${repo}: no completeness attestation (reconciliation.completed) in this package — the population is unattested`);
        continue;
      }
      const latest = recons[recons.length - 1];
      const p = payload(latest);
      const n = Array.isArray(p.discrepancies) ? p.discrepancies.length : 0;
      declaredDiscrepancies += n;
      if (n > 0) findings.push(`${repo}: the record itself declares ${n} reconciliation discrepanc${n === 1 ? "y" : "ies"} — sample them`);
      // The rendered statement must agree with the computed numbers it renders.
      if (typeof p.expectedMergedPrs === "number" && !String(p.statement ?? latest.plain_english).includes(String(p.expectedMergedPrs))) {
        findings.push(`${repo}: completeness statement text disagrees with its own computed numbers`);
      }
      if (Array.isArray(p.uncoveredIntervals) && p.uncoveredIntervals.length > 0) {
        findings.push(`${repo}: coverage gaps declared (${p.uncoveredIntervals.length} interval(s)) — completeness is not claimed for them`);
      }
      if (p.truthTruncated) findings.push(`${repo}: ground-truth enumeration was truncated — completeness claimed only for what was enumerated`);
    }
    const statementInconsistent = findings.some((f) => f.includes("disagrees with its own"));
    add("completeness", statementInconsistent ? "fail" : "pass",
      findings.length ? `${findings.length} completeness note(s) across ${repos.length} repo(s)` : `every repo carries a completeness attestation with 0 discrepancies`,
      findings);
  }

  // ── 5. control operation (deterministic events ONLY — invariant #3) ──────
  if (rows) {
    const findings = [];
    const payload = (r) => { try { return JSON.parse(r.payload_text); } catch { return {}; } };
    const merges = rows.filter((r) => r.event_type === "change.merged");
    const redExceptions = new Set(rows.filter((r) => r.event_type === "exception.merged_red_checks").map((r) => String(payload(r).number)));
    let selfApproved = 0, noApproval = 0, gaps = 0;
    for (const m of merges) {
      const p = payload(m);
      if (!Array.isArray(p.approvers) || p.approvers.length === 0) {
        noApproval++;
        findings.push(`${m.repo} PR #${p.number}: merged with no approving review (merge ${String(p.mergeSha ?? "?").slice(0, 10)})`);
      }
      if (p.selfApproved === true) {
        selfApproved++;
        findings.push(`${m.repo} PR #${p.number}: self-approved — author and approver are the same person`);
      }
      if (Array.isArray(p.evidenceGaps) && p.evidenceGaps.length > 0) {
        gaps++;
        findings.push(`${m.repo} PR #${p.number}: evidence gaps at capture time: ${p.evidenceGaps.join(", ")}`);
      }
      if (Array.isArray(p.redChecksAtMerge) && p.redChecksAtMerge.length > 0 && !redExceptions.has(String(p.number))) {
        // The record contradicts itself: a red-check merge MUST carry its
        // exception event. That is a fail, not a finding.
        findings.push(`FAIL ${m.repo} PR #${p.number}: merged on failing checks but no exception.merged_red_checks event exists — the exception register is incomplete`);
      }
    }
    // AI advisory events: the ONLY thing verified is that provenance labels
    // exist. Their content plays no part in any conclusion above.
    for (const r of rows.filter((x) => x.event_type === "llm.reviewed")) {
      const prov = payload(r).provenance ?? {};
      if (!prov.policyVersion || !prov.model || !prov.promptSha256) {
        findings.push(`FAIL ${r.repo}: llm.reviewed row ${r.id} lacks provenance labels (policyVersion/model/promptSha256) — generated content must be attributable`);
      }
    }
    const hardFail = findings.some((f) => f.startsWith("FAIL "));
    add("control-operation", hardFail ? "fail" : "pass",
      merges.length === 0
        ? "no merges in this package"
        : `${merges.length} merge(s): ${merges.length - noApproval} with independent-or-any approval, ${noApproval} unapproved, ${selfApproved} self-approved, ${gaps} with evidence gaps`,
      findings);
  }

  // ── 6. attestation (exporter identity + time; never truth) ──────────────
  {
    const a = verifyAttestation(files, opts.publicKeyPem ?? null);
    add("attestation", a.status, a.detail, a.findings);
  }

  // ── verdict ──────────────────────────────────────────────────────────────
  const anyFail = checks.some((c) => c.status === "fail");
  const anyFinding = checks.some((c) => c.findings.length > 0);
  const verdict = anyFail ? "fail" : anyFinding ? "verified-with-findings" : "pass";
  const trustBoundary = anyFail
    ? "VERIFICATION FAILED: the evidence is inconsistent with itself at the point(s) named above. Nothing in this package should be relied on as change-control evidence until the inconsistency is explained — treat the named rows as the audit trail of the tampering itself."
    : "Proven: the record was not altered after recording (recomputed, not trusted); the merge population matches its completeness attestation; the named controls operated, with every exception enumerated above. " +
      "Assumed: the recording server was honest at write time — shrink that assumption by fetching the anchor records from the write-once store instead of trusting the package's copy, and (when available) checking the transparency log. " +
      "AI-generated events were verified for provenance labels only; they carry no weight in any conclusion here.";
  return { verdict, exitCode: anyFail ? 2 : anyFinding ? 3 : 0, checks, trustBoundary };
}
