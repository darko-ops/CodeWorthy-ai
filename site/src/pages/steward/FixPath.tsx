// Decisions — what to do about an unhealthy repo, worst first.
//
// The dashboard used to state a problem and stop. Every unhealthy vital carried
// one sentence of advice that assumed CodeWorthy's preferred fix was available,
// and when it wasn't, the user was left with a red badge and no next move. That
// is the state people uninstall from.
//
// So each issue is a short path instead of a verdict. The recommendation is
// first and marked; every alternative says what it costs; and the list always
// ends somewhere — the final option settles the issue by accepting it on the
// record — so a repo can always be brought back to a clean state even when the
// ideal fix is impossible for it.
//
// v2 changes how that path is SHOWN, not what it is. The options used to be a
// walk-down: one card at a time, behind a "not an option for me — show the next
// one" button. You couldn't see what you were choosing between until you had
// rejected everything else, which is a strange way to ask someone to weigh a
// trade-off. Now the row expands into a pick-list: every option on one line,
// the recommendation pre-selected, and the trade-off written under whichever
// one you're looking at. Selecting never acts; only the commit button does.
import { useState } from "react";
import { apiAction, ApiError, type FixOption, type RepoIssue, type RepoMode } from "../../api";

// The effort words, shortened to fit a 72px column without wrapping. The API's
// own vocabulary is three fixed values, so this is a rename, not a truncation.
const EFFORT_LABEL: Record<FixOption["effort"], string> = {
  "one click": "one click",
  "a few minutes": "a few min",
  "a decision to make": "a decision",
};
// Teal reads as "cheap"; the amber of "a decision to make" reads as "this one
// costs you something". Both only on the selected row — an unselected list
// coloured by effort would be four competing signals.
const EFFORT_TONE: Record<FixOption["effort"], string> = {
  "one click": "fast",
  "a few minutes": "fast",
  "a decision to make": "slow",
};

export function FixPath({
  issues,
  actor,
  onChanged,
}: {
  issues: RepoIssue[];
  /** Whose name the record will carry for whatever is decided here. */
  actor?: string;
  onChanged: () => void;
}) {
  // Only one row is open at a time: two open pick-lists is two questions asked
  // at once, and the point of this screen is a single next move.
  const [expanded, setExpanded] = useState<string | null>(null);

  if (issues.length === 0) {
    return (
      <p className="fix-clear">
        Every finding on this repository is either resolved or deliberately accepted. CodeWorthy keeps watching and
        keeps the record; there's nothing waiting on you.
      </p>
    );
  }

  return (
    <div className="decisions">
      {issues.map((issue, i) => (
        <DecisionRow
          key={issue.id}
          issue={issue}
          first={i === 0}
          expanded={expanded === issue.id}
          actor={actor}
          onToggle={() => setExpanded((cur) => (cur === issue.id ? null : issue.id))}
          onChanged={onChanged}
        />
      ))}
    </div>
  );
}

/** The cue under "Do this first": what the recommended option costs, in the
 *  same two clauses every time — effort, then what you give up. */
function recommendedCue(option: FixOption | undefined): string {
  if (!option) return "";
  return `${EFFORT_LABEL[option.effort]} · ${option.tradeoff ? "there's a trade-off" : "nothing given up"}`;
}

function DecisionRow({
  issue,
  first,
  expanded,
  actor,
  onToggle,
  onChanged,
}: {
  issue: RepoIssue;
  first: boolean;
  expanded: boolean;
  actor?: string;
  onToggle: () => void;
  onChanged: () => void;
}) {
  const [selected, setSelected] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<
    { verb: string; title: string; note: string; undoPath: string | null } | null
  >(null);

  const recommended = issue.options[0];
  const option = issue.options[selected] ?? recommended;

  function select(i: number) {
    setSelected(i);
    setError(null);
  }
  // Arrow keys move between options the way a native radio group does; space
  // and enter pick the focused one. Selecting still never runs anything.
  function onPickKey(e: React.KeyboardEvent<HTMLDivElement>, i: number) {
    const last = issue.options.length - 1;
    const to =
      e.key === "ArrowDown" || e.key === "ArrowRight" ? (i === last ? 0 : i + 1)
      : e.key === "ArrowUp" || e.key === "ArrowLeft" ? (i === 0 ? last : i - 1)
      : e.key === " " || e.key === "Enter" ? i
      : null;
    if (to === null) return;
    e.preventDefault();
    select(to);
    (e.currentTarget.parentElement?.children[to] as HTMLElement | undefined)?.focus();
  }

  async function run(o: FixOption) {
    if (o.action.kind !== "codeworthy" && o.action.kind !== "accept") return;
    setBusy(true);
    setError(null);
    try {
      await apiAction(o.action.path, o.action.kind === "codeworthy" ? o.action.body : undefined);
      setDone({
        verb: o.action.kind === "accept" ? "Accepted" : "Settled",
        title: issue.title,
        note:
          o.action.kind === "accept"
            ? "Recorded as a deliberate choice. It shows in the report as accepted, never as a pass."
            : `${o.title} — done, and in the record. This may take a moment to clear from the vitals below.`,
        // Only an acceptance can be taken back, and taking it back APPENDS the
        // reversal — the original decision stays in the record, because a
        // record you can quietly edit is worth nothing.
        undoPath: o.action.kind === "accept" ? o.action.path.replace("/accept/", "/unaccept/") : null,
      });
      onChanged();
    } catch (err) {
      // The server's message, verbatim — it knows why this failed and we don't.
      // A failed "protect this branch" is often how we learn the constraint
      // exists at all, and the reload surfaces the options that work around it.
      setError(err instanceof ApiError ? err.message : "That didn't work.");
    } finally {
      setBusy(false);
    }
  }

  async function undo(path: string) {
    setBusy(true);
    setError(null);
    try {
      await apiAction(path);
      setDone(null);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't take that back.");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="decision-settled">
        <span className="settled-check" aria-hidden>✓</span>
        <div>
          <div className="settled-meta">
            {done.verb} · just now{actor ? ` by @${actor}` : ""}
          </div>
          <p className="settled-title">{done.title}</p>
          <p className="settled-note">{done.note}</p>
          {error && <p className="fix-error">{error}</p>}
        </div>
        {done.undoPath && (
          <button className="btn-plain" onClick={() => undo(done.undoPath!)} disabled={busy}>
            {busy ? "Working…" : "Undo"}
          </button>
        )}
      </div>
    );
  }

  // A one-click CodeWorthy action IS the recommendation, so it goes straight on
  // the row as the screen's one filled button — there is nothing to weigh.
  const oneClick =
    recommended && recommended.action.kind === "codeworthy" && recommended.effort === "one click";

  return (
    <div className={"decision-row" + (first ? " first" : "") + (expanded ? " expanded" : "")}>
      <div>
        {first && recommended && (
          <div className="dr-cue">
            <span className="dr-cue-label">Do this first</span>
            <span className="dr-cue-note">{recommendedCue(recommended)}</span>
          </div>
        )}
        <h3 className="dr-title">{issue.title}</h3>
        <p className="dr-consequence">{issue.consequence}</p>
      </div>

      <div className="dr-action">
        {expanded ? (
          <button className="btn-plain" onClick={onToggle} aria-expanded>
            Collapse ↑
          </button>
        ) : oneClick && !error ? (
          <button className="btn-filled" onClick={() => run(recommended)} disabled={busy}>
            {busy ? "Working…" : recommended.action.label}
          </button>
        ) : (
          <button className="btn-outline" onClick={onToggle} aria-expanded={false}>
            See {issue.options.length} option{issue.options.length === 1 ? "" : "s"}
          </button>
        )}
      </div>

      {/* A one-click row can still fail, and its message has to land somewhere
          the user is already looking. */}
      {!expanded && error && <FixError message={error} />}

      {expanded && (
        <div className="dr-expand">
          {issue.constraint && (
            // Saying "we can't" without "because" reads as the tool being broken.
            <p className="constraint">
              <span className="constraint-label">Why CodeWorthy can't just do this — </span>
              {issue.constraint} Pick the trade you can live with.
            </p>
          )}

          <div className="picklist" role="radiogroup" aria-label={`Options for ${issue.title}`}>
            {issue.options.map((o, i) => (
              // A div, not a button: the selected row holds an ordered list and
              // a Copy button, and neither is legal inside a <button>. Roving
              // tabindex + arrow keys give it the keyboard behaviour a native
              // radio group would have had.
              <div
                key={o.id}
                role="radio"
                aria-checked={i === selected}
                tabIndex={i === selected ? 0 : -1}
                className={"pick-row" + (i === selected ? " selected" : "")}
                onClick={() => select(i)}
                onKeyDown={(e) => onPickKey(e, i)}
              >
                <span className="pick-radio" aria-hidden />
                <div>
                  <span className="pick-label">{o.title}</span>
                  {i === selected && (
                    <>
                      <p className="pick-note">
                        {i === 0
                          ? `Recommended · ${o.tradeoff ?? "nothing given up"}`
                          : (o.tradeoff ?? o.detail)}
                      </p>
                      {o.action.kind === "manual" && <ManualSteps action={o.action} />}
                    </>
                  )}
                </div>
                <span className={"pick-effort " + EFFORT_TONE[o.effort]}>{EFFORT_LABEL[o.effort]}</span>
              </div>
            ))}
          </div>

          {/* A manual option has no button: the steps and the snippet ARE the
              action, and they're already open in the row above. */}
          {option && option.action.kind !== "manual" && (
            <div className="commit-row">
              <CommitAction option={option} busy={busy} onRun={() => run(option)} />
              <span className="commit-note">whatever you pick is recorded with your name and the reason</span>
            </div>
          )}
          {error && <FixError message={error} plural={issue.options.length > 2} />}
        </div>
      )}
    </div>
  );
}

// The failure is the server's sentence, and then one line saying the list is
// still there. A dead end is the thing this screen exists to prevent.
function FixError({ message, plural = true }: { message: string; plural?: boolean }) {
  return (
    <p className="fix-error">
      {message}
      <span className="fix-error-after">
        The other option{plural ? "s stay" : " stays"} available — that's why the list always ends somewhere.
      </span>
    </p>
  );
}

function CommitAction({ option, busy, onRun }: { option: FixOption; busy: boolean; onRun: () => void }) {
  const a = option.action as Exclude<FixOption["action"], { kind: "manual" }>;

  if (a.kind === "github") {
    return (
      <a className="btn-filled" href={a.url} target="_blank" rel="noreferrer">
        {a.label} ↗
      </a>
    );
  }
  // Accepting uses the same button as fixing: it's a normal move on the record,
  // not a downgraded one.
  return (
    <button className="btn-filled" onClick={onRun} disabled={busy}>
      {busy ? "Working…" : a.label}
    </button>
  );
}

function ManualSteps({ action }: { action: Extract<FixOption["action"], { kind: "manual" }> }) {
  const [copied, setCopied] = useState(false);

  async function copy(e: React.MouseEvent) {
    e.stopPropagation(); // the row is a radio; copying must not re-select it
    if (!action.snippet) return;
    try {
      await navigator.clipboard.writeText(action.snippet.body);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked — the snippet is on screen to select by hand */
    }
  }

  return (
    <>
      <ol className="pick-steps">
        {action.steps.map((step, i) => (
          <li key={i}>{step}</li>
        ))}
      </ol>
      {action.snippet && (
        <figure className="snippet">
          <figcaption className="snippet-cap">
            <span>{action.snippet.filename}</span>
            <button type="button" className="snippet-copy" onClick={copy}>
              {copied ? "Copied ✓" : "Copy"}
            </button>
          </figcaption>
          <pre>{action.snippet.body}</pre>
        </figure>
      )}
    </>
  );
}

// The mode control, for when nothing is wrong.
//
// Fix paths only appear when there's a problem, so a HEALTHY shared repo with a
// single maintainer had no way to reach solo mode — they'd have to break
// something first. That's the gap this closes. It confirms before acting,
// because it changes a repository setting, and it says plainly what each mode
// means rather than assuming the words are self-explanatory.
export function ModeSwitch({ repo, mode, onChanged }: { repo: string; mode: RepoMode; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const next: RepoMode = mode === "solo" ? "shared" : "solo";

  async function switchTo() {
    setBusy(true);
    setError(null);
    try {
      await apiAction(`/api/repos/${repo}/mode`, { mode: next });
      setOpen(false);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't change the mode.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mode-switch">
      <button className="btn-plain" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        {open ? "Cancel" : "Change how this repo is worked on"}
      </button>
      {open && (
        <div className="mode-switch-panel">
          <p className="mode-switch-body">
            {next === "solo" ? (
              <>
                <strong>Solo mode</strong> — you push to the default branch directly, and CodeWorthy reviews each change
                after it lands. Force-pushes and branch deletion stay blocked. Choose this when you are the only person
                landing changes here.
              </>
            ) : (
              <>
                <strong>Shared mode</strong> — changes go through a pull request that CodeWorthy reviews before it can
                merge. Choose this as soon as a second person, or an agent, starts landing changes here.
              </>
            )}
          </p>
          <button className="btn-filled" onClick={switchTo} disabled={busy}>
            {busy ? "Working…" : `Switch to ${next} mode`}
          </button>
          {error && <p className="fix-error">{error}</p>}
        </div>
      )}
    </div>
  );
}
