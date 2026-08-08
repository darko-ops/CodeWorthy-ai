// Auditor workflow surface (V5) — the population frame and the per-change
// walkthrough. Both are DERIVED VIEWS OF VERIFIED EVIDENCE: they run the full
// verification first and refuse to emit from a package that fails it — a
// sampling frame built on unverified evidence is how bad audits start.
//
// Everything here is deterministic (same package bytes → same output) and
// deliberately boring: CSV for the population because sampling tools eat CSV,
// fixed-width text for the walkthrough because it gets stapled to a workpaper.
import { verifyPackage } from "./verify.mjs";

function parseRows(files) {
  const raw = files.get("events.jsonl");
  if (!raw) return [];
  return raw.toString("utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
}
const payloadOf = (r) => { try { return JSON.parse(r.payload_text); } catch { return {}; } };

const csvField = (v) => {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
};

/**
 * The sampling frame: one row per merge, from change.merged events (the
 * evidence-rich record) with pull_request.merged as fallback for merges that
 * predate V0.2 instrumentation.
 * @param {Map<string, Buffer>} files
 * @param {{publicKeyPem?: string|null}} [opts]
 */
export function buildPopulation(files, opts = {}) {
  const report = verifyPackage(files, opts);
  if (report.verdict === "fail") {
    return { ok: false, report, error: "verification failed — refusing to emit a sampling frame from unverified evidence (see the report)" };
  }
  const rows = parseRows(files);
  // A merge appears twice in the chain: the webhook record first
  // (pull_request.merged), then the evidence-rich change.merged. The frame
  // takes the rich row and falls back to webhook-only for merges that predate
  // full instrumentation — so pick change.merged keys in a first pass.
  const richKeys = new Set(
    rows.filter((r) => r.event_type === "change.merged").map((r) => `${r.repo}#${payloadOf(r).number}`)
  );
  const seen = new Set();
  const population = [];
  for (const r of rows) {
    if (r.event_type !== "change.merged" && r.event_type !== "pull_request.merged") continue;
    const p = payloadOf(r);
    const key = `${r.repo}#${p.number}`;
    if (seen.has(key)) continue;
    if (r.event_type === "pull_request.merged" && richKeys.has(key)) continue; // the rich row is coming
    seen.add(key);
    const approvers = Array.isArray(p.approvers) ? p.approvers.map((a) => a.login) : [];
    population.push({
      seq: r.id,
      repo: r.repo,
      pr_number: p.number ?? "",
      merge_sha: p.mergeSha ?? "",
      merged_at: p.mergedAt ?? r.ts,
      author: p.author ?? "",
      merged_by: r.actor ?? "",
      approvers: approvers.join(";"),
      self_approved: p.selfApproved === true ? "yes" : "no",
      red_checks_at_merge: Array.isArray(p.redChecksAtMerge) ? p.redChecksAtMerge.join(";") : "",
      evidence_gaps: Array.isArray(p.evidenceGaps) ? p.evidenceGaps.join(";") : "",
      instrumented: r.event_type === "change.merged" ? "full" : "webhook-only",
    });
  }
  return { ok: true, report, population };
}

const CSV_COLUMNS = ["seq", "repo", "pr_number", "merge_sha", "merged_at", "author", "merged_by", "approvers", "self_approved", "red_checks_at_merge", "evidence_gaps", "instrumented"];

export function populationCsv(population) {
  const lines = [CSV_COLUMNS.join(",")];
  for (const row of population) lines.push(CSV_COLUMNS.map((c) => csvField(row[c])).join(","));
  return lines.join("\n") + "\n";
}

/**
 * The walkthrough: one change's full lifecycle from the chained record —
 * everything an auditor traces for a sampled item, on one page.
 * @param {Map<string, Buffer>} files
 * @param {{mergeSha?: string, prNumber?: number, publicKeyPem?: string|null}} sel
 */
export function buildSample(files, sel) {
  const report = verifyPackage(files, sel);
  if (report.verdict === "fail") {
    return { ok: false, report, error: "verification failed — a walkthrough of unverified evidence proves nothing (see the report)" };
  }
  const rows = parseRows(files);

  // Resolve the sampled merge by its join key — preferring the evidence-rich
  // change.merged row over the webhook-shape pull_request.merged that
  // precedes it in the chain.
  const matches = (r) => {
    if (r.event_type !== "change.merged" && r.event_type !== "pull_request.merged") return false;
    const p = payloadOf(r);
    if (sel.mergeSha) return typeof p.mergeSha === "string" && (p.mergeSha === sel.mergeSha || p.mergeSha.startsWith(sel.mergeSha));
    return sel.prNumber != null && p.number === sel.prNumber;
  };
  const mergeRow = rows.find((r) => r.event_type === "change.merged" && matches(r)) ?? rows.find(matches);
  if (!mergeRow) {
    return { ok: false, report, error: `no merge matching ${sel.mergeSha ? `merge SHA ${sel.mergeSha}` : `PR #${sel.prNumber}`} in this package` };
  }
  const mp = payloadOf(mergeRow);
  const number = mp.number;
  const repo = mergeRow.repo;

  // Every event that touches this change, by number or by SHA.
  const touches = (r) => {
    if (r.repo !== repo) return false;
    const p = payloadOf(r);
    return p.number === number
      || (mp.mergeSha && (p.mergeSha === mp.mergeSha || p.head === mp.mergeSha))
      || (mp.headSha && (p.headSha === mp.headSha || p.head === mp.headSha));
  };
  const lifecycle = rows.filter(touches);

  // Anchor coverage: the earliest anchor at-or-after this row seals it.
  let anchorLine = "not anchored within this package's records — check /anchors.json for a later anchor";
  try {
    const anchors = JSON.parse((files.get("anchors.json") ?? Buffer.from("{}")).toString("utf8"));
    const sealing = (anchors.records ?? [])
      .filter((a) => BigInt(a.seq) >= BigInt(mergeRow.id))
      .sort((a, b) => (BigInt(a.seq) < BigInt(b.seq) ? -1 : 1))[0];
    if (sealing) anchorLine = `sealed by write-once anchor at seq ${sealing.seq} (${sealing.anchoredAt}) — rewriting this history would break that anchor`;
  } catch { /* anchors.json malformed — the anchors check already reported it */ }

  const line = (label, text) => `${label.padEnd(14)} ${text}`;
  const out = [];
  out.push(`WALKTHROUGH — ${repo} PR #${number}`);
  out.push("=".repeat(60));
  out.push(line("merge sha", mp.mergeSha ?? "(not recorded)"));
  out.push(line("into", mp.base ?? "(default branch)"));
  out.push(line("author", mp.author ?? "(unknown)"));
  out.push(line("merged by", `${mergeRow.actor ?? "(unknown)"} at ${mp.mergedAt ?? mergeRow.ts}`));
  out.push("");
  out.push("APPROVALS");
  const approvers = Array.isArray(mp.approvers) ? mp.approvers : [];
  if (approvers.length === 0) out.push("  NONE — merged without an approving review");
  for (const a of approvers) out.push(`  ${a.login} approved at ${a.submittedAt ?? "(time not recorded)"}${a.login === mp.author ? "   << SELF-APPROVAL" : ""}`);
  out.push("");
  out.push("CHECKS AT MERGE (on the PR head)");
  const checks = Array.isArray(mp.checksAtMerge) ? mp.checksAtMerge : [];
  if (checks.length === 0) out.push("  none recorded");
  for (const c of checks) out.push(`  ${String(c.conclusion ?? "unknown").padEnd(10)} ${c.name}`);
  if (Array.isArray(mp.evidenceGaps) && mp.evidenceGaps.length) out.push(`  EVIDENCE GAPS at capture: ${mp.evidenceGaps.join(", ")}`);
  out.push("");
  out.push("LIFECYCLE (chained events touching this change)");
  for (const r of lifecycle) {
    const advisory = r.event_type.startsWith("llm.") ? "  [ADVISORY — no evidentiary weight]" : "";
    const exception = r.event_type.startsWith("exception.") ? "  [EXCEPTION]" : "";
    out.push(`  seq ${String(r.id).padEnd(6)} ${r.ts}  ${r.event_type}${exception}${advisory}`);
    out.push(`         ${r.plain_english}`);
  }
  out.push("");
  out.push("INTEGRITY");
  out.push(`  chain: ${report.checks.find((c) => c.name === "chain")?.detail ?? "?"}`);
  out.push(`  ${anchorLine}`);
  out.push("");
  out.push(`Package verdict: ${report.verdict}. This walkthrough is a view of the verified record; it asserts nothing the chained events above do not.`);
  return { ok: true, report, text: out.join("\n") + "\n", mergeRow };
}
