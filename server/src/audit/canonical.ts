// Canonical encoding v2 — the INDEPENDENT reimplementation.
//
// This module recomputes audit-chain hashes from raw field values without
// touching the database's audit_canonical_v2(). It is the seed of the
// standalone verifier (V3 of docs/validator-build-plan.md): the doctrine is
// "verification is independent — the verifier recomputes from raw evidence and
// never trusts exporter conclusions", and that requires a second
// implementation of the byte contract that can never silently drift from the
// SQL one. The drift guard is the cross-implementation test in
// canonical.test.ts: rows written by the DB trigger must recompute to the
// same hashes here, byte for byte.
//
// Deliberately dependency-free (node:crypto only) and free of server imports,
// so it can be lifted into the verifier package unchanged.
//
// The byte contract (v2, in full — see docs/spec/canonical-encoding.md):
//   canonical = UTF-8 bytes of the 0x1f-joined sequence:
//     id                       decimal text
//     ts                       INTEGER epoch-microseconds, decimal text
//     installation_id          decimal text, or empty string when null
//     repo                     as stored
//     event_type               as stored
//     actor                    as stored, or empty string when null
//     payload                  Postgres-normalized jsonb text (as exported)
//     plain_english            as stored
//   (Null fields are coalesced to the empty string BEFORE joining — Postgres
//    concat_ws would otherwise skip nulls entirely — so the separator count is
//    always exactly field-count minus one: 7.)
//   row_hash = sha256( prev_row_hash_bytes || canonical )   (genesis: prev = empty)
import { createHash } from "node:crypto";

export const SEPARATOR = String.fromCharCode(0x1f); // "unit separator" — cannot appear in the fields

export interface CanonicalFieldsV2 {
  id: string; // decimal text of the row id
  tsEpochMicros: string; // decimal text, integer microseconds since epoch (UTC)
  installationId: string | null;
  repo: string;
  eventType: string;
  actor: string | null;
  payloadText: string; // Postgres-normalized jsonb text — exact bytes, as exported
  plainEnglish: string;
}

/** The exact canonical bytes for a v2 row. */
export function canonicalV2(f: CanonicalFieldsV2): Buffer {
  const joined = [
    f.id,
    f.tsEpochMicros,
    f.installationId ?? "",
    f.repo,
    f.eventType,
    f.actor ?? "",
    f.payloadText,
    f.plainEnglish,
  ].join(SEPARATOR);
  return Buffer.from(joined, "utf8");
}

/** row_hash = sha256(prev || canonical), hex. Genesis rows pass prevHashHex = null. */
export function rowHashV2(prevHashHex: string | null, f: CanonicalFieldsV2): string {
  const prev = prevHashHex ? Buffer.from(prevHashHex, "hex") : Buffer.alloc(0);
  return createHash("sha256").update(prev).update(canonicalV2(f)).digest("hex");
}

// Convert an ISO-8601 UTC timestamp WITH microsecond digits (the export format:
// `YYYY-MM-DDTHH:MM:SS.UUUUUUZ`) to the integer epoch-microseconds text the
// canonical encoding uses. String arithmetic on the fractional digits — never a
// float — so the conversion is exact and portable. This is the correspondence
// check that lets a verifier confirm the human-readable timestamp and the
// hashed timestamp are the same instant.
export function isoToEpochMicros(iso: string): string {
  const m = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?Z$/.exec(iso);
  if (!m) throw new Error(`not a supported UTC ISO timestamp: ${iso}`);
  const wholeMs = Date.parse(`${m[1]}Z`); // whole-second instant, in ms (fraction .000)
  if (Number.isNaN(wholeMs)) throw new Error(`unparseable timestamp: ${iso}`);
  const micros = (m[2] ?? "").padEnd(6, "0"); // fractional seconds as 6 digits
  // BigInt end-to-end: exact for any date, no float arithmetic anywhere.
  return (BigInt(wholeMs) * 1000n + BigInt(micros)).toString();
}
