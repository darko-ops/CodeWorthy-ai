# Canonical Encoding of Audit Events

*The byte-level contract between the recording system (Postgres trigger) and any
verifier. A verifier implements this document — not the server's code — and the
cross-implementation test vectors below are the conformance suite. Versioned;
rows are verified under the version they were written with, and a version is
never rewritten onto existing rows.*

Status: **v2 current** (rows written since migration `0003_canonical_v2.sql`);
v1 historical (rows written before it). Server implementations:
`server/db/migrations/0002_audit_hash_chain.sql` (v1),
`0003_canonical_v2.sql` (v2), TypeScript reimplementation
`server/src/audit/canonical.ts`, conformance test
`server/src/audit/canonical.test.ts`.

---

## 1. The chain

Every audit event is one row. Each row commits to its predecessor:

```
row_hash = SHA-256( prev_row_hash_bytes ‖ canonical_bytes(row) )
```

- `prev_row_hash_bytes` — the raw 32 hash bytes of the previous row by `id`
  order; the **empty byte string** for the genesis row (or the first row after
  an authorized truncation).
- Appends are serialized (Postgres advisory lock), so the chain is strictly
  linear — no forks.
- Editing any hashed field breaks that row's recomputation (**content**);
  removing or reordering rows breaks the `prev_hash` linkage (**linkage**).
  A verifier reports the first broken row and which kind.

## 2. Canonical bytes — v2

UTF-8 bytes of the following fields joined by the single byte `0x1F`
(ASCII "unit separator"), in exactly this order:

| # | Field | Encoding |
|---|---|---|
| 1 | `id` | decimal text |
| 2 | `ts` | **integer epoch-microseconds**, decimal text (see §2.1) |
| 3 | `installation_id` | decimal text; **empty string** when null |
| 4 | `repo` | as stored (`owner/name`) |
| 5 | `event_type` | as stored |
| 6 | `actor` | as stored; **empty string** when null |
| 7 | `payload` | Postgres-normalized `jsonb` text (see §2.2) |
| 8 | `plain_english` | as stored |

Null fields are coalesced to the empty string **before** joining, so the
separator count is always exactly **7**. None of the fields can contain `0x1F`
(it is a control character excluded from valid UTF-8 text fields and from
Postgres `jsonb` text output).

### 2.1 Timestamp

`ts` is a `timestamptz` with microsecond precision. Its canonical contribution
is `floor(epoch × 10⁶)` as decimal text — an exact integer conversion with no
float formatting. Evidence packages export the timestamp as
`YYYY-MM-DDTHH:MM:SS.UUUUUUZ` (UTC, six fractional digits); a verifier converts
that to epoch-microseconds by **string arithmetic** (whole-second epoch × 10⁶ +
fractional digits; never float math) and must reject any other timestamp shape.
This is the correspondence check tying the human-readable time to the hashed
time.

### 2.2 Payload

`payload` contributes as the **Postgres-normalized `jsonb` text** of the stored
value (`payload::text`): duplicate keys removed (last wins), object keys sorted
by (length, then byte order), `", "` and `": "` separators, numeric
normalization.

A verifier does **not** re-derive this normalization. The evidence package
exports the normalized text verbatim (`payload_text`), and the hash covers those
exact bytes — so a tampered `payload_text` fails the hash, making the field
self-verifying. The verifier's obligations are only:

1. use `payload_text` byte-for-byte in the canonical sequence;
2. check `payload_text` parses as JSON, and use **the parsed value** (never a
   separately-shipped convenience copy) for any control conclusion.

### 2.3 Version marking

Each row carries `canon_version` (`1` or `2`). `canon_version` is **not** part
of the canonical bytes; it selects which encoding to recompute with. A row
claiming an unknown version fails verification. (Trade-off, made explicit: the
version marker itself is not covered by this row's hash, but an attacker who
flips it only makes the row's recomputation fail — there is no version pair
under which the same stored hash verifies both ways, since v1 and v2 timestamp
encodings differ for every instant.)

## 3. Canonical bytes — v1 (historical)

Identical to v2 except field 2: `ts` contributes as
`extract(epoch from ts)::text` — Postgres `numeric` formatting of a fractional
epoch (e.g. `1723096210.123456`). v1 rows are verifiable only where that exact
text can be reproduced; in practice v1 verification recomputes via the database
function `audit_canonical(...)`, and evidence packages flag v1 rows so external
verifiers treat them as **integrity-inherited**: the v2 chain above them still
seals them (any edit to a v1 row breaks the first following v2 row's `prev`
linkage… precisely: breaks the v1 row's own stored hash and the successor
linkage), but independent byte-recomputation guarantees are v2-only.

## 4. Test vectors

The conformance suite (`canonical.test.ts`) asserts, live against both
implementations:

**Vector 1 — minimal row, nulls coalesced:**

```
fields:  id="1", ts_micros="1754630400000000", installation_id=∅,
         repo="acme/app", event_type="test.vector", actor=∅,
         payload_text="{}", plain_english="vector row"
canonical (with ␟ = 0x1F):
1␟1754630400000000␟␟acme/app␟test.vector␟␟{}␟vector row
separators: exactly 7
```

**Vector family 2 — jsonb normalization stress:** empty object, key reordering
(`{"b":1,"a":2}`), unicode text, nested arrays with mixed types, large/negative/
integer-normalized numbers, and length-then-byte key ordering. For each, the
TypeScript implementation must recompute the exact `row_hash` the database
trigger produced, chained.

**Vector 3 — timestamp arithmetic:**

```
2026-08-08T05:20:00.000001Z → 1786166400000001
2026-08-08T05:20:00.123456Z → 1786166400123456
2026-08-08T05:20:00Z        → 1786166400000000
1970-01-01T00:00:00.000000Z → 0
"2026-08-08 05:20:00"       → rejected (not the export shape)
```

**Vector 4 — mixed-version chain:** a v1 genesis row followed by v2 rows
verifies intact; editing the v1 row is detected as `content` at that row.

## 5. Change policy

- A new canonical version is **additive**: new migration, new function, trigger
  starts stamping the new version. Existing rows are never re-stamped or
  re-hashed (ratified invariant: evidence is append-only).
- Any change to this document that alters bytes for an existing version is a
  **spec violation**, not a revision.
- Verifiers must refuse packages containing versions they do not implement,
  and say so — never skip silently.
