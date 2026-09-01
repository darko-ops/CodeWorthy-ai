// The bug this guards: CORS was one strict equality against the configured
// dashboard URL. The site answers on BOTH the apex and www hosts, so a user on
// the wrong one had every API call blocked by the browser — and because the SPA
// reports a blocked fetch as `offline`, the dashboard sat on "Steward is waking
// up…" indefinitely while the backend was perfectly healthy.
import { describe, expect, it } from "vitest";
import { allowedWebOrigins } from "./webOrigins.js";

describe("which origins may call the API", () => {
  it("allows the apex and www forms of the configured host", () => {
    const a = allowedWebOrigins("https://codeworthy.ai");
    expect(a.has("https://codeworthy.ai")).toBe(true);
    expect(a.has("https://www.codeworthy.ai")).toBe(true);
  });

  it("works the same when www is the configured form", () => {
    const a = allowedWebOrigins("https://www.codeworthy.ai");
    expect(a.has("https://codeworthy.ai")).toBe(true);
    expect(a.has("https://www.codeworthy.ai")).toBe(true);
  });

  it("normalizes a trailing slash or a path to a bare origin", () => {
    // An Origin header is scheme+host+port only, so a configured value with a
    // path must still match what the browser actually sends.
    for (const configured of ["https://codeworthy.ai/", "https://codeworthy.ai/dashboard"]) {
      expect(allowedWebOrigins(configured).has("https://codeworthy.ai")).toBe(true);
    }
  });

  it("keeps the port, and treats a different port as a different origin", () => {
    const a = allowedWebOrigins("http://localhost:5173");
    expect(a.has("http://localhost:5173")).toBe(true);
    expect(a.has("http://localhost:4173")).toBe(false);
  });

  it("accepts extra origins for a preview deployment", () => {
    const a = allowedWebOrigins("https://codeworthy.ai", "https://preview.vercel.app, http://localhost:5173");
    expect(a.has("https://preview.vercel.app")).toBe(true);
    expect(a.has("http://localhost:5173")).toBe(true);
  });

  it("never widens beyond the www/apex pair of the same site", () => {
    // The counterpart rule only ever toggles a leading "www." — it must not
    // become a way to allow a sibling subdomain or a different domain.
    const a = allowedWebOrigins("https://codeworthy.ai");
    for (const nope of [
      "https://evil.codeworthy.ai",
      "https://codeworthy.ai.evil.com",
      "http://codeworthy.ai", // scheme matters
      "https://codeworthy.com",
      "https://wwwcodeworthy.ai",
    ]) {
      expect(a.has(nope), nope).toBe(false);
    }
  });

  it("ignores junk instead of allowing it", () => {
    const a = allowedWebOrigins("https://codeworthy.ai", "not-a-url, , ///");
    expect(a.has("not-a-url")).toBe(false);
    expect([...a].every((o) => o.startsWith("http"))).toBe(true);
  });

  it("is never a wildcard", () => {
    // These endpoints carry a bearer session; "*" would let any site read a
    // signed-in user's repositories.
    expect(allowedWebOrigins("https://codeworthy.ai").has("*")).toBe(false);
  });
});
