import { useState, type FormEvent } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { homeForRole, useAuth, type Role } from "../auth";

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
    <div className="login-wrap">
      <h1 style={{ letterSpacing: "-0.02em" }}>Sign in</h1>
      <p className="hint" style={{ marginBottom: 20 }}>
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

      <form onSubmit={submit} className="card">
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
        <div className="field">
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
          <p style={{ color: "var(--status-critical)", fontSize: 14, margin: "0 0 12px" }}>
            {error}
          </p>
        )}
        <button type="submit" className="btn btn-primary" style={{ width: "100%" }}>
          {role === "merchant" ? "Sign in to your dashboard" : "Sign in to your assessments"}
        </button>
      </form>
    </div>
  );
}
