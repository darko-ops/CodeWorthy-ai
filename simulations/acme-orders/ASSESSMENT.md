# CodeWorthy Assessment — Acme Orders

Welcome. You've just joined the (fictional) Acme Wholesale team. This is a realistic inherited codebase: it has history, conventions, legacy corners, and one production problem that needs an owner. That owner is you.

## Your assignment

Work the ticket in [TICKET.md](TICKET.md): customers occasionally receive **duplicate orders and duplicate charges** when a checkout request is retried.

1. **Reproduce** the problem (or demonstrate convincingly why it happens).
2. **Identify the root cause** — write it down before you fix it.
3. **Write a regression test** that fails on the current code and passes with your fix.
4. **Implement a focused fix.**
5. **Open a pull request** using the repository's PR template, including your deployment and rollback plan.
6. Afterwards, you'll answer a handful of questions about your change (a short technical defense).

## Ground rules

- **Time:** aim for **90 minutes**. If you run out of time, submit what you have and note in the PR what you'd do next — an honest "here's what's missing" is evaluated far better than silence.
- **AI tools are allowed and expected.** Use Claude, Cursor, Codex, ChatGPT, docs, search — whatever you normally work with. You remain responsible for every line you submit and will be asked to explain it.
- **Stay focused.** Fix the ticket; don't refactor unrelated code. The repo has warts — some are load-bearing.
- **Keep the existing test suite green** (`npm test`).
- Migrations must be **backwards compatible** with the currently deployed release (see "Repository notes" in the README for how Acme deploys).

## What we evaluate

You are scored on a competency profile, not a single number:

- Investigation and root-cause analysis (not just "the symptom went away")
- Correctness of the fix **under conditions beyond the visible tests** — think about concurrency and about how Acme runs this service in production
- Whether your regression test would actually catch this bug coming back
- Data safety of any schema changes
- PR focus and communication (root cause, tradeoffs, risk)
- Deployment and rollback judgment
- How you used AI: guiding it, checking it, and owning the result

We do **not** penalize AI use, and we do not use webcam monitoring, keystroke analysis, or "AI detection." Your work and your explanation of it are the whole signal.

## Submitting

- Commit on a branch, open a PR against `main`, and fill in every section of the PR template.
- Note in the PR which parts were AI-assisted and how you verified them.

Good luck — and remember the question behind everything: *would a team trust this change in production?*
