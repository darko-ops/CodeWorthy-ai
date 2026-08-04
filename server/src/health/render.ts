// Renders the repo health report as one self-contained, theme-aware doctor's-
// chart page — the single URL you pull up on demand (no login). Same visual
// language as the CLI checkup so the two read as one product.
import type { HealthReport, HealthVital, VitalStatus } from "./health.js";
import type { DigestEntry } from "../digest/digest.js";

const esc = (s: unknown) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

const VITAL_COLOR: Record<VitalStatus, string> = { healthy: "#16a34a", watch: "#d97706", "at risk": "#dc2626", unknown: "#9ca3af" };
const OVERALL_COLOR: Record<string, string> = { Healthy: "#16a34a", "Needs attention": "#d97706", "At risk": "#dc2626" };
const cls = (s: VitalStatus) => s.replace(" ", "-");

const entryDot = (e: DigestEntry) => {
  const t = e.eventType;
  if (t === "protection.weakened") return "🔴";
  if (t.startsWith("push.direct") || t.startsWith("mechanic.")) return "🟡";
  if (t.startsWith("pull_request") || t === "protection.configured") return "🟢";
  return "⚪";
};
const day = (iso: string) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export function renderHealthHtml(r: HealthReport): string {
  const title = r.repoFilter ? `Repo health — ${esc(r.repoFilter)}` : "Repo health";
  const needAttention = r.vitals.filter((v) => v.status !== "healthy" && v.status !== "unknown").length;

  const vitalRow = (v: HealthVital) => `
    <div class="vital ${cls(v.status)}">
      <div class="v-head"><span class="dot" style="background:${VITAL_COLOR[v.status]}"></span><span class="v-label">${esc(v.label)}</span><span class="v-status" style="color:${VITAL_COLOR[v.status]}">${v.status.toUpperCase()}</span></div>
      <div class="v-finding">${esc(v.finding)}</div>
      ${v.status !== "healthy" && v.prescription ? `<div class="v-rx"><b>Recommendation:</b> ${esc(v.prescription)}</div>` : ""}
    </div>`;

  const activityRow = (e: DigestEntry) =>
    `<div class="act"><span class="a-dot">${entryDot(e)}</span><div><div class="a-msg">${esc(e.plainEnglish)}</div><div class="a-meta">${esc(e.repo)} · ${esc(day(e.ts))}</div></div></div>`;

  const alertsBlock = r.activity.alerts.length
    ? `<h3>Needs your attention</h3>${r.activity.alerts.map(activityRow).join("")}`
    : "";
  const recentBlock = r.activity.recent.length
    ? `<h3>Recent activity</h3>${r.activity.recent.map(activityRow).join("")}`
    : `<div class="empty">No activity tracked in the last ${r.activity.windowDays} days.</div>`;

  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><style>
:root{--bg:#f7f9fa;--card:#fff;--ink:#0f172a;--muted:#64748b;--line:#e5e9ec}
@media(prefers-color-scheme:dark){:root{--bg:#0b1114;--card:#121a1f;--ink:#e7eef2;--muted:#8aa0ab;--line:#1e2a31}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}
.wrap{max-width:720px;margin:0 auto;padding:32px 20px}
.head{display:flex;justify-content:space-between;align-items:baseline;flex-wrap:wrap;gap:8px}
h1{font-size:20px;margin:0}.sub{color:var(--muted);font-size:13px}
h2{font-size:13px;margin:26px 0 10px;color:var(--muted);font-weight:600;text-transform:uppercase;letter-spacing:.03em}
h3{font-size:12px;margin:18px 0 8px;color:var(--muted);font-weight:600;text-transform:uppercase;letter-spacing:.03em}
.banner{margin:18px 0 8px;padding:16px 20px;border-radius:12px;background:var(--card);border:1px solid var(--line);display:flex;align-items:center;gap:14px}
.banner .big{font-size:22px;font-weight:700;color:${OVERALL_COLOR[r.overall] ?? "#64748b"}}
.banner .lede{color:var(--muted);font-size:13px}
.vital{background:var(--card);border:1px solid var(--line);border-left:4px solid var(--line);border-radius:10px;padding:14px 16px;margin-bottom:12px}
.vital.healthy{border-left-color:#16a34a}.vital.watch{border-left-color:#d97706}.vital.at-risk{border-left-color:#dc2626}.vital.unknown{border-left-color:#9ca3af}
.v-head{display:flex;align-items:center;gap:9px}.v-label{font-weight:600}.v-status{margin-left:auto;font-size:11px;font-weight:700;letter-spacing:.04em}
.dot{width:11px;height:11px;border-radius:50%;display:inline-block}
.v-finding{color:var(--ink);margin-top:6px;font-size:14px}
.v-rx{margin-top:8px;font-size:13px;color:var(--muted);background:rgba(127,127,127,.06);padding:8px 10px;border-radius:7px}
.act{display:flex;gap:10px;align-items:flex-start;background:var(--card);border:1px solid var(--line);border-radius:9px;padding:10px 12px;margin-bottom:7px}
.a-dot{font-size:12px;line-height:1.5}.a-msg{font-size:13.5px}.a-meta{color:var(--muted);font-size:12px;margin-top:2px}
.empty{color:var(--muted);font-size:13px;padding:8px 0}
.integ{margin-top:10px;padding:14px 16px;border-radius:10px;border:1px solid var(--line);background:var(--card)}
.integ .i-top{display:flex;align-items:center;gap:9px;font-weight:600}
.integ .i-detail{color:var(--muted);font-size:13px;margin-top:6px}
.foot{color:var(--muted);font-size:12px;margin-top:24px;border-top:1px solid var(--line);padding-top:14px;text-align:center}
</style></head><body><div class="wrap">
<div class="head"><h1>🩺 Repo health</h1><div class="sub">${esc(r.repoFilter ?? "all repositories")} · ${esc(r.generatedAt.slice(0, 10))}</div></div>
<div class="banner"><div class="big">${esc(r.overall)}</div><div class="lede">${needAttention === 0 ? "Everything looks healthy. Each vital is explained below, in plain language." : `${needAttention} vital(s) need attention. Each is explained below, with what to do.`}</div></div>

<h2>Vitals</h2>
${r.vitals.map(vitalRow).join("")}

<h2>Activity · last ${r.activity.windowDays} days · ${r.activity.total} event(s)</h2>
${alertsBlock}
${recentBlock}

<h2>Record integrity</h2>
<div class="integ">
  <div class="i-top"><span class="dot" style="background:${r.integrity.ok ? "#16a34a" : "#dc2626"}"></span>${esc(r.integrity.headline)}</div>
  <div class="i-detail">Hash chain: ${esc(r.integrity.chain)} · anchor: ${esc(r.integrity.anchor)}.<br>This is your change log's tamper-evidence — the append-only record a SOC&nbsp;2 auditor asks for.</div>
</div>

<div class="foot">${esc(r.note)}</div>
</div></body></html>`;
}
