import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { migrate } from "../../db/migrate.js";
import { appendAuditEvent } from "../audit/audit.js";
import { InMemoryAnchor, anchorAuditHead } from "../audit/tamper.js";
import { buildHealthReport } from "./health.js";
import { renderHealthHtml } from "./render.js";

const url = process.env.DATABASE_URL ?? "postgres://acme@localhost:55432/steward_test";
const pool = new Pool({ connectionString: url });

const ev = (repo: string, eventType: string, plainEnglish: string, actor = "codeworthy-steward") =>
  appendAuditEvent(pool, { installationId: 1, repo, eventType, actor, payload: {}, plainEnglish });

const vital = (r: Awaited<ReturnType<typeof buildHealthReport>>, id: string) => r.vitals.find((v) => v.id === id)!;

describe("repo health page", () => {
  beforeEach(async () => { await migrate(url); await pool.query("TRUNCATE audit_events"); });
  afterAll(async () => { await pool.end(); });

  it("reads healthy when protection is on, changes go through PRs, and the record verifies", async () => {
    await ev("acme/app", "protection.configured", "CodeWorthy turned on branch protection for main in acme/app.");
    await ev("acme/app", "pull_request.opened", "raj opened PR #1 in acme/app.", "raj");
    await ev("acme/app", "pull_request.merged", "PR #1 in acme/app was merged.", "raj");

    const r = await buildHealthReport(pool, { repo: "acme/app" }, { anchor: null });
    expect(r.overall).toBe("Healthy");
    expect(vital(r, "protection").status).toBe("healthy");
    expect(vital(r, "review_discipline").status).toBe("healthy");
    expect(vital(r, "integrity").status).toBe("healthy");
    expect(r.integrity.ok).toBe(true);
  });

  it("goes At risk when protection was weakened and changes skipped review", async () => {
    await ev("acme/app", "protection.configured", "protection on.");
    await ev("acme/app", "push.direct_to_default", "dana pushed 2 commits straight to main in acme/app — no PR.", "dana");
    await ev("acme/app", "protection.weakened", "Heads up: branch protection on main in acme/app was weakened.");

    const r = await buildHealthReport(pool, { repo: "acme/app" }, { anchor: null });
    expect(r.overall).toBe("At risk");
    expect(vital(r, "protection").status).toBe("at risk"); // latest protection event wins
    expect(vital(r, "review_discipline").status).toBe("at risk"); // direct push, no PRs
    // the weakening surfaces in the activity alerts too
    expect(r.activity.alerts.map((a) => a.eventType)).toContain("protection.weakened");
  });

  it("watches (not at-risk) when most changes are PRs but some slipped direct", async () => {
    await ev("acme/app", "protection.configured", "protection on.");
    await ev("acme/app", "pull_request.opened", "PR opened.");
    await ev("acme/app", "push.direct_to_default", "one slipped straight to main.", "dana");

    const r = await buildHealthReport(pool, { repo: "acme/app" }, { anchor: null });
    expect(vital(r, "review_discipline").status).toBe("watch");
  });

  it("flags integrity At risk when the log is tampered — even with vitals otherwise green", async () => {
    await ev("acme/app", "protection.configured", "protection on.");
    await ev("acme/app", "pull_request.opened", "PR opened.");
    const anchor = new InMemoryAnchor();
    await anchorAuditHead(pool, anchor);

    // Rewrite history: truncate + rebuild (a valid-but-different chain).
    await pool.query("ALTER TABLE audit_events DISABLE TRIGGER audit_events_no_mutation");
    await pool.query("TRUNCATE audit_events");
    await pool.query("ALTER TABLE audit_events ENABLE TRIGGER audit_events_no_mutation");
    await ev("acme/app", "protection.configured", "rewritten");

    const r = await buildHealthReport(pool, { repo: "acme/app" }, { anchor });
    expect(vital(r, "integrity").status).toBe("at risk");
    expect(r.integrity.ok).toBe(false);
    expect(r.overall).toBe("At risk");
  });

  it("renders a self-contained doctor's-chart page with all three sections", async () => {
    await ev("acme/app", "protection.configured", "CodeWorthy turned on branch protection for main in acme/app.");
    await ev("acme/app", "pull_request.opened", "raj opened PR #1 in acme/app.", "raj");

    const r = await buildHealthReport(pool, { repo: "acme/app" }, { anchor: null });
    const html = renderHealthHtml(r);
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("🩺 Repo health");
    expect(html).toContain("acme/app");
    expect(html).toContain("Vitals");
    expect(html).toContain("Branch protection");
    expect(html).toContain("Record integrity");
    expect(html).toMatch(/prefers-color-scheme: ?dark/); // theme-aware
    expect(html).toContain("not a judgement of any person"); // ethics note
  });
});
