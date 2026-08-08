// The evidence package (V2 of docs/validator-build-plan.md) — the
// period-bounded, self-contained artifact an auditor receives and verifies
// with CodeWorthy switched off.
//
// Contents and their trust status:
//
//   events.jsonl         PRIMARY EVIDENCE — the full chain segment for the
//                        period, raw canonical fields + claimed hashes. The
//                        verifier RECOMPUTES every hash from the fields; the
//                        claimed hashes are checked, never trusted (ratified
//                        invariant #1).
//   chain-binding.json   the segment's boundary: opening prev_hash, closing
//                        head, row count — what an anchor pins.
//   anchors.json         anchor records covering the segment + where to fetch
//                        them independently of this package.
//   reconciliation.json  DERIVED convenience view (completeness statements,
//                        coverage windows) — the verifier recomputes these
//                        claims from events.jsonl.
//   exceptions.json      DERIVED convenience view of the exception.* register.
//   README.txt           plain-language description + the trust boundary.
//   manifest.json        format/generator versions, period, repos, counts,
//                        sha256 of every other file.
//
// Design decisions, made explicit:
//   - The package carries the FULL chain segment (every row in the id range
//     spanning the period, all repos): the chain is one global sequence, so a
//     repo-filtered export could not prove linkage — and a filtered export is
//     a broken population by construction (the plan's own rule). Scoping a
//     package to a repo subset requires per-repo chains — a deliberate future
//     design, not a silent filter here.
//   - The export is selected by ID RANGE (min id at/after `from` … max id
//     before `to`), not by per-row timestamp filtering, so the segment is a
//     contiguous chain walk even if clock skew ever put a timestamp out of
//     order. Population claims remain timestamp-scoped; the verifier applies
//     that scoping itself.
//   - REPRODUCIBLE: same DB state + same parameters → identical bytes. Stable
//     ordering everywhere, no export-time timestamps anywhere in the file set
//     (a signed wrapper adds its own timestamp in V4). manifest.json hashes
//     every file, and is itself the integrity root the (future) signature
//     covers.
//   - llm.* events travel like every other event, labeled by their type; the
//     verifier ignores them for control conclusions (ratified invariant #3).
import { createHash } from "node:crypto";
import type { Pool } from "pg";
import type { Anchor, AnchorRecord } from "../audit/tamper.js";
import { coverageFor, type CoverageWindow } from "../audit/coverage.js";

export const EVIDENCE_FORMAT = "codeworthy-evidence/1";
export const GENERATOR = "codeworthy-steward-server";

export interface ExportParams {
  from: string; // ISO inclusive
  to: string; // ISO exclusive
  repos?: string[]; // the SUBJECT repos for derived views; default: all seen in segment
  anchor?: Anchor | null; // where anchor records come from
  anchorSource?: string; // human description of the independent anchor location
}

export interface EvidencePackage {
  files: Map<string, Buffer>; // filename -> exact bytes (canonical artifact)
  manifest: Record<string, unknown>;
  rowCount: number;
}

interface ExportedRow {
  id: string;
  ts: string; // ISO UTC with microseconds
  installation_id: string | null;
  repo: string;
  event_type: string;
  actor: string | null;
  payload_text: string;
  payload: unknown; // parsed, for derived views only
  plain_english: string;
  canon_version: number;
  prev_hash: string | null;
  row_hash: string;
}

const sha256 = (b: Buffer) => createHash("sha256").update(b).digest("hex");
// Deterministic JSON: keys are emitted in the order object literals define
// them; we never rely on dynamic key insertion for hashed content.
const jsonBuf = (v: unknown) => Buffer.from(JSON.stringify(v, null, 2) + "\n", "utf8");

async function fetchSegment(pool: Pool, from: string, to: string): Promise<ExportedRow[]> {
  const { rows } = await pool.query(
    `WITH b AS (
       SELECT (SELECT min(id) FROM audit_events WHERE ts >= $1) AS first_id,
              (SELECT max(id) FROM audit_events WHERE ts <  $2) AS last_id
     )
     SELECT id::text AS id,
            to_char(ts AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS ts,
            installation_id::text AS installation_id,
            repo, event_type, actor,
            payload::text AS payload_text,
            payload,
            plain_english,
            canon_version,
            encode(prev_hash, 'hex') AS prev_hash,
            encode(row_hash, 'hex') AS row_hash
     FROM audit_events, b
     WHERE b.first_id IS NOT NULL AND id >= b.first_id AND id <= b.last_id
     ORDER BY id`,
    [from, to]
  );
  return rows as ExportedRow[];
}

export async function buildEvidencePackage(pool: Pool, params: ExportParams): Promise<EvidencePackage> {
  const segment = await fetchSegment(pool, params.from, params.to);
  const repos = (params.repos && params.repos.length > 0
    ? [...params.repos]
    : [...new Set(segment.map((r) => r.repo))]
  ).sort();

  // events.jsonl — one line per row, fixed key order, raw fields + claimed
  // hashes. The verifier recomputes; nothing here is conclusions.
  const eventLines = segment.map((r) =>
    JSON.stringify({
      id: r.id,
      ts: r.ts,
      installation_id: r.installation_id,
      repo: r.repo,
      event_type: r.event_type,
      actor: r.actor,
      payload_text: r.payload_text,
      plain_english: r.plain_english,
      canon_version: r.canon_version,
      prev_hash: r.prev_hash,
      row_hash: r.row_hash,
    })
  );
  const eventsFile = Buffer.from(eventLines.join("\n") + (eventLines.length ? "\n" : ""), "utf8");

  const first = segment[0] ?? null;
  const last = segment[segment.length - 1] ?? null;
  const chainBinding = {
    first_seq: first?.id ?? null,
    opening_prev_hash: first?.prev_hash ?? null, // binds the segment to everything before it
    last_seq: last?.id ?? null,
    closing_row_hash: last?.row_hash ?? null,
    row_count: segment.length,
    note: "The verifier walks the segment: each row's recomputed hash must chain from the previous row, opening at opening_prev_hash and closing at closing_row_hash.",
  };

  // Anchors covering the segment — plus the independent source, because an
  // anchor inside the package only proves consistency with the package. The
  // real check fetches the same records from the write-once store.
  let anchorRecords: AnchorRecord[] = [];
  if (params.anchor) {
    const all = await params.anchor.list();
    const firstSeq = first ? BigInt(first.id) : null;
    const lastSeq = last ? BigInt(last.id) : null;
    anchorRecords = all.filter((a) => {
      if (firstSeq == null || lastSeq == null) return false;
      const seq = BigInt(a.seq);
      return seq >= firstSeq && seq <= lastSeq;
    });
  }
  const anchorsJson = {
    records: anchorRecords,
    independent_source: params.anchorSource ?? (params.anchor ? "configured write-once anchor store (ask the operator for read access)" : null),
    note: params.anchor
      ? "Verify these against the write-once store directly — records inside a package prove nothing about the package."
      : "No anchor store was configured for this deployment; chain verification is internal-only for this segment.",
  };

  // Derived views (convenience — recomputable from events.jsonl).
  const coverage: Record<string, CoverageWindow[]> = {};
  for (const repo of repos) coverage[repo] = await coverageFor(pool, repo);
  const reconRows = segment.filter(
    (r) => (r.event_type === "reconciliation.completed" || r.event_type === "reconciliation.gap") && repos.includes(r.repo)
  );
  const reconciliationJson = {
    derived: true,
    note: "Convenience view. The authoritative records are the reconciliation.* events in events.jsonl; recompute claims from there.",
    statements: reconRows
      .filter((r) => r.event_type === "reconciliation.completed")
      .map((r) => ({ id: r.id, repo: r.repo, ts: r.ts, statement: r.plain_english, result: r.payload })),
    gaps: reconRows
      .filter((r) => r.event_type === "reconciliation.gap")
      .map((r) => ({ id: r.id, repo: r.repo, ts: r.ts, detail: r.plain_english, payload: r.payload })),
    coverage_windows: coverage,
  };
  const exceptionRows = segment.filter((r) => r.event_type.startsWith("exception.") && repos.includes(r.repo));
  const exceptionsJson = {
    derived: true,
    note: "Convenience view of the exception register. Authoritative records are the exception.* events in events.jsonl.",
    exceptions: exceptionRows.map((r) => ({ id: r.id, repo: r.repo, ts: r.ts, type: r.event_type, actor: r.actor, detail: r.plain_english, payload: r.payload })),
  };

  const readme = renderReadme(params.from, params.to, repos, segment.length, anchorRecords.length);

  // Assemble; manifest last so it can hash everything else.
  const files = new Map<string, Buffer>();
  files.set("events.jsonl", eventsFile);
  files.set("chain-binding.json", jsonBuf(chainBinding));
  files.set("anchors.json", jsonBuf(anchorsJson));
  files.set("reconciliation.json", jsonBuf(reconciliationJson));
  files.set("exceptions.json", jsonBuf(exceptionsJson));
  files.set("README.txt", Buffer.from(readme, "utf8"));

  const eventCounts: Record<string, number> = {};
  for (const r of segment) eventCounts[r.event_type] = (eventCounts[r.event_type] ?? 0) + 1;
  const manifest = {
    format: EVIDENCE_FORMAT,
    generator: GENERATOR,
    period: { from: params.from, to: params.to },
    repos,
    row_count: segment.length,
    event_counts: Object.fromEntries(Object.entries(eventCounts).sort(([a], [b]) => (a < b ? -1 : 1))),
    canon_versions: [...new Set(segment.map((r) => r.canon_version))].sort(),
    chain: { first_seq: chainBinding.first_seq, last_seq: chainBinding.last_seq, closing_row_hash: chainBinding.closing_row_hash },
    anchors_included: anchorRecords.length,
    files: Object.fromEntries(
      [...files.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([name, buf]) => [name, sha256(buf)])
    ),
    // No export timestamp — reproducibility. The signed wrapper (V4) carries
    // signing time; the content must not vary run to run.
  };
  files.set("manifest.json", jsonBuf(manifest));

  return { files, manifest, rowCount: segment.length };
}

/** The package as sorted entries — the exact input to the tar writer. */
export function packageEntries(pkg: EvidencePackage): Array<{ name: string; content: Buffer }> {
  return [...pkg.files.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([name, content]) => ({ name, content }));
}

function renderReadme(from: string, to: string, repos: string[], rows: number, anchors: number): string {
  return `CodeWorthy Evidence Package
===========================

Period:  ${from} (inclusive) to ${to} (exclusive)
Repos:   ${repos.join(", ") || "(none)"}
Events:  ${rows} chained audit event(s) — the full chain segment for the period
Anchors: ${anchors} write-once anchor record(s) covering the segment

WHAT THIS IS
  The change-control record for the period, exported with its integrity
  metadata so it can be verified without trusting the exporter. Every event
  carries the raw fields plus the hash that chains it to the previous event.

HOW TO VERIFY (independently — that is the point)
  npx codeworthy-verify report <this package>
  The verifier RECOMPUTES every hash from the raw fields (it never trusts the
  claimed ones), walks the chain across the whole segment, checks the anchors
  against an independently fetched copy, recomputes the completeness
  statements, and runs the control checks (approvals precede merges,
  self-approval flags, checks green at merge or a logged exception).

THE TRUST BOUNDARY (read this)
  Verification proves the record was not altered AFTER recording, that the
  merge population is complete against GitHub's own account for the covered
  windows, and that the named controls operated. It does NOT prove the
  recording server was honest at write time — that residual trust is what the
  write-once anchors shrink: a rewritten history cannot match a head that was
  anchored before the rewrite.

WHAT IS NOT EVIDENCE HERE
  Events of type llm.* are AI advisory notes. They are included for
  completeness, labeled by their type and provenance, and carry no weight in
  any control conclusion (AI is advisory — it may explain evidence, never
  constitute it).

  reconciliation.json and exceptions.json are convenience views derived from
  events.jsonl. If they ever disagree with events.jsonl, events.jsonl wins.
`;
}
