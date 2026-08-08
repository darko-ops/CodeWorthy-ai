// Landing point after GitHub OAuth. The backend redirects here with the opaque
// session id in the URL fragment (#session=...) — fragments never reach servers
// or Referer headers. We store it, hydrate the user, then move on to the
// dashboard.
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { setSessionId } from "../api";
import { useGitHubAuth } from "../github-auth";
import { Wordmark } from "../components/Wordmark";

export function AuthComplete() {
  const navigate = useNavigate();
  const { refresh } = useGitHubAuth();

  useEffect(() => {
    const hash = window.location.hash.replace(/^#/, "");
    const params = new URLSearchParams(hash);
    const id = params.get("session");
    if (id) {
      setSessionId(id);
      // Clear the fragment so the id isn't left in the address bar / history.
      window.history.replaceState(null, "", window.location.pathname);
      void refresh().then(() => navigate("/dashboard", { replace: true }));
    } else {
      navigate("/login?error=no_session", { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="auth-complete">
      <Wordmark size={22} />
      <p className="hint" style={{ marginTop: 16 }}>Signing you in…</p>
    </div>
  );
}
