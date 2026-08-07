import { useState, type FormEvent } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { homeForRole, useAuth, type Role } from "../auth";
import { useGitHubAuth } from "../github-auth";
import { Wordmark } from "../components/Wordmark";

// OAuth failures come back as ?error=<code>; turn them into a plain sentence.
const OAUTH_ERRORS: Record<string, string> = {
  not_configured: "GitHub sign-in isn't finished being set up yet. Try the demo login below for now.",
  bad_state: "That sign-in link expired. Please try connecting GitHub again.",
  oauth_failed: "GitHub sign-in didn't complete. Please try again.",
  no_session: "Something went wrong finishing sign-in. Please try again.",
  access_denied: "GitHub sign-in was cancelled.",
};

export function Login() {
  const { login } = useAuth();
  const { signIn } = useGitHubAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const initialRole: Role = params.get("role") === "merchant" ? "merchant" : "examinee";
  const oauthError = params.get("error") ? (OAUTH_ERRORS[params.get("error")!] ?? "GitHub sign-in didn't complete.") : null;

  const [role, setRole] = useState<Role>(initialRole);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!email.includes("@")) {
      setError("Enter a valid email address.");
      return;
    }
    if (password.length === 0) {
      setError("Enter a password.");
      return;
    }
    const session = login(email, role);
    const from = (location.state as { from?: string } | null)?.from;
    navigate(from ?? homeForRole(session.role), { replace: true });
  };

  return (
    <div className="login-split">
      <div className="login-brand">
        <Wordmark size={20} />
        <div>
          <div className="login-eyebrow">Production-readiness, proven</div>
          <h2>Prove you can ship code a team can trust.</h2>
          <p>
            Realistic inherited codebases, hidden failure conditions, and an evidence-backed
            competency report — not a single opaque score.
          </p>
        </div>
        <div className="login-proof">
          <div
            className="ring"
            style={{ width: 44, height: 44, background: "conic-gradient(#22c55e 82%, #16404e 0)" }}
            aria-hidden
          >
            <div
              className="ring-inner"
              style={{ width: 34, height: 34, background: "#0b3140" }}
            >
              <span className="ring-value" style={{ fontSize: 13 }}>4.1</span>
            </div>
          </div>
          <div>
            <div style={{ font: "600 13px var(--sans)", color: "#fff" }}>
              Priya Raman · ACME-1287
            </div>
            <div style={{ font: "500 11px var(--mono)", color: "var(--navy-muted)", marginTop: 2 }}>
              ✓ 5/5 hidden checks · report ready
            </div>
          </div>
        </div>
      </div>

      <form className="login-form" onSubmit={submit}>
        <h1 style={{ font: "800 28px var(--sans)", letterSpacing: "-0.02em", margin: "0 0 6px" }}>
          Sign in
        </h1>
        <p className="hint" style={{ margin: "0 0 20px" }}>
          Connect the repositories CodeWorthy watches, and see their activity in one place.
        </p>

        {oauthError && (
          <p className="login-oauth-error">{oauthError}</p>
        )}

        <button type="button" className="btn btn-github" onClick={signIn}>
          <svg width="18" height="18" viewBox="0 0 16 16" aria-hidden fill="currentColor">
            <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
          </svg>
          Sign in with GitHub
        </button>

        <div className="login-or"><span>or explore the demo</span></div>

        <div className="role-toggle" role="tablist" aria-label="Account type">
          <button
            type="button"
            className={role === "examinee" ? "selected" : ""}
            onClick={() => setRole("examinee")}
          >
            I'm taking an assessment
          </button>
          <button
            type="button"
            className={role === "merchant" ? "selected" : ""}
            onClick={() => setRole("merchant")}
          >
            I'm hiring
          </button>
        </div>

        <div className="field">
          <label htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            placeholder={role === "merchant" ? "you@company.com" : "you@example.com"}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoFocus
          />
        </div>
        <div className="field" style={{ marginBottom: 22 }}>
          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        {error && (
          <p style={{ color: "var(--rating-needs)", fontSize: 14, margin: "0 0 12px" }}>{error}</p>
        )}
        <button type="submit" className="btn btn-primary" style={{ width: "100%", padding: 13 }}>
          {role === "merchant" ? "Sign in to your dashboard" : "Sign in to your assessments"}
        </button>
        <p style={{ font: "400 12px var(--sans)", color: "var(--ink-faint)", margin: "18px 0 0", textAlign: "center" }}>
          New here?{" "}
          <span style={{ color: "var(--accent-strong)", fontWeight: 600 }}>Get started free</span>
        </p>
      </form>
    </div>
  );
}
