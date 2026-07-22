# CodeWorthy Assessment — Acme Orders (The Wrong Merge)

Welcome. You've joined the (fictional) Acme Wholesale team, and you're picking up
after someone else's mistake. This is a realistic inherited codebase with real
history: a feature was merged last week, CI stayed green, and things quietly
broke anyway. Your job is to figure out what, put it right, and make sure it
can't happen the same way again.

## Your assignment

Work the ticket in [TICKET.md](TICKET.md): since the `feature/order-export`
merge, the duplicate-charge monitor has flatlined and a partner read another
company's orders. Both trace to that merge.

1. **Audit the merge.** Determine what it changed relative to `main` — the
   history is intact; use it. The ticket names two symptoms, but assume the
   merge may have changed more than it reported.
2. **Repair the regressions** — restore what was lost **without losing the
   export feature.** Reverting the merge and calling it done is not a valid fix.
3. **Write tests** that fail on the current code and pass with your repair, for
   each behavior you restore.
4. **Open a pull request** using the repository's PR template. Explain what the
   merge deleted, how you found it, why green CI didn't catch it, and what now
   prevents a recurrence.
5. Afterwards, you'll answer a handful of questions about your repair (a short
   technical defense).

## Ground rules

- **Time:** the timebox for this assessment is **2 hours**. If you run out of
  time, submit what you have and note in the PR what you'd do next — an honest
  "here's what's missing" is evaluated far better than silence.
- **AI tools are allowed and expected.** Use Claude, Cursor, Codex, ChatGPT,
  docs, search — whatever you normally work with. You remain responsible for
  every line you submit and will be asked to explain it.
- **Stay focused.** Repair the regressions and keep the feature; don't refactor
  unrelated code. The repo has warts — some are load-bearing.
- **Keep the existing test suite green** (`npm test`) — and remember that green
  was exactly what let this ship.

## What we evaluate

You are scored on a competency profile, not a single number:

- How you investigate a merge — whether you diff it systematically against each
  parent, or just grep for the two symptoms the ticket handed you
- Whether you find everything the merge changed, including anything the ticket
  doesn't mention
- Correctness of the repair, and whether the export feature survives it
- Whether your tests would actually catch this class of loss coming back
- Git judgment: repairing without damaging history or the feature
- How you explain *why CI was green through the deletion* — and what you'd change
- How you used AI: guiding it, checking it, and owning the result

We do **not** penalize AI use, and we do not use webcam monitoring, keystroke
analysis, or "AI detection." Your work and your explanation of it are the whole
signal.

## Submitting

- Commit on a branch, open a PR against `main`, and fill in every section of the
  PR template.
- Note in the PR which parts were AI-assisted and how you verified them.

Good luck — and keep the real question in view: *would a team trust this repair,
and trust you not to let the next merge do the same thing?*
