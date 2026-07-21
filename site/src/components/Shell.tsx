import { Link, NavLink, Outlet, useNavigate } from "react-router-dom";
import { homeForRole, useAuth } from "../auth";
import { Wordmark } from "./Wordmark";

export function Shell() {
  const { session, logout } = useAuth();
  const navigate = useNavigate();

  return (
    <>
      <header className="nav">
        <div className="nav-inner">
          <Link to="/" className="nav-brand" aria-label="CodeWorthy home">
            <Wordmark />
          </Link>
          <nav className="nav-links">
            {session ? (
              <>
                <NavLink to={homeForRole(session.role)}>
                  {session.role === "merchant" ? "Dashboard" : "My assessments"}
                </NavLink>
                <span className="nav-user">
                  {session.name} · {session.role}
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
                <NavLink to="/login">Sign in</NavLink>
                <Link to="/login" className="btn btn-primary">
                  Get started
                </Link>
              </>
            )}
          </nav>
        </div>
      </header>
      <main className="shell-main">
        <Outlet />
        <div className="footer">
          © 2026 <Wordmark size={13} /> · Make your work production-worthy.
        </div>
      </main>
    </>
  );
}
