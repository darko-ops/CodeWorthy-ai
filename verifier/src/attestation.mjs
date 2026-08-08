// Attestation verification (V4) — DSSE envelope over an in-toto ITE-6
// statement, Ed25519, stdlib only.
//
// What a valid attestation adds: EXPORTER IDENTITY AND TIME. It does not add
// truth — the content checks (chain, completeness, controls) stand on their
// own, and a perfectly signed package can still fail them. Conversely a
// package with no attestation can still verify; it just carries no claim of
// who exported it.
//
// The public key must come from OUTSIDE the package (a key shipped inside a
// package could vouch for anything). No key supplied → the check SKIPS and
// says why.
import { createHash, createPublicKey, verify as edVerify } from "node:crypto";

export const DSSE_PAYLOAD_TYPE = "application/vnd.in-toto+json";
export const STATEMENT_TYPE = "https://in-toto.io/Statement/v1";
export const SUPPORTED_PREDICATES = ["https://codeworthy.ai/attestation/control-operation/v1"];

const sha256 = (b) => createHash("sha256").update(b).digest("hex");

/** DSSE Pre-Authentication Encoding — must match the signer byte for byte. */
export function pae(payloadType, payload) {
  return Buffer.concat([
    Buffer.from(`DSSEv1 ${Buffer.byteLength(payloadType)} ${payloadType} ${payload.length} `, "utf8"),
    payload,
  ]);
}

/**
 * Verify attestation.json against the package files and a public key.
 * @param {Map<string, Buffer>} files - package files (may contain attestation.json)
 * @param {string|null} publicKeyPem - the independently obtained public key
 * @returns {{status: "pass"|"fail"|"skip", detail: string, findings: string[], statement?: object}}
 */
export function verifyAttestation(files, publicKeyPem) {
  const raw = files.get("attestation.json");
  if (!raw) {
    return { status: "skip", detail: "no attestation.json — the package is unsigned; content checks stand on their own", findings: [] };
  }
  let envelope;
  try { envelope = JSON.parse(raw.toString("utf8")); } catch {
    return { status: "fail", detail: "attestation.json is not valid JSON", findings: [] };
  }
  if (envelope.payloadType !== DSSE_PAYLOAD_TYPE) {
    return { status: "fail", detail: `unexpected payloadType ${envelope.payloadType}`, findings: [] };
  }
  const payload = Buffer.from(envelope.payload ?? "", "base64");
  let statement;
  try { statement = JSON.parse(payload.toString("utf8")); } catch {
    return { status: "fail", detail: "attestation payload is not a JSON statement", findings: [] };
  }

  const findings = [];
  if (statement._type !== STATEMENT_TYPE) findings.push(`statement _type is ${statement._type}, expected ${STATEMENT_TYPE}`);
  if (!SUPPORTED_PREDICATES.includes(statement.predicateType)) {
    findings.push(`unsupported predicateType ${statement.predicateType} — this verifier implements: ${SUPPORTED_PREDICATES.join(", ")}`);
  }

  // Subject digests must match the package bytes — the signature is only as
  // meaningful as its binding to the files actually in hand.
  for (const s of statement.subject ?? []) {
    const buf = files.get(s.name);
    if (!buf) findings.push(`signed subject missing from package: ${s.name}`);
    else if (sha256(buf) !== s.digest?.sha256) findings.push(`signed digest mismatch: ${s.name} — the package in hand is not the package that was signed`);
  }
  for (const name of files.keys()) {
    if (name === "attestation.json") continue;
    if (!(statement.subject ?? []).some((s) => s.name === name)) findings.push(`package file not covered by the signature: ${name}`);
  }

  if (!publicKeyPem) {
    // Digest bindings need no key — a mismatch is a hard failure even unsigned.
    if (findings.length > 0) {
      return { status: "fail", detail: findings[0], findings, statement };
    }
    return {
      status: "skip",
      detail: "attestation present but no public key supplied (--pubkey) — signature NOT verified; obtain the exporter's published key independently of this package",
      findings,
      statement,
    };
  }

  let sigOk = false;
  try {
    const key = createPublicKey(publicKeyPem);
    sigOk = (envelope.signatures ?? []).some((s) => edVerify(null, pae(DSSE_PAYLOAD_TYPE, payload), key, Buffer.from(s.sig ?? "", "base64")));
  } catch (err) {
    return { status: "fail", detail: `public key unusable: ${err instanceof Error ? err.message : err}`, findings, statement };
  }
  if (!sigOk) findings.push("no signature in the envelope verifies under the supplied public key");

  const failed = findings.length > 0;
  return {
    status: failed ? "fail" : "pass",
    detail: failed
      ? findings[0]
      : `signature valid (keyid ${envelope.signatures?.[0]?.keyid ?? "?"}); every file matches its signed digest; signed at ${statement.predicate?.signedAt ?? "unknown"}. Identity and time only — content conclusions come from the other checks.`,
    findings,
    statement,
  };
}
