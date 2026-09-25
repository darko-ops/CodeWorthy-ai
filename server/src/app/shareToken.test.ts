// The leak this guards.
//
// /steward/digest and /steward/health named their repository in a query string
// and served it to anyone. So `?repo=` was an oracle over every repository in
// the database, and omitting it returned the whole estate — every tenant's repo
// names, branch names and actor logins, to an anonymous caller. Verified on the
// deployment before the fix: 1375 events across other people's repositories.
//
// The pages still have to work for someone with no login — that is the product
// (forward your summary to an auditor). So the link became a capability: the
// repo travels INSIDE a signed token, and the reader takes it from there rather
// than from a parameter sitting next to it.
import { describe, expect, it } from "vitest";
import { DEFAULT_SHARE_TTL_MS, shareTokenRepo, shareUrlFor, signShareToken } from "./shareToken.js";

describe("share tokens", () => {
  it("round-trips the repository it was minted for", () => {
    const t = signShareToken("darko-ops/parea");
    expect(shareTokenRepo(t)).toBe("darko-ops/parea");
  });

  it("a token for one repo does not authorize another", () => {
    const t = signShareToken("acme/orders");
    expect(shareTokenRepo(t)).toBe("acme/orders");
    expect(shareTokenRepo(t)).not.toBe("acme/secrets");
  });

  it("refuses a tampered repository — the signature covers it", () => {
    const t = signShareToken("acme/orders");
    const [v, , exp, sig] = t.split(".");
    const swapped = `${v}.${Buffer.from("acme/secrets", "utf8").toString("base64url")}.${exp}.${sig}`;
    expect(shareTokenRepo(swapped)).toBeNull();
  });

  it("refuses a forged signature", () => {
    const t = signShareToken("acme/orders");
    expect(shareTokenRepo(t.slice(0, -4) + "AAAA")).toBeNull();
  });

  it("expires", () => {
    const mintedAt = Date.now();
    const t = signShareToken("acme/orders", mintedAt);
    expect(shareTokenRepo(t, mintedAt + DEFAULT_SHARE_TTL_MS - 1000)).toBe("acme/orders");
    expect(shareTokenRepo(t, mintedAt + DEFAULT_SHARE_TTL_MS + 1000)).toBeNull();
  });

  it("answers every malformed shape the same way — null, never a hint", () => {
    for (const junk of ["", "x", "s1.a.b", "s1.a.b.c.d", "s2.a.b.c", "....", "undefined"]) {
      expect(shareTokenRepo(junk)).toBeNull();
    }
    expect(shareTokenRepo(undefined)).toBeNull();
  });

  it("mints an absolute link the dashboard can hand out as-is", () => {
    const url = shareUrlFor("https://api.example.com", "acme/orders", 30);
    expect(url.startsWith("https://api.example.com/steward/digest.html?")).toBe(true);
    const token = new URL(url).searchParams.get("t");
    expect(shareTokenRepo(token ?? undefined)).toBe("acme/orders");
    expect(new URL(url).searchParams.get("days")).toBe("30");
  });

  it("can point at the health page instead — the check run's Details link", () => {
    const url = shareUrlFor("https://api.example.com", "acme/orders", 30, "/steward/health.html");
    expect(url).toContain("/steward/health.html?");
    expect(shareTokenRepo(new URL(url).searchParams.get("t") ?? undefined)).toBe("acme/orders");
  });
});
