// The gate's decision logic. Pure in, pure out — no DB, no network — because
// the whole claim of this tier is that the same diff always produces the same
// verdict. Anything that needs a database is testing the plumbing, not the rule.
import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, parseStewardConfig } from "../stewardConfig.js";
import {
  parseCheckRuns,
  parseCommitSubjects,
  parsePatchAdditions,
  parsePullRequestFiles,
  reviewChangeSet,
  underProtectedPath,
  type ChangeSet,
} from "./findings.js";

const file = (filename: string, addedLines: string[] = [], status = "modified") => ({
  filename, status, additions: addedLines.length, addedLines,
});
const change = (over: Partial<ChangeSet> = {}): ChangeSet => ({
  files: [], commitSubjects: [], checks: [], ...over,
});
const ids = (r: { findings: Array<{ id: string }> }) => r.findings.map((f) => f.id);
const gates = (r: { findings: Array<{ id: string; severity: string }> }) =>
  r.findings.filter((f) => f.severity === "gate").map((f) => f.id);

describe("the gate: what blocks a merge", () => {
  it("blocks a secret, wherever in the diff it appears", () => {
    const r = reviewChangeSet(change({ files: [file("src/config.ts", ["const k = 'AKIAIOSFODNN7EXAMPLE';"])] }));
    expect(r.decision).toBe("blocked");
    expect(gates(r)).toContain("secret_introduced");
  });

  it("flags a secret once per file, not once per line", () => {
    const r = reviewChangeSet(change({
      files: [file("src/a.ts", ["k = 'AKIAIOSFODNN7EXAMPLE'", "j = 'AKIAIOSFODNN7EXAMPLF'"])],
    }));
    expect(ids(r).filter((i) => i === "secret_introduced")).toHaveLength(1);
  });

  it("ignores lockfiles and minified bundles, where a 'secret' is a false positive", () => {
    const r = reviewChangeSet(change({ files: [file("package-lock.json", ["sk-aaaaaaaaaaaaaaaaaaaaaaaa"])] }));
    expect(ids(r)).not.toContain("secret_introduced");
  });

  it("blocks a committed .env and committed dependencies", () => {
    const r = reviewChangeSet(change({
      files: [file(".env", ["DATABASE_URL=x"], "added"), file("node_modules/left-pad/index.js", ["x"], "added")],
    }));
    expect(gates(r)).toEqual(expect.arrayContaining(["env_committed", "node_modules_committed"]));
  });

  it("blocks a migration that drops data, advises on one that will just fail", () => {
    const drop = reviewChangeSet(change({ files: [file("db/migrations/003.sql", ["DROP TABLE orders;"])] }));
    expect(gates(drop)).toContain("destructive_migration");

    const notNull = reviewChangeSet(change({ files: [file("db/migrations/004.sql", ["ALTER TABLE orders ADD COLUMN sku text NOT NULL;"])] }));
    expect(gates(notNull)).not.toContain("nonnull_no_default");
    expect(ids(notNull)).toContain("nonnull_no_default");
  });

  it("blocks a change whose OWN tests are red — the 'tested' half of the promise", () => {
    const r = reviewChangeSet(change({
      files: [file("src/orders.ts", ["export const x = 1;"])],
      checks: [{ name: "unit tests", status: "completed", conclusion: "failure" }],
    }));
    expect(r.decision).toBe("blocked");
    expect(gates(r)).toContain("merge_on_red");
    expect(r.findings.find((f) => f.id === "merge_on_red")!.message).toContain("unit tests");
  });

  it("does not treat a cancelled or still-running check as red", () => {
    const r = reviewChangeSet(change({
      files: [file("src/orders.ts", ["export const x = 1;"]), file("src/orders.test.ts", ["it('works')"])],
      checks: [
        { name: "flaky", status: "completed", conclusion: "cancelled" },
        { name: "slow", status: "in_progress", conclusion: null },
        { name: "skipped one", status: "completed", conclusion: "skipped" },
      ],
    }));
    expect(gates(r)).toEqual([]);
  });

  it("advises — never blocks — when a repo has no CI at all", () => {
    // Requiring a check the repo does not have would block every merge forever.
    const r = reviewChangeSet(change({ files: [file("src/orders.ts", ["export const x = 1;"])] }));
    expect(gates(r)).toEqual([]);
    expect(ids(r)).toContain("no_ci");
  });

  it("blocks a change to a path the repo declared protected", () => {
    const config = parseStewardConfig("protected_paths:\n  - db/migrations\n  - src/billing\n");
    const r = reviewChangeSet(change({ files: [file("src/billing/charge.ts", ["x"])] }), config);
    expect(gates(r)).toContain("protected_path");

    const elsewhere = reviewChangeSet(change({ files: [file("src/billingsomething.ts", ["x"])] }), config);
    expect(ids(elsewhere)).not.toContain("protected_path");
  });

  it("respects the repo's configured severity, including turning a gate off", () => {
    const secret = [file("src/a.ts", ["k = 'AKIAIOSFODNN7EXAMPLE'"])];
    const advise = parseStewardConfig("gates:\n  secrets: advise\n");
    const off = parseStewardConfig("gates:\n  secrets: off\n");

    expect(reviewChangeSet(change({ files: secret }), advise).decision).toBe("advise");
    expect(ids(reviewChangeSet(change({ files: secret }), off))).not.toContain("secret_introduced");
    expect(reviewChangeSet(change({ files: secret }), DEFAULT_CONFIG).decision).toBe("blocked");
  });
});

describe("the gate: what it only advises on", () => {
  it("notices code with no test, a large diff, and vague commit messages", () => {
    const r = reviewChangeSet(change({
      files: Array.from({ length: 25 }, (_, i) => file(`src/f${i}.ts`, ["a"])),
      commitSubjects: ["wip", "fix", "stuff", "add the retry budget to the order client"],
      checks: [{ name: "ci", status: "completed", conclusion: "success" }],
    }));
    expect(r.decision).toBe("advise");
    expect(ids(r)).toEqual(expect.arrayContaining(["no_test_in_pr", "large_pr", "weak_messages"]));
  });

  it("is clean on a small, tested, green change", () => {
    const r = reviewChangeSet(change({
      files: [file("src/orders.ts", ["export const x = 1;"]), file("src/orders.test.ts", ["it('works', () => {})"])],
      commitSubjects: ["make the order client retry idempotently"],
      checks: [{ name: "ci", status: "completed", conclusion: "success" }],
    }));
    expect(r.decision).toBe("clean");
    expect(r.findings).toEqual([]);
  });
});

describe("normalizing what GitHub sends", () => {
  it("reads only added lines out of a unified patch", () => {
    const patch = "@@ -1,2 +1,3 @@\n context\n-gone\n+added one\n+added two";
    expect(parsePatchAdditions(patch)).toEqual(["added one", "added two"]);
    expect(parsePatchAdditions(null)).toEqual([]); // binary / too-large files carry no patch
  });

  it("survives a files response with binaries and junk in it", () => {
    const files = parsePullRequestFiles([
      { filename: "a.ts", status: "modified", additions: 2, patch: "@@\n+one\n+two" },
      { filename: "logo.png", status: "added", additions: 0 }, // no patch
      { nonsense: true },
      null,
    ]);
    expect(files.map((f) => f.filename)).toEqual(["a.ts", "logo.png"]);
    expect(files[0]!.addedLines).toEqual(["one", "two"]);
    expect(files[1]!.addedLines).toEqual([]);
  });

  it("never counts our own check as one of the repo's checks", () => {
    // Otherwise a previous CodeWorthy failure would make the next run red on
    // itself — a gate that latches shut is a gate that gets removed.
    const parsed = parseCheckRuns(
      { check_runs: [{ name: "CodeWorthy PR review", status: "completed", conclusion: "failure" }, { name: "ci", status: "completed", conclusion: "success" }] },
      "CodeWorthy PR review"
    );
    expect(parsed.map((c) => c.name)).toEqual(["ci"]);
  });

  it("takes the first line of each commit message", () => {
    expect(parseCommitSubjects([{ commit: { message: "add retries\n\nlong body" } }, { commit: {} }, {}]))
      .toEqual(["add retries"]);
  });

  it("matches protected paths on directory boundaries only", () => {
    expect(underProtectedPath("db/migrations/1.sql", ["db/migrations"])).toBe("db/migrations");
    expect(underProtectedPath("db/migrations", ["db/migrations"])).toBe("db/migrations");
    expect(underProtectedPath("db/migrations-old/1.sql", ["db/migrations"])).toBeNull();
    expect(underProtectedPath("src/a.ts", [])).toBeNull();
  });
});
