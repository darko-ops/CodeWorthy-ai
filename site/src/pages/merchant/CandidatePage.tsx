import { Link, useParams } from "react-router-dom";
import { StatusBadge } from "../../components/StatusBadge";
import { candidateById, examById, STATUS_PROGRESS, VERIFICATIONS } from "../../data";

// Rating bands per the rubric: the label always accompanies the color.
function ratingWord(rating: number): string {
  if (rating >= 4) return "Strong";
  if (rating === 3) return "Developing";
  return "Needs work";
}

export function CandidatePage() {
  const { candidateId } = useParams();
  const candidate = candidateId ? candidateById(candidateId) : undefined;

  if (!candidate) {
    return (
      <p>
        Candidate not found. <Link to="/dashboard">Back to dashboard</Link>
      </p>
    );
  }

  const exam = examById(candidate.examId);
  const pct = STATUS_PROGRESS[candidate.status];
  const verification = VERIFICATIONS[candidate.id];
  const checksPassed = verification?.checks.filter((c) => c.result === "pass").length;

  return (
    <>
      <div className="crumb">
        <Link to="/dashboard">Dashboard</Link> / {candidate.name}
      </div>
      <div className="page-head">
        <div>
          <h1>{candidate.name}</h1>
          <p>
            {candidate.email} · invited {candidate.invitedAt}
          </p>
        </div>
        <StatusBadge status={candidate.status} />
      </div>

      <div className="stat-row">
        <div className="stat-tile">
          <p className="stat-label">Assessment</p>
          <p className="stat-value" style={{ fontSize: 20 }}>
            {exam?.ticket ?? candidate.examId}
          </p>
          <p className="stat-sub">{exam?.title}</p>
        </div>
        <div className="stat-tile">
          <p className="stat-label">Pipeline position</p>
          <p className="stat-value">{pct}%</p>
          <div className="progress-track" style={{ marginTop: 8 }}>
            <div className="progress-fill" style={{ width: `${pct}%` }} />
          </div>
        </div>
        <div className="stat-tile">
          <p className="stat-label">Hidden-suite checks</p>
          <p className="stat-value">
            {verification ? `${checksPassed}/${verification.checks.length}` : "—"}
          </p>
          <p className="stat-sub">
            {verification ? "checks passed" : "verification not yet run"}
          </p>
        </div>
      </div>

      {verification && (
        <div className="card" style={{ marginBottom: 16 }}>
          <h3 style={{ marginBottom: 4 }}>Automated verification results</h3>
          <p style={{ color: "var(--ink-muted)", fontSize: 13, marginTop: 0 }}>
            Baseline check on the candidate's own tests, then the sanitized hidden-suite summary
            run against their branch.
          </p>
          <div style={{ marginBottom: 14 }}>
            <span style={{ fontSize: 13, color: "var(--ink-2)", marginRight: 10 }}>
              Baseline verdict
            </span>
            <span
              className={`badge${
                verification.baselineVerdict === "genuine-regression-test" ? " badge-pass" : " badge-attention"
              }`}
            >
              {verification.baselineVerdict}
            </span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {verification.checks.map((check) => (
              <div key={check.id} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span className={`badge${check.result === "pass" ? " badge-pass" : " badge-attention"}`}>
                  {check.result === "pass" ? "✓ pass" : "✗ fail"}
                </span>
                <span className="artifact" style={{ fontSize: 13, color: "var(--ink-2)" }}>
                  {check.id}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="card">
        <h3 style={{ marginBottom: 4 }}>Competency profile</h3>
        <p style={{ color: "var(--ink-muted)", fontSize: 13, marginTop: 0 }}>
          Every rating cites observable evidence from the candidate's diff, tests, terminal
          activity, and defense answers. A profile is never reduced to a single score.
        </p>
        {candidate.ratings.length === 0 ? (
          <p style={{ color: "var(--ink-2)" }}>
            No ratings yet — the profile appears after submission, hidden-condition runs, and the
            technical defense.
          </p>
        ) : (
          candidate.ratings.map((r) => (
            <div key={r.competency} style={{ marginBottom: 10 }}>
              <div className="rating-row" style={{ paddingBottom: 2 }}>
                <span className="rating-name">{r.competency}</span>
                <div className="rating-cells" aria-label={`${ratingWord(r.rating)}, ${r.rating} out of 5`}>
                  {[1, 2, 3, 4, 5].map((step) => (
                    <span
                      key={step}
                      className={`rating-cell ${step <= r.rating ? `on-${r.rating}` : ""}`}
                    />
                  ))}
                </div>
                <span className="rating-num">
                  {ratingWord(r.rating)} · {r.rating}/5
                </span>
              </div>
              <p className="evidence" style={{ margin: 0 }}>
                {r.evidence}
              </p>
            </div>
          ))
        )}
      </div>
    </>
  );
}
