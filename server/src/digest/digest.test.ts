import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { migrate } from "../../db/migrate.js";
import { appendAuditEvent } from "../audit/audit.js";
import { buildDigest } from "./digest.js";
import { renderDigestHtml, renderDigestText } from "./render.js";

const url = process.env.DATABASE_URL ?? "postgres://acme@localhost:55432/steward_test";
const pool = new Pool({ connectionString: url });

async function seed() {
  await appendAuditEvent(pool, { installationId: 1, repo: "acme/app", eventType: "push.direct_to_default", actor: "dana", payload: {}, plainEnglish: "dana pushed 2 commits straight to main in acme/app — no pull request reviewed them." });
  await appendAuditEvent(pool, { installationId: 1, repo: "acme/app", eventType: "protection.weakened", actor: "codeworthy-steward", payload: {}, plainEnglish: "Heads up: branch protection on main in acme/app was weakened — force-pushes are now allowed." });
  await appendAuditEvent(pool, { installationId: 1, repo: "acme/app", eventType: "pull_request.opened", actor: "raj", payload: {}, plainEnglish: "raj opened PR #14 in acme/app." });
  await appendAuditEvent(pool, { installationId: 1, repo: "other/repo", eventType: "protection.configured", actor: "codeworthy-steward", payload: {}, plainEnglish: "CodeWorthy turned on branch protection for main in other/repo." });
}

describe("weekly digest", () => {
  beforeEach(async () => { await migrate(url); await pool.query("TRUNCATE audit_events"); await seed(); });
  afterAll(async () => { await pool.end(); });

  it("summarizes recent activity for one repo, alerts first", async () => {
    const d = await buildDigest(pool, { repo: "acme/app", periodDays: 7 });
    expect(d.totalEvents).toBe(3); // other/repo excluded
    expect(d.headline).toMatch(/weakened/i);
    expect(d.headline).toMatch(/straight to the default branch/i);
    // alerts carry the weakening and the skipped-review push
    expect(d.alerts.map((a) => a.eventType).sort()).toEqual(["protection.weakened", "push.direct_to_default"]);
    // the alert section sorts before the good section
    expect(d.sections[0]!.tone).toBe("alert");
  });

  it("covers all repos when no repo filter is given", async () => {
    const d = await buildDigest(pool);
    expect(d.totalEvents).toBe(4);
  });

  it("handles a quiet period without crashing", async () => {
    await pool.query("TRUNCATE audit_events");
    const d = await buildDigest(pool, { repo: "acme/app" });
    expect(d.totalEvents).toBe(0);
    expect(d.headline).toMatch(/quiet week/i);
    expect(d.alerts).toEqual([]);
    expect(renderDigestHtml(d)).toContain("Nothing needs your attention");
  });

  it("renders a self-contained HTML page with the plain-language findings", async () => {
    const d = await buildDigest(pool, { repo: "acme/app" });
    const html = renderDigestHtml(d);
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("Your week on acme/app");
    expect(html).toContain("Needs your attention");
    expect(html).toContain("was weakened");
    expect(html).toMatch(/prefers-color-scheme: ?dark/); // theme-aware
  });

  it("renders a plain-text version for email", async () => {
    const d = await buildDigest(pool, { repo: "acme/app" });
    const txt = renderDigestText(d);
    expect(txt).toContain("NEEDS YOUR ATTENTION");
    expect(txt).toContain("SOC 2");
  });
});
