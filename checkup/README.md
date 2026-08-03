# CodeWorthy Repo Checkup

The first buildable tier of the **Steward** product (see
[`../docs/new-direction-report.md`](../docs/new-direction-report.md) and
[`../docs/ai-senior-engineer-policy.md`](../docs/ai-senior-engineer-policy.md)):
point it at any git repo and get a **doctor's-checkup style health report** — a
panel of vitals, each rated 🟢 healthy / 🟡 watch / 🔴 at risk, each with a
plain-language finding and a prescription.

Deterministic, dependency-free, no network, no LLM — just git + the filesystem.
Every result is computed and inspectable, so it satisfies CodeWorthy's rule that
a score must always cite its evidence, and its rule that we rate a **repo's
health, not a person** (no rankings, no lines-of-code metrics, no leaderboards).

## Use

```bash
node checkup/checkup.mjs --repo /path/to/repo          # plain-language report
node checkup/checkup.mjs --repo /path/to/repo --json   # structured JSON
node checkup/checkup.mjs --repo /path/to/repo --html checkup.html   # doctor's-chart report
node checkup/checkup.mjs --repo /path/to/repo --since 60            # look-back window (days)
```

Exit code: `0` healthy, `1` needs attention, `2` at risk — so it can gate CI.

## The vitals (this tier)

| Vital | Checks |
|---|---|
| **Branch health** | direct-to-trunk without PRs, stale branches, PR flow |
| **Test health** | tests present, test/source ratio, `test` script, CI wired, recent changes shipped without tests |
| **Security** | committed secrets (AWS/GitHub/API keys, private keys, hard-coded creds), committed `.env` |
| **Change hygiene** | vague commit messages, oversized commits |
| **Dependencies** | lockfile present, `node_modules` committed |
| **Repo hygiene** | README, `.gitignore`, committed build junk |

## Where it fits (the tiers)

This is the **deterministic tier**. The full Steward product layers on:

1. **This** — deterministic vitals + the checkup report. ✅
2. **Judgment tier** — an LLM reviewer using the competency rubric as its prompt
   (duplication, contract-breaks, backwards-compat, the pre-merge micro-defense).
3. **Enforcement tier** — a GitHub App that runs the checks on every push/PR and
   gates / advises / does safe-mechanics (per the policy doc), never auto-merging.
4. **Compliance tier** — the immutable, plain-language SOC 2 audit log.

Each tier reuses this engine; nothing here is throwaway.

## Design notes

- **Trunk detection** prefers the remote default branch, then `main`/`master`,
  then the current branch — so it's correct on normal repos and degrades
  gracefully on unusual ones.
- **Severity is honest:** only genuinely dangerous, hard-to-undo things
  (committed secrets, committed `node_modules`, zero tests) are 🔴; process
  smells (direct-to-main, vague messages) are 🟡.
- **Plain language** is the point — every finding reads like a colleague
  explaining it, because the audience is builders who aren't (yet) engineers.
