// The protection reconciler. Scheduled (hourly by default, in-process
// scheduler) or by hand:
//
//   npm run protect
//
// Webhooks tell us the moment someone weakens a rule — but only if they fire,
// only if we're up, and only if GitHub sends them. This sweep is the backstop
// that makes the guarantee independent of any single delivery: every repo under
// stewardship is compared to its desired protection on a fixed cadence, and put
// back if it drifted.
//
// The consent line, enforced here: it reconciles ONLY repos where a human
// already turned protection on (there is a `protection.configured` or
// `protection.restored` event in the spine). A repo that never consented is
// never protected by a background job — silence is not consent, and a sweep is
// exactly the kind of place that rule would quietly erode.
import { Pool } from "pg";
import { config } from "../config.js";
import { getInstallationClient } from "../github/auth.js";
import type { GitHubClient } from "../github/client.js";
import { enforceProtection, protectionEverConfigured } from "./enforce.js";

export interface ProtectionJobResult {
  status: "no-github" | "no-coverage" | "reconciled";
  repos: number; // repos actually checked
  drifted: number; // repos found weakened
  restored: number; // repos put back
  detail?: string;
}

export async function runProtectionJob(
  pool: Pool,
  opts: {
    restore?: boolean;
    clientFor?: (installationId: number) => Promise<GitHubClient>; // injected in tests
  } = {}
): Promise<ProtectionJobResult> {
  const clientFor = opts.clientFor ?? (config.github.appId ? (id: number) => getInstallationClient(id) : null);
  if (!clientFor) return { status: "no-github", repos: 0, drifted: 0, restored: 0 };

  // The population is the same one reconciliation uses: repos with an OPEN
  // coverage window. Scoping both to the same frame means "protection was in
  // force for exactly these intervals" lines up with the completeness claim.
  const open = await pool.query(
    `SELECT DISTINCT repo, installation_id FROM coverage_windows WHERE covered_to IS NULL ORDER BY repo`
  );
  if (open.rows.length === 0) return { status: "no-coverage", repos: 0, drifted: 0, restored: 0 };

  const restore = opts.restore ?? config.protection.restoreDrift;
  const clients = new Map<number, GitHubClient>();
  const branchMaps = new Map<number, Map<string, string>>();
  let repos = 0;
  let drifted = 0;
  let restored = 0;
  const failures: string[] = [];

  for (const row of open.rows) {
    const installationId = row.installation_id == null ? null : Number(row.installation_id);
    if (installationId == null) continue; // can't reach GitHub without one
    // Consent gate — see the header note.
    if (!(await protectionEverConfigured(pool, row.repo))) continue;
    try {
      let client = clients.get(installationId);
      if (!client) { client = await clientFor(installationId); clients.set(installationId, client); }
      let branches = branchMaps.get(installationId);
      if (!branches) {
        branches = new Map((await client.listInstallationRepositories()).map((r) => [r.full_name, r.default_branch]));
        branchMaps.set(installationId, branches);
      }
      const result = await enforceProtection(client, pool, row.repo, installationId, {
        restore,
        defaultBranch: branches.get(row.repo) ?? "main",
        trigger: "scheduled-sweep",
      });
      repos++;
      if (result.weakenings.length) drifted++;
      if (result.restored) restored++;
    } catch (err) {
      // A failed repo doesn't abort the sweep — but it isn't silent either.
      failures.push(`${row.repo}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return {
    status: "reconciled",
    repos,
    drifted,
    restored,
    detail: failures.length ? `failed: ${failures.join("; ")}` : undefined,
  };
}

async function main() {
  const pool = new Pool({ connectionString: config.databaseUrl });
  try {
    const r = await runProtectionJob(pool);
    console.log(`[protect] ${r.status}: ${r.repos} repo(s) checked, ${r.drifted} drifted, ${r.restored} restored${r.detail ? ` — ${r.detail}` : ""}`);
    if (r.drifted > 0) process.exitCode = 3; // visible in monitoring, not a crash
  } finally {
    await pool.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(err); process.exit(1); });
}
