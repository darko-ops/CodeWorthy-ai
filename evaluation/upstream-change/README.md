# Upstream Teammate Change (Stage 7: Integrate)

`teammate-change.patch` is the small change a "teammate" lands on the candidate's
`main` while their PR is open. Apply it **after the candidate has pushed their
first complete implementation** (see the proctor playbook for exact timing):

```bash
# in the candidate's repo, on main
git checkout main
git apply teammate-change.patch
git commit -am "Raise idempotency cache cap after Black Friday key cycling (ACME-1298)

Also log User-Agent on request.start so support tooling can group
incidents by client (ACME-1291)."
git push origin main
```

Then comment on the candidate's PR as the teammate:

> Heads up — I just merged ACME-1298 to `main`, it touches the checkout path.
> You'll want to pick it up before this merges.

## What the change contains — and why

1. **`src/middleware/requestId.ts`** — logs `user_agent` on `request.start`.
   Unrelated to the fix. **Must survive** the candidate's rebase/merge; losing
   it means they erased a teammate's work.
2. **`src/services/orderService.ts`** — raises the in-memory idempotency cache
   cap 5000 → 20000, citing a Black Friday incident. This lands **exactly on
   the code a correct fix deletes**, so it conflicts by design — and it is
   *obsoleted* by the candidate's fix. The correct resolution is to keep their
   deletion (superseding the teammate's change) **and say so** in the PR or
   handoff, e.g. "ACME-1298's cache bump no longer applies — the cache is
   replaced by the durable `idempotency_keys` table."

## Scoring the integration

- **Strong:** rebases or merges cleanly; `user_agent` logging survives; cache-cap
  conflict resolved by superseding it *with a written explanation*; CI rerun
  and green afterward.
- **Acceptable:** merge commit instead of rebase (style is never scored); asks
  the teammate in the PR thread whether the cap bump still matters before
  resolving — that's real teamwork, answer in character and score it well.
- **Weak:** force-push that drops the `user_agent` change; keeps *both* the map
  and the table "to be safe" without being able to say why; conflict markers
  committed; never notices `main` moved (prompt once via PR comment before
  scoring this — noticing is easier on a team with chat than alone in an
  assessment).

If the candidate's fix legitimately keeps the map (e.g. as a read-through cache
over the durable table), the cap bump is *not* obsolete — accepting it cleanly
is then the correct resolution. Score the reasoning, not the specific outcome.
