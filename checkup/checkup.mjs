#!/usr/bin/env node
// CodeWorthy Repo Checkup — the deterministic health engine.
//
// Points at any git repo and produces a doctor's-checkup style report: a panel
// of "vitals" (branch health, tests, security, merge hygiene, dependencies,
// hygiene), each rated healthy / watch / at-risk, each with a plain-language
// finding and a prescription. No network, no dependencies, no LLM — just git +
// the filesystem — so it runs anywhere and every result is inspectable.
//
// Ethics (inherited from CodeWorthy doctrine): this rates a REPO's health, not
// people. No per-person ranking, no lines-of-code-as-goodness, no leaderboards.
//
// Usage:
//   node checkup/checkup.mjs --repo <path> [--json] [--html <out.html>] [--since <days>]
//
// Exit code: 0 healthy, 1 needs attention (watch), 2 at risk — so it can gate CI.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

// ── args ─────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const arg = (name, fb) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : fb; };
const has = (name) => argv.includes(`--${name}`);
const repo = arg("repo", ".");
const sinceDays = parseInt(arg("since", "30"), 10);
const asJson = has("json");
const htmlOut = arg("html", null);

if (!existsSync(join(repo, ".git"))) {
  console.error(`checkup: '${repo}' is not a git repository`);
  process.exit(2);
}

const git = (...a) => {
  try { return execFileSync("git", ["-C", repo, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); }
  catch { return ""; }
};
const gitLines = (...a) => git(...a).split("\n").filter(Boolean);

// Status levels: 3=healthy(green) 2=watch(amber) 1=at-risk(red) 0=unknown
const HEALTHY = 3, WATCH = 2, RISK = 1, UNKNOWN = 0;
const STATUS_WORD = { 3: "healthy", 2: "watch", 1: "at risk", 0: "unknown" };
const STATUS_EMOJI = { 3: "🟢", 2: "🟡", 1: "🔴", 0: "⚪" };

const trackedFiles = gitLines("ls-files");
const isSource = (f) => /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rb|java|rs|php)$/.test(f) &&
  !/node_modules|\/dist\/|\.min\./.test(f);
const isTest = (f) => /(\.|\/)(test|spec)\.|(^|\/)(tests?|__tests__)\//i.test(f);

// Resolve the repository's trunk robustly: remote HEAD first (the canonical
// answer), then local/remote main|master, then the current branch as a last
// resort. `defaultRef` is a ref that actually resolves for `git log`.
const { defaultBranch, defaultRef } = (() => {
  const originHead = git("symbolic-ref", "--short", "refs/remotes/origin/HEAD");
  if (originHead) { const b = originHead.replace(/^origin\//, ""); return { defaultBranch: b, defaultRef: git("rev-parse", "--verify", b) ? b : originHead }; }
  for (const b of ["main", "master"]) {
    if (git("rev-parse", "--verify", b)) return { defaultBranch: b, defaultRef: b };
    if (git("rev-parse", "--verify", `origin/${b}`)) return { defaultBranch: b, defaultRef: `origin/${b}` };
  }
  const cur = git("rev-parse", "--abbrev-ref", "HEAD") || "HEAD";
  return { defaultBranch: cur, defaultRef: cur };
})();

// ── vitals ────────────────────────────────────────────────────────────────────
const vitals = [];
const add = (v) => vitals.push(v);

// 1. Branch health
(() => {
  const branches = gitLines("branch", "--format=%(refname:short)");
  const now = Date.now();
  const stale = [];
  for (const b of branches) {
    if (b === defaultBranch) continue;
    const ts = parseInt(git("log", "-1", "--format=%ct", b) || "0", 10) * 1000;
    if (ts && (now - ts) / 86400000 > 45) stale.push(b);
  }
  // direct (non-merge) commits straight onto the default branch recently
  const recentDefault = gitLines("log", `--since=${sinceDays} days ago`, "--no-merges", "--format=%h", defaultRef);
  const merges = gitLines("log", `--since=${sinceDays} days ago`, "--merges", "--format=%h", defaultRef);
  const usesPRFlow = merges.length > 0;
  let status = HEALTHY;
  const findings = [];
  if (recentDefault.length > 3 && !usesPRFlow) {
    status = WATCH;
    findings.push(`${recentDefault.length} change(s) went straight onto ${defaultBranch} with no pull request in the last ${sinceDays} days — nothing reviewed them before they landed`);
  } else if (recentDefault.length > 0 && !usesPRFlow) {
    status = WATCH;
    findings.push(`work is landing directly on ${defaultBranch} rather than through pull requests`);
  }
  if (stale.length) { status = Math.min(status, WATCH); findings.push(`${stale.length} branch(es) haven't been touched in 45+ days (${stale.slice(0,3).join(", ")}${stale.length>3?"…":""})`); }
  if (!findings.length) findings.push(`${branches.length} branch(es); work flows through pull requests`);
  add({ id: "branch_health", label: "Branch health", status,
    finding: findings.join("; "),
    prescription: status === HEALTHY ? "Keep using short-lived branches and PRs." :
      `Do your work on a branch (not ${defaultBranch}) and open a pull request; delete branches once merged.`,
    evidence: { branches: branches.length, staleBranches: stale, directToDefault: recentDefault.length, mergeCommits: merges.length } });
})();

// 2. Test health
(() => {
  const sources = trackedFiles.filter(isSource);
  const tests = trackedFiles.filter(isTest);
  const hasRunner = (() => {
    const pj = join(repo, "package.json");
    if (existsSync(pj)) { try { const p = JSON.parse(readFileSync(pj, "utf8")); return !!(p.scripts && p.scripts.test); } catch {} }
    return false;
  })();
  const hasCI = existsSync(join(repo, ".github", "workflows")) &&
    readdirSync(join(repo, ".github", "workflows")).some((f) => /\.ya?ml$/.test(f));
  // recent source changes without any test change
  const recentCommits = gitLines("log", `--since=${sinceDays} days ago`, "--format=%H", defaultRef);
  let changedSrcNoTest = 0;
  for (const c of recentCommits.slice(0, 50)) {
    const files = gitLines("show", "--name-only", "--format=", c);
    const touchedSrc = files.some(isSource), touchedTest = files.some(isTest);
    if (touchedSrc && !touchedTest) changedSrcNoTest++;
  }
  let status = HEALTHY; const findings = [];
  if (tests.length === 0) { status = RISK; findings.push("no automated tests found — nothing checks that changes don't break things"); }
  else {
    const ratio = sources.length ? tests.length / sources.length : 0;
    if (ratio < 0.1) { status = Math.min(status, WATCH); findings.push(`very few tests relative to code (${tests.length} test files for ${sources.length} source files)`); }
    else findings.push(`${tests.length} test file(s) for ${sources.length} source file(s)`);
  }
  if (!hasRunner) { status = Math.min(status, WATCH); findings.push("no `test` script — there's no one command to run the tests"); }
  if (!hasCI) { status = Math.min(status, WATCH); findings.push("no CI workflow — tests aren't run automatically on every change"); }
  if (recentCommits.length && changedSrcNoTest / Math.max(recentCommits.length,1) > 0.6)
    { status = Math.min(status, WATCH); findings.push(`most recent changes shipped without a matching test (${changedSrcNoTest} of ${Math.min(recentCommits.length,50)})`); }
  add({ id: "test_health", label: "Test health", status,
    finding: findings.join("; "),
    prescription: status === HEALTHY ? "Keep adding a test with each behavior change." :
      "Add tests that would catch a regression, wire a `test` script, and run them in CI on every push.",
    evidence: { sourceFiles: sources.length, testFiles: tests.length, hasTestScript: hasRunner, hasCI, recentChangesWithoutTest: changedSrcNoTest } });
})();

// 3. Security
(() => {
  const SECRET_PATTERNS = [
    [/AKIA[0-9A-Z]{16}/, "AWS access key"],
    [/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/, "private key"],
    [/(?:secret|token|api[_-]?key|password)\s*[:=]\s*['"][A-Za-z0-9._\-]{16,}['"]/i, "hard-coded credential"],
    [/gh[pousr]_[A-Za-z0-9]{20,}/, "GitHub token"],
    [/sk-[A-Za-z0-9]{20,}/, "API secret key"],
  ];
  const hits = [];
  for (const f of trackedFiles) {
    if (/node_modules|package-lock|\.min\.|\.map$|\.lock$/.test(f)) continue;
    if (/\.(png|jpg|jpeg|gif|pdf|woff2?|ico|bundle)$/i.test(f)) continue;
    let content = ""; try { content = readFileSync(join(repo, f), "utf8"); } catch { continue; }
    if (content.length > 500000) continue;
    for (const [re, what] of SECRET_PATTERNS) if (re.test(content)) { hits.push({ file: f, what }); break; }
  }
  const envTracked = trackedFiles.filter((f) => /(^|\/)\.env$/.test(f) || /(^|\/)\.env\.[^e]/.test(f));
  let status = HEALTHY; const findings = [];
  if (hits.length) { status = RISK; findings.push(`possible secret(s) committed: ${hits.slice(0,3).map(h=>`${h.what} in ${h.file}`).join(", ")}`); }
  if (envTracked.length) { status = RISK; findings.push(`.env file is committed (${envTracked[0]}) — secrets in a .env don't belong in git`); }
  if (!findings.length) findings.push("no obvious secrets or .env files in the repository");
  add({ id: "security", label: "Security", status,
    finding: findings.join("; "),
    prescription: status === HEALTHY ? "Keep secrets in environment variables, never in files you commit." :
      "Remove the secret, rotate it immediately (assume it's compromised), and add the file to .gitignore. Removing it from history is a separate step.",
    evidence: { suspectedSecrets: hits, envFilesTracked: envTracked } });
})();

// 4. Merge hygiene (commit-message quality + big commits)
(() => {
  const recent = gitLines("log", "-50", "--no-merges", "--format=%s", defaultRef);
  const weak = recent.filter((m) => m.length < 12 || /^(wip|fix|stuff|update|changes|misc|\.|test)$/i.test(m.trim()));
  // biggest recent commits by files touched
  let bigCommits = 0;
  for (const c of gitLines("log", "-30", "--no-merges", "--format=%H", defaultRef)) {
    const n = gitLines("show", "--name-only", "--format=", c).length;
    if (n > 25) bigCommits++;
  }
  let status = HEALTHY; const findings = [];
  if (recent.length && weak.length / recent.length > 0.4) { status = WATCH; findings.push(`many vague commit messages (${weak.length} of ${recent.length}) — hard to tell what changed and why`); }
  if (bigCommits > 2) { status = Math.min(status, WATCH); findings.push(`${bigCommits} very large commit(s) touching 25+ files — hard to review or undo one thing`); }
  if (!findings.length) findings.push("commit messages are descriptive and commits are a reviewable size");
  add({ id: "merge_hygiene", label: "Change hygiene", status,
    finding: findings.join("; "),
    prescription: status === HEALTHY ? "Keep commits focused with a clear one-line summary." :
      "Write commit messages that say what changed and why; keep each commit to one logical change.",
    evidence: { sampled: recent.length, weakMessages: weak.length, largeCommits: bigCommits } });
})();

// 5. Dependency hygiene (no network)
(() => {
  const pj = join(repo, "package.json");
  let status = HEALTHY; const findings = []; const ev = {};
  if (existsSync(pj)) {
    let p = {}; try { p = JSON.parse(readFileSync(pj, "utf8")); } catch {}
    const deps = Object.keys(p.dependencies || {}).length;
    ev.dependencies = deps;
    const hasLock = ["package-lock.json", "yarn.lock", "pnpm-lock.yaml"].some((l) => existsSync(join(repo, l)));
    ev.lockfile = hasLock;
    if (!hasLock) { status = WATCH; findings.push("no lockfile — installs aren't reproducible, so builds can drift or break"); }
    if (trackedFiles.some((f) => f === "node_modules" || f.startsWith("node_modules/"))) { status = RISK; findings.push("node_modules is committed — it should be in .gitignore, not in the repo"); }
    if (!findings.length) findings.push(`${deps} direct dependency(ies), lockfile present`);
  } else { findings.push("no package.json — dependency check skipped"); status = UNKNOWN; }
  add({ id: "dependencies", label: "Dependencies", status,
    finding: findings.join("; "),
    prescription: status >= HEALTHY ? "Keep the lockfile committed and dependencies current." :
      "Commit a lockfile, and make sure node_modules is gitignored, not tracked.",
    evidence: ev });
})();

// 6. Repo hygiene (README, .gitignore, committed junk)
(() => {
  const hasReadme = trackedFiles.some((f) => /^readme(\.md)?$/i.test(f));
  const hasGitignore = existsSync(join(repo, ".gitignore"));
  const junk = trackedFiles.filter((f) => /(^|\/)(dist|build)\/|\.log$|\.DS_Store$/.test(f));
  let status = HEALTHY; const findings = [];
  if (!hasReadme) { status = WATCH; findings.push("no README — a newcomer (or you in a month) can't tell what this is or how to run it"); }
  if (!hasGitignore) { status = Math.min(status, WATCH); findings.push("no .gitignore — build output and secrets can get committed by accident"); }
  if (junk.length) { status = Math.min(status, WATCH); findings.push(`${junk.length} build/generated file(s) committed (e.g. ${junk[0]})`); }
  if (!findings.length) findings.push("README and .gitignore present; no build junk committed");
  add({ id: "hygiene", label: "Repo hygiene", status,
    finding: findings.join("; "),
    prescription: status === HEALTHY ? "Keep the README current as the project grows." :
      "Add a README that says what this is and how to run it, and a .gitignore covering build output and secrets.",
    evidence: { hasReadme, hasGitignore, committedJunk: junk.slice(0, 5) } });
})();

// ── overall ────────────────────────────────────────────────────────────────────
const known = vitals.filter((v) => v.status !== UNKNOWN);
const overall = known.some((v) => v.status === RISK) ? RISK
  : known.some((v) => v.status === WATCH) ? WATCH : HEALTHY;
const OVERALL_WORD = { 3: "Healthy", 2: "Needs attention", 1: "At risk" }[overall];

const repoName = (() => {
  const url = git("remote", "get-url", "origin");
  const m = url.match(/[/:]([^/]+\/[^/]+?)(?:\.git)?$/);
  return m ? m[1] : relative(process.cwd(), repo) || "this repo";
})();
const stamp = new Date().toISOString().slice(0, 10);

const report = {
  repo: repoName, generatedAt: new Date().toISOString(), overall: OVERALL_WORD,
  overallStatus: STATUS_WORD[overall],
  vitals: vitals.map((v) => ({ id: v.id, label: v.label, status: STATUS_WORD[v.status], finding: v.finding, prescription: v.prescription, evidence: v.evidence })),
  note: "This is a checkup of the repository's health, not a judgement of any person. Every result is computed from git and the files, and is shown with its evidence.",
};

// ── render ─────────────────────────────────────────────────────────────────────
if (asJson) {
  console.log(JSON.stringify(report, null, 2));
} else {
  const bar = "─".repeat(58);
  console.log(`\n  CodeWorthy Repo Checkup — ${repoName}   (${stamp})`);
  console.log(`  ${bar}`);
  console.log(`  Overall: ${STATUS_EMOJI[overall]}  ${OVERALL_WORD}\n`);
  for (const v of vitals) {
    console.log(`  ${STATUS_EMOJI[v.status]}  ${v.label} — ${STATUS_WORD[v.status]}`);
    console.log(`      ${v.finding}`);
    if (v.status < HEALTHY) console.log(`      → ${v.prescription}`);
    console.log("");
  }
  console.log(`  ${bar}`);
  console.log(`  A checkup of the repo's health — not a judgement of anyone. Re-run anytime.\n`);
}

if (htmlOut) { writeFileSync(htmlOut, renderHtml(report)); console.error(`checkup: wrote ${htmlOut}`); }

process.exit(overall === RISK ? 2 : overall === WATCH ? 1 : 0);

// ── html (self-contained doctor's-chart report) ────────────────────────────────
function renderHtml(r) {
  const color = { healthy: "#16a34a", watch: "#d97706", "at risk": "#dc2626", unknown: "#9ca3af" };
  const dot = (s) => `<span class="dot" style="background:${color[s]}"></span>`;
  const rows = r.vitals.map((v) => `
    <div class="vital ${v.status.replace(" ", "-")}">
      <div class="v-head">${dot(v.status)}<span class="v-label">${v.label}</span><span class="v-status" style="color:${color[v.status]}">${v.status.toUpperCase()}</span></div>
      <div class="v-finding">${esc(v.finding)}</div>
      ${v.status !== "healthy" ? `<div class="v-rx"><b>Recommendation:</b> ${esc(v.prescription)}</div>` : ""}
    </div>`).join("");
  const overallColor = { Healthy: "#16a34a", "Needs attention": "#d97706", "At risk": "#dc2626" }[r.overall];
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Repo Checkup — ${esc(r.repo)}</title><style>
:root{--bg:#f7f9fa;--card:#fff;--ink:#0f172a;--muted:#64748b;--line:#e5e9ec}
@media(prefers-color-scheme:dark){:root{--bg:#0b1114;--card:#121a1f;--ink:#e7eef2;--muted:#8aa0ab;--line:#1e2a31}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}
.wrap{max-width:720px;margin:0 auto;padding:32px 20px}
.head{display:flex;justify-content:space-between;align-items:baseline;flex-wrap:wrap;gap:8px}
h1{font-size:20px;margin:0}.sub{color:var(--muted);font-size:13px}
.banner{margin:18px 0 24px;padding:16px 20px;border-radius:12px;background:var(--card);border:1px solid var(--line);display:flex;align-items:center;gap:14px}
.banner .big{font-size:22px;font-weight:700;color:${overallColor}}
.banner .lede{color:var(--muted);font-size:13px}
.vital{background:var(--card);border:1px solid var(--line);border-left:4px solid var(--line);border-radius:10px;padding:14px 16px;margin-bottom:12px}
.vital.healthy{border-left-color:#16a34a}.vital.watch{border-left-color:#d97706}.vital.at-risk{border-left-color:#dc2626}
.v-head{display:flex;align-items:center;gap:9px}.v-label{font-weight:600}.v-status{margin-left:auto;font-size:11px;font-weight:700;letter-spacing:.04em}
.dot{width:11px;height:11px;border-radius:50%;display:inline-block}
.v-finding{color:var(--ink);margin-top:6px;font-size:14px}
.v-rx{margin-top:8px;font-size:13px;color:var(--muted);background:rgba(127,127,127,.06);padding:8px 10px;border-radius:7px}
.foot{color:var(--muted);font-size:12px;margin-top:20px;text-align:center}
</style></head><body><div class="wrap">
<div class="head"><h1>🩺 Repo Checkup</h1><div class="sub">${esc(r.repo)} · ${r.generatedAt.slice(0,10)}</div></div>
<div class="banner"><div class="big">${r.overall}</div><div class="lede">${r.vitals.filter(v=>v.status!=="healthy").length} of ${r.vitals.length} vitals need attention. Each is explained below, in plain language, with what to do.</div></div>
${rows}
<div class="foot">${esc(r.note)}</div>
</div></body></html>`;
}
function esc(s){return String(s).replace(/[&<>"]/g,(c)=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));}
