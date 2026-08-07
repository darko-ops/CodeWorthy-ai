// The repo dashboard — where a signed-in GitHub user watches Steward's activity
// on a repo it's installed on. Live data from the Fly backend, degrading to calm
// states when the server is asleep (trial) or a repo has no history yet.
import { useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import {
  apiGet,
  ApiError,
  type ActivityEvent,
  type InstallationSummary,
  type RepoSummary,
} from "../../api";
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

  // Load the selected repo's activity.
  useEffect(() => {
    if (!selectedRepo) return;
    let live = true;
    setActivityLoading(true);
    setActivityErr(null);
    apiGet<ActivityEvent[]>(`/api/repos/${selectedRepo}/activity?limit=100`)
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
  }, [selectedRepo]);

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
          {installErr && <RailNote err={installErr} />}
          {installs && installs.length === 0 && (
            <div className="repo-empty-rail">
              CodeWorthy isn't installed on any repos yet.
              <a className="repo-link" href="/steward/install">Install it →</a>
            </div>
          )}
          {(installs ?? []).map((inst) => (
            <div key={inst.id} className="repo-group">
              <div className="repo-account">
                {inst.avatar && <img src={inst.avatar} alt="" width={16} height={16} />}
                <span>{inst.account}</span>
              </div>
              {(repos[inst.id] ?? []).map((r) => (
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
          ))}
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
                <div className="repo-doctrine" title="CodeWorthy advises; it never merges, force-pushes, or rewrites history.">
                  advisory · you own every merge
                </div>
              </header>

              {activityLoading && !activity && <Waking label="Reading the change log…" />}
              {activityErr && <ActivityError err={activityErr} />}
              {activity && activity.length === 0 && (
                <div className="repo-blank">
                  <h2>No activity recorded yet</h2>
                  <p className="hint">
                    Steward is watching {selectedRepo}. The first push, review, or protection change
                    will appear here in plain language.
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
