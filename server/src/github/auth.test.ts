import { describe, expect, it } from "vitest";
import { createVerify, generateKeyPairSync } from "node:crypto";
import { appJwt } from "./auth.js";

describe("App JWT", () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const pem = privateKey.export({ type: "pkcs1", format: "pem" }).toString();
  const now = 1_700_000_000;
  const jwt = appJwt(now, "123456", pem);

  it("has three base64url parts with an RS256 header", () => {
    const parts = jwt.split(".");
    expect(parts).toHaveLength(3);
    const header = JSON.parse(Buffer.from(parts[0]!, "base64url").toString());
    expect(header).toEqual({ alg: "RS256", typ: "JWT" });
  });

  it("issues for the app id with a sane clock window", () => {
    const payload = JSON.parse(Buffer.from(jwt.split(".")[1]!, "base64url").toString());
    expect(payload.iss).toBe("123456");
    expect(payload.iat).toBeLessThan(now);
    expect(payload.exp).toBeGreaterThan(now);
    expect(payload.exp - payload.iat).toBeLessThanOrEqual(600); // GitHub caps at 10 min
  });

  it("is verifiably signed by the app private key", () => {
    const [h, p, s] = jwt.split(".");
    const v = createVerify("RSA-SHA256");
    v.update(`${h}.${p}`);
    v.end();
    expect(v.verify(publicKey, Buffer.from(s!, "base64url"))).toBe(true);
  });
});
