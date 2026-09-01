// Turning a GitHub failure into an honest HTTP answer.
//
// The dashboard API calls GitHub with the signed-in user's token, and any
// non-2xx threw. Fastify turns an unhandled throw into a 500, so every one of
// these became "500 Internal Server Error" — including the most common and
// least alarming case, an expired token, where the right answer is "sign in
// again" and the SPA can act on it.
//
// A 500 says "we broke". Most of these are not that: the user's token expired,
// they revoked the installation, or GitHub is rate-limiting us. Saying 500 to
// all of them is both wrong and unactionable — the user sees a broken product
// and has no idea the fix is one click.
import { GitHubHttpError } from "../github/client.js";

export interface ApiErrorResponse {
  status: number;
  body: { error: string; message: string; retryAfter?: string };
}

/**
 * Map a thrown error to the response the SPA should get.
 *
 * Returns null for anything that is NOT a GitHub transport failure — those are
 * genuine bugs and must keep 500ing loudly rather than being smoothed over.
 */
export function mapGitHubError(err: unknown): ApiErrorResponse | null {
  if (!(err instanceof GitHubHttpError)) return null;

  // Rate limiting arrives as 403 (with the remaining header at 0) or 429.
  if (err.status === 429 || (err.status === 403 && err.rateLimited)) {
    return {
      status: 429,
      body: {
        error: "github_rate_limited",
        message: "GitHub is rate-limiting CodeWorthy right now. Nothing is wrong with your repositories — try again shortly.",
        ...(err.retryAfter ? { retryAfter: err.retryAfter } : {}),
      },
    };
  }

  if (err.status === 401) {
    return {
      status: 401,
      body: {
        error: "github_token_expired",
        message: "Your GitHub sign-in has expired. Sign in again to reconnect CodeWorthy.",
      },
    };
  }

  if (err.status === 403) {
    return {
      status: 403,
      body: {
        error: "github_forbidden",
        message: "GitHub refused this request. The CodeWorthy installation may have been removed, or its access to this repository revoked.",
      },
    };
  }

  if (err.status === 404) {
    return {
      status: 404,
      body: {
        error: "github_not_found",
        message: "GitHub doesn't have that — it may have been renamed, deleted, or is no longer shared with CodeWorthy.",
      },
    };
  }

  // 5xx and anything else upstream: GitHub's problem, not the user's, and not
  // ours to claim as an internal error.
  return {
    status: 502,
    body: {
      error: "github_unavailable",
      message: "CodeWorthy couldn't reach GitHub. This is upstream of us — your repositories and your change record are unaffected.",
    },
  };
}
