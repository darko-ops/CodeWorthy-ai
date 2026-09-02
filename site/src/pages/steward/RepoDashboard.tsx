// The repo dashboard — where a signed-in GitHub user watches Steward's activity
// on a repo it's installed on. Live data from the Fly backend, degrading to calm
// states when the server is asleep (trial) or a repo has no history yet.
//
// Two screens on one plane. The overview is a table of every repository, worst
// first. The repo screen puts the outstanding DECISIONS above the data, states
// the verdict as a line rather than a headline, and keeps the tamper-evident
// record permanently beside it — that record is the strongest thing CodeWorthy
// has to say, and it used to be a card three sections down.
//
// There are no cards here on purpose. A section is a mono label and a hairline;
// a row never contains a box; and exactly one button per screen is filled — the
// recommended next action. Everything else is an outline or plain text.
import { useEffect, useMemo, useState } from "react";
import { FixPath, ModeSwitch } from "./FixPath";
import { RulesPanel } from "./RulesPanel";
import { Navigate } from "react-router-dom";
import {
  apiGet,
  ApiError,
  digestUrl,
  estateDigestUrl,
  installUrl,
  type ActivityEvent,
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
//
// Mirrors the server's own digest categories (digest.ts CATEGORY): the alert and
// attention families are the ones worth colouring. Two things this has to get
// right, because in v2 the event type's colour is the ONLY signal on the row:
// every `exception.*` is an alert (that family IS the look-at-this register),
// and a BLOCKED secret is the control working, so it reads as ok rather than as
// the leak it prevented.
function eventTone(type: string): "ok" | "watch" | "note" {
  if (/blocked|restored|configured|installed|created/i.test(type)) return "ok";
  if (/^exception\.|weakened|unreviewed|leak|force|direct_to_default|retroactive_review/i.test(type)) {
    return "watch";
  }
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
  const [rulesOpen, setRulesOpen] = useState(false);

  // GitHub only allows branch protection on a PRIVATE repository on a paid
  // plan. We used to discover that by trying and being refused — the user
  // pressed the recommended fix and got an error. The dashboard already knows
  // which repos are private, so it can say so first.
  const selectedIsPrivate = useMemo(() => {
    if (!selectedRepo) return false;
    for (const list of Object.values(repos)) {
      const hit = list?.find((r) => r.full_name === selectedRepo);
      if (hit) return hit.private;
    }
    return false;
  }, [selectedRepo, repos]);
  // Once GitHub has actually refused, the fix path says so with real options —
  // so the notice steps back to avoid saying the same thing twice, louder.
  const protectionRefused = (health?.issues ?? []).some((i) => i.id === "protection_unavailable");
  const [windowDays, setWindowDays] = useState<number>(30);
  const [filter, setFilter] = useState("");
  // One search box, in the top bar, filtering the overview table. It lives up
  // here because the input and the rows it filters are in different components.
  const [query, setQuery] = useState("");
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
  // from the rail or the overview table.

  // Blank the report only when we're changing WHICH report we're looking at.
  // A refetch after an action (the nonce) deliberately keeps the old one on
  // screen: otherwise the decision row that just settled is unmounted mid
  // sentence and the user never sees the confirmation for what they just did.
  useEffect(() => {
    setHealth(null);
    setRulesOpen(false);
  }, [selectedRepo, windowDays]);

  // Load the selected repo's health checkup (vitals + integrity) over the chosen
  // window. Best-effort: a failure just hides the band, never blocks activity.
  useEffect(() => {
    if (!selectedRepo) return;
    let live = true;
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
  const onOverview = selectedRepo === null;
  const owner = selectedRepo?.split("/")[0] ?? "";
  const accounts = (installs ?? []).map((i) => i.account).filter(Boolean);
  // The estate line: who, how many repos, over what window.
  const context = onOverview
    ? [
        accounts.join(" · ") || "your account",
        `${allRepos.length} ${allRepos.length === 1 ? "repository" : "repositories"}`,
        `${windowDays} days`,
      ].join(" · ")
    : "advisory · you own every merge";

  return (
    <DashShell
      user={user?.login ?? undefined}
      onSignOut={signOut}
      context={context}
      // The table's own search: shown on the overview once there are enough
      // repositories for finding one to be work.
      search={onOverview && (overview?.repos.length ?? 0) > 6 ? { value: query, onChange: setQuery } : undefined}
    >
      {onOverview ? (
        allRepos.length === 0 && installs ? (
          <div className="overview">
            <div className="repo-blank">
              <h2>Nothing to watch yet</h2>
              <p className="hint">
                Once CodeWorthy is installed on a repository, it shows up here.{" "}
                <a className="repo-link link-signal" href={installUrl} target="_blank" rel="noreferrer">Add a repository →</a>
              </p>
            </div>
          </div>
        ) : overview ? (
          <OverviewPanel report={overview} windowDays={windowDays} query={query} onSelect={setSelectedRepo} />
        ) : (
          <Waking label="Building your overview…" />
        )
      ) : (
        <div className="repo-dash">
          <aside className="repo-rail">
            <button className="repo-back" onClick={() => setSelectedRepo(null)}>
              ← Overview
            </button>
            <div className="rail-label">Repositories</div>
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
                  {/* Only worth naming the account when there is more than one. */}
                  {(installs ?? []).length > 1 && (
                    <div className="repo-account">
                      {inst.avatar && <img src={inst.avatar} alt="" width={14} height={14} />}
                      <span>{inst.account}</span>
                    </div>
                  )}
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
                        {flagged > 0 && (
                          <span className="repo-flag" title={`${flagged} flagged in the last ${windowDays} days`}>
                            {flagged}
                          </span>
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
            <div className="repo-eyebrow">{owner}</div>
            {selectedIsPrivate && <PrivateNotice constraintKnown={protectionRefused} />}
            <header className="repo-header">
              <h1 className="repo-title">{selectedRepo.split("/").slice(1).join("/")}</h1>
              <div className="repo-header-right">
                <button
                  className={`btn-plain ${rulesOpen ? "is-on" : ""}`}
                  onClick={() => setRulesOpen((o) => !o)}
                  aria-expanded={rulesOpen}
                  title="What has to be true before a change lands here"
                >
                  Rules
                </button>
                <div className="window-words" role="tablist" aria-label="Time window">
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
                <a
                  className="link-signal"
                  href={digestUrl(selectedRepo, windowDays)}
                  target="_blank"
                  rel="noreferrer"
                >
                  Share summary ↗
                </a>
              </div>
            </header>

            {rulesOpen && (
              <RulesPanel
                repo={selectedRepo}
                onClose={() => setRulesOpen(false)}
                onChanged={() => setHealthNonce((n) => n + 1)}
              />
            )}

            {health && (
              <RepoDetail
                report={health}
                windowDays={windowDays}
                actor={user?.login ?? undefined}
                onChanged={() => setHealthNonce((n) => n + 1)}
              />
            )}

            <div className="section-head">
              <span className="section-label">Change log</span>
              {activity && (
                <ChangeLogCounters activity={activity} flagged={health?.activity?.alerts?.length ?? 0} />
              )}
            </div>
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
              <ol className="log">
                {activity.map((e, i) => (
                  <li key={i} className={"log-row tone-" + eventTone(e.event_type)}>
                    <span className="log-time">{ago(e.ts)}</span>
                    <p className="log-text">{e.plain_english}</p>
                    <span className="log-type">{e.event_type}</span>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>
      )}
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
// The 4-value portfolio status → a colour (adds "Quiet" for no-data repos).
const OVERALL_DOT: Record<Overall, string> = {
  "At risk": "var(--risk)",
  "Needs attention": "var(--watch)",
  Healthy: "var(--signal)",
  Quiet: "var(--unknown)",
};

// The three counters that used to be a card of their own. Same numbers, same
// derivation from the windowed change log — now one line on the section's
// baseline, because three numbers are not three cards.
function ChangeLogCounters({ activity, flagged }: { activity: ActivityEvent[]; flagged: number }) {
  const merges = activity.filter(
    (e) => e.event_type === "pull_request.merged" || e.event_type === "push.direct_to_default"
  ).length;
  const secrets = activity.filter(
    (e) => /secret|leak/i.test(e.event_type) && !/blocked/i.test(e.event_type)
  ).length;
  return (
    <span className="log-counters">
      {merges} merge{merges === 1 ? "" : "s"} · {flagged} flagged · {secrets} secret
      {secrets === 1 ? "" : "s"} reached main
    </span>
  );
}

// The record strip. Permanently visible, at the same weight as the verdict:
// "the record is intact and here is how long it is" is the claim nothing else
// in this category makes, and it used to be a card below the fold.
function RecordStrip({
  ok,
  title,
  body,
  href,
  linkLabel,
  stacked = false,
}: {
  ok: boolean;
  title: string;
  body: string;
  href?: string;
  linkLabel: string;
  stacked?: boolean;
}) {
  return (
    <div className={"record-strip" + (ok ? "" : " warn") + (stacked ? " stacked" : "")}>
      <span className="record-dot" aria-hidden />
      {stacked ? (
        <div className="record-text">
          <span className="record-title">{title}</span>
          <span className="record-body">{body}</span>
        </div>
      ) : (
        <>
          <span className="record-title">{title}</span>
          <span className="record-body">{body}</span>
        </>
      )}
      {href && (
        <a className="record-link" href={href} target="_blank" rel="noreferrer">
          {linkLabel}
        </a>
      )}
    </div>
  );
}

const ANCHOR_WORD: Record<string, string> = {
  consistent: "matched against its write-once anchor",
  "no-anchor": "no external anchor configured",
  tampered: "the external anchor no longer matches",
  ahead: "newer than the last anchor",
};

// The portfolio overview — every repo on one grid, worst first, so a
// deteriorating repo is visible without opening it.
function OverviewPanel({
  report,
  windowDays,
  query,
  onSelect,
}: {
  report: OverviewReport;
  windowDays: number;
  query: string;
  onSelect: (repo: string) => void;
}) {
  const t = report.totals;
  // Counted from the rows when the server is an older build that doesn't break
  // the totals out by band — the rows themselves always carry the status.
  const healthyFallback = report.repos.filter((r) => r.overall === "Healthy").length;
  const shown = query
    ? report.repos.filter((r) => r.full_name.toLowerCase().includes(query.toLowerCase()))
    : report.repos;

  return (
    <div className="overview">
      <div className="ov-title-row">
        <h1 className="ov-title">Overview</h1>
        {/* Four bordered stat tiles said the same thing and outweighed the
            table they were introducing. This is a count line. */}
        <div className="ov-counts">
          <Count n={t.atRisk} label="at risk" color="var(--risk)" />
          <Count n={t.needsAttention} label="needs attention" color="var(--watch)" />
          <Count n={t.healthy ?? healthyFallback} label="healthy" color="var(--signal)" />
          {t.quiet > 0 && <Count n={t.quiet} label="quiet" color="var(--unknown)" />}
        </div>
      </div>

      <RecordStrip
        ok={report.integrity.ok}
        title={report.integrity.ok ? "Record intact" : "Integrity check needed"}
        // The site and the API deploy independently, so a browser can hold a
        // build that is briefly ahead of the server it's talking to. Where a
        // field the server didn't send would otherwise be printed, fall back to
        // what every version does return rather than the word "undefined".
        body={
          report.integrity.ok
            ? report.integrity.chain
              ? `${report.integrity.chain} across ${t.repos} ${t.repos === 1 ? "repository" : "repositories"}`
              : report.integrity.headline
            : report.integrity.headline
        }
        href={estateDigestUrl(windowDays)}
        linkLabel="Export log ↓"
      />

      {report.repos.length === 0 ? (
        <div className="repo-blank">
          <h2>No repositories yet</h2>
          <p className="hint">Add CodeWorthy to a repository to see it here.</p>
        </div>
      ) : shown.length === 0 ? (
        <div className="repo-blank">
          <h2>No repositories match “{query}”</h2>
          <p className="hint">Try a different search.</p>
        </div>
      ) : (
        <div className="repo-table">
          <div className="repo-table-head" role="row">
            <span>Repository</span>
            <span>Status</span>
            <span>Needs a decision</span>
            {/* These two carry the body cells' classes so the narrow layout
                drops the column and its heading together. */}
            <span className="rt-spark">Flagged · {windowDays}d</span>
            <span className="rt-merges rt-head-right">Merges</span>
            <span className="rt-head-right">Active</span>
          </div>
          {shown.map((r) => (
            <RepoRow key={r.full_name} repo={r} onSelect={onSelect} />
          ))}
        </div>
      )}
    </div>
  );
}

function Count({ n, label, color }: { n: number; label: string; color: string }) {
  return (
    <span className="ov-count">
      <span className="ov-count-n" style={{ color }}>{n}</span>
      <span className="ov-count-label">{label}</span>
    </span>
  );
}

// Whole row is the click target into the repo screen.
function RepoRow({ repo, onSelect }: { repo: RepoOverview; onSelect: (repo: string) => void }) {
  const color = OVERALL_DOT[repo.overall];
  const decisionTone = repo.decision ? (repo.overall === "At risk" ? " at-risk" : "") : " none";
  return (
    <button className="repo-row" onClick={() => onSelect(repo.full_name)}>
      <span className="rt-repo">
        <span className="repo-status-dot" style={{ background: color }} aria-hidden />
        <span className="rt-name">{repo.full_name}</span>
        {repo.private && <span className="repo-badge">private</span>}
      </span>
      <span className="status-word" style={{ color }}>{repo.overall}</span>
      <span className={"rt-decision" + decisionTone} title={repo.decision ?? undefined}>
        {repo.decision ?? "—"}
      </span>
      <span className="rt-spark">
        <Sparkline buckets={repo.flaggedBuckets} flagged={repo.flagged} />
      </span>
      <span className="rt-merges">{repo.merges ?? "—"}</span>
      <span className="rt-active">{repo.lastActivity ? ago(repo.lastActivity) : "—"}</span>
    </button>
  );
}

// The flag trend, straight from the server's per-period counts. If the server
// didn't send a trend, the row says the total instead of drawing a shape the
// data doesn't support.
function Sparkline({ buckets, flagged }: { buckets: number[] | undefined; flagged: number }) {
  if (!buckets?.length) {
    return <span className="spark-none">{flagged || "—"}</span>;
  }
  return (
    <span
      className="spark"
      role="img"
      aria-label={`${flagged} flagged, by period: ${buckets.join(", ")}`}
    >
      {buckets.map((n, i) => (
        <span
          key={i}
          className={"spark-bar" + (n > 1 ? " many" : n === 1 ? " one" : "")}
          style={{ height: Math.max(3, n * 6) }}
        />
      ))}
    </span>
  );
}

// The repo's verdict band, its vitals, and the decisions between them.
function RepoDetail({
  report,
  windowDays,
  actor,
  onChanged,
}: {
  report: HealthReport;
  windowDays: number;
  /** Whose name goes on whatever gets decided here. */
  actor?: string;
  onChanged: () => void;
}) {
  const overallStatus = OVERALL_STATUS[report.overall];
  const verdictColor = STATUS_COLOR[overallStatus];
  const known = report.vitals.filter((v) => v.status !== "unknown");
  const needLook = known.filter((v) => v.status !== "healthy").length;
  const alertCount = report.activity?.alerts?.length ?? 0;
  const issues = report.issues ?? [];

  return (
    <>
      <div className="verdict-band">
        <div>
          {/* A 15px line, not a 32px headline: the verdict is context for the
              decisions below it, not the point of the screen. */}
          <div className="verdict-line" style={{ color: verdictColor }}>
            {report.overall}{" "}
            <span className="verdict-sub">
              {needLook} of {report.vitals.length} vitals {needLook === 1 ? "needs" : "need"} a look ·{" "}
              {alertCount} change{alertCount === 1 ? "" : "s"} flagged
            </span>
            {report.mode && (
              <span
                className="mode-badge"
                title={
                  report.mode === "solo"
                    ? "One maintainer. You push to the default branch directly; CodeWorthy reviews each change after it lands. Force-pushes and branch deletion are still blocked."
                    : "Changes go through a pull request that CodeWorthy reviews before it can merge."
                }
              >
                {report.mode}
              </span>
            )}
          </div>
          <VitalsMeter slim vitals={report.vitals} />
        </div>
        <RecordStrip
          stacked
          ok={report.integrity.ok}
          title={report.integrity.ok ? "Record intact" : "Integrity check needed"}
          body={
            report.integrity.ok
              ? `${report.integrity.chain} · ${ANCHOR_WORD[report.integrity.anchor] ?? report.integrity.anchor}`
              : report.integrity.headline
          }
          href={report.repoFilter ? digestUrl(report.repoFilter, windowDays) : undefined}
          linkLabel="Export ↓"
        />
      </div>

      <div className="section-head">
        <span className="section-label">
          {issues.length > 0 ? `To decide · ${issues.length}` : "Nothing to decide"}
        </span>
        {issues.length > 1 && <span className="section-note">worst first</span>}
      </div>
      <FixPath issues={issues} actor={actor} onChanged={onChanged} />

      <div className="section-head">
        <span className="section-label">Vitals</span>
      </div>
      <div className="vitals-list">
        {report.vitals.map((v) => (
          <VitalRow key={v.id} vital={v} />
        ))}
      </div>

      {/* Changing how the repo is worked on decides what "healthy" even means
          here, so it stays reachable when nothing is wrong. */}
      {report.repoFilter && report.mode && issues.length === 0 && (
        <ModeSwitch repo={report.repoFilter} mode={report.mode} onChanged={onChanged} />
      )}
    </>
  );
}

// The status WORD carries the status, so there is no dot on this row.
// Prescriptions live in the decision rows above, where there is a button to act
// on them — repeating them here was advice with nowhere to go.
function VitalRow({ vital }: { vital: HealthVital }) {
  return (
    <div className="vital-row">
      <span className="vital-label">{vital.label}</span>
      <span className="vital-finding">{vital.finding}</span>
      <span className="vital-status status-word" style={{ color: STATUS_COLOR[vital.status] }}>
        {vital.status}
      </span>
    </div>
  );
}

function DashShell({
  children,
  user,
  onSignOut,
  context,
  search,
}: {
  children: React.ReactNode;
  user?: string;
  onSignOut?: () => void;
  context?: string;
  search?: { value: string; onChange: (v: string) => void };
}) {
  const initials = user ? user.replace(/[^a-zA-Z0-9]/g, "").slice(0, 2).toUpperCase() : "";
  return (
    <div className="dash-wrap">
      <div className="dash-topbar">
        <div className="dash-topbar-left">
          <Wordmark size={16} onDark />
          {context && (
            <span
              className="dash-context"
              title="Codeworthy advises; it never merges, force-pushes, or rewrites history."
            >
              {context}
            </span>
          )}
        </div>
        <div className="dash-topbar-right">
          {search && (
            <input
              className="repo-search topbar-search"
              type="search"
              placeholder="Search repositories…"
              value={search.value}
              onChange={(e) => search.onChange(e.target.value)}
              aria-label="Search repositories"
            />
          )}
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

// Private repositories on GitHub's free plan cannot have branch protection or
// rulesets at all — the API refuses with a 403. Saying so up front matters
// because the alternative is worse than silence: the user presses the
// recommended one-click fix, it fails, and the tool looks broken rather than
// constrained.
//
// It is deliberately a note and not a warning. A private repo on a PAID plan is
// completely fine, and we cannot tell which one this is until we try — so it
// states the condition rather than asserting a problem the user may not have.
function PrivateNotice({ constraintKnown }: { constraintKnown: boolean }) {
  if (constraintKnown) return null; // the fix path is already saying it, with options
  return (
    <aside className="private-note" role="note">
      <span className="private-note-mark" aria-hidden>🔒</span>
      <p>
        This repository is <strong>private</strong>. GitHub only allows branch protection and rulesets on private
        repositories on a paid plan — on the free plan it refuses, and CodeWorthy can review and record here but cannot
        enforce. If yours is on a paid plan this doesn't apply and everything works normally.
      </p>
    </aside>
  );
}
