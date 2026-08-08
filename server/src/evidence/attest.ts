// Attestation (V4 of docs/validator-build-plan.md) — the evidence package
// wrapped in standards instead of a bespoke envelope:
//
//   - The statement is in-toto ITE-6: subject = the package's files and their
//     sha256 digests; predicateType = CodeWorthy's control-operation predicate
//     (docs/spec/control-operation-predicate.md) — the unclaimed predicate in
//     the in-toto ecosystem: not "this artifact was built by this process" but
//     "these controls operated over these changes."
//   - The envelope is DSSE (the in-toto standard), signed with Ed25519 from
//     node:crypto — the "published public key" tier. Sigstore keyless + Rekor
//     transparency logging slot into this same envelope later (same payload,
//     different signer); they are a deployment upgrade, not a format change.
//
// The attestation file sits BESIDE the package files (attestation.json). It is
// deliberately not listed in manifest.json — it signs the manifest (via the
// subject digests), so including it would be circular. The verifier knows this.
//
// Time: the package itself is byte-reproducible with no timestamps; the signed
// wrapper is where a timestamp belongs (V2's rule), so signedAt lives in the
// predicate and the signing time is the one intentionally non-reproducible
// field of the whole artifact.
import { createHash, generateKeyPairSync, sign as edSign, createPrivateKey, createPublicKey } from "node:crypto";
import type { EvidencePackage } from "./package.js";

export const STATEMENT_TYPE = "https://in-toto.io/Statement/v1";
export const PREDICATE_TYPE = "https://codeworthy.ai/attestation/control-operation/v1";
export const DSSE_PAYLOAD_TYPE = "application/vnd.in-toto+json";

export interface InTotoStatement {
  _type: string;
  subject: Array<{ name: string; digest: { sha256: string } }>;
  predicateType: string;
  predicate: Record<string, unknown>;
}

export interface DsseEnvelope {
  payloadType: string;
  payload: string; // base64(statement JSON)
  signatures: Array<{ keyid: string; sig: string }>;
}

const sha256hex = (b: Buffer) => createHash("sha256").update(b).digest("hex");

/** The ITE-6 statement for a package. Deterministic except predicate.signedAt. */
export function buildStatement(pkg: EvidencePackage, opts: { now?: () => Date } = {}): InTotoStatement {
  const m = pkg.manifest as Record<string, any>;
  const subject = [...pkg.files.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([name, content]) => ({ name, digest: { sha256: sha256hex(content) } }));

  const exceptionCounts: Record<string, number> = {};
  for (const [type, n] of Object.entries((m.event_counts ?? {}) as Record<string, number>)) {
    if (type.startsWith("exception.")) exceptionCounts[type] = n;
  }

  return {
    _type: STATEMENT_TYPE,
    subject,
    predicateType: PREDICATE_TYPE,
    predicate: {
      format: m.format,
      generator: m.generator,
      period: m.period,
      repos: m.repos,
      rowCount: m.row_count,
      chain: m.chain,
      canonVersions: m.canon_versions,
      exceptionCounts,
      anchorsIncluded: m.anchors_included,
      signedAt: (opts.now ?? (() => new Date()))().toISOString(),
      // What this attestation MEANS (also stated in the predicate spec): the
      // signer attests that these bytes are the evidence package it exported —
      // nothing more. Control conclusions come from verification, not from
      // this signature.
      claim: "The signer exported exactly these bytes as the change-control evidence for the stated period. Verify their content with codeworthy-verify; this signature adds exporter identity and time, not truth.",
    },
  };
}

// DSSE Pre-Authentication Encoding: "DSSEv1" SP len(type) SP type SP len(body) SP body.
export function pae(payloadType: string, payload: Buffer): Buffer {
  return Buffer.concat([
    Buffer.from(`DSSEv1 ${Buffer.byteLength(payloadType)} ${payloadType} ${payload.length} `, "utf8"),
    payload,
  ]);
}

/** Stable key id: sha256 of the public key's DER (SPKI), first 16 hex chars. */
export function keyIdOf(publicKeyPem: string): string {
  const der = createPublicKey(publicKeyPem).export({ type: "spki", format: "der" }) as Buffer;
  return sha256hex(der).slice(0, 16);
}

export function signStatement(statement: InTotoStatement, privateKeyPem: string): DsseEnvelope {
  const key = createPrivateKey(privateKeyPem);
  const publicPem = createPublicKey(key).export({ type: "spki", format: "pem" }).toString();
  const payload = Buffer.from(JSON.stringify(statement), "utf8");
  const sig = edSign(null, pae(DSSE_PAYLOAD_TYPE, payload), key); // Ed25519: algorithm inferred
  return {
    payloadType: DSSE_PAYLOAD_TYPE,
    payload: payload.toString("base64"),
    signatures: [{ keyid: keyIdOf(publicPem), sig: sig.toString("base64") }],
  };
}

/** Generate an Ed25519 keypair (PEM). The public key is what gets published. */
export function generateAttestationKeypair(): { privateKeyPem: string; publicKeyPem: string; keyid: string } {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
  return { privateKeyPem, publicKeyPem, keyid: keyIdOf(publicKeyPem) };
}

// npm run attest:keygen — prints a keypair. Store the private key as the
// operator secret (STEWARD_ATTEST_KEY or STEWARD_ATTEST_KEY_FILE); publish the
// public key wherever your auditors can fetch it independently of any package.
async function main() {
  const { privateKeyPem, publicKeyPem, keyid } = generateAttestationKeypair();
  console.log(`# keyid: ${keyid}`);
  console.log(`# PRIVATE key — operator secret (STEWARD_ATTEST_KEY). Never ship it.\n${privateKeyPem}`);
  console.log(`# PUBLIC key — publish this (docs site, security.txt, auditor portal).\n${publicKeyPem}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(err); process.exit(1); });
}
