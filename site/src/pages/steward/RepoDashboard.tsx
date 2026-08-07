// The repo dashboard — where a signed-in GitHub user watches Steward's activity
// on a repo it's installed on. Live data from the Fly backend, degrading to calm
// states when the server is asleep (trial) or a repo has no history yet.
import { useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import {
  apiGet,
  ApiError,
  installUrl,
  type ActivityEvent,
  type DigestEntry,
  type HealthReport,
  type HealthVital,
  type InstallationSummary,
  type RepoSummary,
  type VitalStatus,
} from "../../api";

// Look-back windows offered by the control (days).
const WINDOWS = [7, 30, 90] as const;
import { useGitHubAuth } from "../../github-auth";
import { Wordmark } from "../../components/Wordmark";

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
  const [windowDays, setWindowDays] = useState<number>(30);
  const [filter, setFilter] = useState("");

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

  // Auto-select the first repo we learn about.
  const firstRepo = useMemo(() => {
    for (const inst of installs ?? []) {
      const rs = repos[inst.id];
      if (rs && rs.length) return rs[0]!.full_name;
    }
    return null;
  }, [installs, repos]);
  useEffect(() => {
    if (!selectedRepo && firstRepo) setSelectedRepo(firstRepo);
  }, [firstRepo, selectedRepo]);

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
  }, [selectedRepo, windowDays]);

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
                {list.map((r) => (
                  <button
                    key={r.full_name}
                    className={"repo-item" + (r.full_name === selectedRepo ? " selected" : "")}
                    onClick={() => setSelectedRepo(r.full_name)}
                  >
                    <span className="repo-item-name">{r.name}</span>
                    {r.private && <span className="repo-badge">private</span>}
                  </button>
                ))}
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
                <p className="hint">Once CodeWorthy is installed on a repository, its activity shows up here.</p>
              </div>
            ) : (
              <Waking label="Loading repositories…" />
            )
          ) : (
            <>
              <header className="repo-header">
                <div>
                  <div className="repo-eyebrow">Repository</div>
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
                  <div className="repo-doctrine" title="CodeWorthy advises; it never merges, force-pushes, or rewrites history.">
                    advisory · you own every merge
                  </div>
                </div>
              </header>

              {health && <HealthCard report={health} windowDays={windowDays} />}

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
  healthy: "var(--rating-strong)",
  watch: "var(--rating-develop)",
  "at risk": "var(--rating-needs)",
  unknown: "var(--rating-none)",
};
const OVERALL_STATUS: Record<HealthReport["overall"], VitalStatus> = {
  Healthy: "healthy",
  "Needs attention": "watch",
  "At risk": "at risk",
};

// The health card: a status ring (filled by how many vitals are healthy,
// colored by the overall status), the vitals with their findings, and the
// tamper-evidence badge. No single opaque number — the word + the evidence.
// "Details" expands the exact findings, the recommended fixes, and every change
// that got flagged in the window — so a user can see what was a mistake.
function HealthCard({ report, windowDays }: { report: HealthReport; windowDays: number }) {
  const [open, setOpen] = useState(false);
  const overallStatus = OVERALL_STATUS[report.overall];
  const known = report.vitals.filter((v) => v.status !== "unknown");
  const healthy = known.filter((v) => v.status === "healthy").length;
  const pct = known.length ? (healthy / known.length) * 100 : 0;
  const alertCount = report.activity?.alerts?.length ?? 0;
  return (
    <section className="health-card-wrap">
      <div className="health-card">
        <HealthRing pct={pct} color={STATUS_COLOR[overallStatus]} overall={report.overall} />
        <div className="health-body">
          <div className="health-vitals">
            {report.vitals.map((v) => (
              <VitalRow key={v.id} vital={v} />
            ))}
          </div>
          <div className="health-foot">
            <IntegrityBadge ok={report.integrity.ok} headline={report.integrity.headline} />
            <button
              className="health-details-btn"
              onClick={() => setOpen((o) => !o)}
              aria-expanded={open}
            >
              {open ? "Hide details" : "Details"}
              {alertCount > 0 && <span className="health-alert-count">{alertCount}</span>}
            </button>
          </div>
        </div>
      </div>
      {open && <HealthDetails report={report} windowDays={windowDays} />}
    </section>
  );
}

// The expanded checkup: recommended fixes (non-healthy vitals) and every change
// flagged in the window — weakened protection, skipped review, and the like.
function HealthDetails({ report, windowDays }: { report: HealthReport; windowDays: number }) {
  const alerts: DigestEntry[] = report.activity?.alerts ?? [];
  const fixes = report.vitals.filter((v) => v.prescription && v.status !== "healthy");
  return (
    <div className="health-details">
      <div className="health-details-grid">
        <div>
          <h3 className="health-details-head">What to look at</h3>
          {fixes.length === 0 ? (
            <p className="hint">No open recommendations — every vital is healthy in this window.</p>
          ) : (
            fixes.map((v) => (
              <div key={v.id} className="fix-row">
                <span className="vital-dot" style={{ background: STATUS_COLOR[v.status] }} aria-hidden />
                <div>
                  <div className="fix-label">{v.label}</div>
                  <div className="fix-finding">{v.finding}</div>
                  <div className="fix-rx">→ {v.prescription}</div>
                </div>
              </div>
            ))
          )}
        </div>
        <div>
          <h3 className="health-details-head">Flagged in the last {windowDays} days</h3>
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
        </div>
      </div>
      <p className="health-note">{report.note}</p>
    </div>
  );
}

function HealthRing({ pct, color, overall }: { pct: number; color: string; overall: string }) {
  return (
    <div className="health-ring-wrap">
      <div
        className="health-ring"
        role="img"
        aria-label={`Repository health: ${overall}`}
        style={{ background: `conic-gradient(${color} ${pct}%, var(--surface-2) 0)` }}
      >
        <div className="health-ring-inner">
          <span className="health-ring-label" style={{ color }}>{overall}</span>
        </div>
      </div>
      <div className="health-ring-cap">repo health</div>
    </div>
  );
}

function VitalRow({ vital }: { vital: HealthVital }) {
  return (
    <div className="vital-row">
      <span className="vital-dot" style={{ background: STATUS_COLOR[vital.status] }} aria-hidden />
      <div className="vital-text">
        <div className="vital-label">
          {vital.label}
          <span className="vital-status" style={{ color: STATUS_COLOR[vital.status] }}>
            {vital.status}
          </span>
        </div>
        <div className="vital-finding">{vital.finding}</div>
      </div>
    </div>
  );
}

function IntegrityBadge({ ok, headline }: { ok: boolean; headline: string }) {
  return (
    <div className={"integrity-badge" + (ok ? " ok" : " warn")} title={headline}>
      <span className="integrity-icon" aria-hidden>{ok ? "🛡️" : "⚠️"}</span>
      <div>
        <div className="integrity-title">{ok ? "Tamper-evident" : "Integrity check needed"}</div>
        <div className="integrity-sub">{headline}</div>
      </div>
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
  return (
    <div className="dash-wrap">
      <div className="dash-topbar">
        <Wordmark size={18} />
        <div className="dash-topbar-right">
          {user && <span className="dash-user">@{user}</span>}
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
