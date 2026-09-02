// Ranked fix paths — what to do about an unhealthy repo, best option first.
//
// The dashboard used to state a problem and stop. Every unhealthy vital carried
// one sentence of advice that assumed CodeWorthy's preferred fix was available,
// and when it wasn't, the user was left with a red badge and no next move. That
// is the state people uninstall from.
//
// So each issue is a short path instead of a verdict. The recommendation is
// first and marked; every alternative says what it costs; and you can walk down
// the list saying "not an option for me" until you reach one you can actually
// take. The list always ends somewhere — the final option settles the issue by
// accepting it on the record — so a repo can always be brought back to a clean
// state even when the ideal fix is impossible for it.
import { useState } from "react";
import { apiAction, ApiError, type FixOption, type RepoIssue, type RepoMode } from "../../api";

const EFFORT_TONE: Record<FixOption["effort"], string> = {
  "one click": "fix-effort-fast",
  "a few minutes": "fix-effort-mid",
  "a decision to make": "fix-effort-slow",
};

export function FixPath({ issues, onChanged }: { issues: RepoIssue[]; onChanged: () => void }) {
  if (issues.length === 0) {
    return (
      <section className="fix-clear">
        <div className="fix-clear-mark" aria-hidden>✓</div>
        <div>
          <h3 className="fix-clear-title">Nothing needs a decision</h3>
          <p className="fix-clear-body">
            Every finding on this repository is either resolved or deliberately accepted. CodeWorthy keeps watching and
            keeps the record; there's nothing waiting on you.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="fix-path">
      <header className="fix-path-head">
        <h3 className="fix-path-title">
          {issues.length} thing{issues.length === 1 ? "" : "s"} to decide
        </h3>
        <p className="fix-path-sub">
          Worst first, and the fastest way out at the top of each. Work down until there's nothing left.
        </p>
      </header>
      {issues.map((issue) => (
        <IssueCard key={issue.id} issue={issue} onChanged={onChanged} />
      ))}
    </section>
  );
}

function IssueCard({ issue, onChanged }: { issue: RepoIssue; onChanged: () => void }) {
  const [index, setIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const option = issue.options[index];
  const exhausted = index >= issue.options.length;

  async function run(o: FixOption) {
    if (o.action.kind !== "codeworthy" && o.action.kind !== "accept") return;
    setBusy(true);
    setError(null);
    try {
      await apiAction(o.action.path, o.action.kind === "codeworthy" ? o.action.body : undefined);
      setDone(o.title);
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

  if (done) {
    return (
      <article className="fix-issue fix-issue-done">
        <div className="fix-done-mark" aria-hidden>✓</div>
        <div>
          <h4 className="fix-issue-title">{issue.title}</h4>
          <p className="fix-done-body">
            <strong>{done}</strong> — done, and in the record. This may take a moment to clear from the vitals above.
          </p>
        </div>
      </article>
    );
  }

  return (
    <article className={`fix-issue fix-sev-${issue.severity.replace(/\s/g, "-")}`}>
      <header className="fix-issue-head">
        <span className="fix-sev-dot" aria-hidden />
        <div>
          <h4 className="fix-issue-title">{issue.title}</h4>
          <p className="fix-issue-finding">{issue.finding}</p>
        </div>
      </header>

      <p className="fix-issue-consequence">{issue.consequence}</p>

      {issue.constraint && (
        // Saying "we can't" without "because" reads as the tool being broken.
        <p className="fix-issue-constraint">
          <span className="fix-constraint-label">Why CodeWorthy can't just do this</span>
          {issue.constraint}
        </p>
      )}

      {exhausted ? (
        <div className="fix-exhausted">
          <p>
            That's every option CodeWorthy has for this one. Nothing here is a fit — which is worth knowing in itself.
          </p>
          <button className="fix-btn fix-btn-ghost" onClick={() => setIndex(0)}>
            Start again from the top
          </button>
        </div>
      ) : (
        option && (
          <>
            <div className="fix-option-meta">
              <span className="fix-option-count">
                Option {index + 1} of {issue.options.length}
              </span>
              {index === 0 && <span className="fix-recommended">Recommended</span>}
              <span className={`fix-effort ${EFFORT_TONE[option.effort]}`}>{option.effort}</span>
            </div>

            <div className="fix-option">
              <h5 className="fix-option-title">{option.title}</h5>
              <p className="fix-option-detail">{option.detail}</p>
              {option.tradeoff && (
                <p className="fix-option-tradeoff">
                  <span className="fix-tradeoff-label">The trade-off</span>
                  {option.tradeoff}
                </p>
              )}
              <OptionAction option={option} busy={busy} onRun={() => run(option)} />
              {error && <p className="fix-error">{error}</p>}
            </div>

            {index < issue.options.length - 1 && (
              <button className="fix-next" onClick={() => { setError(null); setIndex((i) => i + 1); }}>
                Not an option for me — show the next one →
              </button>
            )}
          </>
        )
      )}
    </article>
  );
}

function OptionAction({ option, busy, onRun }: { option: FixOption; busy: boolean; onRun: () => void }) {
  const a = option.action;

  if (a.kind === "github") {
    return (
      <a className="fix-btn fix-btn-primary" href={a.url} target="_blank" rel="noreferrer">
        {a.label} ↗
      </a>
    );
  }

  if (a.kind === "manual") {
    return <ManualSteps action={a} />;
  }

  return (
    <button
      className={`fix-btn ${a.kind === "accept" ? "fix-btn-quiet" : "fix-btn-primary"}`}
      onClick={onRun}
      disabled={busy}
    >
      {busy ? "Working…" : a.label}
    </button>
  );
}

function ManualSteps({ action }: { action: Extract<FixOption["action"], { kind: "manual" }> }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  async function copy() {
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
    <div className="fix-manual">
      <button className="fix-btn fix-btn-primary" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        {open ? "Hide the steps" : action.label}
      </button>
      {open && (
        <div className="fix-steps">
          <ol>
            {action.steps.map((step, i) => (
              <li key={i}>{step}</li>
            ))}
          </ol>
          {action.snippet && (
            <figure className="fix-snippet">
              <figcaption>
                <code>{action.snippet.filename}</code>
                <button className="fix-copy" onClick={copy}>
                  {copied ? "Copied ✓" : "Copy"}
                </button>
              </figcaption>
              <pre>{action.snippet.body}</pre>
            </figure>
          )}
        </div>
      )}
    </div>
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
      <button className="mode-switch-open" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
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
          <button className="fix-btn fix-btn-primary" onClick={switchTo} disabled={busy}>
            {busy ? "Working…" : `Switch to ${next} mode`}
          </button>
          {error && <p className="fix-error">{error}</p>}
        </div>
      )}
    </div>
  );
}
