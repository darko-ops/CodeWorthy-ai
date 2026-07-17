# Red/Green Baseline Check

The core automated verification (docs/mvp-architecture.md, Principle 1): a
candidate's regression test earns the testing signal only if it **fails on the
pristine baseline** (it genuinely detects the seeded bug) **and passes on their
branch** (their fix resolves it). A test that passes on the buggy baseline is
test theater; this check catches it mechanically.

## Usage

Run against a candidate repository (simulation contents at the repo root,
`npm install` already run):

```bash
node evaluation/baseline-check/baseline-check.mjs \
  --repo /path/to/candidate-repo \
  --baseline main \
  --branch fix/acme-1287 \
  --db-server postgres://acme@localhost:5432 \
  --out record.json
```

Exit code 0 only for `genuine-regression-test`. The JSON record is the
evidence line for the report's testing row:

```json
{
  "changedTestFiles": ["test/acme-1287-regression.test.ts"],
  "baseline": { "mustFail": true, "failed": true, "failures": [ ... ] },
  "branch":   { "mustPass": true, "passed": true, "failures": [] },
  "verdict":  "genuine-regression-test"
}
```

Verdicts:

| Verdict | Meaning |
|---|---|
| `genuine-regression-test` | Fails on baseline, passes on branch — the signal |
| `test-theater` | Passes on the buggy baseline: the test does not catch the bug |
| `broken-on-branch` | Detects the bug but their fix doesn't make it pass |
| `no-test-changes` | Candidate changed no test files |

## Mechanics

- Only the candidate's **test-file changes** are overlaid onto the baseline
  worktree — never their source changes (that would erase the bug being
  tested). Helper changes under `test/` (e.g. the harness CASCADE repair) are
  included, since candidate tests legitimately depend on them.
- Each run uses two disposable databases created on `--db-server` and dropped
  afterward, so baseline and branch schemas never contaminate each other.
- `node_modules` is symlinked from the candidate repo into the temporary
  worktrees; if the candidate added dependencies, run `npm install` in their
  repo first.
- The record (including failure messages) is **grader-facing**. The
  candidate-facing surface shows only the verdict.
