// The Steward backend client. All dashboard data comes from the Fly service.
//
// "Degrade gracefully": every call can fail (server asleep on the trial,
// network, 401). Callers get a typed result and render a calm state rather than
// a blank screen — see ApiError.kind.

// Override at build time with VITE_STEWARD_API; defaults to the Fly deployment.
export const API_BASE = (
  (import.meta.env.VITE_STEWARD_API as string | undefined) ?? "https://codeworthy-steward.fly.dev"
).replace(/\/+$/, "");

const SESSION_KEY = "codeworthy.gh_session";

export function getSessionId(): string | null {
  try {
    return localStorage.getItem(SESSION_KEY);
  } catch {
    return null;
  }
}
export function setSessionId(id: string): void {
  try {
    localStorage.setItem(SESSION_KEY, id);
  } catch {
    /* ignore */
  }
}
export function clearSessionId(): void {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch {
    /* ignore */
  }
}

// Where the browser goes to start "Sign in with GitHub".
export const loginUrl = `${API_BASE}/auth/github/login`;

// Where to send a user to add CodeWorthy to more repositories (GitHub's install
// / repo-selection screen for the App).
export const installUrl = "https://github.com/apps/codeworthy-steward/installations/new";

// The rendered, shareable weekly summary (digest) page for a repo. Public by
// design — the same no-login artifact as the health page — so the link can be
// forwarded to a teammate or auditor.
export function digestUrl(repo: string, days = 7): string {
  return `${API_BASE}/steward/digest.html?repo=${encodeURIComponent(repo)}&days=${days}`;
}

export type ApiErrorKind = "unauthenticated" | "offline" | "forbidden" | "server";

export class ApiError extends Error {
  kind: ApiErrorKind;
  status?: number;
  constructor(kind: ApiErrorKind, message: string, status?: number) {
    super(message);
    this.kind = kind;
    this.status = status;
  }
}

// Authenticated GET against the Steward API. Throws ApiError with a kind the UI
// can branch on.
export async function apiGet<T>(path: string): Promise<T> {
  const id = getSessionId();
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      headers: id ? { authorization: `Bearer ${id}` } : {},
    });
  } catch {
    // Network error / server asleep / CORS unreachable.
    throw new ApiError("offline", "Can't reach Steward right now.");
  }
  if (res.status === 401) throw new ApiError("unauthenticated", "Session expired.", 401);
  if (res.status === 403) throw new ApiError("forbidden", "No access to that repository.", 403);
  if (!res.ok) throw new ApiError("server", `Steward returned ${res.status}.`, res.status);
  return (await res.json()) as T;
}

export async function apiPost(path: string): Promise<void> {
  const id = getSessionId();
  try {
    await fetch(`${API_BASE}${path}`, {
      method: "POST",
      headers: id ? { authorization: `Bearer ${id}` } : {},
    });
  } catch {
    /* best-effort (e.g. logout) */
  }
}

// --- Response shapes (mirror the backend /api/* contract) ---
export interface Me {
  login: string;
  name: string | null;
  avatar: string | null;
}
export interface InstallationSummary {
  id: number;
  account: string;
  avatar: string;
  selection: "all" | "selected";
}
export interface RepoSummary {
  full_name: string;
  name: string;
  private: boolean;
  default_branch: string;
}
export interface ActivityEvent {
  ts: string;
  repo: string;
  actor: string | null;
  event_type: string;
  plain_english: string;
}
export type VitalStatus = "healthy" | "watch" | "at risk" | "unknown";
export interface HealthVital {
  id: string;
  label: string;
  status: VitalStatus;
  finding: string;
  prescription: string;
}
export interface DigestEntry {
  ts: string;
  repo: string;
  actor: string | null;
  eventType: string;
  plainEnglish: string;
}
export interface HealthReport {
  repoFilter: string | null;
  generatedAt: string;
  overall: "Healthy" | "Needs attention" | "At risk";
  vitals: HealthVital[];
  activity: { total: number; windowDays: number; alerts: DigestEntry[]; recent: DigestEntry[] };
  integrity: { ok: boolean; headline: string; chain: string; anchor: string };
  note: string;
}
