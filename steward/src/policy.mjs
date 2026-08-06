// Steward repo configuration: a deliberately flat `.steward.yml` in the
// customer repo. Committing `protect: true` IS the consent step for branch
// protection — configuration-as-consent, so Steward never takes its one
// privileged action silently.
//
// Flat key: value lines only (no nesting) — parsed here without a YAML
// dependency, because a config this small should not import a parser.

export const DEFAULTS = Object.freeze({
  protect: false, // consent to configure branch protection on the default branch
  llm_review: false, // advise-only AI review (also requires server-side STEWARD_LLM=1)
  micro_defense: true, // ask the one-question micro-defense on non-trivial PRs
  micro_defense_threshold: 200, // changed lines that make a PR "non-trivial"
  draft_pr_on_branch_push: true, // open a draft PR when a branch has none
  cooldown_minutes: 0, // advisory merge cooldown surfaced in the checkup comment
});

export function parseStewardConfig(text) {
  const config = { ...DEFAULTS };
  if (!text) return config;
  for (const rawLine of text.split("\n")) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line || !line.includes(":")) continue;
    const idx = line.indexOf(":");
    const key = line.slice(0, idx).trim();
    const raw = line.slice(idx + 1).trim();
    if (!(key in DEFAULTS)) continue; // unknown keys are ignored, never fatal
    const current = DEFAULTS[key];
    if (typeof current === "boolean") {
      if (raw === "true") config[key] = true;
      else if (raw === "false") config[key] = false;
    } else if (typeof current === "number") {
      const n = Number(raw);
      if (Number.isFinite(n) && n >= 0) config[key] = n;
    } else {
      config[key] = raw;
    }
  }
  return config;
}

export async function loadConfig(client, owner, repo, ref) {
  const text = await client.getFileContent(owner, repo, ".steward.yml", ref);
  return parseStewardConfig(text);
}

// The protection Steward applies when consented. Solo-founder friendly:
// requires a PR (zero approvals, so a solo builder isn't locked out), blocks
// force pushes and deletions, and does not enforce on admins — an owner can
// consciously bypass, and Steward logs when they do.
export function protectionPayload(requiredChecks = []) {
  return {
    required_status_checks:
      requiredChecks.length > 0 ? { strict: true, contexts: requiredChecks } : null,
    enforce_admins: false,
    required_pull_request_reviews: {
      required_approving_review_count: 0,
    },
    restrictions: null,
    allow_force_pushes: false,
    allow_deletions: false,
    required_linear_history: false,
    lock_branch: false,
  };
}
