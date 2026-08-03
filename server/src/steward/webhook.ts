// Verifies GitHub webhook signatures. Constant-time compare; raw body in, bool out.
import { createHmac, timingSafeEqual } from "node:crypto";

export function verifySignature(secret: string, rawBody: string, signatureHeader: string | undefined): boolean {
  if (!secret || !signatureHeader) return false;
  const expected = "sha256=" + createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signatureHeader);
  return a.length === b.length && timingSafeEqual(a, b);
}
