import { Link, useNavigate } from "react-router-dom";
import { StatusBadge } from "../../components/StatusBadge";
import { averageRating, CANDIDATES, examById, STATUS_PROGRESS } from "../../data";

function avgColor(avg: number | null): string {
  if (avg === null) return "var(--ink-faint)";
  if (avg >= 4) return "var(--accent-bright)";
  if (avg >= 3) return "var(--amber-bright)";
  return "var(--rating-needs)";
}

export function Dashboard() {
  const navigate = useNavigate();

  const total = CANDIDATES.length;
  const active = CANDIDATES.filter((c) => c.status === "in_progress").length;
  const awaitingReview = CANDIDATES.filter(
    (c) => c.status === "submitted" || c.status === "defense"
  ).length;
  const reported = CANDIDATES.filter((c) => c.status === "reported");
  const ratedAverages = reported.map(averageRating).filter((avg): avg is number => avg !== null);
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
          <p>Acme Wholesale · production-access candidates</p>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <Link to="/dashboard/compare" className="btn">
            Compare
          </Link>
          <Link to="/dashboard/invite" className="btn btn-primary">
            + Invite candidate
          </Link>
        </div>
      </div>

      <div className="stat-row">
        <div className="stat-tile">
          <p className="stat-label">Total candidates</p>
          <p className="stat-value">{total}</p>
          <p className="stat-sub" style={{ color: "var(--accent-bright)" }}>
            ▲ 2 this week
          </p>
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
        <div className="stat-tile glow">
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
              <th>Pipeline</th>
              <th className="num">Avg</th>
              <th>Activity</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((c) => {
              const exam = examById(c.examId);
              const pct = STATUS_PROGRESS[c.status];
              const avg = averageRating(c);
              return (
                <tr
                  key={c.id}
                  onClick={() => navigate(`/dashboard/candidates/${c.id}`)}
                  style={{ cursor: "pointer" }}
                >
                  <td>
                    <Link
                      to={`/dashboard/candidates/${c.id}`}
                      style={{ fontWeight: 600 }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      {c.name}
                    </Link>
                    <div style={{ font: "500 11px var(--mono)", color: "var(--ink-faint)", marginTop: 2 }}>
                      {c.email}
                    </div>
                  </td>
                  <td style={{ color: "var(--ink-2)", fontSize: 13 }}>
                    {exam ? (
                      <>
                        <span className="artifact" style={{ color: "var(--ink)" }}>{exam.ticket}</span> · {exam.title}
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
                        <div
                          className="progress-fill"
                          style={{
                            width: `${pct}%`,
                            background: pct === 100 ? "var(--accent)" : undefined,
                          }}
                        />
                      </div>
                      <span className="progress-pct">{pct}%</span>
                    </div>
                  </td>
                  <td className="num" style={{ color: avgColor(avg) }}>
                    {avg !== null ? avg.toFixed(1) : "—"}
                  </td>
                  <td style={{ font: "500 11px var(--mono)", color: "var(--ink-muted)" }}>
                    {c.updatedAt}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
