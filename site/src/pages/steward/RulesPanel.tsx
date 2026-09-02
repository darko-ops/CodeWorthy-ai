// The rules page: what has to be true for a change to land in this repo.
//
// Everything here used to live in a `.steward.yml` that nothing could load —
// the parser existed and the gate consumed it, but the client has no
// contents-read capability by design, so the file was unfetchable and every
// repo ran on defaults. Setting the rules here instead means they take effect,
// and it puts who changed a rule, when, and to what into the append-only record
// rather than a commit someone can rewrite.
//
// Two things this page is careful about:
//
//   1. It shows what CodeWorthy will NOT change, and why. Force-pushes and
//      branch deletion stay blocked in every mode, because they destroy the
//      history the record is made of. Pretending they're adjustable here would
//      be a lie; hiding them would be worse.
//   2. It never offers a setting that cannot take effect. Requiring an
//      approving review is disabled — with the reason — when no approver is
//      installed, because a required approval nobody can give is a repository
//      nothing can merge.
import { useEffect, useState } from "react";
import { apiGet, apiAction, ApiError, type GateLevel, type RepoMode, type RepoRules, type RulesResponse, type RulesSaved } from "../../api";

const LEVELS: Array<{ value: GateLevel; label: string; hint: string }> = [
  { value: "gate", label: "Block the merge", hint: "Nothing lands until it's fixed or waived with a reason." },
  { value: "advise", label: "Comment only", hint: "CodeWorthy says so on the pull request; you decide." },
  { value: "off", label: "Don't check", hint: "Not looked for at all." },
];

const GATES: Array<{ key: keyof RepoRules["gates"]; title: string; detail: string }> = [
  {
    key: "secrets",
    title: "A secret in the diff",
    detail: "API keys, tokens, private keys, a committed .env. A secret is leaked the moment it's pushed, whether or not you remove it later — this is the one worth keeping strict.",
  },
  {
    key: "destructiveMigration",
    title: "A migration that drops data",
    detail: "DROP TABLE or DROP COLUMN. Permanent, and usually noticed after the fact.",
  },
  {
    key: "committedDependencies",
    title: "Dependencies committed to the repo",
    detail: "node_modules and friends. Bloats history and is awkward to undo later.",
  },
];

export function RulesPanel({ repo, onClose, onChanged }: { repo: string; onClose: () => void; onChanged: () => void }) {
  const [state, setState] = useState<RulesResponse | null>(null);
  const [draft, setDraft] = useState<RepoRules | null>(null);
  const [mode, setMode] = useState<RepoMode>("shared");
  const [pathsText, setPathsText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string[] | null>(null);

  useEffect(() => {
    let live = true;
    apiGet<RulesResponse>(`/api/repos/${repo}/rules`)
      .then((r) => {
        if (!live) return;
        setState(r);
        setDraft(r.rules);
        setMode(r.mode);
        setPathsText(r.rules.protectedPaths.join("\n"));
      })
      .catch((err) => live && setError(err instanceof ApiError ? err.message : "Couldn't load the rules."));
    return () => { live = false; };
  }, [repo]);

  async function save() {
    if (!draft) return;
    setBusy(true);
    setError(null);
    setSaved(null);
    try {
      const res = await apiAction<RulesSaved>(`/api/repos/${repo}/rules`, {
        mode,
        rules: { ...draft, protectedPaths: pathsText.split("\n").map((p) => p.trim()).filter(Boolean) },
      });
      setDraft(res.rules);
      setMode(res.mode);
      setSaved(res.changes);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't save the rules.");
    } finally {
      setBusy(false);
    }
  }

  if (error && !draft) return <div className="rules-panel"><p className="fix-error">{error}</p></div>;
  if (!draft || !state) return <div className="rules-panel"><p className="hint">Loading the rules…</p></div>;

  const shared = mode === "shared";

  return (
    <section className="rules-panel">
      <header className="rules-head">
        <div>
          <h3 className="rules-title">Rules for {repo}</h3>
          <p className="rules-sub">What has to be true before a change lands. Saved to the change record, with who changed it.</p>
        </div>
        <button className="fix-btn fix-btn-ghost" onClick={onClose}>Close</button>
      </header>

      <div className="rules-group">
        <h4 className="rules-group-title">How this repo is worked on</h4>
        <div className="rules-modes">
          {(["shared", "solo"] as RepoMode[]).map((m) => (
            <label key={m} className={`rules-mode ${mode === m ? "is-on" : ""}`}>
              <input type="radio" name="mode" checked={mode === m} onChange={() => setMode(m)} />
              <span className="rules-mode-name">{m === "solo" ? "Solo" : "Shared"}</span>
              <span className="rules-mode-detail">
                {m === "solo"
                  ? "You push to the default branch directly. CodeWorthy reviews each change after it lands."
                  : "Changes go through a pull request that CodeWorthy reviews before it can merge."}
              </span>
            </label>
          ))}
        </div>
      </div>

      <div className="rules-group">
        <h4 className="rules-group-title">What blocks a merge</h4>
        {GATES.map((g) => (
          <div key={g.key} className="rules-gate">
            <div className="rules-gate-text">
              <div className="rules-gate-title">{g.title}</div>
              <div className="rules-gate-detail">{g.detail}</div>
            </div>
            <div className="rules-levels">
              {LEVELS.map((l) => (
                <button
                  key={l.value}
                  title={l.hint}
                  className={`rules-level ${draft.gates[g.key] === l.value ? "is-on" : ""} ${l.value === "off" ? "is-off" : ""}`}
                  onClick={() => setDraft({ ...draft, gates: { ...draft.gates, [g.key]: l.value } })}
                >
                  {l.label}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="rules-group">
        <h4 className="rules-group-title">Before a pull request can merge</h4>
        {!shared && <p className="rules-note">These apply in shared mode. This repo is in solo mode, so there's no pull request to gate.</p>}
        <Toggle
          on={draft.requireCodeworthyCheck}
          disabled={!shared}
          label="CodeWorthy's review has to pass"
          detail="Turn this off and the review still runs and still comments — it just stops blocking."
          onChange={(v) => setDraft({ ...draft, requireCodeworthyCheck: v })}
        />
        <Toggle
          on={draft.requireApproval && state.approverAvailable}
          disabled={!shared || !state.approverAvailable}
          label="An approving review is required"
          detail={
            state.approverAvailable
              ? "The CodeWorthy approver — a separate app from the reviewer — approves once the blocking findings are dealt with, and refuses while they aren't."
              : "Unavailable: no approver is installed on this repository. Requiring an approval nobody can give would leave nothing able to merge."
          }
          onChange={(v) => setDraft({ ...draft, requireApproval: v })}
        />
        <Toggle
          on={draft.requireConversationResolution}
          disabled={!shared}
          label="Review comments have to be resolved"
          detail="An open comment thread keeps the merge button off."
          onChange={(v) => setDraft({ ...draft, requireConversationResolution: v })}
        />
      </div>

      <div className="rules-group">
        <h4 className="rules-group-title">Protected paths</h4>
        <p className="rules-note">One per line. A change touching these needs a deliberate decision — CodeWorthy blocks it until someone waives it with a reason.</p>
        <textarea
          className="rules-paths"
          rows={4}
          value={pathsText}
          spellCheck={false}
          placeholder={"db/migrations\nsrc/billing"}
          onChange={(e) => setPathsText(e.target.value)}
        />
      </div>

      <div className="rules-group rules-fixed">
        <h4 className="rules-group-title">Always on</h4>
        <p className="rules-note">
          Force-pushes and branch deletion stay blocked in both modes, and CodeWorthy won't turn them off. They destroy the
          history the change record is built on — everything else here is a trade-off you can make; those two aren't.
          You can still turn them off in GitHub, and CodeWorthy will record it as an exception and put them back.
        </p>
      </div>

      <div className="rules-actions">
        <button className="fix-btn fix-btn-primary" onClick={save} disabled={busy}>
          {busy ? "Saving…" : "Save rules"}
        </button>
        {error && <p className="fix-error">{error}</p>}
        {saved && (
          <div className="rules-saved">
            {saved.length === 0 ? (
              <p>Saved — nothing changed.</p>
            ) : (
              <>
                <p>Saved, and recorded:</p>
                <ul>{saved.map((c, i) => <li key={i}>{c}</li>)}</ul>
              </>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function Toggle({ on, disabled, label, detail, onChange }: {
  on: boolean; disabled?: boolean; label: string; detail: string; onChange: (v: boolean) => void;
}) {
  return (
    <label className={`rules-toggle ${disabled ? "is-disabled" : ""}`}>
      <input type="checkbox" checked={on} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span>
        <span className="rules-toggle-label">{label}</span>
        <span className="rules-toggle-detail">{detail}</span>
      </span>
    </label>
  );
}
