import { Link } from "react-router-dom";
import type { VitalStatus } from "../api";
import { Wordmark } from "../components/Wordmark";
import { VitalsMeter, VITAL_COLOR } from "../components/VitalsMeter";

// "How it works" — four steps, once. Copy carried from the prototype.
const STEPS: { title: string; body: string }[] = [
  {
    title: "Install on your repo",
    body: "One click. It asks to read your code and comment — never to write it or merge.",
  },
  {
    title: "It protects main",
    body: "Changes go through a reviewable pull request. Force-pushes and deletions stop being possible.",
  },
  {
    title: "It reads every change",
    body: "Secrets, committed .env files, destructive migrations — caught before they merge, explained in plain language.",
  },
  {
    title: "You get one email a week",
    body: "What happened, what needs a look, and nothing to check in between.",
  },
];

// The hero health-instrument card (mirrors /steward/health). `status` drives the
// bar + dot + word color; `word` is the label the system emitted for that vital.
type HeroVital = { id: string; label: string; status: VitalStatus; word: string };
const HERO_VITALS: HeroVital[] = [
  { id: "branch", label: "Branch protection", status: "healthy", word: "HEALTHY" },
  { id: "review", label: "Review discipline", status: "watch", word: "WATCH" },
  { id: "secret", label: "Secret hygiene", status: "healthy", word: "HEALTHY" },
  { id: "record", label: "Record integrity", status: "healthy", word: "VERIFIED" },
];

export function Landing() {
  return (
    <div className="lp">
      {/* ---- nav (dark) ---- */}
      <header className="lp-nav">
        <div className="lp-inner lp-nav-inner">
          <Link to="/" className="lp-nav-brand" aria-label="Codeworthy home">
            <Wordmark onDark />
          </Link>
          <a className="lp-nav-link" href="#how">
            How it works
          </a>
          <a className="lp-nav-link" href="#catches">
            What it catches
          </a>
          <a className="lp-nav-link" href="#hiring">
            For hiring teams
          </a>
          <div className="lp-nav-right">
            <Link to="/login" className="lp-nav-link">
              Sign in
            </Link>
            <Link to="/login" className="lp-btn lp-btn-primary">
              Protect my repo
            </Link>
          </div>
        </div>
      </header>

      {/* ---- hero (dark) ---- */}
      <section className="lp-band lp-hero">
        <div className="lp-inner lp-hero-grid">
          <div className="lp-hero-copy">
            <div className="lp-eyebrow-pill">
              <span className="lp-dot" aria-hidden />
              A senior engineer for your repo
            </div>
            <h1 className="lp-hero-h1">
              Build at AI speed.
              <br />
              Land like a
              <br />
              <span className="lp-accent">senior engineer.</span>
            </h1>
            <p className="lp-hero-body">
              Codeworthy watches the repository the way a tech lead would — it protects{" "}
              <span className="lp-mono">main</span>, reads every change before it lands, and writes
              down what happened in plain English. It never merges. You still own that.
            </p>
            <div className="lp-hero-ctas">
              <Link to="/login" className="lp-btn lp-btn-primary lp-btn-lg">
                Protect my repo — free
              </Link>
              <Link to="/login" className="lp-btn lp-btn-ghost lp-btn-lg">
                See a live report →
              </Link>
            </div>
            <div className="lp-trust-row">
              <span>read-only + comment</span>
              <span className="lp-trust-sep">·</span>
              <span>never merges</span>
              <span className="lp-trust-sep">·</span>
              <span>hash-chained log</span>
            </div>
          </div>

          {/* health instrument card */}
          <div className="lp-instrument">
            <div className="lp-instrument-head">
              <span className="lp-instrument-repo">dana-ops/recipe-app</span>
              <span className="lp-instrument-window">Last 30 days</span>
            </div>
            <div className="lp-instrument-body">
              <div className="lp-instrument-label">Repo health</div>
              <div className="health-verdict" style={{ color: VITAL_COLOR.watch }}>
                Needs attention
              </div>
              <VitalsMeter sm vitals={HERO_VITALS} />
              <div className="lp-vitals-rows">
                {HERO_VITALS.map((v) => (
                  <div className="lp-vital-row" key={v.id}>
                    <span
                      className="lp-vital-dot"
                      style={{ background: VITAL_COLOR[v.status] }}
                      aria-hidden
                    />
                    <span className="lp-vital-label">{v.label}</span>
                    <span className="lp-vital-word" style={{ color: VITAL_COLOR[v.status] }}>
                      {v.word}
                    </span>
                  </div>
                ))}
              </div>
              <div className="lp-prescription">
                <div className="lp-prescription-title">3 of 14 merges skipped review</div>
                <div className="lp-prescription-body">
                  Require one approving review on <span className="lp-mono-plain">main</span> to close
                  this.
                </div>
              </div>
            </div>
            <div className="lp-instrument-foot">418 records · append-only · chain verified 07 Aug</div>
          </div>
        </div>
      </section>

      {/* ---- how it works (sand) ---- */}
      <section className="lp-band lp-how" id="how">
        <div className="lp-inner">
          <p className="lp-eyebrow lp-eyebrow-sand">How it works</p>
          <h2 className="lp-h2 lp-h2-sand">Set it up on a Tuesday. Forget it by Thursday.</h2>
          <p className="lp-deck lp-deck-sand">
            No dashboard to babysit, no rules to write. Four steps, once.
          </p>
          <div className="lp-steps">
            {STEPS.map((step, i) => (
              <div className="lp-step" key={step.title}>
                <div className="lp-step-no">{String(i + 1).padStart(2, "0")}</div>
                <div className="lp-step-title">{step.title}</div>
                <div className="lp-step-body">{step.body}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---- what it catches (surface) ---- */}
      <section className="lp-band lp-catches" id="catches">
        <div className="lp-inner">
          <p className="lp-eyebrow">What it catches</p>
          <h2 className="lp-h2 lp-h2-catches">
            The four things that quietly wreck a young codebase
          </h2>
          <div className="lp-catch-grid">
            <div className="lp-catch-card">
              <div className="lp-catch-kicker lp-catch-kicker--signal">Unguarded main</div>
              <h3 className="lp-catch-h3">Guards your default branch</h3>
              <p className="lp-catch-body">
                Branch protection configured so nothing lands without a reviewable pull request — the
                thing a senior engineer sets up on day one, and nobody else remembers.
              </p>
            </div>
            <div className="lp-catch-card">
              <div className="lp-catch-kicker lp-catch-kicker--risk">Leaked credentials</div>
              <h3 className="lp-catch-h3">Blocks what breaks repos</h3>
              <p className="lp-catch-body">
                A secret in a commit, a committed <span className="lp-mono-plain">.env</span>, a
                destructive migration — blocked before merge. Missing tests and sprawling PRs —
                flagged, not blocked.
              </p>
            </div>
            <div className="lp-catch-card">
              <div className="lp-catch-kicker lp-catch-kicker--signal">Black-box tooling</div>
              <h3 className="lp-catch-h3">Explains every call it makes</h3>
              <p className="lp-catch-body">
                Each decision is a plain-language note on the exact commit or PR. No scores, no
                jargon, and every action is reversible by you.
              </p>
            </div>
            <div className="lp-catch-card">
              <div className="lp-catch-kicker lp-catch-kicker--signal">Audit season</div>
              <h3 className="lp-catch-h3">Keeps tamper-evident records</h3>
              <p className="lp-catch-body">
                An append-only, hash-chained change log — the SOC 2 change-control evidence an auditor
                asks for, produced without you thinking about it.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ---- the one rule (dark) ---- */}
      <section className="lp-band lp-rule">
        <div className="lp-inner lp-rule-grid">
          <div>
            <p className="lp-eyebrow lp-eyebrow-dark">The one rule</p>
            <h2 className="lp-h2 lp-h2-dark">
              It advises.
              <br />
              You merge.
            </h2>
          </div>
          <div className="lp-rule-body">
            <p className="lp-rule-text">
              Codeworthy never merges, force-pushes, or rewrites history — not as a policy, but
              because the capability isn't on its surface. It changes repository settings only after
              you say yes. The AI-review tier is <strong>off by default</strong>, opt-in per repo, and
              discloses exactly what leaves your code.
            </p>
            <div className="lp-chip-row">
              <span className="lp-chip">no write access</span>
              <span className="lp-chip">no history rewrites</span>
              <span className="lp-chip">opt-in AI review</span>
              <span className="lp-chip">every action reversible</span>
            </div>
          </div>
        </div>
      </section>

      {/* ---- hiring band (surface) ---- */}
      <section className="lp-band lp-hiring" id="hiring">
        <div className="lp-inner">
          <div className="lp-hiring-card">
            <div className="lp-hiring-copy">
              <p className="lp-eyebrow">Also — for hiring teams</p>
              <h3 className="lp-hiring-h3">
                The same engine that guards repos measures engineers
              </h3>
              <p className="lp-hiring-body">
                Root cause, testing, systems thinking, git discipline — the rules Codeworthy enforces
                are the competencies our assessment scores, with evidence instead of a number.
              </p>
            </div>
            <Link to="/login?role=merchant" className="lp-btn lp-btn-outline">
              See the assessment →
            </Link>
          </div>
        </div>
      </section>

      {/* ---- final CTA + footer (dark) ---- */}
      <section className="lp-band lp-final">
        <div className="lp-inner lp-final-inner">
          <h2 className="lp-final-h2">
            Hand <span className="lp-mono lp-final-main">main</span> to a senior engineer
          </h2>
          <p className="lp-final-deck">
            Install it, pick your repositories, keep building. It handles the rest.
          </p>
          <Link to="/login" className="lp-btn lp-btn-primary lp-btn-lg">
            Protect my repo — free
          </Link>
          <div className="lp-footer">
            <Wordmark size={15} onDark />
            <span className="lp-footer-meta">© 2026 · make your work production-worthy</span>
          </div>
        </div>
      </section>
    </div>
  );
}
