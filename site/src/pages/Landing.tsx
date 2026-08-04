import { Link } from "react-router-dom";

// The Steward service (the backend that runs the guard). Point the CTAs at the
// deployed install flow; overridable per environment.
const STEWARD_URL = (import.meta.env.VITE_STEWARD_URL as string | undefined)?.replace(/\/+$/, "") ?? "https://codeworthy-steward.fly.dev";
const INSTALL_URL = `${STEWARD_URL}/steward/install`;

const STEPS = [
  { title: "Install on your repo", body: "One click. CodeWorthy asks to read your code and comment — never to write it or merge." },
  { title: "It protects main", body: "Your default branch now takes changes through a reviewable pull request. Force-pushes and deletions are blocked." },
  { title: "It reviews every change", body: "Secrets, committed .env files, and risky migrations get caught before they merge — in plain language." },
  { title: "You get a weekly digest", body: "One email: what happened, what needs a look, and nothing to babysit in between." },
];

// The hero health-card vitals (mirrors /steward/health).
const VITALS = [
  { name: "Branch protection", status: "healthy", word: "ON", color: "#4ade80" },
  { name: "Review discipline", status: "watch", word: "WATCH", color: "#f5bd4f" },
  { name: "Record integrity", status: "healthy", word: "VERIFIED", color: "#4ade80" },
];

const DOES = [
  { title: "Guards your main branch", body: "Configures branch protection so nothing lands on your default branch without a reviewable pull request — the thing a senior engineer would set up on day one." },
  { title: "Catches what breaks repos", body: "Secrets in a commit, a committed .env or node_modules, a destructive migration — blocked before merge. Missing tests and sprawling PRs — flagged, not blocked." },
  { title: "Explains every call", body: "No jargon, no black box. Each decision is a plain-language note on the exact commit or PR, and every one is reversible." },
  { title: "Keeps tamper-evident records", body: "An append-only, hash-chained change log — the SOC 2 change-control evidence an auditor asks for, without you thinking about it." },
];

export function Landing() {
  return (
    <>
      <section className="hero-grid">
        <div>
          <div className="hero-eyebrow fu">A senior engineer for your repo ▸</div>
          <h1 className="fu">
            Build with AI.
            <br />
            Ship code that's
            <span className="hero-worthy">
              {" "}worthy
              <span className="underline" aria-hidden />
            </span>
            .
          </h1>
          <p className="fu">
            CodeWorthy stewards your repository the way a senior engineer would — it protects your
            main branch, reviews changes before they land, and keeps a plain-language record. You
            keep building; it makes sure what ships is safe.
          </p>
          <div className="hero-ctas fu">
            <a href={INSTALL_URL} className="btn btn-primary btn-lg">
              Protect my repo
            </a>
            <Link to="/login?role=merchant" className="btn btn-lg">
              For hiring teams →
            </Link>
          </div>
          <div className="hero-chips">
            <span className="badge">Never merges — you own that</span>
            <span className="badge">Plain language</span>
            <span className="badge">Tamper-evident log</span>
          </div>
        </div>

        <div className="evidence-card">
          <div className="evidence-head">
            <span>Repo health</span>
            <span className="badge badge-solid">🩺 LIVE CHART</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 20 }}>
            <div
              className="ring"
              style={{ width: 66, height: 66, background: "conic-gradient(#f5bd4f 66%, #16404e 0)" }}
              aria-hidden
            >
              <div className="ring-inner" style={{ width: 50, height: 50 }}>
                <span className="ring-value" style={{ fontSize: 13 }}>Needs</span>
                <span style={{ font: "500 8px var(--mono)", color: "var(--navy-muted)" }}>attention</span>
              </div>
            </div>
            <div>
              <div style={{ font: "700 15px var(--sans)", color: "#fff" }}>dana/recipe-app</div>
              <div style={{ font: "500 12px var(--mono)", color: "var(--navy-muted)", marginTop: 2 }}>
                1 vital needs a look
              </div>
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
            {VITALS.map((v) => (
              <div key={v.name} style={{ display: "flex", alignItems: "center", gap: 9 }}>
                <span style={{ width: 9, height: 9, borderRadius: "50%", background: v.color, display: "inline-block" }} aria-hidden />
                <span style={{ font: "500 12px var(--sans)", color: "#cfe0e4" }}>{v.name}</span>
                <span style={{ marginLeft: "auto", font: "600 11px var(--mono)", color: v.color }}>{v.word}</span>
              </div>
            ))}
          </div>
          <div className="evidence-foot">append-only · hash-chained · SOC 2 evidence</div>
        </div>
      </section>

      <section className="steps-strip">
        <p className="eyebrow">How it works</p>
        <h2 className="section-title">Set it up once, then forget it's there</h2>
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
        What it does
      </p>
      <h2 className="section-title">A tech lead in a box — not a dashboard to babysit</h2>
      <div className="grid-2">
        {DOES.map((d) => (
          <div className="card" key={d.title}>
            <h3>{d.title}</h3>
            <p style={{ color: "var(--ink-2)", fontSize: 14 }}>{d.body}</p>
          </div>
        ))}
      </div>

      <p className="eyebrow" style={{ marginTop: 56 }}>
        The one rule it lives by
      </p>
      <h2 className="section-title">It gates, advises, and does the safe git chores — you own every merge</h2>
      <div className="grid-2">
        <div className="card">
          <h3>Never a black box</h3>
          <p style={{ color: "var(--ink-2)", fontSize: 14 }}>
            CodeWorthy never merges, force-pushes, or rewrites history — not "we choose not to," but
            the capability isn't on its surface. It changes your repo settings only after you click
            "yes." The AI-review tier is <strong>off by default</strong>, opt-in per repo, and
            discloses exactly what leaves.
          </p>
        </div>
        <div className="card">
          <h3>The same engine that measures engineers</h3>
          <p style={{ color: "var(--ink-2)", fontSize: 14 }}>
            The rules CodeWorthy enforces are the very competencies our assessment measures — root
            cause, testing, systems thinking, git discipline. One model, two products.{" "}
            <Link to="/login?role=merchant" style={{ color: "var(--accent-strong)", fontWeight: 600 }}>Hiring? See the assessment →</Link>
          </p>
        </div>
      </div>

      <div className="card" style={{ marginTop: 64, textAlign: "center", padding: 40 }}>
        <h2 className="section-title" style={{ marginBottom: 8 }}>
          Hand your <span className="artifact">main</span> branch to a senior engineer
        </h2>
        <p style={{ color: "var(--ink-2)", marginTop: 0 }}>
          Install CodeWorthy, pick your repositories, and keep building. It protects the rest.
        </p>
        <a href={INSTALL_URL} className="btn btn-primary btn-lg">
          Protect my repo
        </a>
      </div>
    </>
  );
}
