# Reference Solution (maintainers only)

`fix.patch` is a verified reference fix for ACME-1287, kept so maintainers can
confirm the hidden suite passes for a correct solution. It is **one** correct
shape, not the only one — grade against the rubric, not against this diff.

## Root cause

`OrderService` keeps idempotency keys in a **per-process in-memory Map**, and
writes the key only **after** the order is committed and payment captured.
Two consequences, matching the two incidents in the ticket:

1. **In-flight retry (incident 1):** a client that times out and retries while
   the original request is still processing passes the Map check — the key
   hasn't been written yet. Both requests create an order and capture payment.
2. **Cross-replica retry (incident 2):** production runs two replicas; a retry
   that lands on the other process sees an empty Map. Restarts/deploys wipe it
   too, and the 5,000-entry cap clears it under load.

The sequential visible test passes because a completed first request does
populate the Map — which is why support "could not reproduce it locally."

## Reference fix

- Migration `0004_idempotency_keys.sql`: a keyed table with `key text PRIMARY KEY`
  and a nullable `order_id`. Additive and backwards compatible — the previous
  release simply never writes to it.
- In `createOrder`, inside the same transaction as the order insert:
  `INSERT INTO idempotency_keys (key) ... ON CONFLICT DO NOTHING`. If no row was
  inserted, another request owns the key: roll back, read its `order_id`
  (Postgres blocks the conflicting insert until the owner commits, so this is
  race-free), and replay that order with `200`. Otherwise create the order and
  stamp `order_id` on the claim row before commit.
- Validation failures roll the claim back, so a failed checkout doesn't burn
  its key. The in-memory Map is deleted.
- **The recovery tripwire (Stage 6):** the new table's FK to `orders` breaks the
  test harness's plain `TRUNCATE order_items, orders` — every existing orders
  test fails with `cannot truncate a table referenced in a foreign key
  constraint` while the candidate's targeted test passes. This is seeded on
  purpose (see `evaluation/proctor-playbook.md`). The reference fix resolves it
  with `TRUNCATE ... CASCADE` in `test/helpers/testDb.ts`; adding the table to
  the truncate list is equally valid.

Known acceptable variations: returning `409` for a concurrent in-flight
duplicate; storing a response snapshot on the key row; advisory locks.
Follow-up a strong candidate mentions but need not implement: retention/cleanup
for old key rows.

## Verifying

Patch paths are relative to the simulation, so in **this monorepo** apply with
`--directory` from the repo root (running `git apply` inside the subdirectory
silently ignores every hunk — paths resolve against the repo root):

```bash
git apply --directory=simulations/acme-orders evaluation/reference-solution/fix.patch
(cd simulations/acme-orders && npm test)   # visible suite: green
evaluation/hidden-tests/run.sh             # hidden suite: green
git checkout -- simulations/acme-orders
rm simulations/acme-orders/db/migrations/0004_idempotency_keys.sql
```

In a **candidate repo** (simulation contents at the root) a plain
`git apply fix.patch` works.

## Deployment plan (what a 5/5 answer looks like)

1. Run the migration (additive, no locks on existing tables).
2. Roll out the app across both replicas; during the window, old-code replicas
   behave no worse than today.
3. Watch: duplicate-order rate (same key → >1 order should go to zero),
   checkout error rate, p99 latency (one extra insert per checkout).
4. Rollback: revert the app deploy. The table stays — the old release ignores
   it. No data rollback needed.
