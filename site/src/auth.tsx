import { createContext, useContext, useState, type ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";

export type Role = "merchant" | "examinee";

export interface Session {
  email: string;
  name: string;
  role: Role;
}

interface AuthContextValue {
  session: Session | null;
  login: (email: string, role: Role) => Session;
  logout: () => void;
}

const STORAGE_KEY = "codeworthy.session";

const AuthContext = createContext<AuthContextValue | null>(null);

function readStoredSession(): Session | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

function nameFromEmail(email: string): string {
  const local = email.split("@")[0] ?? "there";
  return local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(" ");
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(readStoredSession);

  const login = (email: string, role: Role): Session => {
    const next: Session = { email, role, name: nameFromEmail(email) };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    setSession(next);
    return next;
  };

  const logout = () => {
    localStorage.removeItem(STORAGE_KEY);
    setSession(null);
  };

  return <AuthContext.Provider value={{ session, login, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}

export function homeForRole(role: Role): string {
  return role === "merchant" ? "/dashboard" : "/learn";
}

// Route guard: unauthenticated users go to /login; a user with the wrong role
// is sent to their own home rather than shown an error.
export function RequireRole({ role, children }: { role: Role; children: ReactNode }) {
  const { session } = useAuth();
  const location = useLocation();
  if (!session) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  if (session.role !== role) {
    return <Navigate to={homeForRole(session.role)} replace />;
  }
  return <>{children}</>;
}
