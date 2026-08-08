// Canonical encoding v2 — implemented FROM THE SPEC (docs/spec/
// canonical-encoding.md), not from the server's code. This file is the
// verifier's independent implementation of the byte contract; the
// cross-implementation vectors in the spec are its conformance suite. It has
// no dependencies and imports nothing outside this package.
import { createHash } from "node:crypto";

export const SEPARATOR = String.fromCharCode(0x1f); // unit separator

/**
 * Exact canonical bytes for a v2 row (spec §2).
 * @param {{id:string, tsEpochMicros:string, installationId:string|null, repo:string,
 *          eventType:string, actor:string|null, payloadText:string, plainEnglish:string}} f
 */
export function canonicalV2(f) {
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

/**
 * row_hash = sha256(prev || canonical), hex (spec §1). Genesis: prevHashHex null.
 * @param {string|null} prevHashHex
 */
export function rowHashV2(prevHashHex, f) {
  const prev = prevHashHex ? Buffer.from(prevHashHex, "hex") : Buffer.alloc(0);
  return createHash("sha256").update(prev).update(canonicalV2(f)).digest("hex");
}

/**
 * The export timestamp shape (spec §2.1) to integer epoch-microseconds text,
 * by string arithmetic — floats never touch the value. Rejects anything that
 * is not the export shape.
 * @param {string} iso e.g. "2026-08-08T05:20:00.123456Z"
 */
export function isoToEpochMicros(iso) {
  const m = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?Z$/.exec(iso);
  if (!m) throw new Error(`not the export timestamp shape: ${iso}`);
  const wholeMs = Date.parse(`${m[1]}Z`);
  if (Number.isNaN(wholeMs)) throw new Error(`unparseable timestamp: ${iso}`);
  const micros = (m[2] ?? "").padEnd(6, "0");
  return (BigInt(wholeMs) * 1000n + BigInt(micros)).toString();
}
