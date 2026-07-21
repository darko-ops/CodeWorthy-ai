import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { examById, LESSONS } from "../../data";

// The invitable assessments named in the mockups (behavior-catalog backlog).
const INVITABLE = ["acme-1287", "acme-legacy-api", "acme-ci"];

export function Invite() {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("jordan.lee@example.com");
  const [examId, setExamId] = useState("acme-1287");
  const [note, setNote] = useState(
    "Hi Jordan — this mirrors the kind of production work you'd own here. Take your time."
  );
  const [sent, setSent] = useState(false);

  const exam = examById(examId)!;
  const firstName = (name.trim() || email.split("@")[0] || "the candidate").split(/[\s._-]/)[0];
  const displayFirst = firstName[0] ? firstName[0].toUpperCase() + firstName.slice(1) : firstName;

  const send = () => {
    setSent(true);
    setTimeout(() => navigate("/dashboard"), 1200);
  };

  return (
    <>
      <div className="crumb">
        <Link to="/dashboard">Candidates</Link> / <span className="here">Invite</span>
      </div>
      <div className="page-head">
        <div>
          <h1 style={{ fontSize: 28 }}>Invite a candidate</h1>
          <p>
            They get a private repo, the ticket, and a timebox — with any AI tools allowed. You get
            the evidence.
          </p>
        </div>
      </div>

      <div
        className="report-grid"
        style={{ display: "grid", gridTemplateColumns: "1fr 360px", gap: 28, alignItems: "start" }}
      >
        <div className="card" style={{ padding: 26 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 20 }}>
            <div className="field" style={{ marginBottom: 0 }}>
              <label htmlFor="inv-name">Full name</label>
              <input
                id="inv-name"
                placeholder="e.g. Jordan Lee"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label htmlFor="inv-email">Email</label>
              <input
                id="inv-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
          </div>

          <label style={{ display: "block", font: "600 12px var(--sans)", color: "var(--ink-2)", marginBottom: 10 }}>
            Assessment
          </label>
          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 20 }}>
            {INVITABLE.map((id) => {
              const e = examById(id)!;
              const lesson = LESSONS.find((l) => l.id === e.lessonId);
              const selected = examId === id;
              return (
                <button
                  key={id}
                  type="button"
                  className={`pick-card${selected ? " selected" : ""}`}
                  onClick={() => setExamId(id)}
                  aria-pressed={selected}
                >
                  <span className="pick-radio">{selected ? "✓" : ""}</span>
                  <span style={{ flex: 1 }}>
                    <span style={{ display: "flex", gap: 7, marginBottom: 5, flexWrap: "wrap" }}>
                      <span
                        className="badge"
                        style={selected ? { background: "#d7f5e3", borderColor: "#d7f5e3", color: "var(--ink)" } : undefined}
                      >
                        {e.ticket}
                      </span>
                      <span className="badge">
                        {lesson?.level.split(" ")[0]} · {e.timeboxHours}h
                      </span>
                    </span>
                    <span style={{ display: "block", font: "600 15px var(--sans)", color: "var(--ink)" }}>
                      {e.title}
                    </span>
                    <span
                      style={{
                        display: "block",
                        font: "400 12.5px/1.45 var(--sans)",
                        color: "var(--ink-muted)",
                        marginTop: 3,
                      }}
                    >
                      {e.summary.split(". ")[0]}.
                    </span>
                  </span>
                </button>
              );
            })}
          </div>

          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor="inv-note">
              Personal note{" "}
              <span style={{ color: "var(--ink-faint)", fontWeight: 400 }}>(optional)</span>
            </label>
            <textarea
              id="inv-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              style={{
                width: "100%",
                padding: "12px 13px",
                font: "400 13.5px/1.5 var(--sans)",
                border: "1px solid var(--border)",
                borderRadius: 8,
                color: "var(--ink)",
                resize: "vertical",
              }}
            />
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div className="card-navy" style={{ borderRadius: 14, padding: 22 }}>
            <div
              style={{
                font: "600 11px var(--mono)",
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                color: "var(--navy-muted)",
                marginBottom: 16,
              }}
            >
              What {displayFirst} receives
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 13 }}>
              {[
                <>A private repo with real history &amp; the bug ticket</>,
                <>
                  A <strong style={{ color: "#fff" }}>{exam.timeboxHours}-hour</strong> timebox once
                  they start
                </>,
                <>Any AI tools allowed — scored on control</>,
                <>Hidden-suite checks run against their branch</>,
              ].map((line, i) => (
                <div key={i} style={{ display: "flex", gap: 11, alignItems: "flex-start" }}>
                  <span style={{ font: "700 12px var(--mono)", color: "var(--accent-bright)", marginTop: 1 }}>
                    ›
                  </span>
                  <span style={{ font: "400 13px/1.4 var(--sans)", color: "var(--navy-ink-2)" }}>
                    {line}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="card-soft" style={{ padding: 18 }}>
            <div style={{ font: "600 12px var(--sans)", marginBottom: 8 }}>Invite email preview</div>
            <div style={{ background: "#fff", border: "1px solid var(--hairline)", borderRadius: 9, padding: 13 }}>
              <div style={{ font: "600 12px var(--sans)", marginBottom: 5 }}>
                You're invited to a CodeWorthy assessment
              </div>
              <div style={{ font: "400 11.5px/1.5 var(--sans)", color: "var(--ink-muted)" }}>
                Acme Wholesale invited you to{" "}
                <span style={{ color: "var(--accent-strong)", fontWeight: 600 }} className="artifact">
                  {exam.ticket}
                </span>
                . Open the repo, read the ticket, and ship a fix you can defend.
              </div>
              <div style={{ marginTop: 10 }}>
                <span className="btn btn-primary" style={{ fontSize: 11, padding: "6px 12px" }}>
                  Accept invite
                </span>
              </div>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "center" }}>
            <span style={{ font: "500 11px var(--sans)", color: "var(--ink-muted)" }}>
              ✉ Email sent immediately on invite
            </span>
          </div>

          <div style={{ display: "flex", gap: 10 }}>
            <Link to="/dashboard" className="btn" style={{ flex: 1, textAlign: "center", padding: 12 }}>
              Cancel
            </Link>
            <button
              className="btn btn-primary"
              style={{ flex: 1, padding: 12 }}
              onClick={send}
              disabled={sent}
            >
              {sent ? "✓ Invite sent" : "Send invite"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
