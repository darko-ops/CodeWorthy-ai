// The thread — a group message between you, the agents that write your code,
// and CodeWorthy.
//
// The premise: the conversation already exists. Claude Code writes a PR body,
// Cursor pushes commits, CodeWorthy posts its review, someone waives a finding
// in a comment. Today all of that is spread across GitHub's pull request page,
// the checks tab, and a change log — and the one participant who has to decide
// anything is the one who has to go and find it. This puts it in one place, in
// the order it happened, and ends every thread with the move only a human can
// make.
//
// Two deliberate departures from the rest of this dashboard:
//
//   1. There are bubbles here. Everywhere else a card is forbidden, because a
//      card makes a number look more important than the sentence next to it. A
//      chat is the one layout where the container IS the meaning — it says who
//      is speaking — so the message bubble stays, kept as quiet as it can be:
//      a fill, no border, no shadow.
//   2. The spine's own events are not bubbles. A verdict, an exception, a merge
//      are not someone talking; they are the record. They render as centred
//      system lines, the way a chat renders "X joined" — present, dateable, and
//      never competing with what a participant actually wrote.
import { useEffect, useMemo, useRef, useState } from "react";
import {
  apiAction,
  apiGet,
  ApiError,
  threadUrl,
  type MessageTone,
  type Participant,
  type Thread,
  type ThreadMessage,
  type ThreadSummary,
} from "../../api";

/**
 * Run `read` now, then every 30 seconds — but only while the tab is on screen.
 *
 * Both polls here cost real GitHub API calls, and a dashboard left open in a
 * background tab overnight would spend a rate-limit budget on a conversation
 * nobody is reading. Pausing on hidden also means coming BACK to the tab reads
 * immediately, which is exactly when the answer matters most.
 */
export function poll(read: () => void | Promise<unknown>, everyMs = 30_000): () => void {
  const tick = () => {
    if (document.visibilityState === "visible") void read();
  };
  // The FIRST read is unconditional. A dashboard opened in a background tab
  // (cmd-click, a restored session) would otherwise sit on "Opening…" until it
  // was looked at — and that read has to happen sooner or later anyway, so
  // deferring it buys nothing and costs the wait.
  void read();
  const timer = setInterval(tick, everyMs);
  // Coming back to the tab reads at once rather than waiting out the interval —
  // that is the moment the answer matters most.
  const onVisible = () => {
    if (document.visibilityState === "visible") tick();
  };
  document.addEventListener("visibilitychange", onVisible);
  return () => {
    clearInterval(timer);
    document.removeEventListener("visibilitychange", onVisible);
  };
}

const TONE_COLOR: Record<MessageTone, string> = {
  ok: "var(--signal)",
  watch: "var(--watch)",
  risk: "var(--risk)",
  note: "var(--on-dark-6)",
};

const STATE_WORD: Record<ThreadSummary["state"], string> = {
  open: "open",
  draft: "draft",
  merged: "merged",
  closed: "closed",
  standing: "branch",
};

function ago(iso: string | null): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const s = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

function clockOf(iso: string): string {
  const d = new Date(iso);
  return Number.isFinite(d.getTime())
    ? d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
    : "";
}

/**
 * The thread list lives in the dashboard, not here.
 *
 * It has to: the tab strip shows how many threads are waiting on you, and that
 * badge would be a lie if it only updated while you happened to be looking at
 * this tab. So the shell owns the list and its polling, and this component owns
 * the conversation you have open.
 */
export function ThreadView({
  repo,
  windowDays,
  threads,
  error,
  onChanged,
}: {
  repo: string;
  windowDays: number;
  threads: ThreadSummary[] | null;
  error: ApiError | null;
  /** A reply, approval or merge changes the repo's state — tell the shell. */
  onChanged: () => void;
}) {
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [thread, setThread] = useState<Thread | null>(null);
  const [threadErr, setThreadErr] = useState<ApiError | null>(null);
  // Bumped after anything that changes the conversation, so the stream re-reads
  // without waiting for the list's next poll.
  const [nonce, setNonce] = useState(0);

  // Open whatever wants you most — the server already sorted for that — rather
  // than an empty pane asking you to pick. Only ever chooses when nothing is
  // open, so a poll never yanks you out of the thread you are reading.
  useEffect(() => {
    if (!threads?.length) return;
    setOpenKey((cur) => (cur && threads.some((t) => t.key === cur) ? cur : (threads.find((t) => t.needsYou) ?? threads[0])!.key));
  }, [threads]);

  // Switching threads clears the previous one, so a slow fetch never shows the
  // last thread's messages under this thread's title.
  useEffect(() => {
    setThread(null);
    setThreadErr(null);
  }, [openKey, repo]);

  // The open thread, and a poll of its own so a live conversation moves.
  useEffect(() => {
    if (!openKey) return;
    let live = true;
    const stop = poll(async () => {
      try {
        const t = await apiGet<Thread>(threadUrl(repo, openKey, windowDays));
        if (live) {
          setThread(t);
          setThreadErr(null);
        }
      } catch (e) {
        // A poll failure must not blank a thread the user is reading.
        if (live) setThreadErr(e instanceof ApiError ? e : new ApiError("server", String(e)));
      }
    });
    return () => {
      live = false;
      stop();
    };
  }, [repo, openKey, windowDays, nonce]);

  function refresh() {
    setNonce((n) => n + 1);
    onChanged();
  }

  if (error) return <ThreadsUnavailable err={error} />;
  if (!threads) return <p className="hint th-loading">Reading the conversation…</p>;

  const waiting = threads.filter((t) => t.needsYou).length;

  return (
    <div className="threads">
      <aside className="th-list">
        <div className="th-list-head">
          <span className="section-label">Threads</span>
          {waiting > 0 && <span className="th-waiting">{waiting} waiting on you</span>}
        </div>
        {threads.map((t) => (
          <ThreadRow key={t.key} thread={t} selected={t.key === openKey} onOpen={() => setOpenKey(t.key)} />
        ))}
      </aside>

      <section className="th-pane">
        {threadErr && !thread ? (
          <ThreadsUnavailable err={threadErr} />
        ) : thread ? (
          <ThreadStream thread={thread} repo={repo} onChanged={refresh} />
        ) : (
          <p className="hint th-loading">Opening…</p>
        )}
      </section>
    </div>
  );
}

function ThreadRow({ thread, selected, onOpen }: { thread: ThreadSummary; selected: boolean; onOpen: () => void }) {
  const n = thread.needsYou;
  return (
    <button className={"th-row" + (selected ? " selected" : "")} onClick={onOpen}>
      <span className="th-row-top">
        <span className="th-row-title">
          {thread.number != null && <span className="th-num">#{thread.number}</span>}
          {thread.title}
        </span>
        <span className="th-row-when">{ago(thread.lastTs)}</span>
      </span>
      <span className="th-row-line">{thread.lastLine}</span>
      <span className="th-row-foot">
        <Faces participants={thread.participants} />
        <span className="th-state">{STATE_WORD[thread.state]}</span>
        {n && (
          <span className="th-needs" style={{ color: TONE_COLOR[n.tone] }}>
            <span className="th-needs-dot" style={{ background: TONE_COLOR[n.tone] }} aria-hidden />
            {n.reason}
          </span>
        )}
      </span>
    </button>
  );
}

/** The participant strip — who is in this conversation, at a glance. */
function Faces({ participants }: { participants: Participant[] }) {
  const shown = participants.slice(0, 4);
  return (
    <span className="th-faces">
      {shown.map((p, i) => (
        <Face key={p.login + i} who={p} small />
      ))}
      {participants.length > shown.length && <span className="th-face-more">+{participants.length - shown.length}</span>}
    </span>
  );
}

function Face({ who, small = false }: { who: Participant; small?: boolean }) {
  const initials =
    who.kind === "codeworthy"
      ? "CW"
      : (who.label.replace(/^@/, "").match(/[a-zA-Z0-9]/g) ?? ["?"]).slice(0, 2).join("").toUpperCase();
  if (who.avatar && who.kind !== "codeworthy") {
    return <img className={"th-face" + (small ? " sm" : "")} src={who.avatar} alt="" title={who.label} />;
  }
  return (
    <span className={"th-face is-text kind-" + who.kind + (small ? " sm" : "")} title={who.label} aria-hidden>
      {initials}
    </span>
  );
}

// ── the stream ──────────────────────────────────────────────────────────────

function ThreadStream({ thread, repo, onChanged }: { thread: Thread; repo: string; onChanged: () => void }) {
  const streamRef = useRef<HTMLDivElement | null>(null);
  const lastId = thread.messages[thread.messages.length - 1]?.id;

  // Scroll to the newest message when the thread changes or something arrives —
  // the point of a chat is the bottom of it. Setting scrollTop on the stream
  // itself rather than calling scrollIntoView: that walks every scrollable
  // ancestor, so it drags the whole page (and the thread list beside it) along
  // with it, pushing the thread's own header out of view.
  useEffect(() => {
    const el = streamRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [thread.key, lastId]);

  // Collapse the header on a run of messages from the same participant, the way
  // any chat does: the second thing someone says isn't a new speaker.
  const rendered = useMemo(() => {
    let prev: string | null = null;
    return thread.messages.map((m) => {
      const isSystem = m.kind === "verdict" || m.kind === "event";
      const sameSpeaker = !isSystem && prev === m.author.label;
      prev = isSystem ? null : m.author.label;
      return { m, sameSpeaker };
    });
  }, [thread.messages]);

  return (
    <>
      <header className="th-head">
        <div>
          <h2 className="th-title">
            {thread.number != null && <span className="th-num">#{thread.number}</span>}
            {thread.title}
          </h2>
          <p className="th-sub">
            {thread.author ? `${thread.author.label} · ` : ""}
            {STATE_WORD[thread.state]}
            {thread.base ? ` → ${thread.base}` : ""}
            {thread.participants.length > 1 ? ` · ${thread.participants.length} in this thread` : ""}
          </p>
        </div>
        {thread.url && (
          <a className="link-signal" href={thread.url} target="_blank" rel="noreferrer">
            Open on GitHub ↗
          </a>
        )}
      </header>

      <div className="th-stream" ref={streamRef}>
        {rendered.length === 0 && (
          <p className="hint th-empty">
            Nothing has been said here yet. When an agent opens a pull request or pushes a commit, it shows up in this
            thread — and so does everything CodeWorthy finds.
          </p>
        )}
        {rendered.map(({ m, sameSpeaker }) => (
          <Message key={m.id} message={m} sameSpeaker={sameSpeaker} />
        ))}
      </div>

      <ActionBar thread={thread} repo={repo} onChanged={onChanged} />
    </>
  );
}

function Message({ message, sameSpeaker }: { message: ThreadMessage; sameSpeaker: boolean }) {
  const m = message;
  // The spine's own entries: the record, not a speaker.
  if (m.kind === "verdict" || m.kind === "event") {
    return (
      <div className={"th-sys tone-" + m.tone}>
        <span className="th-sys-dot" style={{ background: TONE_COLOR[m.tone] }} aria-hidden />
        <p className="th-sys-text">{m.body}</p>
        <span className="th-sys-meta">
          {m.title && <span className="th-sys-type">{m.title}</span>}
          <time dateTime={m.ts}>{clockOf(m.ts)}</time>
        </span>
      </div>
    );
  }

  const mine = m.author.kind === "you";
  return (
    <div className={"th-msg kind-" + m.author.kind + (mine ? " mine" : "") + (sameSpeaker ? " run" : "")}>
      {!sameSpeaker && <Face who={m.author} />}
      <div className="th-msg-body">
        {!sameSpeaker && (
          <div className="th-msg-head">
            <span className="th-who">{m.author.label}</span>
            {/* An agent that pushed under a human login: say both, because the
                commit really is that person's and the writing really is the
                agent's. */}
            {m.author.kind === "agent" && m.author.agent !== "agent" && !m.author.login.endsWith("[bot]") && (
              <span className="th-via">as @{m.author.login}</span>
            )}
            {/* The permalink lives on the timestamp, the way a chat does it. As
                its own line under every bubble it was a link on nearly every
                message, and the thread stopped reading as a conversation. */}
            {m.url ? (
              <a className="th-when" href={m.url} target="_blank" rel="noreferrer" title="Open on GitHub">
                <time dateTime={m.ts}>{clockOf(m.ts)}</time> ↗
              </a>
            ) : (
              <time className="th-when" dateTime={m.ts}>
                {clockOf(m.ts)}
              </time>
            )}
          </div>
        )}
        <div className={"th-bubble tone-" + m.tone}>
          {m.title && m.kind !== "opened" && <span className="th-bubble-tag">{m.title}</span>}
          <Body text={m.body} kind={m.kind} />
        </div>
      </div>
    </div>
  );
}

/**
 * Message bodies, rendered without a markdown dependency.
 *
 * Fenced code is the one piece of markdown that is unreadable if it isn't
 * honoured — CodeWorthy quotes diffs and agents paste snippets — so fences
 * become <pre> and everything else stays exactly as it was typed. No HTML is
 * ever interpreted: this is other people's text, some of it written by a model,
 * and it renders as text.
 */
function Body({ text, kind }: { text: string; kind: ThreadMessage["kind"] }) {
  if (kind === "commit") {
    return (
      <ul className="th-commits">
        {text.split("\n").filter(Boolean).map((line, i) => (
          <li key={i}>{line}</li>
        ))}
      </ul>
    );
  }
  const parts = text.split(/```/);
  if (parts.length === 1) return <p className="th-text">{text}</p>;
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <pre key={i} className="th-code">
            {part.replace(/^[a-zA-Z0-9_-]*\n/, "").trimEnd()}
          </pre>
        ) : (
          part.trim() && (
            <p key={i} className="th-text">
              {part.trim()}
            </p>
          )
        )
      )}
    </>
  );
}

// ── the end of the thread: the move only a human can make ───────────────────

type MergeMethod = "squash" | "merge" | "rebase";
const METHOD_WORD: Record<MergeMethod, string> = {
  squash: "Squash and merge",
  merge: "Merge commit",
  rebase: "Rebase and merge",
};

/**
 * Reply, approve, merge — pinned under the stream so it is never something you
 * have to scroll to find.
 *
 * Merging asks twice. Everything else on this dashboard is additive or
 * reversible; this one ships code to the default branch, and it is the single
 * action CodeWorthy will not do on anyone's behalf. A confirm step is the least
 * a screen can do before performing it, and it is also where the head commit is
 * named — so what you agree to merge is the commit you were just reading.
 */
function ActionBar({ thread, repo, onChanged }: { thread: Thread; repo: string; onChanged: () => void }) {
  const a = thread.actions;
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<null | "reply" | "approve" | "merge">(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [method, setMethod] = useState<MergeMethod>("squash");

  const key = thread.number != null ? String(thread.number) : thread.key;
  const n = thread.needsYou;

  async function act(kind: "reply" | "approve" | "merge") {
    setBusy(kind);
    setError(null);
    setDone(null);
    try {
      if (kind === "reply") {
        await apiAction(`/api/repos/${repo}/threads/${key}/reply`, { body: text.trim() });
        setText("");
        setDone("Posted on the pull request.");
      } else if (kind === "approve") {
        await apiAction(`/api/repos/${repo}/threads/${key}/approve`, {
          // Whatever is in the box rides along as the review body, so the note
          // you were about to write isn't thrown away by pressing Approve.
          body: text.trim(),
        });
        setText("");
        setDone("Approved, as you, and on the record.");
      } else {
        await apiAction(`/api/repos/${repo}/threads/${key}/merge`, { sha: thread.headSha, method });
        setConfirming(false);
        setDone(`Merged. ${METHOD_WORD[method]} — recorded with your name.`);
      }
      onChanged();
    } catch (err) {
      // GitHub's own sentence, verbatim: it knows why it refused and we don't.
      setError(err instanceof ApiError ? err.message : "That didn't work.");
      setConfirming(false);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="th-actions">
      {n && (
        <div className="th-needs-line" style={{ color: TONE_COLOR[n.tone] }}>
          <span className="th-needs-dot" style={{ background: TONE_COLOR[n.tone] }} aria-hidden />
          <strong>{n.reason}</strong>
          <span className="th-needs-detail">{n.detail}</span>
        </div>
      )}

      {confirming ? (
        <div className="th-confirm">
          <p className="th-confirm-text">
            Merge <strong>{thread.title}</strong> into <strong>{thread.base}</strong> as yourself, at commit{" "}
            <code>{thread.headSha?.slice(0, 7)}</code>? CodeWorthy records it; it can't undo it.
          </p>
          <div className="th-confirm-row">
            <div className="window-words" role="radiogroup" aria-label="Merge method">
              {(Object.keys(METHOD_WORD) as MergeMethod[]).map((m) => (
                <button
                  key={m}
                  role="radio"
                  aria-checked={method === m}
                  className={method === m ? "selected" : ""}
                  onClick={() => setMethod(m)}
                >
                  {m}
                </button>
              ))}
            </div>
            <button className="btn-filled" onClick={() => act("merge")} disabled={busy !== null}>
              {busy === "merge" ? "Merging…" : METHOD_WORD[method]}
            </button>
            <button className="btn-plain" onClick={() => setConfirming(false)} disabled={busy !== null}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="th-compose">
            <textarea
              className="th-input"
              rows={2}
              placeholder={
                a.canReply
                  ? "Reply — the agents read this on the pull request…"
                  : (a.replyBlocked ?? "You can't reply here.")
              }
              value={text}
              disabled={!a.canReply || busy !== null}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                // ⌘/Ctrl+Enter sends, because this box is a chat box and the
                // plain Enter has to stay available for writing a real reply.
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && text.trim() && a.canReply) {
                  e.preventDefault();
                  void act("reply");
                }
              }}
            />
            <button
              className="btn-outline th-send"
              onClick={() => act("reply")}
              disabled={!a.canReply || !text.trim() || busy !== null}
            >
              {busy === "reply" ? "Sending…" : "Send"}
            </button>
          </div>

          <div className="th-buttons">
            <Action
              label="Approve"
              can={a.canApprove}
              why={a.approveBlocked}
              filled={false}
              busy={busy === "approve"}
              onClick={() => act("approve")}
            />
            <Action
              label="Merge"
              can={a.canMerge}
              why={a.mergeBlocked}
              filled
              busy={false}
              onClick={() => setConfirming(true)}
            />
            <span className="th-doctrine">
              CodeWorthy never merges. It reviews, it records, and it hands you the button.
            </span>
          </div>
        </>
      )}

      {error && <p className="fix-error">{error}</p>}
      {done && <p className="th-done">{done}</p>}
    </div>
  );
}

/** A button, or the reason there isn't one. Never a dead control with no words. */
function Action({
  label,
  can,
  why,
  filled,
  busy,
  onClick,
}: {
  label: string;
  can: boolean;
  why: string | null;
  filled: boolean;
  busy: boolean;
  onClick: () => void;
}) {
  if (!can) {
    return why ? (
      <span className="th-cant">
        <span className="th-cant-label">{label}</span>
        {why}
      </span>
    ) : null;
  }
  return (
    <button className={filled ? "btn-filled" : "btn-outline"} onClick={onClick} disabled={busy}>
      {busy ? "Working…" : label}
    </button>
  );
}

// A thread list that couldn't load. The most likely cause by far is a backend
// that predates this feature, and "404" is not something to show a person.
function ThreadsUnavailable({ err }: { err: ApiError }) {
  const [title, body] =
    err.kind === "offline"
      ? ["Waking up…", "Steward's backend is asleep. It'll connect on the next try — refresh in a moment."]
      : err.status === 404
        ? [
            "No conversation yet",
            "This CodeWorthy backend doesn't serve threads yet. The repository and protection tabs work as they always have.",
          ]
        : err.kind === "forbidden"
          ? ["No access", "You don't have access to this repository through your installations."]
          : ["Couldn't load the conversation", err.message];
  return (
    <div className="repo-blank">
      <h2>{title}</h2>
      <p className="hint">{body}</p>
    </div>
  );
}
