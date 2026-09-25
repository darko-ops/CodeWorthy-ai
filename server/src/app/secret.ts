// The one HMAC key this process signs with.
//
// Two things are derived from it — the OAuth `state` (oauth.ts) and share
// tokens (shareToken.ts) — and they must agree on the key, or a token minted
// before a restart stops verifying after it while the other keeps working.
// Having each module keep its own boot fallback made that failure per-feature
// and invisible; one module means one answer.
//
// Set STEWARD_SESSION_SECRET in production. Unset, this is a boot-time random:
// fine for a single instance, but every signature dies with the process (and
// two instances never agree), so a share link would stop working for no
// reason the holder could see.
import { randomBytes } from "node:crypto";
import { config } from "../config.js";

const BOOT_SECRET = randomBytes(32).toString("hex");

export function signingSecret(): string {
  return config.sessionSecret || BOOT_SECRET;
}

/** True when the key survives a restart — i.e. share links are durable. */
export function signingSecretIsPersistent(): boolean {
  return Boolean(config.sessionSecret);
}
