# Grading Workflow (manual, MVP phase)

Every submission is human-reviewed. Budget ~45 minutes per candidate.

Grading starts **after** the live loop — provisioning, the red-phase check, the
upstream merge, and Sam's review comments all happen during the assessment and
are covered by `evaluation/proctor-playbook.md`. Bring the proctor's stage log
(timestamps, workflow events) into grading; it fills the report's
"Workflow events" table.

## 0. Setup

```bash
# fresh disposable database
docker compose -f simulations/acme-orders/docker-compose.yml up -d db
cd simulations/acme-orders && npm install
```

Check out the candidate's branch **into `simulations/acme-orders`** (their assessment repo is a copy of that directory).

## 1. Mechanical checks (10 min)

One command runs the whole automated half — the red/green baseline check and
the sanitized hidden-suite summary — against the candidate's clone, and writes a
consolidated `grading-record.json`:

```bash
scripts/grade-submission.sh --repo <candidate-clone> \
  --scenario acme-orders --branch <their-branch> \
  --db-server postgres://acme:acme@localhost:5432
```

(For the wrong-merge scenario pass `--scenario wrong-merge`; the merge-commit
baseline is derived automatically.) The record's `automatedSummary` reports the
baseline-check verdict and hidden pass/fail — it scores **none** of the
human-judgment competencies and makes no hiring recommendation.

Only verdict `genuine-regression-test` earns the regression-testing signal;
`test-theater` (passes on the buggy baseline) is recorded verbatim in the
report. Attach `grading-record.json` to the report's evidence, and confirm the
visible suite and typecheck are green on their branch (`npm test`,
`npm run typecheck`).

The underlying tools remain runnable directly when you want to inspect a step:
`evaluation/hidden-tests/run.sh <repo> [--summary]` (or the wrong-merge runner)
and `evaluation/baseline-check/baseline-check.mjs`.

## 2. Read the work (15 min)

- Diff: focused? conventions respected? did they avoid the legacy landmines the repo warns about?
- Migration (if any): additive? compatible with the running release? retention story?
- PR text: is the root cause *explained with evidence* (the log excerpt shows the overlap) or just asserted?
- Commits: coherent story vs. one giant blob.

## 3. Technical defense (15 min)

Run the defense per `evaluation/defense-questions.md` — five questions, generated from their actual diff. Record answers verbatim where possible.

## 4. Write the report (5 min)

Fill in `evaluation/report-template.md`. Rules:

- Every rating cites inspectable evidence.
- Unfinished ≠ 1/5 — mark **U** (unassessed).
- The summary never claims more than the evidence supports.
- Send the candidate their copy the same day.

## Calibration notes

After each batch of five, compare reports side by side: do rating differences correspond to differences an engineering manager would care about? Adjust rubric anchors, not scores, when calibration drifts. Keep every graded artifact — this corpus is what eventually trains automated evaluation.
