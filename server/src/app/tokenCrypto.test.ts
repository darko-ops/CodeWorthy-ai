// The crypto seam. Pure — no database, so this runs anywhere.
import { describe, expect, it } from "vitest";
import { createCipheriv, randomBytes } from "node:crypto";
import { decryptToken, encryptToken, tokenKeyConfigured } from "./tokenCrypto.js";

const TOKEN = "ghu_aVeryRecognisablePlaintextToken0123456789";

describe("token encryption", () => {
  it("is configured in tests (the fixture key from vitest.config.ts)", () => {
    expect(tokenKeyConfigured()).toBe(true);
  });

  it("round-trips", () => {
    expect(decryptToken(encryptToken(TOKEN))).toBe(TOKEN);
  });

  it("round-trips an empty string — absence must not look like failure", () => {
    // decryptToken signals failure with null, so "" has to survive as "".
    expect(decryptToken(encryptToken(""))).toBe("");
  });

  it("never produces the same ciphertext twice — a fresh IV each time", () => {
    const seen = new Set(Array.from({ length: 50 }, () => encryptToken(TOKEN)));
    expect(seen.size).toBe(50);
  });

  it("does not contain the plaintext", () => {
    expect(encryptToken(TOKEN)).not.toContain("ghu_");
  });

  it("refuses a forged tag — this is why it is GCM", () => {
    const [v, iv, tag, body] = encryptToken(TOKEN).split(".");
    const flipped = Buffer.from(tag!, "base64url");
    flipped[0]! ^= 0xff;
    expect(decryptToken([v, iv, flipped.toString("base64url"), body].join("."))).toBeNull();
  });

  it("refuses altered ciphertext", () => {
    const [v, iv, tag, body] = encryptToken(TOKEN).split(".");
    const flipped = Buffer.from(body!, "base64url");
    flipped[0]! ^= 0xff;
    expect(decryptToken([v, iv, tag, flipped.toString("base64url")].join("."))).toBeNull();
  });

  it("refuses a value encrypted under a different key — this is what makes rotation work", () => {
    // Built here rather than by swapping config, so the test does not depend on
    // module-load order. Same format, different key.
    const otherKey = randomBytes(32);
    const iv = randomBytes(12);
    const c = createCipheriv("aes-256-gcm", otherKey, iv);
    const body = Buffer.concat([c.update(TOKEN, "utf8"), c.final()]);
    const foreign = ["v1", iv.toString("base64url"), c.getAuthTag().toString("base64url"), body.toString("base64url")].join(".");
    expect(decryptToken(foreign)).toBeNull();
  });

  it("returns null for junk instead of throwing — a caller that can tell failures apart is an oracle", () => {
    for (const junk of ["", "x", "v1.a.b", "v1.a.b.c.d", "v2.a.b.c", "....", "not base64 at all"]) {
      expect(decryptToken(junk)).toBeNull();
    }
  });
});
