// Encryption for the one secret this service stores on someone else's behalf:
// the GitHub user-to-server token.
//
// Threat model, stated because it decides the design. What this defends against
// is READ ACCESS TO POSTGRES WITHOUT THE APP'S RUNTIME ENVIRONMENT — a backup,
// a leaked read-only connection string, a console session, a query in a log.
// The key lives in a Fly secret and the ciphertext lives in Neon, so holding
// either one alone yields nothing.
//
// It does NOT defend against an attacker who already has the app's environment:
// they hold DATABASE_URL too and can simply read tokens through the running
// service. KMS would not change that (an envelope-encrypted data key sits in the
// same process's memory); what KMS would add is a decrypt audit trail and
// instant revocation, which matter at a scale this isn't at — and it would put a
// network call on the authenticated-request hot path, since every /api/* call
// resolves a session.
//
// Deliberately NOT routed through app/secret.ts. That key signs OAuth state and
// share tokens and can be rotated whenever you like; this one decrypts stored
// data. Sharing them would couple two rotation stories that have to stay
// independent.
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { config } from "../config.js";

const VERSION = "v1";
const IV_BYTES = 12; // GCM standard; a 96-bit IV is what the mode is specified for
const KEY_BYTES = 32; // AES-256

export function tokenKeyConfigured(): boolean {
  return keyOrNull() !== null;
}

function keyOrNull(): Buffer | null {
  const raw = config.session.tokenKey;
  if (!raw) return null;
  const key = Buffer.from(raw, "base64");
  return key.length === KEY_BYTES ? key : null;
}

function requireKey(): Buffer {
  const key = keyOrNull();
  if (!key) {
    throw new Error(
      "STEWARD_TOKEN_KEY is not set to 32 base64-encoded bytes, so GitHub tokens cannot be " +
        "encrypted. Generate one with: openssl rand -base64 32"
    );
  }
  return key;
}

/**
 * `v1.<iv>.<tag>.<ciphertext>`, each part base64url.
 *
 * Version-prefixed so a later scheme is DISTINGUISHABLE rather than guessed at
 * from length — the mistake that makes crypto migrations hazardous.
 */
export function encryptToken(plaintext: string): string {
  const key = requireKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64url"), tag.toString("base64url"), body.toString("base64url")].join(".");
}

/**
 * The plaintext, or null.
 *
 * NEVER throws, and every failure looks the same: wrong key, truncated value,
 * forged tag, garbage. Two reasons. A caller that can tell them apart is an
 * oracle. And session.ts treats null as "no such session" and prunes the row —
 * which is what makes key rotation self-cleaning: set a new key and the old
 * sessions evict themselves the next time anyone presents one, with no DELETE
 * pass and no re-encryption.
 */
export function decryptToken(stored: string): string | null {
  const key = keyOrNull();
  if (!key) return null;
  const parts = stored.split(".");
  if (parts.length !== 4 || parts[0] !== VERSION) return null;
  const [, ivPart, tagPart, bodyPart] = parts;
  try {
    const iv = Buffer.from(ivPart!, "base64url");
    const tag = Buffer.from(tagPart!, "base64url");
    if (iv.length !== IV_BYTES || tag.length !== 16) return null;
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    // final() is what verifies the tag — it throws on any tampering, which is
    // the whole reason this is GCM and not CBC.
    return Buffer.concat([decipher.update(Buffer.from(bodyPart!, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}
