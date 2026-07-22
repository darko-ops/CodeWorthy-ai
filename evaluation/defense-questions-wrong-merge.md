# Technical Defense — Question Bank (ACME-1490, The Wrong Merge)

The defense happens after submission. Questions must be **generated from the
candidate's actual repair** — their diff, PR, tests, and terminal/reflog history
— not floated free of them. Five questions target; stop early when understanding
is unambiguous either way.

The defense tests understanding. It never tries to detect *whether* AI was used
— AI use is allowed.

**The corroboration rule:** un-verifiable claims (how they discovered the
losses, why CI was green, which behavior was hardest to find) are self-reported
until tied to an artifact in their diff, PR, or terminal history. **No such
claim stands on its own — each must be corroborated by a defense answer
generated from that specific artifact.** A fabricated discovery story collapses
when they're asked to run the command live.

## Base questions (always)

1. **"Show me how you determined what the merge deleted."** Have them run it
   live — `git diff 8444911 9997d60 -- src/routes/orders.ts`, `git show --cc`,
   grep for orphaned importers, any real method.
   - *Listen for:* a repeatable procedure, not "I read the ticket and searched
     for the two symptoms." The strong answer diffs the merge against the main
     parent and reads the pure deletions.
2. **"Why did green CI fail to catch a deleted authorization check?"**
   - *Listen for:* the two-part answer — no visible test ever observed the
     behavior (the gap predated the merge), and the whole-file resolution
     deleted code without producing a diff any check looked at. "CI only proves
     what tests assert," in their own words. Corroborates the PR's why-green
     section.
3. **"Which lost behavior was hardest to notice was gone, and what found it?"**
   - *Listen for:* honest process. The expected answer is the flag guard —
     nothing in the ticket points at it. A candidate who claims all three were
     equally obvious gets the follow-up: *"then why does your first commit only
     restore two?"* if their history shows that.

## Adaptive follow-ups (pick by diff shape)

4. If their logging test captures stdout: **"Your test flips `LOG_IN_TESTS` and
   intercepts stdout — when does that approach break?"** If they refactored the
   logger instead: **"The logger carries an ACME-871 warning — what did you
   check before touching it?"**
5. If they restored the flag: **"`FLAG_BACKORDERS` defaults off, so your
   restored code is dead in every default environment. How did you verify it
   actually works — and who runs with it on?"** *Listen for:* the pilot
   customer, a flag-on test, the deferred-capture semantics (no stock
   decrement, `payment_capture_id` null, `status: 'backordered'`).
6. If they reverted the merge at any point (visible in reflog / history / PR):
   **"You reverted a merge commit. What does git believe about
   `feature/order-export` afterwards, and what did that force you to do?"**
   *Listen for:* awareness of the revert-of-a-merge trap (git treats the branch
   as already merged; needs a revert-of-the-revert or a rebased re-merge).
7. If their diff touches the export route: **"Should `/api/orders/export`
   require the ops key? Whose mistake is it that it doesn't?"** *Listen for:* the
   timeline — Alex branched before the auth commit existed, so the unguarded
   export is a process gap, not negligence; guarding it is a product decision to
   raise, not silently ship. (Stretch probe; a strong unprompted answer supports
   a 5 on Security/Systems.)
8. AI question, verbatim from the shared bank: **"Which parts of this change did
   an AI tool write, and what did you change or verify before keeping them?"**
   *Listen for:* specificity. "I asked it for X, it produced Y, I rejected Z
   because…" scores well; "it looked right" does not.

## Scoring the defense

Map answers onto Root-cause analysis, Git discipline & integration, Systems
thinking, Security, and AI collaboration. Quote answers verbatim in the report.
A candidate who says "I don't know, I'd check X" is scored better than one who
confabulates.
