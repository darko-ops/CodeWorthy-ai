// Threads — the repository's conversation, keyed on the BRANCH.
//
// The first version keyed on the pull request, and that was the wrong seam. A
// pull request is something that happens to a branch partway through: an agent
// cuts `feat/idempotent-checkout`, pushes four commits, and only then opens a
// PR. Keyed on the PR, all of that work is invisible until the PR exists and
// the thread starts mid-conversation. Keyed on the branch, the thread exists
// from the first push and the pull request is an event inside it — which is
// also how a branch that gets a PR closed and reopened stays one conversation
// instead of splitting into two unrelated ones.
//
// It also makes the time window mean something. The PR-keyed list asked GitHub
// for `state: "all"` and never filtered by date, so a change merged a year ago
// sat in the list on a 7-day window with a stale line under it. Branches are
// live things: they are ordered by their last commit, and they go away.
//
// The messages come from two sources and nowhere else:
//
//   1. GitHub — the branch's commits, the PR body, its issue comments, its
//      reviews. This is where Claude Code, Cursor and Codex actually talk, and
//      where CodeWorthy posts its review.
//   2. The audit spine — the gate's verdict, protection exceptions, the merge.
//      These happen AROUND a pull request and never appear as comments, so a
//      thread built only from GitHub would be missing exactly the parts that
//      are evidence.
//
// Merged on timestamp, they read as one group message. Nothing here is
// generated text: every message is something a participant wrote or something
// the spine recorded.
import type { Pool } from "pg";
import type { BranchRef, GitHubClient } from "../github/client.js";
import { STEWARD_BRANCH_PREFIX } from "../steward/mechanics.js";
import { cleanBody, identify, type Participant } from "./agents.js";

/** How many branches to read. GitHub cannot sort them by date, so the query
 *  takes a page and the client sorts — 100 covers any repo a person is
 *  actually working in, and the window then cuts it to the live ones. */
const BRANCH_LIMIT = 100;
/** How many finished pull requests to consider keeping once their branch is gone. */
const ARCHIVE_LIMIT = 30;

export type ThreadState =
  /** The repo's default branch — the standing thread. */
  | "default"
  /** Commits, but no pull request yet: an agent is still working. */
  | "working"
  | "draft"
  | "open"
  | "merged"
  | "closed";
export type GateDecision = "passed" | "advise" | "blocked" | "unavailable" | "none";
export type Tone = "ok" | "watch" | "risk" | "note";

// ── keys ────────────────────────────────────────────────────────────────────
//
// A key is either a branch or — when the branch has been deleted but its
// finished pull request is still worth reading — the pull request itself.
// Branch names contain slashes, so keys travel in the query string and in POST
// bodies, never in a path segment.

export type ThreadKey = { kind: "branch"; branch: string } | { kind: "archived"; number: number };

export const branchKey = (branch: string) => `b:${branch}`;
export const archivedKey = (number: number) => `pr:${number}`;

export function parseThreadKey(key: string): ThreadKey | null {
  if (key.startsWith("b:")) {
    const branch = key.slice(2);
    return branch ? { kind: "branch", branch } : null;
  }
  const m = /^pr:(\d{1,9})$/.exec(key);
  if (!m) return null;
  const n = Number(m[1]);
  return n > 0 ? { kind: "archived", number: n } : null;
}

/** Why this thread is asking for the human, in the words shown on the row. */
export interface NeedsYou {
  reason: string;
  detail: string;
  tone: Tone;
}

export interface ThreadSummary {
  key: string;
  /** The branch, or null once it has been deleted. */
  branch: string | null;
  /** The pull request on this branch, when there is one. */
  number: number | null;
  title: string;
  state: ThreadState;
  author: Participant | null;
  participants: Participant[];
  gate: GateDecision;
  /** Flagged/exception events on this thread in the window. */
  flagged: number;
  lastTs: string | null;
  lastLine: string;
  needsYou: NeedsYou | null;
  url: string | null;
  headSha: string | null;
  base: string | null;
}

export interface ThreadMessage {
  id: string;
  ts: string;
  author: Participant;
  kind: "opened" | "commit" | "comment" | "review" | "verdict" | "event";
  /** A short label above the body: "approved", "3 commits", "review · blocked". */
  title: string | null;
  body: string;
  tone: Tone;
  url: string | null;
}

export interface ThreadActions {
  canReply: boolean;
  replyBlocked: string | null;
  canApprove: boolean;
  approveBlocked: string | null;
  canMerge: boolean;
  mergeBlocked: string | null;
  /** True once the viewer's own approving review is on the record. */
  youApproved: boolean;
}

export interface Thread extends ThreadSummary {
  body: string;
  messages: ThreadMessage[];
  actions: ThreadActions;
}

// ── the spine side ──────────────────────────────────────────────────────────

interface SpineRow {
  id: string;
  ts: string;
  actor: string | null;
  event_type: string;
  plain_english: string;
  payload: Record<string, unknown>;
  number: number | null;
}

/** Every audit event for a repo in the window, with its PR number pulled out. */
async function spineFor(pool: Pool, repo: string, sinceDays: number, limit = 500): Promise<SpineRow[]> {
  const { rows } = await pool.query(
    `SELECT id::text, ts, actor, event_type, plain_english, payload,
            NULLIF(payload->>'number','')::bigint AS number
       FROM audit_events
      WHERE repo = $1 AND ts >= now() - ($2 || ' days')::interval
      ORDER BY ts ASC, id ASC
      LIMIT $3`,
    [repo, String(Math.min(Math.max(sinceDays, 1), 365)), limit]
  );
  return rows.map((r: any) => ({
    id: String(r.id),
    ts: new Date(r.ts).toISOString(),
    actor: r.actor,
    event_type: r.event_type,
    plain_english: r.plain_english,
    payload: (r.payload ?? {}) as Record<string, unknown>,
    number: r.number == null ? null : Number(r.number),
  }));
}

/** Events that mean something went wrong, not merely that something happened. */
export function isFlagged(eventType: string): boolean {
  return /^exception\./.test(eventType) || /weakened|bypassed|unreviewed|direct_to_default|force/.test(eventType);
}

export function toneFor(eventType: string): Tone {
  if (isFlagged(eventType)) return "risk";
  if (/blocked/.test(eventType)) return "watch";
  if (/restored|configured|merged|approved|accepted|reviewed/.test(eventType)) return "ok";
  return "note";
}

/** The latest gate verdict on a thread, in the words the UI uses. */
function gateFromSpine(rows: SpineRow[]): GateDecision {
  for (let i = rows.length - 1; i >= 0; i--) {
    const r = rows[i]!;
    if (r.event_type === "gate.evaluated") {
      const d = String(r.payload.decision ?? "");
      if (d === "blocked") return "blocked";
      if (d === "advise") return "advise";
      if (d === "passed" || d === "clean" || d === "ok") return "passed";
      return "unavailable";
    }
    if (r.event_type === "exception.gate_unavailable") return "unavailable";
  }
  return "none";
}

// ── the GitHub side ─────────────────────────────────────────────────────────

interface RawPull {
  number: number;
  title: string;
  body: string | null;
  state: string;
  draft?: boolean;
  merged?: boolean;
  merged_at?: string | null;
  created_at: string;
  updated_at: string;
  html_url: string;
  mergeable?: boolean | null;
  mergeable_state?: string | null;
  user?: { login?: string; avatar_url?: string; type?: string } | null;
  head?: { sha?: string; ref?: string } | null;
  base?: { ref?: string } | null;
}

function prParticipant(pr: RawPull, viewer: string | null): Participant {
  return identify({
    login: pr.user?.login ?? null,
    type: pr.user?.type ?? null,
    avatar: pr.user?.avatar_url ?? null,
    // The PR body carries the agent's own footer even when it pushed under a
    // human login — which is the common case for Claude Code and Codex.
    text: pr.body ?? null,
    viewer,
  });
}

/** Whoever pushed the branch's head commit, named from what they wrote. */
function refParticipant(ref: BranchRef, viewer: string | null): Participant {
  return identify({
    login: ref.authorLogin ?? ref.authorName ?? null,
    avatar: ref.authorAvatar ?? null,
    // The FULL message, because the agent's trailer is in its footer.
    text: ref.message ?? null,
    viewer,
  });
}

/** Dedupe participants by login, keeping the most specific label. */
function mergeParticipants(list: Participant[]): Participant[] {
  const byLogin = new Map<string, Participant>();
  for (const p of list) {
    const prev = byLogin.get(p.login);
    // An agent identification beats a plain "@login" for the same actor.
    if (!prev || (prev.kind === "human" && p.kind === "agent")) byLogin.set(p.login, p);
  }
  return [...byLogin.values()];
}

/** The most recent pull request per head branch. */
function pullsByBranch(pulls: RawPull[]): Map<string, RawPull> {
  const m = new Map<string, RawPull>();
  // The caller asks GitHub for updated-descending, so the first one wins — the
  // branch's CURRENT pull request, not the one that was closed on it in March.
  for (const pr of pulls) {
    const ref = pr.head?.ref;
    if (ref && !m.has(ref)) m.set(ref, pr);
  }
  return m;
}

function stateOf(pr: RawPull | undefined, isDefault: boolean): ThreadState {
  if (isDefault) return "default";
  if (!pr) return "working";
  if (pr.merged || pr.merged_at) return "merged";
  if (pr.state === "closed") return "closed";
  if (pr.draft) return "draft";
  return "open";
}

// ── what a thread wants from you ────────────────────────────────────────────

/**
 * Whether this thread is waiting on the human, and for what.
 *
 * Deliberately narrow. "Needs you" is the only alarm on this screen, so it
 * fires for exactly three things: CodeWorthy is blocking, something went wrong
 * that has no automatic answer, or the change is finished and only a merge is
 * missing. Everything else is the agents and CodeWorthy working, which is what
 * the tool is for — a branch being worked on is not a request for attention.
 */
export function needsYouFor(input: {
  state: ThreadState;
  gate: GateDecision;
  flagged: number;
}): NeedsYou | null {
  const exception = (n: number): NeedsYou => ({
    reason: "Look at this",
    detail: `${n} thing${n === 1 ? "" : "s"} on this branch went on the record as an exception.`,
    tone: "risk",
  });

  if (input.state === "merged" || input.state === "closed" || input.state === "default") {
    return input.flagged > 0 ? exception(input.flagged) : null;
  }
  // A branch with no pull request yet is work in progress. It speaks up only if
  // something actually went wrong on it.
  if (input.state === "working") {
    return input.flagged > 0 ? exception(input.flagged) : null;
  }
  if (input.gate === "blocked") {
    return {
      reason: "Blocked",
      detail: "CodeWorthy found something that has to be dealt with before this can merge. Tell the agent here, or waive it with a reason.",
      tone: "risk",
    };
  }
  if (input.flagged > 0) return exception(input.flagged);
  if (input.state === "draft") return null;
  if (input.gate === "unavailable") {
    return {
      reason: "Unreviewed",
      detail: "CodeWorthy couldn't review this change, so nothing was approved by default. It needs your eyes.",
      tone: "watch",
    };
  }
  if (input.gate === "passed" || input.gate === "advise") {
    return {
      reason: "Ready for you",
      detail: "CodeWorthy is done with this one. The merge is yours — it never merges anything itself.",
      tone: "ok",
    };
  }
  return null;
}

/**
 * Does this thread survive the window?
 *
 * An open pull request stays regardless of age: it is an outstanding request
 * for a human, and one that has gone quiet for eight weeks is precisely the
 * thing you want to see. The default branch always stays — it is the trunk.
 *
 * Everything else obeys the window, INCLUDING a branch with no pull request.
 * That is not an oversight: a branch nobody has pushed to in the window is
 * abandoned, not in progress, and agent-driven repos accumulate those fast —
 * the repo this was built in had twenty-two branches and six live ones. A list
 * that shows every branch anyone ever cut is the noise problem this rewrite
 * exists to fix, in a new costume.
 */
export function withinWindow(state: ThreadState, lastTs: string | null, sinceDays: number, now = Date.now()): boolean {
  if (state === "default" || state === "open" || state === "draft") return true;
  if (!lastTs) return false;
  const age = now - new Date(lastTs).getTime();
  return Number.isFinite(age) && age <= sinceDays * 86_400_000;
}

// ── the list ────────────────────────────────────────────────────────────────

export interface ListOptions {
  repo: string;
  sinceDays: number;
  /** The signed-in user, so their own messages read as "You". */
  viewer: string | null;
}

/**
 * Every thread in the window, the ones that want you first.
 *
 * Two GitHub calls, whatever the repo's size — one GraphQL query for the
 * branches (which is the only way to order them by recency without a call per
 * branch) and one REST page of pull requests to join onto them. The per-thread
 * detail is only fetched when a thread is opened.
 */
export async function listThreads(
  client: GitHubClient,
  pool: Pool,
  opts: ListOptions
): Promise<ThreadSummary[]> {
  const [refs, pulls, spine] = await Promise.all([
    client.listBranchRefs(opts.repo, BRANCH_LIMIT).catch(() => [] as BranchRef[]),
    client
      .listPullRequests(opts.repo, { state: "all", sort: "updated", direction: "desc", per_page: String(ARCHIVE_LIMIT) })
      .then((r) => (r as RawPull[]) ?? [])
      .catch(() => [] as RawPull[]),
    spineFor(pool, opts.repo, opts.sinceDays),
  ]);

  const byNumber = new Map<number, SpineRow[]>();
  const loose: SpineRow[] = [];
  for (const row of spine) {
    if (row.number == null) loose.push(row);
    else {
      const list = byNumber.get(row.number) ?? [];
      list.push(row);
      byNumber.set(row.number, list);
    }
  }

  const prForBranch = pullsByBranch(pulls);
  const threads: ThreadSummary[] = [];

  for (const ref of refs) {
    // CodeWorthy's own branches are not conversations. `steward/edit-<sha>` is
    // a bookmark the retroactive-review mechanic leaves at a commit that
    // skipped review — one per direct push, and nobody ever talks on one. The
    // thing it marks is already in the default branch's thread, as the
    // mechanic.retroactive_review event that names it.
    if (ref.name.startsWith(STEWARD_BRANCH_PREFIX)) continue;
    const pr = prForBranch.get(ref.name);
    const state = stateOf(pr, ref.isDefault);
    // The default branch also carries everything that belongs to no pull
    // request — the direct pushes, the protection changes, the post-merge
    // reviews. That is what makes it the standing thread rather than a
    // special case bolted on beside the list.
    const rows = [...(pr ? byNumber.get(pr.number) ?? [] : []), ...(ref.isDefault ? loose : [])].sort((a, b) =>
      a.ts.localeCompare(b.ts)
    );
    const author = pr ? prParticipant(pr, opts.viewer) : refParticipant(ref, opts.viewer);
    const last = rows[rows.length - 1];
    const lastTs = [ref.committedAt, last?.ts, pr?.updated_at].filter(Boolean).sort().pop() ?? null;
    const gate = gateFromSpine(rows);
    const flagged = rows.filter((r) => isFlagged(r.event_type)).length;
    if (!withinWindow(state, lastTs, opts.sinceDays)) continue;

    threads.push({
      key: branchKey(ref.name),
      branch: ref.name,
      number: pr?.number ?? null,
      title: pr?.title ?? (ref.isDefault ? ref.name : ref.headline ?? ref.name),
      state,
      author,
      participants: mergeParticipants([
        author,
        ...rows.filter((r) => r.actor).map((r) => identify({ login: r.actor, text: r.plain_english, viewer: opts.viewer })),
      ]),
      gate,
      flagged,
      lastTs,
      lastLine:
        last?.plain_english ??
        (pr ? `${author.label} opened PR #${pr.number}.` : ref.headline ?? "No commits on this branch yet."),
      needsYou: needsYouFor({ state, gate, flagged }),
      url: pr?.html_url ?? null,
      headSha: pr?.head?.sha ?? ref.headSha,
      base: pr?.base?.ref ?? null,
    });
  }

  // Finished pull requests whose branch has been deleted. GitHub removes the
  // head branch on merge for most repos, so without this every conversation
  // would vanish the moment it succeeded — and "what did CodeWorthy say about
  // that change last week" is a question people ask. They are read-only, and
  // they obey the window like any other finished work.
  const live = new Set(refs.map((r) => r.name));
  for (const pr of pulls) {
    const ref = pr.head?.ref;
    if (ref && live.has(ref)) continue; // already a branch thread above
    const state = stateOf(pr, false);
    if (state === "open" || state === "draft" || state === "working") continue; // still live; its branch is just beyond our page
    const rows = byNumber.get(pr.number) ?? [];
    const last = rows[rows.length - 1];
    const lastTs = last?.ts ?? pr.merged_at ?? pr.updated_at ?? null;
    if (!withinWindow(state, lastTs, opts.sinceDays)) continue;
    const author = prParticipant(pr, opts.viewer);
    const gate = gateFromSpine(rows);
    const flagged = rows.filter((r) => isFlagged(r.event_type)).length;
    threads.push({
      key: archivedKey(pr.number),
      branch: null,
      number: pr.number,
      title: pr.title,
      state,
      author,
      participants: mergeParticipants([
        author,
        ...rows.filter((r) => r.actor).map((r) => identify({ login: r.actor, text: r.plain_english, viewer: opts.viewer })),
      ]),
      gate,
      flagged,
      lastTs,
      lastLine: last?.plain_english ?? `${author.label} opened PR #${pr.number}.`,
      needsYou: needsYouFor({ state, gate, flagged }),
      url: pr.html_url,
      headSha: pr.head?.sha ?? null,
      base: pr.base?.ref ?? null,
    });
  }

  // The ones that want a human first, then most recently active. The point of
  // the list is what to look at next, not what happened last.
  const weight = (t: ThreadSummary) => (t.needsYou ? (t.needsYou.tone === "risk" ? 0 : 1) : 2);
  return threads.sort((a, b) => {
    const w = weight(a) - weight(b);
    if (w !== 0) return w;
    return (b.lastTs ?? "").localeCompare(a.lastTs ?? "");
  });
}

// ── one thread, in full ─────────────────────────────────────────────────────

interface RawComment {
  id: number;
  body: string | null;
  created_at: string;
  html_url?: string;
  user?: { login?: string; avatar_url?: string; type?: string } | null;
}
interface RawReview {
  id: number;
  body: string | null;
  state: string;
  submitted_at: string | null;
  html_url?: string;
  user?: { login?: string; avatar_url?: string; type?: string } | null;
}
interface RawCommit {
  sha: string;
  html_url?: string;
  commit?: { message?: string; author?: { name?: string; date?: string } | null } | null;
  author?: { login?: string; avatar_url?: string; type?: string } | null;
}

const REVIEW_WORD: Record<string, { title: string; tone: Tone }> = {
  APPROVED: { title: "approved", tone: "ok" },
  CHANGES_REQUESTED: { title: "requested changes", tone: "watch" },
  COMMENTED: { title: "commented", tone: "note" },
  DISMISSED: { title: "review dismissed", tone: "note" },
};

export interface ThreadOptions {
  repo: string;
  key: ThreadKey;
  viewer: string | null;
  sinceDays: number;
  /** Whether the viewer can push here — decides the merge button. */
  canPush: boolean;
}

export async function getThread(client: GitHubClient, pool: Pool, opts: ThreadOptions): Promise<Thread | null> {
  const [refs, pulls, spine] = await Promise.all([
    client.listBranchRefs(opts.repo, BRANCH_LIMIT).catch(() => [] as BranchRef[]),
    client
      .listPullRequests(opts.repo, { state: "all", sort: "updated", direction: "desc", per_page: String(ARCHIVE_LIMIT) })
      .then((r) => (r as RawPull[]) ?? [])
      .catch(() => [] as RawPull[]),
    spineFor(pool, opts.repo, opts.sinceDays),
  ]);

  // Hoisted so the discriminated union narrows — reading opts.key twice makes
  // TypeScript re-widen it on the second access.
  const key = opts.key;
  const ref = key.kind === "branch" ? refs.find((r) => r.name === key.branch) : undefined;
  const summaryPr =
    key.kind === "branch" ? pullsByBranch(pulls).get(key.branch) : pulls.find((p) => p.number === key.number);

  // A branch that isn't there and no pull request to fall back on: the branch
  // was deleted, or renamed, while the list the user clicked was on screen.
  if (!ref && !summaryPr) return null;

  // The live pull request, re-read: the list's copy comes from the index
  // endpoint, which does not carry `mergeable` / `mergeable_state`, and those
  // are exactly what decides whether the merge button is offered.
  const pr = summaryPr
    ? await client
        .getPullRequest(opts.repo, summaryPr.number)
        .then((r) => (r as RawPull) ?? summaryPr)
        .catch(() => summaryPr)
    : undefined;

  const isDefault = ref?.isDefault ?? false;
  const rows = [
    ...(pr ? spine.filter((r) => r.number === pr.number) : []),
    ...(isDefault ? spine.filter((r) => r.number == null) : []),
  ].sort((a, b) => a.ts.localeCompare(b.ts));

  const messages: ThreadMessage[] = [];
  let youApproved = false;

  if (pr) {
    // 1. The proposal itself.
    messages.push({
      id: `pr-${pr.number}`,
      ts: pr.created_at,
      author: prParticipant(pr, opts.viewer),
      kind: "opened",
      title: `opened #${pr.number}`,
      body: cleanBody(pr.body) || pr.title,
      tone: "note",
      url: pr.html_url,
    });

    const [comments, reviews, commits] = await Promise.all([
      client.listIssueComments(opts.repo, pr.number).then((r) => (r as RawComment[]) ?? []).catch(() => [] as RawComment[]),
      client.listPullRequestReviews(opts.repo, pr.number).then((r) => (r as RawReview[]) ?? []).catch(() => [] as RawReview[]),
      client.listPullRequestCommits(opts.repo, pr.number).then((r) => (r as RawCommit[]) ?? []).catch(() => [] as RawCommit[]),
    ]);

    // 2. The commits, grouped into runs by the same participant.
    messages.push(...groupCommits(commits, opts.viewer));

    // 3. What everyone said. CodeWorthy's review lands here too — it posts as
    //    an issue comment — so it is identified by its marker, not by position.
    for (const c of comments) {
      messages.push({
        id: `comment-${c.id}`,
        ts: c.created_at,
        author: identify({
          login: c.user?.login ?? null,
          type: c.user?.type ?? null,
          avatar: c.user?.avatar_url ?? null,
          text: c.body,
          viewer: opts.viewer,
        }),
        kind: "comment",
        title: null,
        body: cleanBody(c.body),
        tone: "note",
        url: c.html_url ?? null,
      });
    }

    // 4. Reviews — including the approver App's, and the viewer's own.
    for (const r of reviews) {
      if (!r.submitted_at) continue;
      const who = identify({
        login: r.user?.login ?? null,
        type: r.user?.type ?? null,
        avatar: r.user?.avatar_url ?? null,
        text: r.body,
        viewer: opts.viewer,
      });
      const word = REVIEW_WORD[r.state] ?? { title: r.state.toLowerCase(), tone: "note" as Tone };
      if (r.state === "APPROVED" && who.kind === "you") youApproved = true;
      messages.push({
        id: `review-${r.id}`,
        ts: r.submitted_at,
        author: who,
        kind: "review",
        title: word.title,
        body: cleanBody(r.body),
        tone: word.tone,
        url: r.html_url ?? null,
      });
    }
  } else if (ref && !isDefault) {
    // A branch with no pull request yet — the case the PR-keyed version could
    // not show at all. What belongs here is the work that is ON this branch and
    // not on the trunk; the branch's last N commits would show the trunk's
    // history on a branch that forked a while ago.
    const base = refs.find((r) => r.isDefault)?.name;
    const commits = base
      ? await client
          .compareCommits(opts.repo, base, ref.name)
          .then((r) => ((r as { commits?: RawCommit[] })?.commits ?? []) as RawCommit[])
          .catch(() => [] as RawCommit[])
      : [];
    messages.push(...groupCommits(commits, opts.viewer));
  }

  // 5. The spine — the verdicts and exceptions that never appear as comments.
  for (const row of rows) messages.push(spineMessage(row, opts.viewer));
  messages.sort((a, b) => a.ts.localeCompare(b.ts));

  const state = stateOf(pr, isDefault);
  const gate = gateFromSpine(rows);
  const flagged = rows.filter((r) => isFlagged(r.event_type)).length;
  const author = pr ? prParticipant(pr, opts.viewer) : ref ? refParticipant(ref, opts.viewer) : null;
  const branch = ref?.name ?? pr?.head?.ref ?? null;

  return {
    key: ref ? branchKey(ref.name) : archivedKey(pr!.number),
    branch: ref ? ref.name : null,
    number: pr?.number ?? null,
    title: pr?.title ?? (isDefault ? ref!.name : ref?.headline ?? ref?.name ?? "This branch"),
    state,
    author,
    participants: mergeParticipants([...(author ? [author] : []), ...messages.map((m) => m.author)]),
    gate,
    flagged,
    lastTs: messages[messages.length - 1]?.ts ?? ref?.committedAt ?? null,
    lastLine: rows[rows.length - 1]?.plain_english ?? "",
    needsYou: needsYouFor({ state, gate, flagged }),
    url: pr?.html_url ?? null,
    headSha: pr?.head?.sha ?? ref?.headSha ?? null,
    base: pr?.base?.ref ?? (isDefault ? null : refs.find((r) => r.isDefault)?.name ?? null),
    body: cleanBody(pr?.body ?? null),
    messages,
    actions: actionsFor({
      pr,
      state,
      branch,
      branchGone: !ref && Boolean(pr),
      viewer: opts.viewer,
      canPush: opts.canPush,
      youApproved,
      authorIsViewer: author?.kind === "you",
    }),
  };
}

function spineMessage(row: SpineRow, viewer: string | null): ThreadMessage {
  const who = identify({ login: row.actor, text: row.plain_english, viewer });
  const isVerdict = row.event_type === "gate.evaluated" || row.event_type === "llm.reviewed";
  // A verdict's tone comes from the verdict, not from the event NAME — every
  // gate result is logged as "gate.evaluated", so reading the type alone would
  // colour "this cannot merge" exactly like "this is fine".
  const decision = row.event_type === "gate.evaluated" ? String(row.payload.decision ?? "") : "";
  const tone: Tone =
    decision === "blocked" ? "risk" : decision === "advise" ? "watch" : decision ? "ok" : toneFor(row.event_type);
  return {
    id: `event-${row.id}`,
    ts: row.ts,
    author: who,
    kind: isVerdict ? "verdict" : "event",
    title: decision ? `review · ${decision}` : row.event_type,
    body: row.plain_english,
    tone,
    url: null,
  };
}

/** Consecutive commits by the same participant become one message. */
function groupCommits(commits: RawCommit[], viewer: string | null): ThreadMessage[] {
  const out: ThreadMessage[] = [];
  let run: { who: Participant; subjects: string[]; ts: string; sha: string; url: string | null } | null = null;

  const flush = () => {
    if (!run) return;
    out.push({
      id: `commits-${run.sha}`,
      ts: run.ts,
      author: run.who,
      kind: "commit",
      title: `${run.subjects.length} commit${run.subjects.length === 1 ? "" : "s"}`,
      body: run.subjects.join("\n"),
      tone: "note",
      url: run.url,
    });
    run = null;
  };

  for (const c of commits) {
    const message = c.commit?.message ?? "";
    const subject = message.split("\n")[0] ?? c.sha.slice(0, 7);
    const who = identify({
      login: c.author?.login ?? c.commit?.author?.name ?? null,
      type: c.author?.type ?? null,
      avatar: c.author?.avatar_url ?? null,
      // The FULL message, because the agent's trailer is in its footer.
      text: message,
      viewer,
    });
    const ts = c.commit?.author?.date ?? new Date(0).toISOString();
    if (run && run.who.label === who.label) {
      run.subjects.push(subject);
      run.ts = ts;
      run.sha = c.sha;
      run.url = c.html_url ?? run.url;
    } else {
      flush();
      run = { who, subjects: [subject], ts, sha: c.sha, url: c.html_url ?? null };
    }
  }
  flush();
  return out;
}

/**
 * What the human can do from here.
 *
 * Every "no" carries its reason. A greyed-out merge button with no explanation
 * is the single most common way a tool like this reads as broken when it is
 * actually working correctly — the whole point of a required check is that the
 * merge button is off, and saying so is the difference between a control and a
 * bug.
 */
export function actionsFor(ctx: {
  pr: RawPull | undefined;
  state: ThreadState;
  branch: string | null;
  /** A finished pull request whose head branch has since been deleted. */
  branchGone: boolean;
  viewer: string | null;
  canPush: boolean;
  youApproved: boolean;
  authorIsViewer: boolean;
}): ThreadActions {
  const { pr } = ctx;
  const base = pr?.base?.ref ?? "the base branch";
  const live = ctx.state === "open" || ctx.state === "draft";

  // No pull request: there is nowhere to post, nothing to approve, nothing to
  // merge. Saying which of those it is beats three disabled buttons.
  if (!pr) {
    const why =
      ctx.state === "default"
        ? "This is the default branch. Changes arrive here through a pull request, and the conversation happens on that."
        : `No pull request on ${ctx.branch ?? "this branch"} yet. Open one and the conversation moves here.`;
    return {
      canReply: false,
      replyBlocked: why,
      canApprove: false,
      approveBlocked: null,
      canMerge: false,
      mergeBlocked: null,
      youApproved: false,
    };
  }

  const approveBlocked = !ctx.viewer
    ? "Sign in to review this."
    : !live
      ? `This pull request is already ${ctx.state}.`
      : ctx.authorIsViewer
        ? "GitHub doesn't let you approve your own pull request."
        : ctx.youApproved
          ? "You've already approved this."
          : null;

  const mergeBlocked = !live
    ? ctx.branchGone
      ? `This pull request is ${ctx.state} and its branch is gone. The thread is here to read, not to act on.`
      : `This pull request is already ${ctx.state}.`
    : ctx.state === "draft"
      ? "It's still a draft. Mark it ready for review first."
      : !ctx.canPush
        ? "You don't have write access to this repository."
        : pr.mergeable === false || pr.mergeable_state === "dirty"
          ? `It conflicts with ${base}. The branch has to be updated first.`
          : pr.mergeable_state === "blocked"
            ? "A required check or review is still outstanding — that's the rule doing its job. Deal with it here and the button turns on."
            : pr.mergeable_state === "behind"
              ? `The branch is behind ${base} and the rule requires it to be up to date.`
              : pr.mergeable == null || pr.mergeable_state === "unknown"
                ? "GitHub is still working out whether this can merge. Try again in a moment."
                : null;

  return {
    canReply: live,
    replyBlocked: live ? null : `This pull request is ${ctx.state}, so the conversation is closed.`,
    canApprove: approveBlocked === null,
    approveBlocked,
    canMerge: mergeBlocked === null,
    mergeBlocked,
    youApproved: ctx.youApproved,
  };
}
