import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { migrate } from "../../db/migrate.js";
import { appendAuditEvent } from "../audit/audit.js";
import { sendDigest } from "./send.js";
import { runDigestJob } from "./digest-job.js";
import { ConsoleMailer, makeMailer, SmtpMailer, type Mailer, type MailMessage } from "../mail/mailer.js";

const url = process.env.DATABASE_URL ?? "postgres://acme@localhost:55432/steward_test";
const pool = new Pool({ connectionString: url });

class FakeMailer implements Mailer {
  sent: MailMessage[] = [];
  send(msg: MailMessage) { this.sent.push(msg); return Promise.resolve(); }
}

const ev = (repo: string, eventType: string, plain: string, actor = "dana") =>
  appendAuditEvent(pool, { installationId: 1, repo, eventType, actor, payload: {}, plainEnglish: plain });

describe("digest sending", () => {
  beforeEach(async () => { await migrate(url); await pool.query("TRUNCATE audit_events"); });
  afterAll(async () => { await pool.end(); });

  it("renders and sends html + text, with an alert-led subject when something needs attention", async () => {
    await ev("acme/app", "protection.weakened", "branch protection on main in acme/app was weakened.");
    await ev("acme/app", "push.direct_to_default", "dana pushed 2 commits straight to main in acme/app — no PR.");
    const mailer = new FakeMailer();

    const res = await sendDigest(pool, mailer, { to: "founder@acme.com", repo: "acme/app" });
    expect(res.sent).toBe(true);
    expect(res.alertCount).toBe(2);
    expect(mailer.sent).toHaveLength(1);
    const msg = mailer.sent[0]!;
    expect(msg.to).toBe("founder@acme.com");
    expect(msg.subject).toMatch(/⚠️.*need your attention/);
    expect(msg.html).toContain("<!doctype html>");
    expect(msg.html).toContain("was weakened");
    expect(msg.text).toContain("NEEDS YOUR ATTENTION");
  });

  it("uses a calm all-clear subject on a quiet week", async () => {
    const mailer = new FakeMailer();
    const res = await sendDigest(pool, mailer, { to: "founder@acme.com", repo: "acme/app" });
    expect(res.alertCount).toBe(0);
    expect(mailer.sent[0]!.subject).toMatch(/all clear/i);
  });

  it("job is a no-op when no recipients are configured", async () => {
    const mailer = new FakeMailer();
    const out = await runDigestJob(pool, mailer, { to: "" });
    expect(out.status).toBe("no-recipients");
    expect(mailer.sent).toHaveLength(0);
  });

  it("job sends to each configured recipient", async () => {
    await ev("acme/app", "pull_request.opened", "raj opened PR #1 in acme/app.", "raj");
    const mailer = new FakeMailer();
    const out = await runDigestJob(pool, mailer, { to: "a@x.com, b@x.com", repo: "acme/app" });
    expect(out.status).toBe("sent");
    expect(mailer.sent[0]!.to).toEqual(["a@x.com", "b@x.com"]);
  });

  it("makeMailer picks console when no SMTP, SMTP when configured", () => {
    expect(makeMailer({})).toBeInstanceOf(ConsoleMailer);
    expect(makeMailer({ smtpUrl: "smtps://u:p@smtp.host:465" })).toBeInstanceOf(SmtpMailer);
  });

  it("console mailer logs rather than dropping silently", async () => {
    const lines: string[] = [];
    const mailer = new ConsoleMailer((l) => lines.push(l));
    await mailer.send({ to: "x@y.com", subject: "hi", html: "<p>", text: "body" });
    expect(lines.join("\n")).toMatch(/mail:console.*x@y\.com/s);
  });
});
