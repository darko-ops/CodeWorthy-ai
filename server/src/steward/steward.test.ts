import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { verifySignature } from "./webhook.js";
import { parseStewardConfig, DEFAULT_CONFIG } from "./stewardConfig.js";
import { toStewardEvent } from "./events.js";

describe("webhook signature", () => {
  const secret = "s3cr3t";
  const body = JSON.stringify({ action: "opened" });
  const sig = "sha256=" + createHmac("sha256", secret).update(body).digest("hex");

  it("accepts a valid signature", () => expect(verifySignature(secret, body, sig)).toBe(true));
  it("rejects a tampered body", () => expect(verifySignature(secret, body + "x", sig)).toBe(false));
  it("rejects a wrong secret", () => expect(verifySignature("nope", body, sig)).toBe(false));
  it("rejects a missing signature", () => expect(verifySignature(secret, body, undefined)).toBe(false));
});

describe(".steward.yml config", () => {
  it("returns safe defaults when absent", () => {
    expect(parseStewardConfig(null)).toEqual(DEFAULT_CONFIG);
  });
  it("falls back to defaults on malformed yaml", () => {
    expect(parseStewardConfig(":\n  bad: [unclosed")).toEqual(DEFAULT_CONFIG);
  });
  it("parses overrides and keeps the LLM tier opt-in", () => {
    const cfg = parseStewardConfig("gates:\n  secrets: advise\nmerge_cooldown_minutes: 30\nprotected_paths:\n  - db/\n");
    expect(cfg.gates.secrets).toBe("advise");
    expect(cfg.gates.destructiveMigration).toBe("gate"); // untouched default
    expect(cfg.mergeCooldownMinutes).toBe(30);
    expect(cfg.protectedPaths).toEqual(["db/"]);
    expect(cfg.llm.enabled).toBe(false); // never on unless explicitly true
  });
});

describe("event -> audit mapping", () => {
  it("logs a direct push to the default branch with a plain-language sentence", () => {
    const ev = toStewardEvent("push", {
      ref: "refs/heads/main", created: false,
      repository: { full_name: "acme/app", default_branch: "main" },
      pusher: { name: "dana" }, commits: [{}, {}], after: "abc123",
      installation: { id: 7 },
    });
    expect(ev?.eventType).toBe("push.direct_to_default");
    expect(ev?.plainEnglish).toMatch(/straight to main/);
    expect(ev?.installationId).toBe(7);
  });

  it("does not log a normal push to a feature branch", () => {
    const ev = toStewardEvent("push", {
      ref: "refs/heads/feature/x", repository: { full_name: "acme/app", default_branch: "main" },
      pusher: { name: "dana" }, commits: [{}],
    });
    expect(ev).toBeNull();
  });
});
