// The email transport seam — injectable, exactly like the WORM anchor.
//
//   ConsoleMailer (dev/no-config): renders and LOGS the email, never silently
//     drops it — you can see what would have gone out.
//   SmtpMailer (prod): nodemailer over any SMTP provider (dynamic-imported so a
//     deployment that never sends email doesn't load it).
//
// Tests inject a fake Mailer and assert on what was handed to send() — no SMTP,
// no network.

export interface MailMessage {
  to: string | string[];
  subject: string;
  html: string;
  text: string;
  from?: string;
}

export interface Mailer {
  send(msg: MailMessage): Promise<void>;
}

// Dev default. Prints a one-line summary + the text body so nothing is lost.
export class ConsoleMailer implements Mailer {
  constructor(private log: (line: string) => void = (l) => console.log(l)) {}
  send(msg: MailMessage): Promise<void> {
    const to = Array.isArray(msg.to) ? msg.to.join(", ") : msg.to;
    this.log(`[mail:console] to=${to} subject=${JSON.stringify(msg.subject)}\n${msg.text}`);
    return Promise.resolve();
  }
}

// Prod. `smtpUrl` is a standard connection string (e.g.
// smtps://user:pass@smtp.host:465). Credentials live in that env var, not here.
export class SmtpMailer implements Mailer {
  private transporter: any = null;
  constructor(private smtpUrl: string, private defaultFrom: string) {}
  private async tx() {
    if (!this.transporter) {
      const nodemailer = await import("nodemailer");
      this.transporter = nodemailer.createTransport(this.smtpUrl);
    }
    return this.transporter;
  }
  async send(msg: MailMessage): Promise<void> {
    const tx = await this.tx();
    await tx.sendMail({ from: msg.from ?? this.defaultFrom, to: msg.to, subject: msg.subject, html: msg.html, text: msg.text });
  }
}

// Resolve the configured mailer: SMTP when a URL is set, else the console mailer.
export function makeMailer(cfg: { smtpUrl?: string; from?: string }): Mailer {
  if (cfg.smtpUrl) return new SmtpMailer(cfg.smtpUrl, cfg.from ?? "CodeWorthy <steward@codeworthy.dev>");
  return new ConsoleMailer();
}
