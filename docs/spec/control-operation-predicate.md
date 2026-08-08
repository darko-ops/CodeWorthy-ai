# The Control-Operation Predicate

`https://codeworthy.ai/attestation/control-operation/v1`

*An in-toto (ITE-6) predicate type for attesting that change-management
controls operated over a period of software changes. The in-toto ecosystem
attests provenance — "this artifact was built by this process." This predicate
attests operation — "these controls ran over these changes, and here is the
verifiable record." Versioned; changes follow the same additive-only policy as
[`canonical-encoding.md`](canonical-encoding.md) §5.*

## Statement shape

Standard ITE-6:

```json
{
  "_type": "https://in-toto.io/Statement/v1",
  "subject": [
    { "name": "manifest.json",  "digest": { "sha256": "…" } },
    { "name": "events.jsonl",   "digest": { "sha256": "…" } },
    { "name": "chain-binding.json", "digest": { "sha256": "…" } }
    // …every file of the evidence package
  ],
  "predicateType": "https://codeworthy.ai/attestation/control-operation/v1",
  "predicate": { … }
}
```

The **subject is the evidence package** (every file, including the manifest —
so the signature transitively covers each file twice: directly, and via the
manifest's own hash list).

## Predicate fields (v1)

| Field | Type | Meaning |
|---|---|---|
| `format` | string | evidence-package format (`codeworthy-evidence/1`) |
| `generator` | string | exporting software |
| `period` | `{from, to}` | ISO instants; `from` inclusive, `to` exclusive |
| `repos` | string[] | the subject repositories of the derived views |
| `rowCount` | number | chained events in the segment |
| `chain` | `{first_seq, last_seq, closing_row_hash}` | the segment boundary |
| `canonVersions` | number[] | canonical-encoding versions present |
| `exceptionCounts` | object | `exception.*` event counts by type |
| `anchorsIncluded` | number | write-once anchor records covering the segment |
| `signedAt` | ISO string | signing time — the one intentionally non-reproducible field of the artifact |
| `claim` | string | the semantic limit, verbatim (below) |

## What the signature means — and does not

> The signer exported exactly these bytes as the change-control evidence for
> the stated period. **The signature adds exporter identity and time, not
> truth.** Control conclusions come from verification of the content
> (`codeworthy-verify`), which recomputes every claim; a perfectly signed
> package can still fail verification, and an unsigned package can still pass.

This is the same separation as the rest of the system: facts are recomputable;
identity and time are attested; nothing generated or asserted is laundered
into a fact by being signed.

## Envelope and keys

- Envelope: **DSSE** (`application/vnd.in-toto+json` payload), file
  `attestation.json` beside the package files. It is not listed in
  `manifest.json` — it signs the manifest, so listing it would be circular.
- Signature: **Ed25519** (`node:crypto`), keyid = first 16 hex chars of the
  sha256 of the public key's SPKI DER.
- Key distribution: the public key is **published by the operator**
  (docs site, security.txt, auditor portal) and must reach the verifier
  independently of any package. `codeworthy-verify report --pubkey key.pem`.
- **Sigstore upgrade path**: keyless signing (Fulcio certificate binding an
  OIDC identity) and Rekor transparency logging use this same DSSE envelope —
  a deployment upgrade, not a format change. When adopted, verification adds
  a log-inclusion check under `--live`.

## Verifier obligations

1. Reject payload types and predicate types it does not implement.
2. Check every subject digest against the package bytes in hand — a valid
   signature over *different* bytes is a finding, not a pass ("the package in
   hand is not the package that was signed").
3. Check every package file is covered by a subject (nothing rides uncovered).
4. Digest bindings are checked even with no key supplied; only the signature
   check may skip, and it must say the key was absent.
5. Never let attestation status alter any content check's result.

## Control mapping (for the OSCAL emitter)

Verifier checks map to SOC 2 (2017 TSC) CC8.1 aspects; the table ships in
`verifier/src/oscal.mjs` and may be extended per engagement (e.g. ISO/IEC
27001:2022 A.8.32 Change management). The OSCAL emitter is deliberately thin:
every observation restates a verifier check; it introduces no judgment of its
own.
