import { Link } from "react-router-dom";
import { COMPETENCIES } from "../data";

const STEPS = [
  { title: "Inherit a real codebase", body: "A working app with history, legacy corners, and a production bug ticket." },
  { title: "Investigate & reproduce", body: "Production logs point at the failure; the naive reproduction won't trigger it." },
  { title: "Fix and ship a PR", body: "Any AI tools you normally use are allowed. Regression coverage is expected." },
  { title: "Survive hidden conditions", body: "Concurrency, replicas, restarts, and unrelated-regression checks." },
  { title: "Defend your diff", body: "An AI-led defense generates questions from your actual diff and reasoning." },
  { title: "Get an evidence-backed report", body: "A competency profile with cited evidence — never a single opaque score." },
];

const EVIDENCE_BARS = [
  { name: "Root-cause analysis", score: "5/5", width: "100%", color: "#22c55e", scoreColor: "#4ade80", delay: "0.7s" },
  { name: "Testing", score: "4/5", width: "80%", color: "#22c55e", scoreColor: "#4ade80", delay: "0.82s" },
  { name: "Deployment judgment", score: "3/5", width: "60%", color: "#d9a200", scoreColor: "#f5bd4f", delay: "0.94s" },
];

export function Landing() {
  return (
    <>
      <section className="hero-grid">
        <div>
          <div className="hero-eyebrow fu">Production-readiness, proven ▸</div>
          <h1 className="fu">
            Make your work
            <br />
            production-
            <span className="hero-worthy">
              worthy
              <span className="underline" aria-hidden />
            </span>
            .
          </h1>
          <p className="fu">
            Anyone can build fast with AI. The scarce thing is shipping code a team can trust.
            CodeWorthy proves it — realistic inherited codebases, hidden failure conditions, and an
            evidence-backed report employers can act on.
          </p>
          <div className="hero-ctas fu">
            <Link to="/login?role=examinee" className="btn btn-primary btn-lg">
              Start proving it
            </Link>
            <Link to="/login?role=merchant" className="btn btn-lg">
              I'm hiring →
            </Link>
          </div>
          <div className="hero-chips">
            <span className="badge">12 competencies</span>
            <span className="badge">AI tools allowed</span>
            <span className="badge">Evidence, not a score</span>
          </div>
        </div>

        <div className="evidence-card">
          <div className="evidence-head">
            <span>Competency report</span>
            <span className="badge badge-solid">✓ REPORT READY</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 20 }}>
            <div
              className="ring"
              style={{ width: 66, height: 66, background: "conic-gradient(#22c55e 82%, #16404e 0)" }}
              aria-hidden
            >
              <div className="ring-inner" style={{ width: 50, height: 50 }}>
                <span className="ring-value" style={{ fontSize: 18 }}>4.1</span>
                <span style={{ font: "500 8px var(--mono)", color: "var(--navy-muted)" }}>/ 5.0 avg</span>
              </div>
            </div>
            <div>
              <div style={{ font: "700 15px var(--sans)", color: "#fff" }}>Priya Raman</div>
              <div style={{ font: "500 12px var(--mono)", color: "var(--navy-muted)", marginTop: 2 }}>
                ACME-1287 · duplicate charges
              </div>
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
            {EVIDENCE_BARS.map((b) => (
              <div key={b.name}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
                  <span style={{ font: "500 12px var(--sans)", color: "#cfe0e4" }}>{b.name}</span>
                  <span style={{ font: "600 11px var(--mono)", color: b.scoreColor }}>{b.score}</span>
                </div>
                <div className="evidence-bar">
                  <div style={{ width: b.width, background: b.color, animationDelay: b.delay }} />
                </div>
              </div>
            ))}
          </div>
          <div className="evidence-foot">5/5 hidden-suite checks passed · evidence-cited</div>
        </div>
      </section>

      <section className="steps-strip">
        <p className="eyebrow">How an assessment works</p>
        <h2 className="section-title">Six steps, zero trivia questions</h2>
        <div className="steps-grid">
          {STEPS.map((step, i) => (
            <div key={step.title}>
              <div className="step-no">{String(i + 1).padStart(2, "0")}</div>
              <div className="step-title">{step.title}</div>
              <div className="step-body">{step.body}</div>
            </div>
          ))}
        </div>
      </section>

      <p className="eyebrow" style={{ marginTop: 56 }}>
        For employers
      </p>
      <h2 className="section-title">A competency profile, never a single score</h2>
      <div className="grid-2">
        <div className="card">
          <h3>Evidence you can inspect</h3>
          <p style={{ color: "var(--ink-2)", fontSize: 14 }}>
            Every rating cites the candidate's actual work: the diff, the tests, the terminal
            activity, the defense answers. "Did not finish" is distinguished from "does not
            understand."
          </p>
        </div>
        <div className="card">
          <h3>AI usage scored on control</h3>
          <p style={{ color: "var(--ink-2)", fontSize: 14 }}>
            Candidates use whatever AI tools they normally would. We measure whether they guide,
            inspect, and verify the output — never whether they used it.
          </p>
        </div>
      </div>

      <p className="eyebrow" style={{ marginTop: 56 }}>
        What we measure
      </p>
      <h2 className="section-title">Twelve competencies, rated 1–5 with evidence</h2>
      <div className="grid-3">
        {COMPETENCIES.map((c) => (
          <div className="card" key={c} style={{ padding: "14px 16px" }}>
            <strong style={{ fontSize: 14 }}>{c}</strong>
          </div>
        ))}
      </div>

      <div className="card" style={{ marginTop: 64, textAlign: "center", padding: 40 }}>
        <h2 className="section-title" style={{ marginBottom: 8 }}>
          Ready to see it in action?
        </h2>
        <p style={{ color: "var(--ink-2)", marginTop: 0 }}>
          The flagship assessment is live: a duplicate-charge bug in an inherited order-management
          API — ticket <span className="artifact">ACME-1287</span>.
        </p>
        <Link to="/login" className="btn btn-primary btn-lg">
          Sign in to get started
        </Link>
      </div>
    </>
  );
}
