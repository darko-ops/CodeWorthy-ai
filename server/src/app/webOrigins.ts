// Which browser origins may call /api/*.
//
// This was a single strict equality against `config.webBaseUrl`. The dashboard
// is served from BOTH the apex and the www host — Vercel answers
// www.codeworthy.ai with a 200 rather than redirecting — so whichever host
// wasn't configured got no CORS headers, every /api/* call failed in the
// browser, and the SPA reported `offline`. The dashboard then sat forever on
// "Steward is waking up — this will connect in a moment", which it never did:
// the backend was healthy the whole time and the browser was refusing to talk
// to it. A misconfigured origin should not be indistinguishable from a sleeping
// server.
//
// Deliberately an ALLOWLIST, not a wildcard. These endpoints carry a bearer
// session; `access-control-allow-origin: *` would let any site read a signed-in
// user's repositories.

/**
 * The origins allowed to call the API, derived from the dashboard's base URL:
 * the configured origin, plus its apex/www counterpart, plus anything named in
 * `extra` (comma-separated — e.g. a preview deployment).
 */
export function allowedWebOrigins(webBaseUrl: string, extra?: string): Set<string> {
  const out = new Set<string>();

  const add = (raw: string) => {
    const value = raw.trim().replace(/\/+$/, "");
    if (!value) return;
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      return; // not a URL — ignore rather than allow something unparseable
    }
    // An Origin header is scheme + host + port only; normalize to that so a
    // configured value with a path still matches what the browser sends.
    const origin = url.origin;
    out.add(origin);

    // The apex/www counterpart of the same site. Only ever toggles a leading
    // "www." — it never widens to a different registrable domain.
    if (url.hostname.startsWith("www.")) {
      out.add(`${url.protocol}//${url.hostname.slice(4)}${url.port ? `:${url.port}` : ""}`);
    } else {
      out.add(`${url.protocol}//www.${url.hostname}${url.port ? `:${url.port}` : ""}`);
    }
  };

  add(webBaseUrl);
  for (const one of (extra ?? "").split(",")) add(one);
  return out;
}
