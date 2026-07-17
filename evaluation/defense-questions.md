# Technical Defense — Question Bank (ACME-1287)

The defense happens after submission. Questions must be **generated from the candidate's actual diff, tests, terminal history, and PR text** — the bank below provides base questions and adaptive follow-ups. Five questions is the target; stop early if understanding is unambiguous either way.

The defense tests understanding. It never tries to detect *whether* AI was used — AI use is allowed.

## Base questions (always applicable)

1. **Explain why the duplicate order occurred.** Walk me through the two requests in the ticket's log excerpt — why did the second one create an order despite carrying the same idempotency key?
   - *Listen for:* the map is written only after payment capture; the retry arrived inside that window. Bonus: per-process scope, replicas.
2. **Show me how your regression test fails against the original code.** (Have them run it on `main`.)
   - *Listen for:* they've actually done this; a test that passes on baseline is the single biggest red flag.
3. **What happens if two identical requests arrive at the same moment with your fix in place?** Trace it through the database.
   - *Listen for:* unique constraint / conflict handling; who wins, what the loser returns.
4. **Which parts of this change did an AI tool write, and what did you change or verify before keeping them?**
   - *Listen for:* specificity. "I asked it for X, it produced Y, I rejected Z because…" scores well; "it looked right" does not.
5. **You're deploying this Friday afternoon. Walk me through the release — and the rollback if duplicate charges spike anyway.**
   - *Listen for:* migration ordering vs. the two replicas, what metric they watch, that an additive migration can remain during an app rollback.

## Adaptive follow-ups (pick based on the diff)

- Their fix uses a new table: **"Why a database constraint instead of writing the in-memory map earlier?"** and **"What is the retention story for idempotency keys?"**
- Their fix uses `SELECT` then `INSERT`: **"What happens between your select and your insert?"**
- Their fix wraps payment capture in the DB transaction: **"What happens to the database connection when PayFlow takes 4 seconds? What if the process dies after capture but before commit?"**
- They return 409 on replay: **"The Northfield integration retries on any non-2xx. What does your 409 make it do?"**
- They disabled or changed the client retry in `web/src/api.ts`: **"Incident 2 came from a server-to-server integration you don't control. How does your change help them?"**
- They added a unique index on `(customer_id, total_cents)` or similar: **"A customer legitimately places the same order twice on purpose. What happens?"**
- Their test uses `setTimeout` sleeps: **"What makes this test deterministic? When would it flake?"**
- Zero AI usage disclosed but the diff style suggests otherwise: do **not** accuse; ask question 4 verbatim and score on the explanation quality alone.
- They hit the harness tripwire (TRUNCATE/FK failure): **"When the rest of the suite went red after your migration — walk me through how you decided whether that was your bug or the tests' bug."**
- They integrated the upstream change: **"Sam's commit raised the cache cap. Where is that cap in the code you shipped?"** (*Listen for:* "gone — my fix removes the cache, and I said so" or a coherent reason it survived.)
- They answered Sam's Redis comment: **"Suppose we did use Redis with a 30-second TTL. Reconstruct the 2026-07-09 incident — what happens?"**

## Scoring the defense

Map answers onto the rubric's *Root-cause analysis*, *AI collaboration*, *Systems thinking*, and *Deployment judgment* rows. Quote answers verbatim in the report as evidence. A candidate who says "I don't know, I'd have to check X" is scored better than one who confabulates.
