# codeworthy-verify

Standalone verifier for CodeWorthy evidence packages. Run it with the vendor
switched off — that is the point.

```bash
codeworthy-verify report ./evidence-acme-app-2026H1          # a directory…
codeworthy-verify report ./evidence-acme-app-2026H1.tar.gz   # …or the tarball
codeworthy-verify report ./pkg --json                        # machine-readable
```

Exit codes: `0` verified clean · `2` verification **failed** (the evidence is
inconsistent with itself — tampering, corruption, or self-contradiction) ·
`3` verified, **with findings** an auditor must look at (declared exceptions,
coverage limits, reconciliation discrepancies).

## What it checks — all recomputed, nothing trusted

1. **Package integrity** — every file matches its sha256 in `manifest.json`;
   unknown format versions are refused, never skipped.
2. **Chain** — every event's hash is recomputed from its raw fields per the
   published byte contract (`docs/spec/canonical-encoding.md`) and walked as a
   chain from the stated opening to the stated closing head. Any edit, removal,
   or reorder fails at the first broken row.
3. **Anchors** — anchored (seq, hash) pairs must match the *recomputed* chain.
   The package's copy proves consistency only; fetch the records from the
   write-once store for full assurance.
4. **Completeness** — the completeness attestations are recomputed from the
   reconciliation events themselves (never from the convenience views);
   unattested repos, declared discrepancies, coverage gaps, and truncated
   enumerations are all surfaced.
5. **Control operation** — over the whole merge population, from deterministic
   events only: approvals present and pre-merge, self-approvals enumerated,
   red-check merges must carry their exception event, gate overrides must
   carry reasons, evidence gaps surfaced.

AI-generated events (`llm.*`) are checked for provenance labels and for
nothing else — they carry no weight in any conclusion.

## Design constraints

- **Zero runtime dependencies.** Node ≥ 20, stdlib only. Short enough to read
  before you trust it — please do.
- **Never imports the exporter's code.** Its only contract with the recording
  system is the published canonical-encoding spec and its test vectors.
- **Deterministic.** Same package bytes, same report.
