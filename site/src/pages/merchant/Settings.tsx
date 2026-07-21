import { useState } from "react";
import { Link } from "react-router-dom";

const TIMEBOXES = ["2h", "3h", "4h", "6h"];

function Toggle({
  on,
  onChange,
  label,
}: {
  on: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      className={`toggle${on ? " on" : ""}`}
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
    />
  );
}

export function Settings() {
  const [twoReviewer, setTwoReviewer] = useState(true);
  const [blindFirstPass, setBlindFirstPass] = useState(true);
  const [autoShare, setAutoShare] = useState(false);
  const [timebox, setTimebox] = useState("4h");

  return (
    <>
      <div className="page-head">
        <div>
          <h1 style={{ fontSize: 28 }}>Settings</h1>
          <p>Manage your organization, reviewers, and notifications.</p>
        </div>
      </div>

      <div
        style={{ display: "grid", gridTemplateColumns: "220px 1fr", gap: 32, alignItems: "start" }}
        className="report-grid"
      >
        <nav className="side-nav" aria-label="Settings sections">
          <span className="side-item">Profile</span>
          <span className="side-item active">Organization</span>
          <Link to="/dashboard/team" className="side-item">
            Reviewers &amp; roles
          </Link>
          <span className="side-item">Notifications</span>
          <span className="side-item">Assessments</span>
          <Link to="/dashboard/billing" className="side-item">
            Billing
          </Link>
        </nav>

        <div style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: 640 }}>
          <div className="card" style={{ padding: 24 }}>
            <h3 style={{ font: "700 16px var(--sans)", margin: "0 0 4px" }}>Organization</h3>
            <p style={{ font: "400 12.5px var(--sans)", color: "var(--ink-muted)", margin: "0 0 20px" }}>
              These details appear to candidates on their invite and assessment pages.
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
              <div className="field" style={{ marginBottom: 0 }}>
                <label htmlFor="org-name">Organization name</label>
                <input id="org-name" defaultValue="Acme Wholesale" />
              </div>
              <div className="field" style={{ marginBottom: 0 }}>
                <label htmlFor="org-url">Workspace URL</label>
                <input
                  id="org-url"
                  defaultValue="codeworthy.dev/acme"
                  style={{ fontFamily: "var(--mono)", color: "var(--ink-muted)" }}
                />
              </div>
            </div>
            <label style={{ display: "block", font: "600 12px var(--sans)", color: "var(--ink-2)", marginBottom: 6 }}>
              Default timebox
            </label>
            <div className="seg">
              {TIMEBOXES.map((t) => (
                <button
                  key={t}
                  className={timebox === t ? "selected" : ""}
                  onClick={() => setTimebox(t)}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          <div className="card" style={{ padding: 24 }}>
            <h3 style={{ font: "700 16px var(--sans)", margin: "0 0 16px" }}>Review policy</h3>
            {[
              {
                title: "Require 2 reviewer approvals",
                sub: "A report is only released after two reviewers sign off.",
                on: twoReviewer,
                set: setTwoReviewer,
              },
              {
                title: "Blind first pass",
                sub: "Hide candidate name until the first review is submitted.",
                on: blindFirstPass,
                set: setBlindFirstPass,
              },
              {
                title: "Auto-share report with candidate",
                sub: "Candidates receive their own evidence-backed profile.",
                on: autoShare,
                set: setAutoShare,
              },
            ].map((row, i, arr) => (
              <div
                key={row.title}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 16,
                  padding: "12px 0",
                  borderBottom: i < arr.length - 1 ? "1px solid #f2f5f6" : "none",
                }}
              >
                <div style={{ flex: 1 }}>
                  <div style={{ font: "600 14px var(--sans)" }}>{row.title}</div>
                  <div style={{ font: "400 12px var(--sans)", color: "var(--ink-muted)", marginTop: 2 }}>
                    {row.sub}
                  </div>
                </div>
                <Toggle on={row.on} onChange={row.set} label={row.title} />
              </div>
            ))}
          </div>

          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
            <button className="btn">Cancel</button>
            <button className="btn btn-primary">Save changes</button>
          </div>
        </div>
      </div>
    </>
  );
}
