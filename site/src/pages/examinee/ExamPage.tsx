import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  EXAM_STEP_MODES,
  EXAMINEE_RESULTS,
  examById,
  PILOT_REPOS,
  readProgress,
  writeProgress,
  type ExamProgress,
} from "../../data";

// Presentation only: steps that a machine verifies live (checks that tick)
// versus steps a human reviews after submission. Exams with an explicit
// EXAM_STEP_MODES entry use it; others fall back to the keyword heuristic.
function isAutomatedStep(examId: string, step: string, index: number): boolean {
  const modes = EXAM_STEP_MODES[examId];
  if (modes && modes[index] !== undefined) return modes[index] === "auto";
  return /reproduce|test|regression|green|metric|migration|backfill/i.test(step);
}

// Ticket ids (ACME-1234) and check ids (snake_case tokens) are real system
// artifacts — render them in mono wherever they appear in step text.
function renderArtifacts(text: string) {
  const parts = text.split(/(ACME-\d{4}|\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b)/g);
  return parts.map((part, i) =>
    /^(ACME-\d{4}|[a-z][a-z0-9]*(?:_[a-z0-9]+)+)$/.test(part) ? (
      <span key={i} className="artifact">
        {part}
      </span>
    ) : (
      part
    )
  );
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
        <Link to="/learn">My assessments</Link> / <span className="here">{exam.ticket}</span>
      </div>

      <div className="ticket-band">
        <div className="band-chips">
          <span className="band-chip">{exam.ticket}</span>
          <span className="band-chip">{exam.timeboxHours}h timebox</span>
          <span className="band-chip green">AI tools allowed</span>
          {PILOT_REPOS[exam.id] && (
            <a
              className="band-chip"
              href={PILOT_REPOS[exam.id]}
              target="_blank"
              rel="noreferrer"
              style={{ color: "#cfe0e4" }}
            >
              assessment repo ↗
            </a>
          )}
        </div>
        <div className="band-foot">
          <div>
            <h1>{exam.title}</h1>
            <p className="sub">{exam.summary}</p>
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
          {progress === "submitted" &&
            (EXAMINEE_RESULTS[exam.id] ? (
              <Link to={`/learn/results/${exam.id}`} className="btn btn-primary btn-lg">
                View your result →
              </Link>
            ) : (
              <span className="badge badge-solid">✓ SUBMITTED — AWAITING REVIEW</span>
            ))}
        </div>
      </div>

      <div className="exam-grid">
        <div>
          <h2 className="mono-h">Scenario</h2>
          <p style={{ font: "400 15px/1.6 var(--sans)", color: "var(--ink-2)", margin: "0 0 28px" }}>
            {exam.scenario}
          </p>
          <h2 className="mono-h">What you'll do</h2>
          <div>
            {exam.steps.map((step, i) => (
              <div className="mission-step" key={step}>
                <span className="mission-idx">{String(i + 1).padStart(2, "0")}</span>
                <p>{renderArtifacts(step)}</p>
                {isAutomatedStep(exam.id, step, i) ? (
                  <span className="badge badge-pass">auto check</span>
                ) : (
                  <span className="badge">pending review</span>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="card-soft">
          <h3 style={{ font: "700 13px var(--sans)", margin: "0 0 14px" }}>Competencies in focus</h3>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 22 }}>
            {exam.focusCompetencies.map((c) => (
              <span className="competency-chip" key={c}>
                {c}
              </span>
            ))}
          </div>
          <h3 style={{ font: "700 13px var(--sans)", margin: "0 0 10px" }}>Ground rules</h3>
          <ul style={{ margin: 0, paddingLeft: 16, font: "400 12.5px/1.6 var(--sans)", color: "var(--ink-muted)" }}>
            <li>Open a PR with the provided template when done.</li>
            <li>Stay in control of your diff — you'll explain every line.</li>
            <li>Hidden conditions run against your branch after submission.</li>
            <li>
              Out of time is <em>unassessed</em>, not failed.
            </li>
          </ul>
        </div>
      </div>
    </>
  );
}
