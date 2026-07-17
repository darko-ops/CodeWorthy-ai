# CodeWorthy — MVP Architecture

CodeWorthy's product is the orchestrated engineering simulation and the evidence-backed assessment it produces. The candidate-facing window is a guide through that simulation, not the product itself. Every design decision below serves one goal: **produce competency claims an experienced engineering manager will trust because each one is traceable to an inspectable fact.**

## Delivery

No desktop app for the MVP. The candidate works in a browser mission-control view, a private GitHub repository, and their own editor and terminal. A CodeWorthy GitHub App orchestrates the repository and listens for events. Sequencing:

1. Responsive web companion (mission control)
2. GitHub App for orchestration and event capture
3. GitHub itself as the work surface
4. `npx codeworthy` only where local verification is genuinely needed
5. Desktop companion only if candidates demonstrably want it

## Principle 1 — Verification is the product, not detection

Detecting that a commit exists is trivial and worthless. Verifying that the committed test actually reproduces the bug is the entire value of the assessment.

**The red/green baseline check is the centerpiece** — the one automated signal that is both cheap to compute and genuinely meaningful. It is built first and built well (`evaluation/baseline-check/`). It is worth more than every other checklist row combined.

The mechanic:

1. Extract the candidate's added/modified test files from their branch.
2. Apply those test files on top of the **pristine baseline commit** — not the candidate's source changes.
3. Run them. They **must fail** there, on the assertion tied to the seeded bug. A test that passes against the buggy baseline is test theater.
4. Apply the candidate's full branch. Run the same tests. They **must pass**.
5. Record: baseline-fail yes/no, branch-pass yes/no, which assertions fired. That record is the evidence line the employer sees.

Only baseline-fail **and** branch-pass earns the regression-testing signal. Everything else in the testing competency is refinement on top of this gate.

## Principle 2 — The UI never implies auto-verification on judgment rows

The MVP manually reviews every submission, and manual review is not real time. Every checklist row is classified into one of two verification modes, displayed differently:

**Live-automated** (deterministic GitHub events / checks — these tick green as the candidate works):
repository invitation accepted · non-default branch pushed · red phase (test fails on baseline) · required checks green · PR created · upstream commit incorporated with checks still green.

**Submitted-pending-review** (judgment — displayed as "Submitted — pending review," never as a green auto-verified check):
clarified requirements · root-cause note correctness · review-response quality · handoff completeness · defense.

Three honest states: **Completed** (the action occurred), **Verified** (a deterministic check proves it, or a reviewer assigned it during review), **Needs attention**. A row may show "Verified" in real time only when a deterministic check backs it.

## Principle 3 — Un-verifiable artifacts are self-reported context; the defense tests them

Five rows cannot be proven by GitHub events: get it running, reproduce the bug, read the CI output, understand the repo, use AI responsibly. Artifacts for these (a reproduction command, a root-cause note, terminal output) are **a candidate's claim, not a verified fact** — a screenshot proves nothing a determined faker can't fabricate.

The rule: **no un-verifiable artifact stands on its own; each must be corroborated by a defense question generated from that specific artifact.**

- Submitted a reproduction command → defense asks what it exercises and what the failing output means.
- Claimed a root cause → defense asks them to show how their test fails against the original code.
- Used AI heavily → defense asks which parts the model produced and why a given construct is safe. Inability to explain the submission is the signal — never the fact that AI was used.

This resolves "use AI responsibly" cleanly: the platform never detects or accuses; it measures whether the candidate remained in control, entirely by whether they can explain, justify, and defend what they submitted.

## Principle 4 — The simulated reviewer is minimal, scripted, and scored by a human

Response *presence* is a GitHub event (live-automated). Response *quality* is a judgment call (pending review). And canned comments read as canned by the second candidate.

For the MVP: **one required thread, at most two.** The required thread forces a real tradeoff — the reviewer suggests a Redis-based lock, and a strong candidate pushes back on lock-expiration and durability risks and argues for the database constraint. That single thread separates pattern-matchers from candidates who reason about failure modes. An optional second thread (correctness probe or contract concern) is chosen per-diff. Scripts: `evaluation/proctor-playbook.md`.

The **defense carries the anti-gaming weight**, not the review thread: a circulated "right answer" to the review comment is worthless when the defense asks the candidate to justify it against a variant of the tradeoff.

## Principle 5 — Hidden-test isolation, provisioning, teardown

Leaked hidden tests are a solved assessment; this is the piece that can sink the product.

**Hidden tests never live in the candidate's repository.** The candidate repo contains only the application, visible tests, and the CI that runs them (`evaluation/candidate-repo/ci.yml`). Hidden tests live in this private platform repo, which candidates never access.

The evaluation flow:

1. The candidate's PR only *signals* readiness — its workflow contains no evaluation logic worth stealing.
2. Evaluation runs in a CodeWorthy-controlled context (controlled runner / private repo workflow), never in a workflow file the candidate can edit.
3. The evaluation environment checks out the candidate's branch **as untrusted input**: isolated, ephemeral, no secrets, no credentials for the hidden-test repo, no network path to exfiltrate. Hidden-test checkout happens *after and separate from* any execution of candidate-controlled code (candidate code can read the filesystem — so the hidden tests must not be on it while candidate code runs; in practice: overlay hidden specs, run, destroy the environment).
4. Only a **structured pass/fail summary** ever leaves the environment (`evaluation/hidden-tests/run.sh --summary`) — never test source, never verbatim assertions, never stack traces that reveal internals. The candidate-facing UI shows "concurrency check: not covered," not the test that produced it.

Provisioning: each candidate gets a private repo stamped from the template with a scoped installation token limited to that repo. Candidates cannot see each other's repos, the hidden-test repo, or template internals. After the window closes: candidate repo archived (evidence trail), access revoked, ephemeral environments torn down.

## Scoring output

Never a single number — "82/100, you passed" is false precision that invites optimizing the number instead of the work. A competency profile where **every rating is one-click-traceable to the evidence that produced it**; a rating that floats without evidence is the opaque-number problem again.

Two audiences, two failure modes:

- **Candidate report** — developmental language ("Developing," never "Failed"), every rating backed by a specific inspectable fact about the work, never a judgment about the person. Example: *Regression testing — Developing: "Your test reproduced sequential retries but did not fail against simultaneous requests on the baseline."*
- **Employer report** — stays narrow. Reports what the candidate did, backed by evidence; claims no prediction of job performance until validation data supports it.

Internal rubric anchors (1–5, `evaluation/rubric.md`) map to candidate-facing labels: 5–4 → Strong, 3 → Developing, 2–1 → Needs work, U → Not assessed.

## Task table

| Task | Verification mode | What actually proves it |
|---|---|---|
| Open repository | Live-automated | Repository invitation accepted |
| Clarify requirements | Submitted-pending-review | Documented assumption; quality scored in review, probed in defense |
| Create branch | Live-automated | Non-default branch pushed |
| Add regression test | Live-automated (**the core check**) | Test fails on unpatched baseline AND passes on branch |
| Red phase | Live-automated | CI fails for the expected assertion on baseline |
| Implement fix | Live-automated (presence) / review (quality) | Source change pushed; correctness confirmed by hidden eval + review |
| Get CI green | Live-automated | Required checks pass on branch |
| Integrate upstream change | Live-automated | Required commit incorporated, checks still green |
| Open PR | Live-automated | Pull request created |
| Respond to review | Live-automated (presence) / review (quality) | Reply exists; quality scored by human, probed in defense |
| Handoff | Submitted-pending-review | Handoff comment present; completeness scored in review |
| Defense | Submitted-pending-review | Adaptive defense evaluated against the candidate's own artifacts |

## What exists today vs. what the GitHub App automates later

| Piece | Today (manual MVP) | GitHub App target |
|---|---|---|
| Provisioning | Proctor stamps template repo by hand | App creates repo, scoped token, issue, checklist |
| Red/green baseline check | `evaluation/baseline-check/` run by grader | Triggered on PR events, result posted to mission control |
| Hidden evaluation | `evaluation/hidden-tests/run.sh --summary` on a grading machine | Controlled runner, untrusted-input isolation as above |
| Reviewer thread | Proctor posts as "Sam" | App posts; human still scores quality |
| Upstream change | Proctor applies `evaluation/upstream-change/` | App merges on schedule |
| Checklist | Proctor's stage log | Live-automated rows tick from webhook events |
