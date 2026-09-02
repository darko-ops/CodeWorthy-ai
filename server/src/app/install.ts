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
// The permission list shown here is DERIVED from the manifest being posted, not
// written by hand beside it. It was hand-written once, and when the approver
// flow reused this form it advertised the Steward's permissions — telling the
// user they were granting Administration and Checks write on an App that asks
// for neither. A consent screen that misstates the grant is worse than no
// consent screen, and the only way to keep the two from drifting is to stop
// having two of them.
const PERMISSION_NOTES: Record<string, string> = {
  contents: "read the diff",
  pull_requests: "open drafts, post reviews",
  administration: "branch protection, on your consent",
  checks: "post the PR review check",
  issues: "post comments on pull requests",
  metadata: "required baseline",
};

export function renderManifestForm(manifest: AppManifest): string {
  const json = esc(JSON.stringify(manifest));
  const perms = Object.entries(manifest.default_permissions)
    .map(([name, level]) => {
      const label = name.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
      const note = PERMISSION_NOTES[name];
      return `<li>${esc(label)} — <b>${esc(level)}</b>${note ? ` (${esc(note)})` : ""}</li>`;
    })
    .join("");
  // Saying what it CANNOT do matters as much as what it can, and this is also
  // derived — so an App that later gained a permission stops claiming it lacks it.
  const granted = new Set(Object.keys(manifest.default_permissions));
  const absent = [
    !granted.has("administration") && "change your repository settings",
    !granted.has("checks") && "post the check that gates a merge",
    manifest.default_permissions.contents !== "write" && "write code",
  ].filter(Boolean) as string[];

  return page(`Create ${manifest.name}`, `
<h1>⚙️ Create ${esc(manifest.name)}</h1>
<div class="sub">One click registers this App on your GitHub account with exactly the permissions below — nothing more. There is no merge scope on GitHub, and none of CodeWorthy's Apps can merge.</div>
<div class="card"><h2>Permissions requested</h2><ul>${perms}</ul></div>
${absent.length ? `<div class="card"><h2>What it cannot do</h2><ul>${absent.map((a) => `<li class="wont">✗ ${esc(a)}</li>`).join("")}</ul></div>` : ""}
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


// ── the approver's front door ───────────────────────────────────────────────
export function renderApproverPage(o: { configured: boolean; strict: boolean; slug: string | null }): string {
  const status = o.configured
    ? `<p class="will">✓ An approver is configured. Branch protection on shared repos now requires one approving review, and this App is what gives it.</p>`
    : `<p class="muted">No approver is configured yet. Until one exists, CodeWorthy never requires an approving review — a required approval nobody can give is an unmergeable repository.</p>`;
  const install = o.slug
    ? `<a class="btn secondary" href="https://github.com/apps/${esc(o.slug)}/installations/new">Install the Approver on your repos →</a>`
    : "";
  return page("CodeWorthy Approver", `
<h1>⚖️ The Approver</h1>
<div class="sub">A second App, with its own identity. CodeWorthy reviews; this approves — and the two are deliberately not the same actor.</div>
<div class="card">
  <h2>What it does</h2>
  <ul>
    <li>Reads CodeWorthy's verdict for the exact commit under review.</li>
    <li>Approves when every blocking finding is <b>fixed</b>, or <b>waived by a person who gave a reason</b>.</li>
    <li><b>Refuses</b> otherwise — and refusing is the point. An approver that always approves is worse than none: it manufactures evidence that a control operated when it didn't.</li>
    <li>Never approves a commit it has no verdict for. A verdict on an earlier commit says nothing about this one.</li>
  </ul>
</div>
<div class="card">
  <h2>What it can't do</h2>
  <ul>
    <li class="wont">✗ Merge, push, or change your settings</li>
    <li class="wont">✗ Post the check that gates the merge — that's the reviewer's, and one actor doing both would be approving its own work</li>
    <li class="wont">✗ Waive a finding on its own behalf. Neither can CodeWorthy. Only a person can accept a risk.</li>
  </ul>
</div>
<div class="card">
  <h2>Mode</h2>
  <p>${o.strict
    ? "<b>Strict.</b> It also forms its own independent read of the diff, and can withhold approval on that basis alone — it can never grant one the base rules would have refused."
    : "<b>Standard.</b> It checks that CodeWorthy's findings were dealt with. Set <code>APPROVER_STRICT=1</code> for an independent second review as well."}</p>
</div>
${status}
<form action="/steward/approver-manifest" method="get" style="display:inline-block;margin-right:10px">
  <button class="btn" type="submit">Create the Approver App →</button>
</form>
${install}
<div class="foot">Waive a finding by commenting on the pull request: <code>@codeworthy waive &lt;finding_id&gt;: why this is acceptable here</code></div>`);
}

export function renderApproverCredentials(o: { id: number; slug: string; htmlUrl: string; pem: string; webhookSecret: string }): string {
  const pemEscaped = o.pem.replace(/\r?\n/g, "\\n");
  const flyCommand = [
    "fly secrets set --app codeworthy-steward \\",
    `  APPROVER_APP_ID='${o.id}' \\`,
    `  APPROVER_PRIVATE_KEY='${pemEscaped}'`,
  ].join("\n");
  return page("Approver created — save these", `
<h1>⚖️ Approver App created</h1>
<div class="sub"><strong>Shown once.</strong> These are the approver's OWN credentials — separate from the Steward's on purpose. Sharing them would collapse the two actors into one.</div>
<div class="card"><h2>One command</h2>
<pre style="white-space:pre-wrap;word-break:break-all">${esc(flyCommand)}</pre>
<p class="muted">Then redeploy, and install the App on the repositories you want it to approve.</p></div>
<a class="btn secondary" href="${esc(o.htmlUrl)}">Open the App on GitHub →</a>
<div class="foot">Once it's installed, shared-mode repos will require one approving review — and this App is what gives it.</div>`);
}
