// "Sign in with GitHub" session, separate from the demo role-login in auth.tsx.
// Holds the signed-in GitHub user, hydrated from the opaque session id in
// localStorage by calling /api/me. When the backend is unreachable we keep the
// stored session and surface `offline` so the UI can say "waking up" rather than
// bouncing the user to /login.
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { apiGet, apiPost, clearSessionId, getSessionId, loginUrl, ApiError, type Me } from "./api";

interface GitHubAuthValue {
  user: Me | null;
  status: "loading" | "authed" | "anon" | "offline";
  signIn: () => void;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
}

const Ctx = createContext<GitHubAuthValue | null>(null);

export function GitHubAuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Me | null>(null);
  const [status, setStatus] = useState<GitHubAuthValue["status"]>("loading");

  async function hydrate() {
    if (!getSessionId()) {
      setUser(null);
      setStatus("anon");
      return;
    }
    try {
      const me = await apiGet<Me>("/api/me");
      setUser(me);
      setStatus("authed");
    } catch (err) {
      if (err instanceof ApiError && err.kind === "unauthenticated") {
        clearSessionId();
        setUser(null);
        setStatus("anon");
      } else {
        // Offline / server error: keep the stored session, report offline.
        setStatus("offline");
      }
    }
  }

  useEffect(() => {
    void hydrate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const value: GitHubAuthValue = {
    user,
    status,
    signIn: () => {
      window.location.href = loginUrl;
    },
    signOut: async () => {
      await apiPost("/api/logout");
      clearSessionId();
      setUser(null);
      setStatus("anon");
    },
    refresh: hydrate,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useGitHubAuth(): GitHubAuthValue {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useGitHubAuth must be used inside GitHubAuthProvider");
  return ctx;
}
