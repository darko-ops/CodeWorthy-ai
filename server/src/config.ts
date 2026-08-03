// Runtime configuration for the CodeWorthy backend service.
export const config = {
  port: parseInt(process.env.PORT ?? "8080", 10),
  databaseUrl: process.env.DATABASE_URL ?? "postgres://acme@localhost:55432/steward",
  github: {
    appId: process.env.GITHUB_APP_ID ?? "",
    webhookSecret: process.env.GITHUB_WEBHOOK_SECRET ?? "",
    // PEM stored with escaped newlines in env; restore real newlines here.
    privateKey: (process.env.GITHUB_PRIVATE_KEY ?? "").replace(/\\n/g, "\n"),
  },
  // M3. Off unless explicitly enabled AND the installation opts in. The
  // deterministic gate and checkup never call out; only this tier does.
  llmEnabled: process.env.STEWARD_LLM_ENABLED === "1",
};
