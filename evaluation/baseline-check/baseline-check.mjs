#!/usr/bin/env node
// Red/green baseline check — the core automated verification (see
// docs/mvp-architecture.md, Principle 1).
//
// Given a candidate repository (simulation contents at the repo root):
//   1. Finds test files the candidate added or changed relative to baseline.
//   2. Overlays ONLY those test files onto the pristine baseline commit and
//      runs them there: they must FAIL (the test detects the seeded bug).
//   3. Runs the same test files on the candidate's branch: they must PASS.
//   4. Emits a JSON evidence record with the verdict.
//
// Verdicts:
//   genuine-regression-test  baseline-fail AND branch-pass
//   test-theater             test passes on the buggy baseline
//   broken-on-branch         fails on baseline but also fails on the branch
//   no-test-changes          candidate changed no test files
//
// Usage:
//   node baseline-check.mjs --repo <path> [--baseline main] [--branch HEAD]
//                           --db-server postgres://user@host:port [--out record.json]
//
// Requirements: git, psql/createdb on PATH, npm install already run in <repo>
// (node_modules is symlinked into the temporary worktrees).
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const repo = arg("repo", process.cwd());
const baselineRef = arg("baseline", "main");
const branchRef = arg("branch", "HEAD");
const dbServer = arg("db-server", process.env.CW_DB_SERVER);
const outFile = arg("out", null);

if (!dbServer) {
  console.error("--db-server (or CW_DB_SERVER) is required, e.g. postgres://acme@localhost:5432");
  process.exit(2);
}

const git = (...args) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" }).trim();
const psql = (sql) =>
  execFileSync("psql", [`${dbServer}/postgres`, "-v", "ON_ERROR_STOP=1", "-q", "-c", sql], {
    encoding: "utf8",
  });

const baselineSha = git("rev-parse", baselineRef);
const branchSha = git("rev-parse", branchRef);

// Test files added/changed by the candidate (deletions can't be overlaid).
const changedTestFiles = git(
  "diff", "--name-only", "--diff-filter=ACMR", `${baselineSha}..${branchSha}`, "--", "test"
).split("\n").filter(Boolean);
const runnableTests = changedTestFiles.filter((f) => /\.test\.ts$/.test(f));

const record = {
  baselineRef: baselineSha,
  branchRef: branchSha,
  changedTestFiles,
  runnableTests,
  baseline: null,
  branch: null,
  verdict: null,
};

function finish() {
  const json = JSON.stringify(record, null, 2);
  if (outFile) writeFileSync(outFile, json + "\n");
  console.log(json);
  process.exit(record.verdict === "genuine-regression-test" ? 0 : 1);
}

if (runnableTests.length === 0) {
  record.verdict = "no-test-changes";
  finish();
}

const scratch = mkdtempSync(join(tmpdir(), "cw-baseline-check-"));
const suffix = `${process.pid}_${Math.floor(Math.random() * 1e6)}`;
const dbs = { baseline: `cw_eval_${suffix}_base`, branch: `cw_eval_${suffix}_branch` };
const worktrees = [];

function cleanup() {
  for (const wt of worktrees) {
    spawnSync("git", ["-C", repo, "worktree", "remove", "--force", wt]);
  }
  rmSync(scratch, { recursive: true, force: true });
  for (const db of Object.values(dbs)) {
    try { psql(`DROP DATABASE IF EXISTS ${db} WITH (FORCE)`); } catch { /* best effort */ }
  }
}
process.on("exit", cleanup);

function makeWorktree(name, ref) {
  const dir = join(scratch, name);
  execFileSync("git", ["-C", repo, "worktree", "add", "--detach", dir, ref], { stdio: "ignore" });
  worktrees.push(dir);
  const modules = join(repo, "node_modules");
  const target = join(dir, "node_modules");
  if (existsSync(modules) && !existsSync(target)) symlinkSync(modules, target);
  return dir;
}

function runTests(dir, databaseUrl) {
  const resultsFile = join(dir, "vitest-results.json");
  const res = spawnSync(
    "npx",
    ["vitest", "run", ...runnableTests, "--reporter=json", `--outputFile=${resultsFile}`],
    {
      cwd: dir,
      encoding: "utf8",
      env: { ...process.env, DATABASE_URL: databaseUrl, NODE_ENV: "test", CI: "1" },
      timeout: 5 * 60 * 1000,
    }
  );
  let failures = [];
  try {
    const parsed = JSON.parse(readFileSync(resultsFile, "utf8"));
    for (const suite of parsed.testResults ?? []) {
      for (const t of suite.assertionResults ?? []) {
        if (t.status === "failed") {
          failures.push({
            test: t.fullName ?? t.title,
            message: (t.failureMessages?.[0] ?? "").split("\n")[0],
          });
        }
      }
      if (suite.status === "failed" && (suite.assertionResults ?? []).length === 0) {
        failures.push({ test: suite.name, message: "suite failed to run" });
      }
    }
  } catch {
    failures.push({ test: "(runner)", message: "could not parse vitest output" });
  }
  return { passed: res.status === 0, failures };
}

// Baseline: pristine code + ONLY the candidate's changed test files on top.
const baselineDir = makeWorktree("baseline", baselineSha);
for (const file of changedTestFiles) {
  const content = execFileSync("git", ["-C", repo, "show", `${branchSha}:${file}`]);
  mkdirSync(dirname(join(baselineDir, file)), { recursive: true });
  writeFileSync(join(baselineDir, file), content);
}

psql(`CREATE DATABASE ${dbs.baseline}`);
const baselineRun = runTests(baselineDir, `${dbServer}/${dbs.baseline}`);
record.baseline = { mustFail: true, failed: !baselineRun.passed, failures: baselineRun.failures };

// Branch: the candidate's full tree, same test files.
const branchDir = makeWorktree("branch", branchSha);
psql(`CREATE DATABASE ${dbs.branch}`);
const branchRun = runTests(branchDir, `${dbServer}/${dbs.branch}`);
record.branch = { mustPass: true, passed: branchRun.passed, failures: branchRun.failures };

record.verdict = !record.baseline.failed
  ? "test-theater"
  : record.branch.passed
    ? "genuine-regression-test"
    : "broken-on-branch";

finish();
