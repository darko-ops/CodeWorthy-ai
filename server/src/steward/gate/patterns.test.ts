// The secret list is mirrored (server TS) from a source of truth (checkup .mjs).
// A mirror that can silently drift is worse than no mirror: the Action would
// block a leaked key the hosted gate waves through. This test makes divergence
// a build failure.
import { describe, expect, it } from "vitest";
import { SECRET_PATTERNS } from "./patterns.js";

describe("secret patterns", () => {
  it("matches checkup/secret-patterns.mjs exactly, in order", async () => {
    const url = new URL("../../../../checkup/secret-patterns.mjs", import.meta.url).href;
    const canonical = (await import(/* @vite-ignore */ url)).SECRET_PATTERNS as Array<[RegExp, string]>;

    const shape = (list: Array<[RegExp, string]>) => list.map(([re, what]) => [re.source, re.flags, what]);
    expect(shape(SECRET_PATTERNS)).toEqual(shape(canonical));
  });

  it("catches the keys that actually leak", () => {
    const hits = (line: string) => SECRET_PATTERNS.filter(([re]) => re.test(line)).map(([, what]) => what);
    expect(hits("const k = 'AKIAIOSFODNN7EXAMPLE'")).toContain("AWS access key");
    expect(hits("-----BEGIN RSA PRIVATE KEY-----")).toContain("private key");
    expect(hits("STRIPE=sk_live_abcdefghijklmnop")).toContain("Stripe secret key");
    expect(hits('password: "hunter2hunter2hunter2"')).toContain("hard-coded credential");
    // and does not fire on ordinary code
    expect(hits("const password = process.env.PASSWORD")).toEqual([]);
    expect(hits("// set the api_key in your environment")).toEqual([]);
  });
});
