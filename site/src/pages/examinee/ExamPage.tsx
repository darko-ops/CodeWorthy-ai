import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { examById, readProgress, writeProgress, type ExamProgress } from "../../data";

// Presentation only: steps that a machine verifies live (checks that tick)
// versus steps a human reviews after submission.
function isAutomatedStep(step: string): boolean {
  return /reproduce|test|regression|green|metric|migration|backfill/i.test(step);
}

export function ExamPage() {
  const { examId } = useParams();
  const exam = examId ? examById(examId) : undefined;
  const [progress, setProgress] = useState<ExamProgress>(
    () => (examId && readProgress()[examId]) || "not_started"
  );

  if (!exam) {
    return (
      <p>
        Exam not found. <Link to="/learn">Back to assessments</Link>
      </p>
    );
  }

  const update = (next: ExamProgress) => {
    writeProgress(exam.id, next);
    setProgress(next);
  };

  return (
    <>
      <div className="crumb">
        <Link to="/learn">My assessments</Link> / <span className="artifact">{exam.ticket}</span>
      </div>
      <div className="page-head">
        <div>
          <h1>{exam.title}</h1>
          <p>{exam.summary}</p>
        </div>
        {progress === "not_started" && (
          <button className="btn btn-primary btn-lg" onClick={() => update("in_progress")}>
            Start assessment
          </button>
        )}
        {progress === "in_progress" && (
          <button className="btn btn-primary btn-lg" onClick={() => update("submitted")}>
            Mark as submitted
          </button>
        )}
        {progress === "submitted" && (
          <span className="badge badge-pass">✓ Submitted — awaiting review</span>
        )}
      </div>

      <div className="exam-meta">
        <span className="badge">{exam.ticket}</span>
        <span className="badge">{exam.timeboxHours}h timebox</span>
        <span className="badge">AI tools allowed</span>
      </div>

      <div className="prose">
        <h2>Scenario</h2>
        <p style={{ color: "var(--ink-2)" }}>{exam.scenario}</p>

        <h2>What you'll do</h2>
        <div className="card" style={{ padding: "6px 20px" }}>
          {exam.steps.map((step, i) => (
            <div className="mission-step" key={step}>
              <span className="mission-idx">{String(i + 1).padStart(2, "0")}</span>
              <p>{step}</p>
              {isAutomatedStep(step) ? (
                <span className="badge">auto check</span>
              ) : (
                <span className="badge">pending review</span>
              )}
            </div>
          ))}
        </div>

        <h2>Competencies in focus</h2>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {exam.focusCompetencies.map((c) => (
            <span className="competency-chip" key={c}>
              {c}
            </span>
          ))}
        </div>

        <h2>Ground rules</h2>
        <ul style={{ paddingLeft: 20 }}>
          <li>
            Work in the repository you're invited to; open a PR with the provided template when
            done.
          </li>
          <li>
            Use any AI tools you normally would — you'll be asked to explain and defend your diff,
            so stay in control of it.
          </li>
          <li>
            Hidden conditions (concurrency, replicas, restarts, unrelated regressions) run against
            your branch after submission.
          </li>
          <li>
            Running out of time is reported as <em>unassessed</em>, not failed — ship the most
            trustworthy subset you can.
          </li>
        </ul>
      </div>
    </>
  );
}
