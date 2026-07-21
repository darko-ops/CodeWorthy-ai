import { Link } from "react-router-dom";
import { useAuth } from "../../auth";
import { StatusBadge } from "../../components/StatusBadge";
import { averageRating, CANDIDATES, examById, STATUS_PROGRESS } from "../../data";

export function Dashboard() {
  const { session } = useAuth();

  const total = CANDIDATES.length;
  const active = CANDIDATES.filter((c) => c.status === "in_progress").length;
  const awaitingReview = CANDIDATES.filter(
    (c) => c.status === "submitted" || c.status === "defense"
  ).length;
  const reported = CANDIDATES.filter((c) => c.status === "reported");
  const ratedAverages = reported
    .map(averageRating)
    .filter((avg): avg is number => avg !== null);
  const avgCompetency =
    ratedAverages.length > 0
      ? ratedAverages.reduce((a, b) => a + b, 0) / ratedAverages.length
      : null;

  const sorted = [...CANDIDATES].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Hiring dashboard</h1>
          <p>{session?.email} · Acme Wholesale assessments</p>
        </div>
      </div>

      <div className="stat-row">
        <div className="stat-tile">
          <p className="stat-label">Total potential hires</p>
          <p className="stat-value">{total}</p>
          <p className="stat-sub">▲ 2 this week</p>
        </div>
        <div className="stat-tile">
          <p className="stat-label">Currently assessing</p>
          <p className="stat-value">{active}</p>
          <p className="stat-sub">in the simulation now</p>
        </div>
        <div className="stat-tile">
          <p className="stat-label">Awaiting review</p>
          <p className="stat-value">{awaitingReview}</p>
          <p className="stat-sub">submitted or in defense</p>
        </div>
        <div className="stat-tile">
          <p className="stat-label">Reports ready</p>
          <p className="stat-value">{reported.length}</p>
          <p className="stat-sub">
            avg competency {avgCompetency !== null ? avgCompetency.toFixed(1) : "—"} / 5
          </p>
        </div>
      </div>

      <div className="table-card">
        <table>
          <thead>
            <tr>
              <th>Candidate</th>
              <th>Assessment</th>
              <th>Status</th>
              <th>Pipeline progress</th>
              <th className="num">Avg rating</th>
              <th>Last activity</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((c) => {
              const exam = examById(c.examId);
              const pct = STATUS_PROGRESS[c.status];
              const avg = averageRating(c);
              return (
                <tr key={c.id}>
                  <td>
                    <Link to={`/dashboard/candidates/${c.id}`} style={{ fontWeight: 600 }}>
                      {c.name}
                    </Link>
                    <div style={{ fontSize: 12, color: "var(--ink-muted)" }}>{c.email}</div>
                  </td>
                  <td>
                    {exam ? (
                      <>
                        <span className="artifact">{exam.ticket}</span> · {exam.title}
                      </>
                    ) : (
                      c.examId
                    )}
                  </td>
                  <td>
                    <StatusBadge status={c.status} />
                  </td>
                  <td>
                    <div className="progress-cell">
                      <div
                        className="progress-track"
                        role="progressbar"
                        aria-valuenow={pct}
                        aria-valuemin={0}
                        aria-valuemax={100}
                      >
                        <div className="progress-fill" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="progress-pct">{pct}%</span>
                    </div>
                  </td>
                  <td className="num">{avg !== null ? `${avg.toFixed(1)} / 5` : "—"}</td>
                  <td>{c.updatedAt}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
