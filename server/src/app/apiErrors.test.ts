// What the dashboard tells a user when GitHub says no.
//
// The bug this guards: every GitHub failure threw, Fastify turned it into a
// 500, and the most common case by far — an expired token — looked identical
// to "the product is broken". A 500 is unactionable; "sign in again" is one
// click.
import { describe, expect, it } from "vitest";
import { GitHubHttpError } from "../github/client.js";
import { mapGitHubError } from "./apiErrors.js";

const err = (status: number, meta = {}) => new GitHubHttpError(status, "GET", "/user/installations", meta);

describe("mapping a GitHub failure to an answer", () => {
  it("tells an expired token to sign in again, not that we broke", () => {
    const r = mapGitHubError(err(401))!;
    expect(r.status).toBe(401);
    expect(r.body.error).toBe("github_token_expired");
    expect(r.body.message).toMatch(/sign in again/i);
  });

  it("separates rate limiting from a permissions refusal, though both are 403", () => {
    const limited = mapGitHubError(err(403, { rateLimited: true, retryAfter: "60" }))!;
    expect(limited.status).toBe(429);
    expect(limited.body.error).toBe("github_rate_limited");
    expect(limited.body.retryAfter).toBe("60");

    const refused = mapGitHubError(err(403))!;
    expect(refused.status).toBe(403);
    expect(refused.body.error).toBe("github_forbidden");
  });

  it("treats an explicit 429 as rate limiting too", () => {
    expect(mapGitHubError(err(429))!.body.error).toBe("github_rate_limited");
  });

  it("answers a GitHub outage with 502 — upstream, not our internal error", () => {
    for (const status of [500, 502, 503, 504]) {
      const r = mapGitHubError(err(status))!;
      expect(r.status).toBe(502);
      expect(r.body.error).toBe("github_unavailable");
    }
  });

  it("passes a 404 through as a 404", () => {
    expect(mapGitHubError(err(404))!.status).toBe(404);
  });

  it("refuses to smooth over a real bug", () => {
    // Anything that isn't a GitHub transport failure must keep 500ing loudly —
    // otherwise this helper becomes a way to hide our own exceptions.
    expect(mapGitHubError(new TypeError("cannot read property 'x' of undefined"))).toBeNull();
    expect(mapGitHubError(new Error("GET /user -> 401"))).toBeNull(); // message-only, no status
    expect(mapGitHubError(null)).toBeNull();
  });

  it("never returns a 500 of its own", () => {
    for (const status of [400, 401, 403, 404, 418, 429, 500, 503]) {
      expect(mapGitHubError(err(status))!.status).not.toBe(500);
    }
  });
});
