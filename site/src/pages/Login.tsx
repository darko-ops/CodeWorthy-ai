import { useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { homeForRole, useAuth, type Role } from "../auth";
import { useGitHubAuth } from "../github-auth";
import { Wordmark } from "../components/Wordmark";
import { VitalsMeter } from "../components/VitalsMeter";
import type { VitalStatus } from "../api";

// OAuth failures come back as ?error=<code>; turn them into a plain sentence.
const OAUTH_ERRORS: Record<string, string> = {
  not_configured: "GitHub sign-in isn't finished being set up yet. Try the demo login below for now.",
  bad_state: "That sign-in link expired. Please try connecting GitHub again.",
  oauth_failed: "GitHub sign-in didn't complete. Please try again.",
  no_session: "Something went wrong finishing sign-in. Please try again.",
  access_denied: "GitHub sign-in was cancelled.",
};

// Proof card on the dark panel: repo health, not a candidate score.
const PROOF_VITALS: { id: string; label: string; status: VitalStatus }[] = [
  { id: "branch", label: "Branch protection", status: "healthy" },
  { id: "secrets", label: "Secret scanning", status: "watch" },
  { id: "deps", label: "Dependencies", status: "healthy" },
  { id: "records", label: "Record integrity", status: "healthy" },
];

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
    <div className="signin">
      <div className="signin-topbar">
        <div className="signin-topbar-inner">
          <Wordmark size={20} onDark />
          <Link to="/" className="signin-back">Back to site →</Link>
        </div>
      </div>

      <div className="signin-split">
        <div className="signin-brand">
          <div>
            <div className="signin-eyebrow">Your repos, watched</div>
            <h2 className="signin-brand-h">Sign in and see what landed while you were building.</h2>
            <p className="signin-brand-body">
              One place for every repository Codeworthy watches — health, flagged changes,
              and a tamper-evident record of all of it.
            </p>
          </div>
          <div className="signin-proof">
            <div className="signin-proof-head">
              <span className="signin-proof-repo">dana-ops/recipe-app</span>
              <span className="signin-proof-status">WATCH</span>
            </div>
            <VitalsMeter vitals={PROOF_VITALS} sm />
            <div className="signin-proof-line">
              2 changes flagged in the last 30 days · 418 records verified
            </div>
          </div>
        </div>

        <form className="signin-form" onSubmit={submit}>
          <h1 className="signin-h1">Sign in</h1>
          <p className="signin-deck">
            GitHub is how Codeworthy connects to your repositories — there's nothing else to set up.
          </p>

          {oauthError && <p className="signin-error">{oauthError}</p>}

          <button type="button" className="signin-github" onClick={signIn}>
            <svg width="18" height="18" viewBox="0 0 16 16" aria-hidden fill="currentColor">
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
            </svg>
            Sign in with GitHub
          </button>
          <p className="signin-scopes">read + comment scopes only · no write access</p>

          <div className="signin-or"><span>or explore the demo</span></div>

          <div className="signin-roles" role="tablist" aria-label="Account type">
            <button
              type="button"
              role="tab"
              aria-selected={role === "examinee"}
              className={"signin-role-card" + (role === "examinee" ? " selected" : "")}
              onClick={() => setRole("examinee")}
            >
              <span className="signin-role-title">Taking an assessment</span>
              <span className="signin-role-sub">See the candidate view</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={role === "merchant"}
              className={"signin-role-card" + (role === "merchant" ? " selected" : "")}
              onClick={() => setRole("merchant")}
            >
              <span className="signin-role-title">Hiring</span>
              <span className="signin-role-sub">See the reviewer view</span>
            </button>
          </div>

          <div className="signin-field">
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
          <div className="signin-field signin-field-last">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          {error && <p className="signin-error">{error}</p>}

          <button type="submit" className="signin-submit">Enter the demo</button>
        </form>
      </div>
    </div>
  );
}
