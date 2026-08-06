// CodeWorthy Steward — webhook service.
//
// Env (all required unless noted):
//   PORT                    default 8080
//   DATABASE_URL            Neon Postgres (role: steward_app — INSERT/SELECT only)
//   GITHUB_APP_ID
//   GITHUB_APP_PRIVATE_KEY  PEM (with literal \n allowed)
//   GITHUB_WEBHOOK_SECRET
//   STEWARD_LOG_TOKEN       bearer token for the change-log/verify endpoints
//   STEWARD_LLM             "1" enables the advise-only AI review (optional)
//   ANTHROPIC_API_KEY       required only when STEWARD_LLM=1
import { createServer } from "node:http";
import pg from "pg";
import { appendEvent, verifyChain, changeLog } from "./audit.mjs";
import { TokenBroker, verifyWebhookSignature } from "./github.mjs";
import { handlePush } from "./handlers/push.mjs";
import { handlePullRequest, handleIssueComment } from "./handlers/pullRequest.mjs";

export function createStewardServer(env = process.env, deps = {}) {
  const pool = deps.pool ?? new pg.Pool({ connectionString: env.DATABASE_URL, max: 5 });
  const broker =
    deps.broker ??
    new TokenBroker({
      appId: env.GITHUB_APP_ID,
      privateKeyPem: (env.GITHUB_APP_PRIVATE_KEY ?? "").replace(/\\n/g, "\n"),
    });
  const audit = deps.audit ?? ((event) => appendEvent(pool, event));
  // pending micro-defense checks: "owner/repo#number" -> checkRunId.
  // In-memory is acceptable at MVP volume; a restart re-asks on the next push.
  const pendingMicroDefense = deps.pendingMicroDefense ?? new Map();

  // Sequential in-process queue: webhooks ack fast, work runs in order.
  let chain = Promise.resolve();
  const enqueue = (fn) => {
    chain = chain.then(fn).catch((err) => console.error("steward: handler error:", err.message));
    return chain;
  };

  const server = createServer((req, res) => {
    const respond = (status, body) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };

    if (req.method === "GET" && req.url === "/healthz") {
      return respond(200, { status: "ok" });
    }

    // Change log + chain verification (token-protected read surface).
    if (req.method === "GET" && req.url?.startsWith("/api/")) {
      const auth = req.headers.authorization ?? "";
      if (!env.STEWARD_LOG_TOKEN || auth !== `Bearer ${env.STEWARD_LOG_TOKEN}`) {
        return respond(401, { error: "unauthorized" });
      }
      const url = new URL(req.url, "http://localhost");
      const repo = url.searchParams.get("repo");
      if (!repo) return respond(400, { error: "repo query param required" });
      if (url.pathname === "/api/log") {
        return changeLog(pool, repo)
          .then((rows) => respond(200, { repo, events: rows }))
          .catch((err) => respond(500, { error: err.message }));
      }
      if (url.pathname === "/api/verify") {
        return verifyChain(pool, repo)
          .then((result) => respond(result.ok ? 200 : 409, result))
          .catch((err) => respond(500, { error: err.message }));
      }
      return respond(404, { error: "not found" });
    }

    if (req.method !== "POST" || req.url !== "/webhook") {
      return respond(404, { error: "not found" });
    }

    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks);
      if (!verifyWebhookSignature(env.GITHUB_WEBHOOK_SECRET, raw, req.headers["x-hub-signature-256"])) {
        return respond(401, { error: "bad signature" });
      }
      let payload;
      try {
        payload = JSON.parse(raw.toString("utf8"));
      } catch {
        return respond(400, { error: "bad json" });
      }
      const event = req.headers["x-github-event"];

      if (event === "push") {
        enqueue(() => handlePush({ payload, broker, audit }));
      } else if (event === "pull_request") {
        enqueue(async () => {
          const result = await handlePullRequest({ payload, broker, audit, env });
          if (result?.microDefense) {
            pendingMicroDefense.set(
              `${payload.repository.full_name}#${payload.pull_request.number}`,
              result.microDefense.checkRunId
            );
          }
        });
      } else if (event === "issue_comment") {
        enqueue(() =>
          handleIssueComment({ payload, broker, audit, pending: pendingMicroDefense })
        );
      } else if (event === "installation" || event === "installation_repositories") {
        enqueue(() =>
          audit({
            installationId: payload.installation.id,
            repo: payload.repositories?.[0]?.full_name ?? payload.repository?.full_name ?? "*",
            actor: payload.sender?.login ?? "unknown",
            eventType: `app_${event}_${payload.action}`,
            payload: { action: payload.action },
            plainEnglish: `CodeWorthy Steward was ${payload.action} by ${payload.sender?.login ?? "someone"}.`,
          })
        );
      }
      // Unknown events are acknowledged and ignored.
      respond(202, { queued: true });
    });
  });

  return { server, pool, enqueue: () => chain };
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop());
if (isMain) {
  const { server } = createStewardServer();
  const port = Number(process.env.PORT ?? 8080);
  server.listen(port, () => console.log(`codeworthy-steward listening on :${port}`));
}
