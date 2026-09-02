// The repo dashboard — where a signed-in GitHub user watches Steward's activity
// on a repo it's installed on. Live data from the Fly backend, degrading to calm
// states when the server is asleep (trial) or a repo has no history yet.
import { useEffect, useMemo, useState } from "react";
import { FixPath, ModeSwitch } from "./FixPath";
import { Navigate } from "react-router-dom";
import {
  apiGet,
  ApiError,
  digestUrl,
  installUrl,
  type ActivityEvent,
  type DigestEntry,
  type HealthReport,
  type HealthVital,
  type InstallationSummary,
  type Overall,
  type OverviewReport,
  type RepoOverview,
  type RepoSummary,
  type VitalStatus,
} from "../../api";

// Look-back windows offered by the control (days).
const WINDOWS = [7, 30, 90] as const;
import { useGitHubAuth } from "../../github-auth";
import { Wordmark } from "../../components/Wordmark";
import { VitalsMeter } from "../../components/VitalsMeter";

// A short, human relative time ("3h ago") from an ISO timestamp.
function ago(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const s = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

// A calm word for each event family, and whether it reads as an alert.
function eventTone(type: string): "ok" | "watch" | "note" {
  if (/blocked|leak|secret|force|risky|serious|critical/i.test(type)) return "watch";
  if (/protection|installed|configured|created/i.test(type)) return "ok";
  return "note";
}

export function RepoDashboard() {
  const { user, status, signOut } = useGitHubAuth();

  const [installs, setInstalls] = useState<InstallationSummary[] | null>(null);
  const [installErr, setInstallErr] = useState<ApiError | null>(null);
  const [repos, setRepos] = useState<Record<number, RepoSummary[]>>({});
  const [selectedRepo, setSelectedRepo] = useState<string | null>(null);
  const [activity, setActivity] = useState<ActivityEvent[] | null>(null);
  const [activityErr, setActivityErr] = useState<ApiError | null>(null);
  const [activityLoading, setActivityLoading] = useState(false);
  const [health, setHealth] = useState<HealthReport | null>(null);
  // Bumped after a fix action so the checkup re-reads. The action already
  // changed the world (protection applied, mode set, finding accepted); this is
  // what makes the page agree with it.
  const [healthNonce, setHealthNonce] = useState(0);
  const [windowDays, setWindowDays] = useState<number>(30);
  const [filter, setFilter] = useState("");
  const [overview, setOverview] = useState<OverviewReport | null>(null);

  // Load installations once authed.
  useEffect(() => {
    if (status !== "authed") return;
    let live = true;
    apiGet<InstallationSummary[]>("/api/me/installations")
      .then((list) => {
        if (!live) return;
        setInstalls(list);
        setInstallErr(null);
      })
      .catch((e) => live && setInstallErr(e instanceof ApiError ? e : new ApiError("server", String(e))));
    return () => {
      live = false;
    };
  }, [status]);

  // The portfolio overview — one call powers the main dashboard AND the rail's
  // per-repo status dots + flag badges, so a problem repo is visible without
  // opening it. Refreshes with the window.
  useEffect(() => {
    if (status !== "authed") return;
    let live = true;
    apiGet<OverviewReport>(`/api/me/overview?days=${windowDays}`)
      .then((o) => live && setOverview(o))
      .catch(() => live && setOverview(null));
    return () => {
      live = false;
    };
  }, [status, windowDays]);

  // Per-repo overview keyed by full name (rail badges + status dots).
  const byRepo = useMemo(() => {
    const m: Record<string, RepoOverview> = {};
    for (const r of overview?.repos ?? []) m[r.full_name] = r;
    return m;
  }, [overview]);

  // Load repos for each installation as installs arrive.
  useEffect(() => {
    if (!installs) return;
    let live = true;
    for (const inst of installs) {
      apiGet<RepoSummary[]>(`/api/installations/${inst.id}/repositories`)
        .then((rs) => live && setRepos((prev) => ({ ...prev, [inst.id]: rs })))
        .catch(() => live && setRepos((prev) => ({ ...prev, [inst.id]: [] })));
    }
    return () => {
      live = false;
    };
  }, [installs]);

  // Default view is the Overview (selectedRepo == null); repos are drilled into
  // from the rail or the overview cards.

  // Load the selected repo's health checkup (vitals + integrity) over the chosen
  // window. Best-effort: a failure just hides the card, never blocks activity.
  useEffect(() => {
    if (!selectedRepo) return;
    let live = true;
    setHealth(null);
    apiGet<HealthReport>(`/api/repos/${selectedRepo}/health?days=${windowDays}`)
      .then((h) => live && setHealth(h))
      .catch(() => live && setHealth(null));
    return () => {
      live = false;
    };
  }, [selectedRepo, windowDays, healthNonce]);

  // Load the selected repo's activity over the chosen window.
  useEffect(() => {
    if (!selectedRepo) return;
    let live = true;
    setActivityLoading(true);
    setActivityErr(null);
    apiGet<ActivityEvent[]>(`/api/repos/${selectedRepo}/activity?limit=200&days=${windowDays}`)
      .then((ev) => {
        if (!live) return;
        setActivity(ev);
      })
      .catch((e) => {
        if (!live) return;
        setActivity(null);
        setActivityErr(e instanceof ApiError ? e : new ApiError("server", String(e)));
      })
      .finally(() => live && setActivityLoading(false));
    return () => {
      live = false;
    };
  }, [selectedRepo, windowDays]);

  // --- Gate / global states ---
  if (status === "anon") return <Navigate to="/login" replace />;
  if (status === "loading") return <DashShell><Waking label="Loading your account…" /></DashShell>;
  if (status === "offline") {
    return (
      <DashShell>
        <Waking label="Steward is waking up — the backend is on a free-tier machine that sleeps between visits. This will connect in a moment." />
      </DashShell>
    );
  }

  const allRepos: RepoSummary[] = (installs ?? []).flatMap((i) => repos[i.id] ?? []);

  return (
    <DashShell user={user?.login ?? undefined} onSignOut={signOut}>
      <div className="repo-dash">
        <aside className="repo-rail">
          <button
            className={"repo-overview-nav" + (selectedRepo === null ? " selected" : "")}
            onClick={() => setSelectedRepo(null)}
          >
            <span className="repo-overview-icon" aria-hidden>▦</span>
            Overview
            {overview && overview.totals.atRisk + overview.totals.needsAttention > 0 && (
              <span className="repo-flag">{overview.totals.atRisk + overview.totals.needsAttention}</span>
            )}
          </button>
          <div className="repo-rail-head">Your repositories</div>
          {allRepos.length > 6 && (
            <input
              className="repo-search"
              type="search"
              placeholder="Filter repositories…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              aria-label="Filter repositories"
            />
          )}
          {installErr && <RailNote err={installErr} />}
          {installs && installs.length === 0 && (
            <div className="repo-empty-rail">
              CodeWorthy isn't installed on any repos yet.
              <a className="repo-link" href={installUrl} target="_blank" rel="noreferrer">Add a repository →</a>
            </div>
          )}
          {(installs ?? []).map((inst) => {
            const list = (repos[inst.id] ?? []).filter((r) =>
              filter ? r.full_name.toLowerCase().includes(filter.toLowerCase()) : true
            );
            if (repos[inst.id] && filter && list.length === 0) return null;
            return (
              <div key={inst.id} className="repo-group">
                <div className="repo-account">
                  {inst.avatar && <img src={inst.avatar} alt="" width={16} height={16} />}
                  <span>{inst.account}</span>
                </div>
                {list.map((r) => {
                  const o = byRepo[r.full_name];
                  const flagged = o?.flagged ?? 0;
                  return (
                    <button
                      key={r.full_name}
                      className={"repo-item" + (r.full_name === selectedRepo ? " selected" : "")}
                      onClick={() => setSelectedRepo(r.full_name)}
                    >
                      {o && (
                        <span
                          className="repo-status-dot"
                          style={{ background: OVERALL_DOT[o.overall] }}
                          title={o.overall}
                          aria-hidden
                        />
                      )}
                      <span className="repo-item-name">{r.name}</span>
                      {flagged > 0 ? (
                        <span className="repo-flag" title={`${flagged} flagged in the last ${windowDays} days`}>
                          {flagged}
                        </span>
                      ) : (
                        r.private && <span className="repo-badge">private</span>
                      )}
                    </button>
                  );
                })}
                {!repos[inst.id] && <div className="repo-item-loading">loading…</div>}
              </div>
            );
          })}
          {installs && installs.length > 0 && (
            <a className="repo-add" href={installUrl} target="_blank" rel="noreferrer">
              <span aria-hidden>＋</span> Add a repository
            </a>
          )}
        </aside>

        <section className="repo-main">
          {!selectedRepo ? (
            allRepos.length === 0 && installs ? (
              <div className="repo-blank">
                <h2>Nothing to watch yet</h2>
                <p className="hint">
                  Once CodeWorthy is installed on a repository, it shows up here.{" "}
                  <a className="repo-link" href={installUrl} target="_blank" rel="noreferrer">Add a repository →</a>
                </p>
              </div>
            ) : overview ? (
              <OverviewPanel
                report={overview}
                windowDays={windowDays}
                onWindow={setWindowDays}
                onSelect={setSelectedRepo}
              />
            ) : (
              <Waking label="Building your overview…" />
            )
          ) : (
            <>
              <header className="repo-header">
                <div>
                  <button className="repo-back" onClick={() => setSelectedRepo(null)}>
                    ← Overview
                  </button>
                  <h1 className="repo-title">{selectedRepo}</h1>
                </div>
                <div className="repo-header-right">
                  <div className="window-control" role="tablist" aria-label="Time window">
                    {WINDOWS.map((d) => (
                      <button
                        key={d}
                        role="tab"
                        aria-selected={windowDays === d}
                        className={windowDays === d ? "selected" : ""}
                        onClick={() => setWindowDays(d)}
                      >
                        {d}d
                      </button>
                    ))}
                  </div>
                  <SummaryLink repo={selectedRepo} days={windowDays} />
                </div>
              </header>

              {health && (
                <HealthCard
                  report={health}
                  windowDays={windowDays}
                  activity={activity}
                  onChanged={() => setHealthNonce((n) => n + 1)}
                />
              )}

              {activityLoading && !activity && <Waking label="Reading the change log…" />}
              {activityErr && <ActivityError err={activityErr} />}
              {activity && activity.length === 0 && (
                <div className="repo-blank">
                  <h2>No activity in the last {windowDays} days</h2>
                  <p className="hint">
                    Steward is watching {selectedRepo}. Widen the window, or the next push, review,
                    or protection change will appear here in plain language.
                  </p>
                </div>
              )}
              {activity && activity.length > 0 && (
                <ol className="activity">
                  {activity.map((e, i) => (
                    <li key={i} className={"activity-item tone-" + eventTone(e.event_type)}>
                      <div className="activity-dot" aria-hidden />
                      <div className="activity-body">
                        <p className="activity-text">{e.plain_english}</p>
                        <div className="activity-meta">
                          <code className="activity-type">{e.event_type}</code>
                          {e.actor && <span className="activity-actor">{e.actor}</span>}
                          <span className="activity-time">{ago(e.ts)}</span>
                        </div>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </>
          )}
        </section>
      </div>
    </DashShell>
  );
}

// Status → the site's rating tokens. Honest: a REPO health status, not a score.
const STATUS_COLOR: Record<VitalStatus, string> = {
  healthy: "var(--signal)",
  watch: "var(--watch)",
  "at risk": "var(--risk)",
  unknown: "var(--unknown)",
};
const OVERALL_STATUS: Record<HealthReport["overall"], VitalStatus> = {
  Healthy: "healthy",
  "Needs attention": "watch",
  "At risk": "at risk",
};
// The 4-value portfolio status → a dot color (adds "Quiet" for no-data repos).
const OVERALL_DOT: Record<Overall, string> = {
  "At risk": "var(--risk)",
  "Needs attention": "var(--watch)",
  Healthy: "var(--signal)",
  Quiet: "var(--unknown)",
};

// The portfolio overview — every repo at a high level, most-attention first.
function OverviewPanel({
  report,
  windowDays,
  onWindow,
  onSelect,
}: {
  report: OverviewReport;
  windowDays: number;
  onWindow: (d: number) => void;
  onSelect: (repo: string) => void;
}) {
  const t = report.totals;
  const [q, setQ] = useState("");
  const shown = q
    ? report.repos.filter((r) => r.full_name.toLowerCase().includes(q.toLowerCase()))
    : report.repos;
  return (
    <div className="overview">
      <header className="repo-header">
        <div>
          <div className="repo-eyebrow">All repositories</div>
          <h1 className="repo-title" style={{ fontFamily: "var(--sans)" }}>Overview</h1>
        </div>
        <div className="repo-header-right">
          <div className="window-control" role="tablist" aria-label="Time window">
            {WINDOWS.map((d) => (
              <button
                key={d}
                role="tab"
                aria-selected={windowDays === d}
                className={windowDays === d ? "selected" : ""}
                onClick={() => onWindow(d)}
              >
                {d}d
              </button>
            ))}
          </div>
        </div>
      </header>

      <div className="stat-tiles">
        <StatTile label="Repositories" value={t.repos} tone="neutral" />
        <StatTile label="At risk" value={t.atRisk} tone={t.atRisk > 0 ? "at risk" : "ok"} />
        <StatTile label="Needs attention" value={t.needsAttention} tone={t.needsAttention > 0 ? "watch" : "ok"} />
        <StatTile label={`Flagged · ${windowDays}d`} value={t.flagged} tone={t.flagged > 0 ? "at risk" : "ok"} />
      </div>

      <div className={"overview-integrity" + (report.integrity.ok ? " ok" : " warn")}>
        <span aria-hidden>{report.integrity.ok ? "🛡️" : "⚠️"}</span>
        <span>{report.integrity.headline}</span>
      </div>

      {report.repos.length === 0 ? (
        <div className="repo-blank">
          <h2>No repositories yet</h2>
          <p className="hint">Add CodeWorthy to a repository to see it here.</p>
        </div>
      ) : (
        <>
          {report.repos.length > 6 && (
            <div className="overview-toolbar">
              <input
                className="repo-search overview-search"
                type="search"
                placeholder="Search repositories…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                aria-label="Search repositories"
              />
              {q && (
                <span className="overview-count">
                  {shown.length} of {report.repos.length}
                </span>
              )}
            </div>
          )}
          {shown.length === 0 ? (
            <div className="repo-blank">
              <h2>No repositories match “{q}”</h2>
              <p className="hint">Try a different search.</p>
            </div>
          ) : (
            <div className="repo-cards">
              {shown.map((r) => (
                <RepoCard key={r.full_name} repo={r} windowDays={windowDays} onSelect={onSelect} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function StatTile({ label, value, tone }: { label: string; value: number; tone: "neutral" | "ok" | "watch" | "at risk" }) {
  return (
    <div className={"stat-tile tone-" + tone.replace(" ", "-")}>
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}

function RepoCard({
  repo,
  windowDays,
  onSelect,
}: {
  repo: RepoOverview;
  windowDays: number;
  onSelect: (repo: string) => void;
}) {
  return (
    <button className="repo-card" onClick={() => onSelect(repo.full_name)}>
      <div className="repo-card-top">
        <span className="repo-card-status" style={{ background: OVERALL_DOT[repo.overall] }} aria-hidden />
        <span className="repo-card-name">{repo.full_name}</span>
        {repo.flagged > 0 && <span className="repo-flag">{repo.flagged}</span>}
      </div>
      <div className="repo-card-overall" style={{ color: OVERALL_DOT[repo.overall] }}>
        {repo.overall}
      </div>
      <div className="repo-card-meta">
        <span title="Branch protection">
          {repo.protection === "healthy" ? "🔒 protected" : repo.protection === "at risk" ? "🔓 weakened" : "🔓 open"}
        </span>
        <span>{repo.events} event{repo.events === 1 ? "" : "s"} · {windowDays}d</span>
        <span>{repo.lastActivity ? `active ${ago(repo.lastActivity)}` : "no activity yet"}</span>
      </div>
    </button>
  );
}

// The health card + the two cards stacked beside it. No ring: a verdict WORD
// over a segmented vitals meter, then the vitals with findings and inline fixes.
// Right column: a "this window" counters card and the tamper-evidence card.
function HealthCard({
  report,
  windowDays,
  activity,
  onChanged,
}: {
  report: HealthReport;
  windowDays: number;
  activity: ActivityEvent[] | null;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const overallStatus = OVERALL_STATUS[report.overall];
  const verdictColor = STATUS_COLOR[overallStatus];
  const known = report.vitals.filter((v) => v.status !== "unknown");
  const needLook = known.filter((v) => v.status !== "healthy").length;
  const alertCount = report.activity?.alerts?.length ?? 0;
  const subline = `${needLook} of ${report.vitals.length} vitals ${needLook === 1 ? "needs" : "need"} a look · ${alertCount} change${alertCount === 1 ? "" : "s"} flagged`;

  // Counters, from the windowed change log.
  const ev = activity ?? [];
  const merges = ev.filter(
    (e) => e.event_type === "pull_request.merged" || e.event_type === "push.direct_to_default"
  ).length;
  const blocked = alertCount;
  const secrets = ev.filter((e) => /secret|leak/i.test(e.event_type) && !/blocked/i.test(e.event_type)).length;

  return (
    <>
      <FixPath issues={report.issues ?? []} onChanged={onChanged} />
      <div className="health-row">
        <section className="health-card">
          <div className="health-card-head">
            <div>
              <div className="health-card-label">
                REPO HEALTH · {windowDays} DAYS
                {report.mode && (
                  <span className={`mode-badge mode-${report.mode}`} title={
                    report.mode === "solo"
                      ? "One maintainer. You push to the default branch directly; CodeWorthy reviews each change after it lands. Force-pushes and branch deletion are still blocked."
                      : "Changes go through a pull request that CodeWorthy reviews before it can merge."
                  }>
                    {report.mode === "solo" ? "solo" : "shared"}
                  </span>
                )}
              </div>
              <div className="health-verdict" style={{ color: verdictColor }}>{report.overall}</div>
              <div className="health-subline">{subline}</div>
            </div>
            <button
              className="health-details-btn"
              onClick={() => setOpen((o) => !o)}
              aria-expanded={open}
            >
              {open ? "Hide details" : "Details"}
              {alertCount > 0 && <span className="health-alert-count">{alertCount}</span>}
            </button>
          </div>
          <VitalsMeter vitals={report.vitals} />
          <div className="health-vitals">
            {report.vitals.map((v) => (
              <VitalRow key={v.id} vital={v} />
            ))}
          </div>
        </section>

        <div className="health-side">
          <div className="counters-card">
            <div className="counters-label">THIS WINDOW</div>
            <div className="counter">
              <div className="counter-value">{merges}</div>
              <div className="counter-caption">merges to main</div>
            </div>
            <div className="counter">
              <div className="counter-value" style={blocked > 0 ? { color: "var(--risk)" } : undefined}>{blocked}</div>
              <div className="counter-caption">changes flagged</div>
            </div>
            <div className="counter">
              <div className="counter-value" style={{ color: secrets > 0 ? "var(--risk)" : "var(--signal)" }}>{secrets}</div>
              <div className="counter-caption">secrets reached main</div>
            </div>
          </div>
          <div className="tamper-card">
            <div className="tamper-title">{report.integrity.ok ? "Tamper-evident record" : "Integrity check needed"}</div>
            <div className="tamper-body">{report.integrity.headline}</div>
            {report.repoFilter && (
              <a className="tamper-export" href={digestUrl(report.repoFilter, windowDays)} target="_blank" rel="noreferrer">
                Export log ↓
              </a>
            )}
          </div>
        </div>
      </div>
      {open && (
        <>
          <HealthDetails report={report} windowDays={windowDays} />
          {report.repoFilter && report.mode && (
            <ModeSwitch repo={report.repoFilter} mode={report.mode} onChanged={onChanged} />
          )}
        </>
      )}
    </>
  );
}

// The expanded checkup: every change flagged in the window (the recommended
// fixes now live inline on each vital row, so this is the flagged list only).
function HealthDetails({ report, windowDays }: { report: HealthReport; windowDays: number }) {
  const alerts: DigestEntry[] = report.activity?.alerts ?? [];
  return (
    <div className="health-details">
      <h3 className="health-details-head">Flagged changes · last {windowDays} days</h3>
      {alerts.length === 0 ? (
        <p className="hint">Nothing flagged — no weakened protection or skipped review in this window.</p>
      ) : (
        <ol className="flagged">
          {alerts.map((a, i) => (
            <li key={i} className="flagged-item">
              <p className="flagged-text">{a.plainEnglish}</p>
              <div className="activity-meta">
                <code className="activity-type">{a.eventType}</code>
                {a.actor && <span className="activity-actor">{a.actor}</span>}
                <span className="activity-time">{ago(a.ts)}</span>
              </div>
            </li>
          ))}
        </ol>
      )}
      <p className="health-note">{report.note}</p>
    </div>
  );
}

function VitalRow({ vital }: { vital: HealthVital }) {
  return (
    <div className="vital-row">
      <span className="vital-dot" style={{ background: STATUS_COLOR[vital.status] }} aria-hidden />
      <div className="vital-text">
        <div className="vital-label">{vital.label}</div>
        <div className="vital-finding">{vital.finding}</div>
        {vital.status !== "healthy" && vital.prescription && (
          <div className="vital-rx">→ {vital.prescription}</div>
        )}
      </div>
      <span className="vital-status status-word" style={{ color: STATUS_COLOR[vital.status] }}>
        {vital.status}
      </span>
    </div>
  );
}

// A shareable weekly (or windowed) summary: open the rendered digest, or copy
// its link to forward to a teammate or auditor. The digest page is public by
// design, so the copied URL works without a login.
function SummaryLink({ repo, days }: { repo: string; days: number }) {
  const [copied, setCopied] = useState(false);
  const url = digestUrl(repo, days);
  const label = days === 7 ? "Weekly summary" : `${days}-day summary`;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      window.prompt("Copy this shareable summary link:", url);
    }
  };
  return (
    <div className="summary-link">
      <a className="summary-open" href={url} target="_blank" rel="noreferrer">
        {label} <span aria-hidden>↗</span>
      </a>
      <button className="summary-copy" onClick={copy} title="Copy shareable link" aria-label="Copy shareable link">
        {copied ? "Copied" : "⧉"}
      </button>
    </div>
  );
}

function DashShell({
  children,
  user,
  onSignOut,
}: {
  children: React.ReactNode;
  user?: string;
  onSignOut?: () => void;
}) {
  const initials = user ? user.replace(/[^a-zA-Z0-9]/g, "").slice(0, 2).toUpperCase() : "";
  return (
    <div className="dash-wrap">
      <div className="dash-topbar">
        <div className="dash-topbar-left">
          <Wordmark size={18} onDark />
          <span className="dash-doctrine" title="Codeworthy advises; it never merges, force-pushes, or rewrites history.">
            advisory · you own every merge
          </span>
        </div>
        <div className="dash-topbar-right">
          {user && <span className="dash-user">@{user}</span>}
          {user && <span className="dash-avatar" aria-hidden>{initials}</span>}
          {onSignOut && (
            <button className="dash-signout" onClick={onSignOut}>
              Sign out
            </button>
          )}
        </div>
      </div>
      {children}
    </div>
  );
}

function Waking({ label }: { label: string }) {
  return (
    <div className="repo-waking">
      <div className="repo-waking-pulse" aria-hidden />
      <p className="hint" style={{ maxWidth: 380 }}>{label}</p>
    </div>
  );
}

function RailNote({ err }: { err: ApiError }) {
  return <div className="repo-empty-rail">{err.kind === "offline" ? "Steward is waking up…" : err.message}</div>;
}

function ActivityError({ err }: { err: ApiError }) {
  const msg =
    err.kind === "offline"
      ? "Steward's backend is asleep. It'll connect on the next try — refresh in a moment."
      : err.kind === "forbidden"
        ? "You don't have access to this repository through your installations."
        : err.message;
  return (
    <div className="repo-blank">
      <h2>{err.kind === "offline" ? "Waking up…" : "Couldn't load activity"}</h2>
      <p className="hint">{msg}</p>
    </div>
  );
}
