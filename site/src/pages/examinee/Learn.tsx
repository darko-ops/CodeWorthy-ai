import { useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../auth";
import { EXAMS, LESSONS, readProgress, type ExamProgress } from "../../data";

const PROGRESS_LABEL: Record<ExamProgress, string> = {
  not_started: "Not started",
  in_progress: "In progress",
  submitted: "Submitted",
};

// Rail color follows activity (mockup 1f): green for the track you're in,
// navy for the rest.
function railFor(states: ExamProgress[]): string {
  return states.some((s) => s === "in_progress" || s === "submitted") ? "#16a34a" : "#3a5a63";
}

const STRIP = [
  { k: "REAL REPO", v: "Clone it, run it, read the ticket. The bug reproduces in production conditions." },
  { k: "AI ALLOWED", v: "Guide, inspect, verify. You'll defend every line of your diff." },
  { k: "HIDDEN CONDITIONS", v: "Concurrency, replicas, restarts, and unrelated-regression checks." },
  { k: "EVIDENCE PROFILE", v: "Twelve competencies — the report employers actually see." },
];

export function Learn() {
  const { session } = useAuth();
  const [progress] = useState(readProgress);

  const inProgress = EXAMS.filter((e) => progress[e.id] === "in_progress").length;
  const submitted = EXAMS.filter((e) => progress[e.id] === "submitted").length;
  const available = EXAMS.length - inProgress - submitted;

  return (
    <div className="learn-bg">
      <div className="learn-head">
        <div>
          <h1 style={{ font: "800 30px var(--sans)", letterSpacing: "-0.02em", margin: 0 }}>
            Welcome, {session?.name}
          </h1>
          <p style={{ font: "400 15px var(--sans)", color: "var(--ink-2)", margin: "8px 0 0", maxWidth: 560 }}>
            Advance by demonstrating competencies under different conditions — never by consuming
            content.
          </p>
        </div>
        <div className="learn-stats">
          <div>
            <div className="learn-stat-n" style={{ color: "var(--accent-strong)" }}>{inProgress}</div>
            <div className="learn-stat-l">in progress</div>
          </div>
          <div className="sep" />
          <div>
            <div className="learn-stat-n">{available}</div>
            <div className="learn-stat-l">available</div>
          </div>
          <div className="sep" />
          <div>
            <div className="learn-stat-n" style={{ color: "var(--ink-faint)" }}>{submitted}</div>
            <div className="learn-stat-l">submitted</div>
          </div>
        </div>
      </div>

      <div className="navy-strip">
        {STRIP.map((s) => (
          <div key={s.k}>
            <div className="k">{s.k}</div>
            <div className="v">{s.v}</div>
          </div>
        ))}
      </div>

      {LESSONS.map((lesson, idx) => {
        const exams = EXAMS.filter((e) => e.lessonId === lesson.id);
        if (exams.length === 0) return null;
        const rail = railFor(exams.map((e) => progress[e.id] ?? "not_started"));
        return (
          <section key={lesson.id} className="track" style={{ "--rail": rail } as React.CSSProperties}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 4 }}>
              <span className="track-level">{lesson.level}</span>
              <span className="track-idx">track {idx + 1} / {LESSONS.length}</span>
            </div>
            <h2>{lesson.title}</h2>
            <p>{lesson.summary}</p>
            {exams.map((exam) => {
              const state = progress[exam.id] ?? "not_started";
              return (
                <Link key={exam.id} to={`/learn/exams/${exam.id}`} className="exam-card">
                  <div style={{ display: "flex", gap: 8, marginBottom: 10, alignItems: "center", flexWrap: "wrap" }}>
                    <span className="badge">{exam.ticket}</span>
                    <span className="badge">{exam.timeboxHours}h timebox</span>
                    <span
                      className={`badge${
                        state === "submitted" ? " badge-pass" : state === "in_progress" ? " badge-amber" : ""
                      }`}
                    >
                      {state === "submitted" ? "✓ " : ""}
                      {PROGRESS_LABEL[state]}
                    </span>
                    <span className="go">
                      {state === "in_progress" ? "Resume" : state === "submitted" ? "Review" : "Start"} →
                    </span>
                  </div>
                  <div style={{ font: "700 15px var(--sans)", color: "var(--ink)", marginBottom: 5 }}>
                    {exam.title}
                  </div>
                  <p style={{ font: "400 13px/1.5 var(--sans)", color: "var(--ink-muted)", margin: 0 }}>
                    {exam.summary}
                  </p>
                </Link>
              );
            })}
          </section>
        );
      })}
    </div>
  );
}
