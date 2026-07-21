import { useState, type FormEvent } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { homeForRole, useAuth, type Role } from "../auth";
import { Wordmark } from "../components/Wordmark";

export function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const initialRole: Role = params.get("role") === "merchant" ? "merchant" : "examinee";

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
        <p className="hint" style={{ margin: "0 0 24px" }}>
          Demo environment — any email and password work. Pick the role to explore.
        </p>

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
