import { Link, useParams } from "react-router-dom";
import { Ring } from "../../components/Ring";
import { StatusBadge } from "../../components/StatusBadge";
import {
  averageRating,
  candidateById,
  examById,
  PILOT_REPOS,
  RUBRIC_GATES,
  STATUS_PROGRESS,
  VERIFICATIONS,
  type Competency,
  type VerificationResult,
} from "../../data";

function ratingWord(rating: number): string {
  if (rating >= 4) return "Strong";
  if (rating === 3) return "Developing";
  return "Needs work";
}

// Scenario rubric gates: a competency is capped unless every required hidden
// check passed. Returns the failing check ids when the gate fires.
function failedGateChecks(
  examId: string,
  competency: Competency,
  verification: VerificationResult | undefined
): { cap: number; failing: string[] } | null {
  const gate = (RUBRIC_GATES[examId] ?? []).find((g) => g.competency === competency);
  if (!gate) return null;
  const failing = gate.requires.filter(
    (id) => verification?.checks.find((c) => c.id === id)?.result !== "pass"
  );
  return failing.length > 0 ? { cap: gate.cap, failing } : null;
}

function ratingWordColor(rating: number): string {
  if (rating >= 4) return "var(--accent-strong)";
  if (rating === 3) return "var(--rating-develop)";
  return "var(--rating-needs)";
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
  // The displayed average respects rubric gates (capped ratings count capped).
  const effectiveRatings = candidate.ratings.map((r) => {
    const gate = failedGateChecks(candidate.examId, r.competency, verification);
    return gate !== null && r.rating > gate.cap ? gate.cap : r.rating;
  });
  const avg =
    effectiveRatings.length > 0
      ? effectiveRatings.reduce((a, b) => a + b, 0) / effectiveRatings.length
      : averageRating(candidate);
  const checksPassed = verification?.checks.filter((c) => c.result === "pass").length ?? 0;
  const lowest =
    candidate.ratings.length > 0
      ? candidate.ratings.reduce((min, r) => (r.rating < min.rating ? r : min))
      : null;

  return (
    <>
      <div className="crumb">
        <Link to="/dashboard">Dashboard</Link> / <span className="here">{candidate.name}</span>
      </div>
      <div className="page-head" style={{ alignItems: "flex-start" }}>
        <div>
          <h1 style={{ fontSize: 32 }}>{candidate.name}</h1>
          <p className="artifact">
            {candidate.email} · invited {candidate.invitedAt} ·{" "}
            <span style={{ color: "var(--ink)" }}>{exam?.ticket ?? candidate.examId}</span>
          </p>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <StatusBadge status={candidate.status} />
          {PILOT_REPOS[candidate.examId] && (
            <a
              className="btn"
              href={PILOT_REPOS[candidate.examId]}
              target="_blank"
              rel="noreferrer"
            >
              Repo ↗
            </a>
          )}
          <button className="btn" onClick={() => window.print()}>
            Export PDF
          </button>
        </div>
      </div>

      <div
        className="report-grid"
        style={{ display: "grid", gridTemplateColumns: "300px 1fr", gap: 28, alignItems: "start" }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div className="card-navy" style={{ textAlign: "center", padding: 26 }}>
            <div
              style={{
                font: "600 12px var(--mono)",
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                color: "var(--navy-muted)",
                marginBottom: 18,
              }}
            >
              Competency average
            </div>
            <div style={{ display: "flex", justifyContent: "center" }}>
              <Ring value={avg} size={150} sub="out of 5.0" />
            </div>
            <div style={{ font: "500 12px/1.5 var(--sans)", color: "var(--navy-ink-2)", marginTop: 18 }}>
              {avg === null
                ? "Appears after submission, hidden-condition runs, and the defense."
                : lowest
                  ? `An average, never a verdict — read with the full profile. Growth edge: ${lowest.competency.toLowerCase()}.`
                  : null}
            </div>
          </div>

          <div className="card-soft">
            <div style={{ font: "700 13px var(--sans)", marginBottom: 4 }}>
              Hidden-suite verification
            </div>
            {verification ? (
              <>
                <div style={{ margin: "10px 0 14px" }}>
                  <span
                    className={`badge${
                      verification.baselineVerdict === "genuine-regression-test"
                        ? " badge-pass"
                        : " badge-attention"
                    }`}
                  >
                    {verification.baselineVerdict}
                  </span>
                </div>
                <div>
                  {verification.checks.map((check) => (
                    <div key={check.id} className="check-line">
                      <span className={check.result === "pass" ? "ok" : "bad"}>
                        {check.result === "pass" ? "✓" : "✗"}
                      </span>
                      <span>{check.id}</span>
                    </div>
                  ))}
                </div>
                <div
                  style={{
                    marginTop: 14,
                    paddingTop: 12,
                    borderTop: "1px solid var(--hairline)",
                    font: "600 12px var(--mono)",
                    color:
                      checksPassed === verification.checks.length
                        ? "var(--accent-strong)"
                        : "var(--rating-develop)",
                  }}
                >
                  {checksPassed} / {verification.checks.length} checks passed
                </div>
              </>
            ) : (
              <p style={{ font: "400 13px var(--sans)", color: "var(--ink-muted)", margin: "8px 0 0" }}>
                Verification runs against the candidate's branch after submission.
              </p>
            )}
          </div>

          <div className="card-soft">
            <div style={{ font: "700 13px var(--sans)", marginBottom: 10 }}>Pipeline position</div>
            <div className="progress-cell">
              <div
                className="progress-track"
                style={{ maxWidth: "none" }}
                role="progressbar"
                aria-valuenow={pct}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <div
                  className="progress-fill"
                  style={{ width: `${pct}%`, background: pct === 100 ? "var(--accent)" : undefined }}
                />
              </div>
              <span className="progress-pct">{pct}%</span>
            </div>
          </div>
        </div>

        <div className="card" style={{ padding: 26 }}>
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              justifyContent: "space-between",
              marginBottom: 6,
              gap: 12,
              flexWrap: "wrap",
            }}
          >
            <h3 style={{ font: "700 17px var(--sans)", margin: 0 }}>Competency profile</h3>
            <div className="legend">
              <span>
                <span className="sw" style={{ background: "var(--rating-strong)" }} />
                strong
              </span>
              <span>
                <span className="sw" style={{ background: "var(--rating-develop)" }} />
                developing
              </span>
              <span>
                <span className="sw" style={{ background: "var(--rating-needs)" }} />
                needs work
              </span>
            </div>
          </div>
          <p style={{ font: "400 12.5px/1.5 var(--sans)", color: "var(--ink-muted)", margin: "0 0 18px" }}>
            Every rating cites observable evidence — diff, tests, terminal activity, and defense
            answers. Never reduced to a single score.
          </p>
          {candidate.ratings.length === 0 ? (
            <p style={{ color: "var(--ink-2)", fontSize: 14 }}>
              No ratings yet — the profile appears after submission, hidden-condition runs, and the
              technical defense.
            </p>
          ) : (
            candidate.ratings.map((r) => {
              const gate = failedGateChecks(candidate.examId, r.competency, verification);
              const capped = gate !== null && r.rating > gate.cap;
              const shown = capped ? gate.cap : r.rating;
              return (
                <div key={r.competency} className="rating-item">
                  <div className="rating-row">
                    <span className="rating-name">{r.competency}</span>
                    <div
                      className="rating-cells"
                      aria-label={`${ratingWord(shown)}, ${shown} out of 5${capped ? ", capped by failed verification" : ""}`}
                    >
                      {[1, 2, 3, 4, 5].map((step) => (
                        <span
                          key={step}
                          className={`rating-cell ${step <= shown ? `on-${shown}` : ""}`}
                        />
                      ))}
                    </div>
                    <span className="rating-num" style={{ color: ratingWordColor(shown) }}>
                      {ratingWord(shown)} · {shown}/5
                    </span>
                  </div>
                  {capped && (
                    <p
                      className="evidence"
                      style={{ margin: "4px 0 0", fontFamily: "var(--mono)", fontSize: 11 }}
                    >
                      capped — {gate.failing.map((id) => `${id}: fail`).join(" · ")}
                    </p>
                  )}
                  <p className="evidence">{r.evidence}</p>
                </div>
              );
            })
          )}
        </div>
      </div>
    </>
  );
}
