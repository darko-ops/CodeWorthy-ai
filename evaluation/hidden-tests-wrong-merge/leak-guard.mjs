#!/usr/bin/env node
// Permanent error-path leak guard for the wrong-merge hidden suite
// (Requirement C). A leaked hidden test is a dead assessment; a wrong verdict
// is only a dispute — so this guard BLOCKS: nothing goes candidate-facing
// unless it exits 0. Run it in CI and after ANY edit to summarize.mjs,
// run.sh, or the hidden test file.
//
// What it does: copies a clean candidate repo to scratch, injects a fault
// that forces every check to (a) THROW before its assertions run, then
// (b) TIME OUT, runs the real `run.sh --summary` pipeline against each fault
// state, and asserts the sanitized output still contains ONLY
// {check id, label, pass/fail/not-run} — no stack traces, no assertion text,
// no file paths, no error message bodies. Fault messages carry a canary
// string; if the canary (or any forbidden pattern) appears in either output
// stream, the guard fails loudly.
//
// Usage:
//   node leak-guard.mjs --repo <clean-candidate-repo> [--db <DATABASE_URL>]
import { spawnSync } from "node:child_process";
import {
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const repo = arg("repo");
const db = arg("db", process.env.DATABASE_URL);
if (!repo || !db) {
  console.error("usage: leak-guard.mjs --repo <clean-candidate-repo> --db <DATABASE_URL>");
  process.exit(2);
}

const CANARY = "SECRET_LEAK_CANARY";
const FORBIDDEN = [
  { name: "canary", re: new RegExp(CANARY) },
  { name: "stack-frame", re: /\bat .+:\d+/ },
  { name: "error-text", re: /Error[:!]/ },
  { name: "assertion", re: /AssertionError|expect\(|toBe\(/ },
  { name: "source-file", re: /\.ts\b/ },
  { name: "fs-path", re: /\/(Users|home|private|var|tmp)\// },
  { name: "node-internals", re: /node_modules|node:internal/ },
  { name: "stack-word", re: /stack trace|stacktrace/i },
];
const ALLOWED_RESULTS = new Set(["pass", "fail", "not-run"]);

const CASES = [
  {
    name: "throw",
    describe: "every check throws before its assertions run (app import explodes)",
    inject(dir) {
      const appPath = join(dir, "src", "app.ts");
      const original = readFileSync(appPath, "utf8");
      writeFileSync(
        appPath,
        `throw new Error("${CANARY}_THROW at /hidden/internal/evaluator.ts:42");\n` + original
      );
    },
  },
  {
    name: "timeout",
    describe: "every check hangs until the runner's test timeout kills it",
    inject(dir) {
      writeFileSync(
        join(dir, "src", "middleware", "requestId.ts"),
        `import type { NextFunction, Request, Response } from "express";

declare module "express-serve-static-core" {
  interface Request {
    requestId: string;
  }
}

// ${CANARY}_HANG: fault injection — middleware never calls next(), so every
// HTTP request hangs and every check times out.
export function requestId(_req: Request, _res: Response, _next: NextFunction) {}
`
      );
    },
  },
];

function scratchCopy() {
  const dir = mkdtempSync(join(tmpdir(), "cw-leak-guard-"));
  cpSync(repo, dir, {
    recursive: true,
    filter: (src) => !src.includes("node_modules") && !src.includes(`${repo}/.git`),
  });
  symlinkSync(join(repo, "node_modules"), join(dir, "node_modules"));
  return dir;
}

let failed = false;

for (const testCase of CASES) {
  const dir = scratchCopy();
  try {
    testCase.inject(dir);
    const res = spawnSync("bash", [join(here, "run.sh"), dir, "--summary"], {
      encoding: "utf8",
      env: { ...process.env, DATABASE_URL: db },
      timeout: 10 * 60 * 1000,
    });
    const stdout = res.stdout ?? "";
    const stderr = res.stderr ?? "";
    const problems = [];

    let parsed = null;
    try {
      parsed = JSON.parse(stdout);
    } catch {
      problems.push("stdout is not pure summary JSON");
    }
    if (parsed) {
      const topKeys = Object.keys(parsed).sort().join(",");
      if (topKeys !== "checks,failed,notRun,passed") {
        problems.push(`unexpected top-level keys: ${topKeys}`);
      }
      for (const check of parsed.checks ?? []) {
        const keys = Object.keys(check).sort().join(",");
        if (keys !== "id,label,result") problems.push(`unexpected check keys: ${keys}`);
        if (!ALLOWED_RESULTS.has(check.result)) {
          problems.push(`unexpected result value: ${JSON.stringify(check.result)}`);
        }
      }
      if ((parsed.checks ?? []).some((c) => c.result === "pass")) {
        problems.push("a check passed under fault injection — the fault did not reach it");
      }
    }
    for (const [stream, text] of [["stdout", stdout], ["stderr", stderr]]) {
      for (const { name, re } of FORBIDDEN) {
        if (re.test(text)) problems.push(`${stream} matches forbidden pattern [${name}]`);
      }
    }

    console.log(`=== leak-guard case: ${testCase.name} — ${testCase.describe} ===`);
    console.log(`--- raw --summary stdout ---`);
    console.log(stdout.trimEnd());
    console.log(`--- raw --summary stderr (${stderr.length} bytes) ---`);
    if (stderr.trim()) console.log(stderr.trimEnd());
    if (problems.length === 0) {
      console.log(`RESULT [${testCase.name}]: CLEAN — sanitized output only\n`);
    } else {
      failed = true;
      console.log(`RESULT [${testCase.name}]: LEAK DETECTED`);
      for (const p of problems) console.log(`  - ${p}`);
      console.log("");
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

if (failed) {
  console.error("leak-guard: BLOCKING FAILURE — do not expose this suite to any candidate-facing surface.");
  process.exit(1);
}
console.log("leak-guard: all error paths sanitized.");
