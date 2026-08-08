// Renderers for the weekly digest: a self-contained, theme-aware HTML page (the
// founder-facing artifact and the auditor's change log), and a plain-text
// version for email.
import type { Digest, DigestEntry, Tone } from "./digest.js";

const esc = (s: unknown) =>
  String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

const TONE_COLOR: Record<Tone, string> = { alert: "#dc2626", attention: "#d97706", good: "#16a34a", neutral: "#64748b" };
const TONE_DOT: Record<Tone, string> = { alert: "🔴", attention: "🟡", good: "🟢", neutral: "⚪" };

function toneOf(eventType: string): Tone {
  if (eventType === "protection.weakened" || eventType.startsWith("exception.")) return "alert";
  if (eventType.startsWith("push.direct") || eventType.startsWith("mechanic.")) return "attention";
  if (eventType.startsWith("pull_request") || eventType === "change.merged" || eventType === "protection.configured") return "good";
  return "neutral";
}

const day = (iso: string) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export function renderDigestHtml(d: Digest): string {
  const title = d.repoFilter ? `Your week on ${esc(d.repoFilter)}` : "Your week on CodeWorthy";
  const entryRow = (e: DigestEntry) => {
    const t = toneOf(e.eventType);
    return `<div class="entry ${t}"><span class="dot">${TONE_DOT[t]}</span><div><div class="msg">${esc(e.plainEnglish)}</div><div class="meta">${esc(e.repo)} · ${esc(day(e.ts))}</div></div></div>`;
  };
  const alertsBlock = d.alerts.length
    ? `<section class="attn"><h2>Needs your attention</h2>${d.alerts.map(entryRow).join("")}</section>`
    : `<section class="allgood">🟢 Nothing needs your attention this period.</section>`;
  const sections = d.sections
    .map((s) => `<section class="sec"><h3><span style="color:${TONE_COLOR[s.tone]}">${TONE_DOT[s.tone]}</span> ${esc(s.label)} <span class="count">${s.count}</span></h3>${s.entries.map(entryRow).join("")}</section>`)
    .join("");

  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><style>
:root{--bg:#f7f9fa;--card:#fff;--ink:#0f172a;--muted:#64748b;--line:#e5e9ec}
@media(prefers-color-scheme:dark){:root{--bg:#0b1114;--card:#121a1f;--ink:#e7eef2;--muted:#8aa0ab;--line:#1e2a31}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.55 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}
.wrap{max-width:720px;margin:0 auto;padding:32px 20px}
h1{font-size:20px;margin:0 0 2px}.sub{color:var(--muted);font-size:13px}
.headline{margin:18px 0 22px;padding:16px 18px;border-radius:12px;background:var(--card);border:1px solid var(--line);font-size:15px}
h2{font-size:15px;margin:22px 0 10px}h3{font-size:13px;margin:20px 0 8px;color:var(--muted);font-weight:600;text-transform:uppercase;letter-spacing:.03em}
.count{color:var(--muted);font-weight:400}
.entry{display:flex;gap:10px;align-items:flex-start;background:var(--card);border:1px solid var(--line);border-left:4px solid var(--line);border-radius:9px;padding:11px 13px;margin-bottom:8px}
.entry.alert{border-left-color:#dc2626}.entry.attention{border-left-color:#d97706}.entry.good{border-left-color:#16a34a}
.dot{font-size:12px;line-height:1.5}.msg{font-size:14px}.meta{color:var(--muted);font-size:12px;margin-top:3px}
.attn h2{color:#d97706}.allgood{color:var(--muted);padding:14px 0}
.foot{color:var(--muted);font-size:12px;margin-top:26px;border-top:1px solid var(--line);padding-top:14px}
</style></head><body><div class="wrap">
<h1>🗓️ ${esc(title)}</h1><div class="sub">last ${d.periodDays} days · ${esc(d.generatedAt.slice(0, 10))} · ${d.totalEvents} event(s)</div>
<div class="headline">${esc(d.headline)}</div>
${alertsBlock}
${sections}
<div class="foot">This is your change log — a plain-language record of what happened, and the change-control evidence a SOC&nbsp;2 auditor asks for. Every line is drawn from an append-only audit trail.</div>
</div></body></html>`;
}

export function renderDigestText(d: Digest): string {
  const lines = [`Your week on ${d.repoFilter ?? "CodeWorthy"} (last ${d.periodDays} days)`, "", d.headline, ""];
  if (d.alerts.length) {
    lines.push("NEEDS YOUR ATTENTION:");
    for (const e of d.alerts) lines.push(`  - ${e.plainEnglish}`);
    lines.push("");
  }
  lines.push("TIMELINE:");
  for (const e of d.timeline) lines.push(`  ${day(e.ts)}  ${e.plainEnglish}`);
  lines.push("", "This is your change log — also your SOC 2 change-control evidence.");
  return lines.join("\n");
}
