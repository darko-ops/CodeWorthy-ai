import { describe, expect, it } from "vitest";
import { authorizeUrl, callbackUrl, signState, verifyState } from "./oauth.js";

describe("oauth state (CSRF)", () => {
  it("round-trips a freshly signed state", () => {
    const s = signState();
    expect(verifyState(s)).toBe(true);
  });

  it("rejects a tampered state", () => {
    const s = signState();
    const tampered = s.slice(0, -2) + (s.endsWith("aa") ? "bb" : "aa");
    expect(verifyState(tampered)).toBe(false);
  });

  it("rejects a malformed state", () => {
    expect(verifyState("")).toBe(false);
    expect(verifyState("only.two")).toBe(false);
    expect(verifyState("a.b.c.d")).toBe(false);
  });

  it("rejects an expired state", () => {
    const t0 = 1_000_000_000_000;
    const s = signState(t0);
    // 11 minutes later, past the 10-minute window
    expect(verifyState(s, t0 + 11 * 60_000)).toBe(false);
    // still valid at 9 minutes
    expect(verifyState(s, t0 + 9 * 60_000)).toBe(true);
  });

  it("rejects a future-dated state (clock skew guard)", () => {
    const t0 = 1_000_000_000_000;
    const s = signState(t0);
    expect(verifyState(s, t0 - 60_000)).toBe(false);
  });
});

describe("oauth urls", () => {
  it("callback url hangs off the service base", () => {
    expect(callbackUrl()).toMatch(/\/auth\/github\/callback$/);
  });

  it("authorize url carries client_id, redirect_uri, and the state", () => {
    const u = new URL(authorizeUrl("STATE123"));
    expect(u.origin + u.pathname).toBe("https://github.com/login/oauth/authorize");
    expect(u.searchParams.get("state")).toBe("STATE123");
    expect(u.searchParams.get("redirect_uri")).toMatch(/\/auth\/github\/callback$/);
    expect(u.searchParams.has("client_id")).toBe(true);
  });
});
