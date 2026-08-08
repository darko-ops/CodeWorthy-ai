// The install-flow routes. Human-facing HTML (no API auth) — the front door and
// the post-install consent. Kept in its own module so the webhook/audit spine
// stays clean.
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { config } from "../config.js";
import { buildAppManifest } from "./manifest.js";
import {
  applyProtectionConsent,
  page,
  renderInstallPage,
  renderManifestCredentials,
  renderManifestForm,
  renderProtectDonePage,
  renderSetupPage,
} from "./install.js";

export function registerAppRoutes(app: FastifyInstance, pool: Pool) {
  // Parse the consent form post. Different content-type from the webhook's JSON
  // parser, so this is additive.
  app.addContentTypeParser("application/x-www-form-urlencoded", { parseAs: "string" }, (_req, body, done) => {
    const out: Record<string, string> = {};
    for (const pair of String(body).split("&")) {
      if (!pair) continue;
      const [k, v = ""] = pair.split("=");
      if (!k) continue;
      out[decodeURIComponent(k)] = decodeURIComponent(v.replace(/\+/g, " "));
    }
    done(null, out);
  });

  const html = (reply: any, body: string) => reply.type("text/html").send(body);

  // The consent landing page.
  app.get("/steward/install", async (_req, reply) => html(reply, renderInstallPage({ appSlug: config.appSlug, baseUrl: config.baseUrl })));

  // Post-install: GitHub redirects the user here (the App's Setup URL).
  app.get("/steward/setup", async (req, reply) => {
    const q = req.query as { installation_id?: string; setup_action?: string };
    const installationId = q.installation_id ? parseInt(q.installation_id, 10) : null;
    html(reply, renderSetupPage({ installationId, setupAction: q.setup_action ?? null }));
  });

  // The one consented action: turn on branch protection for the installation.
  app.post("/steward/setup/protect", async (req, reply) => {
    const body = req.body as { installation_id?: string };
    const installationId = body?.installation_id ? parseInt(body.installation_id, 10) : NaN;
    if (!Number.isFinite(installationId)) {
      return html(reply.code(400), page("Missing installation", "<h1>Missing installation id</h1><p class='muted'>Re-open the setup link from GitHub.</p>"));
    }
    try {
      const results = await applyProtectionConsent(pool, installationId);
      html(reply, renderProtectDonePage(results));
    } catch (err) {
      app.log.error({ err }, "protection consent failed");
      html(reply.code(502), page("Couldn't reach GitHub", "<h1>⚠️ Couldn't turn on protection</h1><p class='muted'>GitHub didn't respond as expected. You can retry from the digest, or set it in your repo settings.</p>"));
    }
  });

  // One-click App registration (manifest flow).
  app.get("/steward/app-manifest", async (_req, reply) => html(reply, renderManifestForm(buildAppManifest(config.baseUrl))));

  // GitHub redirects here with a temporary ?code after the App is created; we
  // exchange it for the App's credentials and show them once.
  app.get("/steward/app-manifest/callback", async (req, reply) => {
    const code = (req.query as { code?: string }).code;
    if (!code) return html(reply.code(400), page("Missing code", "<h1>Missing code</h1><p class='muted'>Start from <a href='/steward/app-manifest'>Create the App</a>.</p>"));
    try {
      const res = await fetch(`https://api.github.com/app-manifests/${encodeURIComponent(code)}/conversions`, {
        method: "POST",
        headers: {
          accept: "application/vnd.github+json",
          "x-github-api-version": "2022-11-28",
          "user-agent": "codeworthy-steward",
        },
      });
      if (!res.ok) throw new Error(`GitHub conversion -> ${res.status}`);
      const appData = (await res.json()) as {
        id: number;
        slug: string;
        html_url: string;
        pem: string;
        webhook_secret: string;
      };
      html(
        reply,
        renderManifestCredentials({
          id: appData.id,
          slug: appData.slug,
          htmlUrl: appData.html_url,
          pem: appData.pem,
          webhookSecret: appData.webhook_secret,
        })
      );
    } catch (err) {
      app.log.error({ err }, "manifest conversion failed");
      html(reply.code(502), page("Couldn't finish", "<h1>⚠️ App creation didn't complete</h1><p class='muted'>The one-time code may have expired. Start again from <a href='/steward/app-manifest'>Create the App</a>.</p>"));
    }
  });
}
