import { useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth";
import { Wordmark } from "./Wordmark";

function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

// Static demo notifications for the merchant app bar.
const NOTIFICATIONS = [
  { who: "Priya Raman", what: "report is ready — 4.1/5 competency average.", when: "ACME-1287 · 12m ago", unread: true },
  { who: "Dan Kowalski", what: "submitted a PR — hidden suite running.", when: "ACME-1287 · 1h ago", unread: true },
  { who: "Sofia Alvarez", what: "defense is scheduled for 3:00 PM.", when: "ACME-1287 · 3h ago", unread: false },
];

function Bell() {
  const [open, setOpen] = useState(false);
  const unread = NOTIFICATIONS.filter((n) => n.unread).length;
  return (
    <div className="bell-wrap">
      <button
        className="bell-btn"
        aria-label={`Notifications, ${unread} unread`}
        onClick={() => setOpen((o) => !o)}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.7 21a2 2 0 0 1-3.4 0" />
        </svg>
        {unread > 0 && <span className="bell-count">{unread}</span>}
      </button>
      {open && (
        <div className="bell-menu" role="menu">
          {NOTIFICATIONS.map((n) => (
            <div key={n.who + n.when} className={`bell-item${n.unread ? " unread" : ""}`}>
              <div>
                <div>
                  <strong>{n.who}</strong> {n.what}
                </div>
                <div className="when">{n.when}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function Shell() {
  const { session, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  // The dashboard list is dark mission control; reports and everything else
  // stay on the white editorial surface (mockups 1b vs 1c).
  const dark = session?.role === "merchant" && location.pathname === "/dashboard";

  return (
    <div className={dark ? "app shell-dark" : "app"}>
      <header className="nav">
        <div className="nav-inner">
          <Link to="/" className="nav-brand" aria-label="CodeWorthy home">
            <Wordmark />
          </Link>
          {session?.role === "merchant" && (
            <>
              <NavLink to="/dashboard" end className="nav-tab">
                Dashboard
              </NavLink>
              <span className="nav-tab" aria-disabled title="Coming soon">
                Assessments
              </span>
              <span className="nav-tab" aria-disabled title="Coming soon">
                Team
              </span>
            </>
          )}
          {session?.role === "examinee" && (
            <NavLink to="/learn" className="nav-tab">
              My assessments
            </NavLink>
          )}
          <div className="nav-right">
            {session ? (
              <>
                <span className="nav-user">
                  {session.email} · {session.role}
                </span>
                {dark && <Bell />}
                <span className="nav-avatar" aria-hidden>
                  {initials(session.name)}
                </span>
                <button
                  className="btn"
                  onClick={() => {
                    logout();
                    navigate("/");
                  }}
                >
                  Sign out
                </button>
              </>
            ) : (
              <>
                <NavLink to="/login" className="nav-tab">
                  Sign in
                </NavLink>
                <Link to="/login" className="btn btn-primary">
                  Get started
                </Link>
              </>
            )}
          </div>
        </div>
      </header>
      <main className="shell-main">
        <Outlet />
        <div className="footer">
          © 2026 <Wordmark size={13} /> · Make your work production-worthy.
        </div>
      </main>
    </div>
  );
}
