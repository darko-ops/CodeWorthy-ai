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

/** POST that returns the parsed body and throws ApiError with the server's own
 *  message — the fix-path UI shows that message verbatim rather than inventing
 *  its own, because the server knows why an action failed and the UI doesn't. */
export async function apiAction<T = unknown>(path: string, body?: unknown): Promise<T> {
  const id = getSessionId();
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      headers: {
        ...(id ? { authorization: `Bearer ${id}` } : {}),
        ...(body ? { "content-type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  } catch {
    throw new ApiError("offline", "Can't reach Steward right now.");
  }
  if (res.status === 401) throw new ApiError("unauthenticated", "Session expired.", 401);
  const parsed = await res.json().catch(() => null);
  if (!res.ok) {
    const message =
      (parsed && typeof parsed === "object" && typeof (parsed as any).message === "string"
        ? (parsed as any).message
        : null) ?? `Steward returned ${res.status}.`;
    throw new ApiError(res.status === 403 ? "forbidden" : "server", message, res.status);
  }
  return parsed as T;
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
export type RepoMode = "solo" | "shared";
export type GateLevel = "gate" | "advise" | "off";
export interface RepoRules {
  gates: { secrets: GateLevel; destructiveMigration: GateLevel; committedDependencies: GateLevel };
  protectedPaths: string[];
  requireApproval: boolean;
  requireConversationResolution: boolean;
  requireCodeworthyCheck: boolean;
}
export interface RulesResponse {
  repo: string;
  mode: RepoMode;
  rules: RepoRules;
  /** False when no approver is installed here — the UI disables that control. */
  approverAvailable: boolean;
}
export interface RulesSaved {
  ok: boolean;
  rules: RepoRules;
  mode: RepoMode;
  /** Plain-language list of what changed, straight from the audit record. */
  changes: string[];
  protection?: string;
}

export type Effort = "one click" | "a few minutes" | "a decision to make";
export type FixAction =
  | { kind: "codeworthy"; label: string; method: "POST"; path: string; body?: Record<string, unknown> }
  | { kind: "github"; label: string; url: string }
  | { kind: "manual"; label: string; steps: string[]; snippet?: { filename: string; body: string } }
  | { kind: "accept"; label: string; method: "POST"; path: string };
export interface FixOption {
  id: string;
  title: string;
  detail: string;
  /** Null on the recommendation — it's recommended because nothing is given up. */
  tradeoff: string | null;
  effort: Effort;
  action: FixAction;
}
export interface RepoIssue {
  id: string;
  vitalId: string;
  severity: "at risk" | "watch";
  title: string;
  finding: string;
  consequence: string;
  /** Why CodeWorthy can't just fix it. */
  constraint: string | null;
  options: FixOption[];
}

export interface HealthReport {
  repoFilter: string | null;
  mode: RepoMode;
  issues: RepoIssue[];
  generatedAt: string;
  overall: "Healthy" | "Needs attention" | "At risk";
  vitals: HealthVital[];
  activity: { total: number; windowDays: number; alerts: DigestEntry[]; recent: DigestEntry[] };
  integrity: { ok: boolean; headline: string; chain: string; anchor: string };
  note: string;
}

// The portfolio overview (main dashboard).
export type Overall = "Healthy" | "Needs attention" | "At risk" | "Quiet";
export interface RepoOverview {
  full_name: string;
  overall: Overall;
  protection: "healthy" | "watch" | "at risk";
  review: VitalStatus;
  flagged: number;
  events: number;
  lastActivity: string | null;
}
export interface OverviewReport {
  generatedAt: string;
  windowDays: number;
  repos: RepoOverview[];
  totals: { repos: number; needsAttention: number; atRisk: number; flagged: number };
  integrity: { ok: boolean; headline: string };
}
