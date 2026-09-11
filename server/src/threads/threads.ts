// Threads — the repository's conversation, assembled rather than invented.
//
// A thread is a pull request: the place where an agent proposes a change,
// CodeWorthy says what it found, and a human decides. The messages come from
// two sources and nowhere else:
//
//   1. GitHub — the PR body, its commits, its issue comments, its reviews.
//      This is where Claude Code, Cursor and Codex actually talk, and where
//      CodeWorthy posts its review. Reading it means the dashboard shows the
//      real conversation instead of a summary of one.
//   2. The audit spine — the gate's verdict, protection exceptions, the merge.
//      These happen AROUND the pull request and never appear as comments, so a
//      thread built only from GitHub would be missing exactly the parts that
//      are evidence.
//
// Merged on timestamp, they read as one group message. Nothing here is
// generated text: every message is something a participant wrote or something
// the spine recorded.
//
// There is also one synthetic thread per repo — the default branch — carrying
// everything that has no pull request to belong to (direct pushes in solo mode,
// protection changes, post-merge reviews). Without it a solo repo's thread tab
// would be empty while things were plainly happening.
import type { Pool } from "pg";
import type { GitHubClient } from "../github/client.js";
import { cleanBody, identify, type Participant } from "./agents.js";

export const MAIN_THREAD_KEY = "branch";

export type ThreadState = "open" | "draft" | "merged" | "closed" | "standing";
export type GateDecision = "passed" | "advise" | "blocked" | "unavailable" | "none";
export type Tone = "ok" | "watch" | "risk" | "note";

/** Why this thread is asking for the human, in the words shown on the row. */
export interface NeedsYou {
  reason: string;
  detail: string;
  tone: Tone;
}

export interface ThreadSummary {
  key: string;
  /** Null on the standing default-branch thread. */
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
  /** A short label above the body: "approved", "3 commits", "blocked". */
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

function stateOf(pr: RawPull): ThreadState {
  if (pr.merged || pr.merged_at) return "merged";
  if (pr.state === "closed") return "closed";
  if (pr.draft) return "draft";
  return "open";
}

function participantFor(pr: RawPull, viewer: string | null): Participant {
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

// ── what a thread wants from you ────────────────────────────────────────────

/**
 * Whether this thread is waiting on the human, and for what.
 *
 * Deliberately narrow. "Needs you" is the only alarm on this screen, so it
 * fires for exactly three things: CodeWorthy is blocking, something went wrong
 * that has no automatic answer, or the change is finished and only a merge is
 * missing. Everything else is the agents and CodeWorthy working, which is what
 * the tool is for.
 */
export function needsYouFor(input: {
  state: ThreadState;
  gate: GateDecision;
  flagged: number;
  viewerIsAuthor: boolean;
}): NeedsYou | null {
  if (input.state === "merged" || input.state === "closed" || input.state === "standing") {
    return input.flagged > 0
      ? {
          reason: "Look at this",
          detail: `${input.flagged} thing${input.flagged === 1 ? "" : "s"} on this change went on the record as an exception.`,
          tone: "risk",
        }
      : null;
  }
  if (input.gate === "blocked") {
    return {
      reason: "Blocked",
      detail: "CodeWorthy found something that has to be dealt with before this can merge. Tell the agent here, or waive it with a reason.",
      tone: "risk",
    };
  }
  if (input.flagged > 0) {
    return {
      reason: "Exception",
      detail: `${input.flagged} exception${input.flagged === 1 ? "" : "s"} on this change. CodeWorthy recorded it and can't decide it for you.`,
      tone: "risk",
    };
  }
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

// ── the list ────────────────────────────────────────────────────────────────

export interface ListOptions {
  repo: string;
  sinceDays: number;
  /** The signed-in user, so their own messages read as "You". */
  viewer: string | null;
  limit?: number;
}

/**
 * Every thread in the window, most recently active first.
 *
 * One GitHub call and one SQL query, whatever the repo's size — the per-thread
 * detail (comments, reviews, commits) is only fetched when a thread is opened.
 */
export async function listThreads(
  client: GitHubClient,
  pool: Pool,
  opts: ListOptions
): Promise<ThreadSummary[]> {
  const limit = Math.min(opts.limit ?? 25, 50);
  const [pulls, spine] = await Promise.all([
    client
      .listPullRequests(opts.repo, { state: "all", sort: "updated", direction: "desc", per_page: String(limit) })
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

  const threads: ThreadSummary[] = pulls.map((pr) => {
    const rows = byNumber.get(pr.number) ?? [];
    const state = stateOf(pr);
    const gate = gateFromSpine(rows);
    const flagged = rows.filter((r) => isFlagged(r.event_type)).length;
    const author = participantFor(pr, opts.viewer);
    const last = rows[rows.length - 1];
    const participants = mergeParticipants([
      author,
      ...rows
        .filter((r) => r.actor)
        .map((r) => identify({ login: r.actor, text: r.plain_english, viewer: opts.viewer })),
    ]);
    return {
      key: `pr-${pr.number}`,
      number: pr.number,
      title: pr.title,
      state,
      author,
      participants,
      gate,
      flagged,
      lastTs: last?.ts ?? pr.updated_at ?? pr.created_at,
      lastLine: last?.plain_english ?? `${author.label} opened this pull request.`,
      needsYou: needsYouFor({
        state,
        gate,
        flagged,
        viewerIsAuthor: author.kind === "you",
      }),
      url: pr.html_url,
      headSha: pr.head?.sha ?? null,
      base: pr.base?.ref ?? null,
    };
  });

  // The standing thread. It exists even when empty, because "nothing has
  // happened on the default branch" is itself worth being able to see.
  const looseFlagged = loose.filter((r) => isFlagged(r.event_type)).length;
  const lastLoose = loose[loose.length - 1];
  threads.push({
    key: MAIN_THREAD_KEY,
    number: null,
    title: "The default branch",
    state: "standing",
    author: null,
    participants: mergeParticipants(
      loose.filter((r) => r.actor).map((r) => identify({ login: r.actor, text: r.plain_english, viewer: opts.viewer }))
    ),
    gate: "none",
    flagged: looseFlagged,
    lastTs: lastLoose?.ts ?? null,
    lastLine: lastLoose?.plain_english ?? "Nothing has landed outside a pull request in this window.",
    needsYou: needsYouFor({ state: "standing", gate: "none", flagged: looseFlagged, viewerIsAuthor: false }),
    url: null,
    headSha: null,
    base: null,
  });

  // Most recent first, but a thread that wants the human outranks a quiet one
  // that happens to be newer — the point of the list is what to look at next.
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
  number: number | null;
  viewer: string | null;
  sinceDays: number;
  /** Whether the viewer can push here — decides the merge button. */
  canPush: boolean;
}

export async function getThread(
  client: GitHubClient,
  pool: Pool,
  opts: ThreadOptions
): Promise<Thread | null> {
  const spine = await spineFor(pool, opts.repo, opts.sinceDays);

  if (opts.number == null) return standingThread(spine, opts);

  const number = opts.number;
  const rows = spine.filter((r) => r.number === number);

  const [pr, comments, reviews, commits] = await Promise.all([
    client.getPullRequest(opts.repo, number).then((r) => r as RawPull),
    client.listIssueComments(opts.repo, number).then((r) => (r as RawComment[]) ?? []).catch(() => [] as RawComment[]),
    client.listPullRequestReviews(opts.repo, number).then((r) => (r as RawReview[]) ?? []).catch(() => [] as RawReview[]),
    client.listPullRequestCommits(opts.repo, number).then((r) => (r as RawCommit[]) ?? []).catch(() => [] as RawCommit[]),
  ]);
  if (!pr) return null;

  const author = participantFor(pr, opts.viewer);
  const state = stateOf(pr);
  const gate = gateFromSpine(rows);
  const flagged = rows.filter((r) => isFlagged(r.event_type)).length;
  const messages: ThreadMessage[] = [];

  // 1. The proposal itself.
  messages.push({
    id: `pr-${number}`,
    ts: pr.created_at,
    author,
    kind: "opened",
    title: `opened #${number}`,
    body: cleanBody(pr.body) || pr.title,
    tone: "note",
    url: pr.html_url,
  });

  // 2. The commits, grouped into runs by the same participant. One message per
  //    commit would drown the conversation in a long-running PR; a run is how
  //    a person would describe it anyway ("Claude Code pushed four commits").
  const commitMsgs = groupCommits(commits, opts.viewer);
  messages.push(...commitMsgs);

  // 3. What everyone said. CodeWorthy's review lands here too — it posts as an
  //    issue comment — so it is identified by its marker, not by position.
  for (const c of comments) {
    const who = identify({
      login: c.user?.login ?? null,
      type: c.user?.type ?? null,
      avatar: c.user?.avatar_url ?? null,
      text: c.body,
      viewer: opts.viewer,
    });
    messages.push({
      id: `comment-${c.id}`,
      ts: c.created_at,
      author: who,
      kind: "comment",
      title: null,
      body: cleanBody(c.body),
      tone: who.kind === "codeworthy" ? "note" : "note",
      url: c.html_url ?? null,
    });
  }

  // 4. Reviews — including the approver App's, and the viewer's own.
  let youApproved = false;
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

  // 5. The spine — the verdicts and exceptions that never appear as comments.
  for (const row of rows) {
    messages.push(spineMessage(row, opts.viewer));
  }

  messages.sort((a, b) => a.ts.localeCompare(b.ts));

  const participants = mergeParticipants([author, ...messages.map((m) => m.author)]);

  return {
    key: `pr-${number}`,
    number,
    title: pr.title,
    state,
    author,
    participants,
    gate,
    flagged,
    lastTs: messages[messages.length - 1]?.ts ?? pr.updated_at,
    lastLine: rows[rows.length - 1]?.plain_english ?? `${author.label} opened this pull request.`,
    needsYou: needsYouFor({ state, gate, flagged, viewerIsAuthor: author.kind === "you" }),
    url: pr.html_url,
    headSha: pr.head?.sha ?? null,
    base: pr.base?.ref ?? null,
    body: cleanBody(pr.body),
    messages,
    actions: actionsFor(pr, state, {
      viewer: opts.viewer,
      canPush: opts.canPush,
      youApproved,
      authorIsViewer: author.kind === "you",
    }),
  };
}

/** The default-branch thread: spine events with no pull request of their own. */
function standingThread(spine: SpineRow[], opts: ThreadOptions): Thread {
  const rows = spine.filter((r) => r.number == null);
  const messages = rows.map((r) => spineMessage(r, opts.viewer));
  const flagged = rows.filter((r) => isFlagged(r.event_type)).length;
  return {
    key: MAIN_THREAD_KEY,
    number: null,
    title: "The default branch",
    state: "standing",
    author: null,
    participants: mergeParticipants(messages.map((m) => m.author)),
    gate: "none",
    flagged,
    lastTs: messages[messages.length - 1]?.ts ?? null,
    lastLine: rows[rows.length - 1]?.plain_english ?? "Nothing has landed outside a pull request in this window.",
    needsYou: needsYouFor({ state: "standing", gate: "none", flagged, viewerIsAuthor: false }),
    url: null,
    headSha: null,
    base: null,
    body: "Everything CodeWorthy recorded that doesn't belong to a pull request — direct pushes, protection changes, and the reviews it ran after the fact.",
    messages,
    actions: {
      canReply: false,
      // Saying WHY the box is missing, rather than leaving a gap where one is
      // on every other thread.
      replyBlocked: "There's no pull request here to reply on. Open one and the conversation moves there.",
      canApprove: false,
      approveBlocked: null,
      canMerge: false,
      mergeBlocked: null,
      youApproved: false,
    },
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
export function actionsFor(
  pr: RawPull,
  state: ThreadState,
  ctx: { viewer: string | null; canPush: boolean; youApproved: boolean; authorIsViewer: boolean }
): ThreadActions {
  const base = pr.base?.ref ?? "the base branch";
  const open = state === "open" || state === "draft";

  const approveBlocked = !ctx.viewer
    ? "Sign in to review this."
    : !open
      ? `This pull request is already ${state}.`
      : ctx.authorIsViewer
        ? "GitHub doesn't let you approve your own pull request."
        : ctx.youApproved
          ? "You've already approved this."
          : null;

  const mergeBlocked = !open
    ? `This pull request is already ${state}.`
    : state === "draft"
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
    canReply: open,
    replyBlocked: open ? null : `This pull request is ${state}, so the conversation is closed.`,
    canApprove: approveBlocked === null,
    approveBlocked,
    canMerge: mergeBlocked === null,
    mergeBlocked,
    youApproved: ctx.youApproved,
  };
}
