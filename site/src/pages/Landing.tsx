import { Link } from "react-router-dom";
import { COMPETENCIES } from "../data";

const STEPS = [
  {
    title: "Inherit a real codebase",
    body: "A working app with history, legacy corners, and a production bug ticket — not a toy puzzle.",
  },
  {
    title: "Investigate & reproduce",
    body: "Production logs point at the failure; the naive reproduction won't trigger it.",
  },
  {
    title: "Fix and ship a PR",
    body: "Any AI tools you normally use are allowed. Regression coverage is expected.",
  },
  {
    title: "Survive the hidden conditions",
    body: "Concurrency, replica behavior, restarts, and unrelated-regression checks run against your branch.",
  },
  {
    title: "Defend your diff",
    body: "An AI-led technical defense generates questions from your actual diff, tests, and reasoning.",
  },
  {
    title: "Get an evidence-backed report",
    body: "A competency profile with cited evidence — never a single opaque score.",
  },
];

export function Landing() {
  return (
    <>
      <section className="hero">
        <h1>Make your work production-worthy.</h1>
        <p>
          Developers can build fast with AI. The scarce thing is shipping code a team can trust.
          CodeWorthy proves it: realistic inherited codebases, hidden failure conditions, and an
          evidence-backed competency report employers can act on.
        </p>
        <div className="hero-ctas">
          <Link to="/login?role=examinee" className="btn btn-primary btn-lg">
            Start proving it
          </Link>
          <Link to="/login?role=merchant" className="btn btn-lg">
            I'm hiring — see candidate evidence
          </Link>
        </div>
      </section>

      <p className="eyebrow">How an assessment works</p>
      <h2 className="section-title">Six steps, zero trivia questions</h2>
      <div className="grid-2">
        {STEPS.map((step, i) => (
          <div
            className={`card step${i === STEPS.length - 1 ? " step-final" : ""}`}
            key={step.title}
          >
            <span className="step-num">{String(i + 1).padStart(2, "0")}</span>
            <div>
              <strong>{step.title}</strong>
              <p>{step.body}</p>
            </div>
          </div>
        ))}
      </div>

      <p className="eyebrow">For employers</p>
      <h2 className="section-title">A competency profile, never a single score</h2>
      <div className="grid-2">
        <div className="card">
          <h3>Evidence you can inspect</h3>
          <p style={{ color: "var(--ink-2)" }}>
            Every rating cites the candidate's actual work: the diff, the tests, the terminal
            activity, the defense answers. "Did not finish" is distinguished from "does not
            understand."
          </p>
        </div>
        <div className="card">
          <h3>AI usage scored on control</h3>
          <p style={{ color: "var(--ink-2)" }}>
            Candidates use whatever AI tools they normally would. We measure whether they guide,
            inspect, and verify the output — never whether they used it.
          </p>
        </div>
      </div>

      <p className="eyebrow">What we measure</p>
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
