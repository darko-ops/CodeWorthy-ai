// The reconciliation job (V1). Scheduled (daily by default, in-process
// scheduler) or by hand:
//
//   npm run reconcile
//
// For every repo with an OPEN coverage window (V0.4) it reconciles the trailing
// window against GitHub ground truth and appends the result to the chain
// (reconcile.ts). Safe no-op when the App isn't configured — like the anchor
// job, it can be scheduled before credentials exist.
//
// Repos installed before coverage windows existed (pre-0004) have no window and
// are skipped; a backfill window (source='backfill') can be inserted to bring
// them in — an explicit, visible act, consistent with "gaps are declared".
import { Pool } from "pg";
import { config } from "../config.js";
import { getInstallationClient } from "../github/auth.js";
import type { GitHubClient } from "../github/client.js";
import { reconcileRepo, type ReconcileResult } from "./reconcile.js";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface ReconcileJobResult {
  status: "no-github" | "no-coverage" | "reconciled";
  repos: number;
  discrepancies: number;
  detail?: string;
}

export async function runReconcileJob(
  pool: Pool,
  opts: {
    windowDays?: number;
    now?: () => Date; // injectable clock
    clientFor?: (installationId: number) => Promise<GitHubClient>; // injected in tests
    defaultBranchFor?: (client: GitHubClient, repo: string) => Promise<string>; // injected in tests
  } = {}
): Promise<ReconcileJobResult> {
  const clientFor = opts.clientFor ?? (config.github.appId ? (id: number) => getInstallationClient(id) : null);
  if (!clientFor) return { status: "no-github", repos: 0, discrepancies: 0 };

  const open = await pool.query(
    `SELECT DISTINCT repo, installation_id FROM coverage_windows WHERE covered_to IS NULL ORDER BY repo`
  );
  if (open.rows.length === 0) return { status: "no-coverage", repos: 0, discrepancies: 0 };

  const now = (opts.now ?? (() => new Date()))();
  const from = new Date(now.getTime() - (opts.windowDays ?? 7) * DAY_MS).toISOString();
  const to = now.toISOString();

  // One client (and one default-branch map) per installation, not per repo.
  const clients = new Map<number, GitHubClient>();
  const branchMaps = new Map<number, Map<string, string>>();
  let repos = 0;
  let discrepancies = 0;
  const failures: string[] = [];

  for (const row of open.rows) {
    const installationId = row.installation_id == null ? null : Number(row.installation_id);
    if (installationId == null) continue; // can't reach GitHub without one
    try {
      let client = clients.get(installationId);
      if (!client) { client = await clientFor(installationId); clients.set(installationId, client); }
      let branches = branchMaps.get(installationId);
      if (!branches) {
        branches = new Map((await client.listInstallationRepositories()).map((r) => [r.full_name, r.default_branch]));
        branchMaps.set(installationId, branches);
      }
      const defaultBranch = opts.defaultBranchFor
        ? await opts.defaultBranchFor(client, row.repo)
        : branches.get(row.repo) ?? "main";

      const result: ReconcileResult = await reconcileRepo(client, pool, {
        repo: row.repo, defaultBranch, installationId, from, to,
      });
      repos++;
      discrepancies += result.discrepancies.length;
    } catch (err) {
      // A failed repo doesn't abort the run — but it isn't silent either.
      failures.push(`${row.repo}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return {
    status: "reconciled",
    repos,
    discrepancies,
    detail: failures.length ? `failed: ${failures.join("; ")}` : undefined,
  };
}

async function main() {
  const pool = new Pool({ connectionString: config.databaseUrl });
  try {
    const result = await runReconcileJob(pool);
    console.log(`[reconcile] ${result.status}: ${result.repos} repo(s), ${result.discrepancies} discrepanc${result.discrepancies === 1 ? "y" : "ies"}${result.detail ? ` — ${result.detail}` : ""}`);
    if (result.discrepancies > 0) process.exitCode = 3; // visible in CI/monitoring, not a crash
  } finally {
    await pool.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(err); process.exit(1); });
}
