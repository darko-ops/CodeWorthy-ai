// The install / consent flow — the human-facing front door.
//
// Honest MVP: three small pages and one consented action.
//   /steward/install            — what CodeWorthy will do, and the disclosures,
//                                 then an "Install on GitHub" button.
//   /steward/setup              — GitHub sends the user here AFTER they install.
//                                 Confirms it's on, and asks the one real
//                                 consent: "protect your default branch now?"
//   POST /steward/setup/protect — applies branch protection to the installation's
//                                 repos ONLY because the human just clicked yes.
//
// The install-screen grants the permissions; this flow is where CodeWorthy earns
// the one privileged action (changing repo settings) with an explicit click,
// never silently. Everything else it does is additive and reversible.
import type { Pool } from "pg";
import { getInstallationClient } from "../github/auth.js";
import type { GitHubClient } from "../github/client.js";
import { ensureProtection } from "../steward/enforce.js";
import { installUrl, type AppManifest } from "./manifest.js";

const esc = (s: unknown) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

// One shared, theme-aware shell so every page reads as one product.
export function page(title: string, body: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><style>
:root{--bg:#f7f9fa;--card:#fff;--ink:#0f172a;--muted:#64748b;--line:#e5e9ec;--accent:#2563eb}
@media(prefers-color-scheme:dark){:root{--bg:#0b1114;--card:#121a1f;--ink:#e7eef2;--muted:#8aa0ab;--line:#1e2a31;--accent:#3b82f6}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.55 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}
.wrap{max-width:640px;margin:0 auto;padding:40px 20px}
h1{font-size:22px;margin:0 0 6px}.sub{color:var(--muted);font-size:14px;margin-bottom:22px}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:18px 20px;margin:14px 0}
h2{font-size:14px;margin:0 0 10px;color:var(--muted);text-transform:uppercase;letter-spacing:.03em}
ul{margin:0;padding-left:18px}li{margin:6px 0}
.btn{display:inline-block;background:var(--accent);color:#fff;text-decoration:none;font-weight:600;padding:11px 20px;border-radius:9px;border:0;font-size:15px;cursor:pointer}
.btn.secondary{background:transparent;color:var(--accent);border:1px solid var(--accent)}
.will{color:#16a34a}.wont{color:#dc2626}.muted{color:var(--muted)}
.foot{color:var(--muted);font-size:12px;margin-top:24px}
form{margin:0}
</style></head><body><div class="wrap">${body}</div></body></html>`;
}

export function renderInstallPage(cfg: { appSlug: string; baseUrl: string }): string {
  const url = installUrl(cfg.appSlug);
  const cta = url
    ? `<a class="btn" href="${esc(url)}">Install on GitHub →</a>`
    : `<p class="muted">This CodeWorthy App isn't registered yet. <a href="/steward/app-manifest">Create the GitHub App</a> first (one click), then set <code>GITHUB_APP_SLUG</code>.</p>`;
  return page("Install CodeWorthy", `
<h1>🛡️ CodeWorthy — a senior engineer for your repo</h1>
<div class="sub">It protects your main branch, reviews changes before they land, and keeps a plain-language record — so you can build with AI and still ship safely.</div>
<div class="card">
  <h2>What it will do</h2>
  <ul>
    <li class="will">✓ Protect your default branch — changes go through a reviewable pull request, and CodeWorthy puts the protection back if it gets weakened</li>
    <li class="will">✓ Block the merge when its review finds something serious — its check is what your branch protection requires</li>
    <li class="will">✓ Catch secrets, committed <code>.env</code>/<code>node_modules</code>, and risky migrations before they merge</li>
    <li class="will">✓ Leave plain-language notes explaining every call, and a weekly digest</li>
    <li class="will">✓ Keep an append-only, tamper-evident change log (your SOC&nbsp;2 evidence)</li>
  </ul>
</div>
<div class="card">
  <h2>What it will never do</h2>
  <ul>
    <li class="wont">✗ Merge, force-push, or rewrite history — <b>you own every merge</b></li>
    <li class="wont">✗ Change your repo settings silently — branch protection only after you click "yes"</li>
    <li class="wont">✗ Send your code anywhere — the AI review tier is <b>off by default</b>, opt-in per repo, and discloses exactly what leaves</li>
  </ul>
</div>
${cta}
<div class="foot">You'll pick which repositories on the next screen. You can uninstall any time.</div>`);
}

export function renderSetupPage(o: { installationId: number | null; setupAction: string | null }): string {
  const installed = o.setupAction !== "update";
  const consent = o.installationId != null
    ? `<form method="post" action="/steward/setup/protect">
         <input type="hidden" name="installation_id" value="${esc(o.installationId)}">
         <button class="btn" type="submit">Protect my default branch →</button>
       </form>
       <p class="muted">This requires a pull request for changes to your default branch, requires CodeWorthy's review check to pass, and blocks force-pushes and deletions. <b>CodeWorthy will also keep it on:</b> if the rule is later weakened, it puts it back and records both the change and the fix. Reversible any time — turn the rule off in your GitHub settings and CodeWorthy records that choice instead of fighting it.</p>`
    : `<p class="muted">Couldn't read the installation id from GitHub — you can still turn on protection later from the digest.</p>`;
  return page("CodeWorthy is set up", `
<h1>✅ CodeWorthy is ${installed ? "installed" : "updated"}</h1>
<div class="sub">It's now watching your selected repositories. From here on, it logs what happens and can guard your main branch.</div>
<div class="card">
  <h2>One decision — the only setting that changes your repo</h2>
  <p>Turn on branch protection so changes to your default branch go through a reviewable pull request. Nothing else CodeWorthy does changes your settings.</p>
  ${consent}
</div>
<div class="foot">You'll get a weekly digest. Your live repo chart is always at <code>/steward/health.html?repo=owner/name</code>.</div>`);
}

export function renderProtectDonePage(results: Array<{ repo: string; ok: boolean; error?: string }>): string {
  const rows = results.map((r) => `<li>${r.ok ? "🟢" : "🔴"} <b>${esc(r.repo)}</b>${r.ok ? " — protected" : ` — couldn't protect${r.error ? ` (${esc(r.error)})` : ""}`}</li>`).join("");
  const anyOk = results.some((r) => r.ok);
  return page("Protection turned on", `
<h1>${anyOk ? "🛡️ Your default branch is protected" : "⚠️ Nothing was changed"}</h1>
<div class="sub">${anyOk ? "Changes now go through a reviewable pull request that CodeWorthy has to pass. Force-pushes and deletions are blocked, and if the rule is weakened CodeWorthy puts it back." : "No repositories were updated."}</div>
<div class="card"><h2>Repositories</h2><ul>${rows || "<li class='muted'>No repositories found for this installation.</li>"}</ul></div>
<div class="foot">Every change from here is logged in plain language. You own every merge.</div>`);
}

// One-click App registration: a form that POSTs the manifest to GitHub's
// app-creation page. GitHub reads the manifest, the operator confirms, and it
// redirects back to our callback with a temporary code.
export function renderManifestForm(manifest: AppManifest): string {
  const json = esc(JSON.stringify(manifest));
  return page("Create the CodeWorthy GitHub App", `
<h1>⚙️ Create the CodeWorthy GitHub App</h1>
<div class="sub">One click registers the App on your GitHub account with exactly the permissions below — read code, comment on PRs, and configure branch protection. No code-write, no merge scope.</div>
<div class="card"><h2>Permissions requested</h2><ul>
  <li>Contents — <b>read</b> (read the diff; never write)</li>
  <li>Pull requests — <b>write</b> (open drafts, post reviews)</li>
  <li>Administration — <b>write</b> (branch protection, on your consent)</li>
  <li>Checks — <b>write</b> (post the PR review check)</li>
  <li>Metadata — <b>read</b></li>
</ul></div>
<form action="https://github.com/settings/apps/new" method="post">
  <input type="hidden" name="manifest" value="${json}">
  <button class="btn" type="submit">Create App on GitHub →</button>
</form>
<div class="foot">After you confirm on GitHub, you'll be redirected back and shown the credentials to save.</div>`);
}

export function renderManifestCredentials(o: {
  id: number;
  slug: string;
  htmlUrl: string;
  pem: string;
  webhookSecret: string;
}): string {
  // GitHub returns the private key and webhook secret exactly once, in this
  // conversion response — so this page must SHOW them, ready to paste. The
  // PEM's newlines are escaped as \n (the server restores them on boot).
  const pemEscaped = o.pem.replace(/\r?\n/g, "\\n");
  const flyCommand = [
    "fly secrets set --app codeworthy-steward \\",
    `  GITHUB_APP_ID='${o.id}' \\`,
    `  GITHUB_APP_SLUG='${o.slug}' \\`,
    `  GITHUB_WEBHOOK_SECRET='${o.webhookSecret}' \\`,
    `  GITHUB_PRIVATE_KEY='${pemEscaped}'`,
  ].join("\n");
  return page("App created — save these", `
<h1>🎉 CodeWorthy App created</h1>
<div class="sub"><strong>Shown once.</strong> Copy the command below and run it now — GitHub will not display the private key or webhook secret again.</div>
<div class="card"><h2>One command sets everything</h2>
<pre style="white-space:pre-wrap;word-break:break-all">${esc(flyCommand)}</pre>
<p class="muted">Then redeploy: <code>fly deploy</code></p></div>
<a class="btn secondary" href="${esc(o.htmlUrl)}">Open the App on GitHub →</a>
<div class="foot">Once the secrets are set and deployed, share <code>/steward/install</code> with anyone who wants to add CodeWorthy to their repos.</div>`);
}

export interface ConsentDeps {
  client?: GitHubClient; // injected in tests
}

// Apply protection to the installation's repos — ONLY as the result of the human
// clicking "yes" on the setup page. Lists the repos, protects each, logs each.
export async function applyProtectionConsent(
  pool: Pool,
  installationId: number,
  deps: ConsentDeps = {}
): Promise<Array<{ repo: string; ok: boolean; error?: string }>> {
  const client = deps.client ?? (await getInstallationClient(installationId));
  const repos = await client.listInstallationRepositories();
  const results: Array<{ repo: string; ok: boolean; error?: string }> = [];
  for (const r of repos) {
    try {
      const applied = await ensureProtection(client, pool, r.full_name, installationId, {
        defaultBranch: r.default_branch || "main",
      });
      if (applied.action === "failed") results.push({ repo: r.full_name, ok: false, error: applied.detail });
      else results.push({ repo: r.full_name, ok: true });
    } catch (err) {
      results.push({ repo: r.full_name, ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return results;
}
