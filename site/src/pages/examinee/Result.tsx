import { Link, useParams } from "react-router-dom";
import { useAuth } from "../../auth";
import { Ring } from "../../components/Ring";
import {
  averageRating,
  candidateById,
  EXAMINEE_RESULTS,
  examById,
  VERIFICATIONS,
} from "../../data";

function ratingWord(rating: number): string {
  if (rating >= 4) return "Strong";
  if (rating === 3) return "Developing";
  return "Needs work";
}

function ratingWordColor(rating: number): string {
  if (rating >= 4) return "var(--accent-strong)";
  if (rating === 3) return "var(--rating-develop)";
  return "var(--rating-needs)";
}

export function Result() {
  const { session } = useAuth();
  const { examId } = useParams();
  const result = examId ? EXAMINEE_RESULTS[examId] : undefined;
  const exam = examId ? examById(examId) : undefined;

  if (!result || !exam) {
    return (
      <p>
        No released result for this assessment yet. <Link to="/learn">Back to assessments</Link>
      </p>
    );
  }

  // Demo: the released profile data mirrors the reference candidate's report.
  const profile = candidateById(result.candidateId)!;
  const avg = averageRating(profile);
  const verification = VERIFICATIONS[result.candidateId];
  const passed = verification?.checks.filter((c) => c.result === "pass").length ?? 0;
  const lowest = profile.ratings.reduce((min, r) => (r.rating < min.rating ? r : min));
  const firstName = session?.name.split(" ")[0] ?? "there";

  return (
    <>
      <div className="crumb">
        <Link to="/learn">My assessments</Link> / <span className="here">Result</span>
      </div>

      <div
        className="ticket-band"
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 200px",
          gap: 32,
          alignItems: "center",
          padding: "38px 36px",
        }}
      >
        <div>
          <div className="band-chips">
            <span className="band-chip green">✓ ASSESSMENT COMPLETE</span>
            <span className="band-chip">{exam.ticket}</span>
          </div>
          <h1 style={{ fontSize: 32 }}>
            Nice work, {firstName} — this is a result a team can trust.
          </h1>
          <p className="sub">
            Your fix survived every hidden condition and your reasoning held up in the defense.
            Here's the evidence-backed profile employers will see — you control who gets it.
          </p>
        </div>
        <div style={{ textAlign: "center" }}>
          <Ring value={avg} size={150} sub="average / 5.0" />
        </div>
      </div>

      <div
        className="report-grid"
        style={{ display: "grid", gridTemplateColumns: "300px 1fr", gap: 28, alignItems: "start" }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div className="card-soft">
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
              <span style={{ font: "700 13px var(--sans)" }}>Hidden-suite result</span>
              <span style={{ font: "600 12px var(--mono)", color: "var(--accent-strong)" }}>
                {passed} / {verification?.checks.length} ✓
              </span>
            </div>
            <div>
              {verification?.checks.map((check) => (
                <div key={check.id} className="check-line">
                  <span className={check.result === "pass" ? "ok" : "bad"}>
                    {check.result === "pass" ? "✓" : "✗"}
                  </span>
                  <span>{check.id}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="card-navy" style={{ borderRadius: 14, padding: 20 }}>
            <div style={{ font: "700 13px var(--sans)", marginBottom: 12 }}>Share your profile</div>
            <p style={{ font: "400 12px/1.5 var(--sans)", color: "var(--navy-ink-2)", margin: "0 0 14px" }}>
              You decide who sees this. Generate a private link or share directly with a hiring
              team.
            </p>
            <button className="btn btn-primary" style={{ width: "100%", padding: 10, fontSize: 13, color: "#082f3c" }}>
              Share with employers
            </button>
            <button
              className="btn btn-ghost"
              style={{ width: "100%", marginTop: 6, color: "#cfe0e4", fontSize: 12 }}
              onClick={() => navigator.clipboard?.writeText(window.location.href)}
            >
              Copy private link
            </button>
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
            <h3 style={{ font: "700 17px var(--sans)", margin: 0 }}>Your competency profile</h3>
            <div className="legend">
              <span>
                <span className="sw" style={{ background: "var(--rating-strong)" }} />
                strong
              </span>
              <span>
                <span className="sw" style={{ background: "var(--rating-develop)" }} />
                developing
              </span>
            </div>
          </div>
          <p style={{ font: "400 12.5px/1.5 var(--sans)", color: "var(--ink-muted)", margin: "0 0 18px" }}>
            Each rating cites your own work — the diff, tests, terminal activity, and defense
            answers. Your growth edge is called out so you know exactly what to sharpen next.
          </p>
          {profile.ratings.map((r) => (
            <div key={r.competency} className="rating-item">
              <div className="rating-row">
                <span className="rating-name">{r.competency}</span>
                <div className="rating-cells" aria-label={`${ratingWord(r.rating)}, ${r.rating} out of 5`}>
                  {[1, 2, 3, 4, 5].map((step) => (
                    <span
                      key={step}
                      className={`rating-cell ${step <= r.rating ? `on-${r.rating}` : ""}`}
                    />
                  ))}
                </div>
                <span className="rating-num" style={{ color: ratingWordColor(r.rating) }}>
                  {ratingWord(r.rating)} · {r.rating}/5
                </span>
              </div>
              <p className="evidence">{r.evidence}</p>
            </div>
          ))}
          <div
            style={{
              marginTop: 20,
              paddingTop: 18,
              borderTop: "1px solid #f2f5f6",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 16,
              flexWrap: "wrap",
            }}
          >
            <div>
              <div style={{ font: "600 14px var(--sans)" }}>Ready for the next level?</div>
              <div style={{ font: "400 12.5px var(--sans)", color: "var(--ink-muted)", marginTop: 2 }}>
                {lowest.competency} is your growth edge — the {result.growthEdgeTrack} track targets
                it directly.
              </div>
            </div>
            <Link to="/learn" className="btn" style={{ flex: "none" }}>
              Explore tracks →
            </Link>
          </div>
        </div>
      </div>
    </>
  );
}
