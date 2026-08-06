// The hard rules, enforced by CI rather than convention:
//   1. The API client exposes no merge / ref-delete / force-update capability.
//   2. The AI review check can never produce a blocking conclusion.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { StewardClient } from "../src/github.mjs";
import { NEVER_GATE } from "../src/llm.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const src = (f) => readFileSync(join(here, "..", "src", f), "utf8");

test("client exposes no merge, delete, or force capability", () => {
  const client = new StewardClient({ token: "t" });
  const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(client));
  for (const name of methods) {
    assert.doesNotMatch(name, /merge/i, `forbidden method name: ${name}`);
    assert.doesNotMatch(name, /delete/i, `forbidden method name: ${name}`);
    assert.doesNotMatch(name, /force/i, `forbidden method name: ${name}`);
  }
});

test("github.mjs contains no forbidden endpoints or verbs", () => {
  const code = src("github.mjs");
  assert.ok(!code.includes("/merge"), "merge endpoint present");
  assert.ok(!/"DELETE"/.test(code), "DELETE verb present");
  assert.ok(!/force:\s*true/.test(code), "force ref update present");
});

test("no source file calls a merge or ref-deletion endpoint", () => {
  for (const file of [
    "server.mjs",
    "llm.mjs",
    "protection.mjs",
    "policy.mjs",
    "audit.mjs",
    "plain.mjs",
    "handlers/push.mjs",
    "handlers/pullRequest.mjs",
  ]) {
    const code = src(file);
    assert.ok(!code.includes("pulls/") || !code.includes("/merge"), `${file}: merge endpoint`);
    assert.ok(!/git\/refs\/.*DELETE|"DELETE".*git\/refs/s.test(code), `${file}: ref deletion`);
  }
});

test("AI review conclusions are frozen to neutral — the model cannot gate", () => {
  assert.equal(NEVER_GATE.ok, "neutral");
  assert.equal(NEVER_GATE.errored, "neutral");
  assert.ok(Object.isFrozen(NEVER_GATE));
  const code = src("llm.mjs");
  assert.ok(!/conclusion:\s*"(failure|action_required)"/.test(code), "a blocking conclusion is reachable in llm.mjs");
});

test("AI review posts COMMENT reviews only — never approve, never request changes", () => {
  const code = src("github.mjs");
  assert.ok(code.includes('event: "COMMENT"'));
  assert.ok(!code.includes("REQUEST_CHANGES"));
  assert.ok(!/event:\s*"APPROVE"/.test(code));
});
