import { useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../auth";
import { EXAMS, LESSONS, readProgress, type ExamProgress } from "../../data";

const PROGRESS_LABEL: Record<ExamProgress, string> = {
  not_started: "Not started",
  in_progress: "In progress",
  submitted: "Submitted",
};

export function Learn() {
  const { session } = useAuth();
  const [progress] = useState(readProgress);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Welcome, {session?.name}</h1>
          <p>Advance by demonstrating competencies under different conditions — never by consuming content.</p>
        </div>
      </div>

      <div className="card prose" style={{ marginBottom: 28 }}>
        <h3 style={{ marginBottom: 8 }}>How assessments work</h3>
        <ul style={{ margin: 0, paddingLeft: 20 }}>
          <li>
            <strong>You get a real repository.</strong> Clone it, run it, read the ticket. The bug
            reproduces in production conditions, not on the happy path.
          </li>
          <li>
            <strong>AI tools are allowed — and scored on control.</strong> Guide, inspect, and
            verify. You will defend every line of your diff.
          </li>
          <li>
            <strong>Hidden conditions run against your branch.</strong> Concurrency, replicas,
            restarts, and unrelated-regression checks.
          </li>
          <li>
            <strong>Your work becomes an evidence-backed profile</strong> across twelve
            competencies — the report employers actually see.
          </li>
        </ul>
      </div>

      {LESSONS.map((lesson) => {
        const exams = EXAMS.filter((e) => e.lessonId === lesson.id);
        if (exams.length === 0) return null;
        return (
          <section key={lesson.id} className="lesson-section">
            <span className="lesson-level">{lesson.level}</span>
            <h2 style={{ margin: "2px 0 4px", letterSpacing: "-0.02em" }}>{lesson.title}</h2>
            <p style={{ color: "var(--ink-2)", margin: "0 0 14px", maxWidth: 720 }}>
              {lesson.summary}
            </p>
            <div className="grid-2">
              {exams.map((exam) => {
                const state = progress[exam.id] ?? "not_started";
                return (
                  <Link
                    key={exam.id}
                    to={`/learn/exams/${exam.id}`}
                    className="card"
                    style={{ color: "inherit", display: "block" }}
                  >
                    <div className="exam-meta" style={{ margin: "0 0 8px" }}>
                      <span className="badge">{exam.ticket}</span>
                      <span className="badge">{exam.timeboxHours}h timebox</span>
                      <span className={`badge${state === "submitted" ? " badge-pass" : ""}`}>
                        {state === "submitted" ? "✓ " : ""}
                        {PROGRESS_LABEL[state]}
                      </span>
                    </div>
                    <strong style={{ fontSize: 16 }}>{exam.title}</strong>
                    <p style={{ color: "var(--ink-2)", fontSize: 14, margin: "6px 0 0" }}>
                      {exam.summary}
                    </p>
                  </Link>
                );
              })}
            </div>
          </section>
        );
      })}
    </>
  );
}
