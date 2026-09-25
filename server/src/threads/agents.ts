// Who is talking — and which of them is a coding agent.
//
// The thread view is a group message between three kinds of participant: you,
// the agents that write your code, and CodeWorthy. Rendering that honestly
// means naming the agent rather than printing whatever login it happened to
// push under. Claude Code commits under the human's own login with a trailer;
// Cursor's background agent pushes as `cursoragent`; Codex arrives as an app.
// Nothing about the raw login tells you which, so the identification happens
// here, in one place, from evidence: the login, and the text the actor wrote.
//
// It is deliberately conservative. A signal has to be something the tool itself
// writes (its bot login, or the trailer it stamps on every commit) — never a
// guess from prose, because labelling a human's commit "Claude Code" in a record
// that is meant to be evidence is worse than saying nothing.

export type AgentId = "claude-code" | "cursor" | "codex" | "copilot" | "devin" | "agent";

export interface AgentSignature {
  id: AgentId;
  label: string;
  /** Matched against a bot/app login, lowercased. */
  logins: RegExp;
  /** Matched against commit messages and PR bodies — the trailers tools stamp. */
  trailer: RegExp;
}

// Order matters only for readability; the matchers are mutually exclusive in
// practice, and the first hit wins.
export const AGENTS: AgentSignature[] = [
  {
    id: "claude-code",
    label: "Claude Code",
    logins: /^(claude|claude-code|claude-bot|anthropic)(\[bot\])?$/,
    // The two things Claude Code writes itself: the co-author trailer and the
    // generated-with footer.
    trailer: /co-authored-by:\s*claude|noreply@anthropic\.com|generated with \[?claude code/i,
  },
  {
    id: "cursor",
    label: "Cursor",
    logins: /^(cursor|cursoragent|cursor-agent|cursorai)(\[bot\])?$/,
    trailer: /co-authored-by:\s*cursor|generated (with|by) cursor|cursor\.com\/agents/i,
  },
  {
    id: "codex",
    label: "ChatGPT (Codex)",
    logins: /^(chatgpt|chatgpt-codex-connector|codex|openai)(\[bot\])?$/,
    trailer: /co-authored-by:\s*(chatgpt|codex|openai)|chatgpt\.com\/codex|generated (with|by) codex/i,
  },
  {
    id: "copilot",
    label: "GitHub Copilot",
    logins: /^(copilot|copilot-swe-agent|github-copilot)(\[bot\])?$/,
    trailer: /co-authored-by:\s*copilot|github\.com\/copilot\/|generated (with|by) copilot/i,
  },
  {
    id: "devin",
    label: "Devin",
    logins: /^(devin|devin-ai-integration)(\[bot\])?$/,
    trailer: /co-authored-by:\s*devin|app\.devin\.ai/i,
  },
];

/** CodeWorthy's own logins — the reviewer App and the separate approver App. */
const CODEWORTHY_LOGIN = /^codeworthy(-steward|-approver)?(\[bot\])?$/i;
/** The HTML markers CodeWorthy stamps on everything it posts. */
const CODEWORTHY_MARKER = /<!--\s*codeworthy-(gate|ai-review|approver|micro-defense)\s*-->/i;

export type ParticipantKind = "you" | "human" | "agent" | "codeworthy";

export interface Participant {
  /** GitHub login, or "codeworthy" for the App. */
  login: string;
  /** What the thread shows: "Claude Code", "CodeWorthy", "@darko". */
  label: string;
  kind: ParticipantKind;
  /** Set when kind is "agent" — which tool it is. */
  agent: AgentId | null;
  avatar: string | null;
}

export interface IdentifyInput {
  login: string | null;
  /** GitHub's own type field ("Bot" / "User"), when we have it. */
  type?: string | null;
  avatar?: string | null;
  /** Commit message, comment body, or PR body — whatever this actor wrote. */
  text?: string | null;
  /** The signed-in viewer, so their own messages read as "You". */
  viewer?: string | null;
}

/** Which agent wrote this text, by the trailer the tool stamps on it. */
export function agentFromText(text: string | null | undefined): AgentSignature | null {
  if (!text) return null;
  for (const a of AGENTS) if (a.trailer.test(text)) return a;
  return null;
}

/** Which agent this login belongs to, when the agent pushes under its own bot. */
export function agentFromLogin(login: string | null | undefined): AgentSignature | null {
  if (!login) return null;
  const l = login.toLowerCase();
  for (const a of AGENTS) if (a.logins.test(l)) return a;
  return null;
}

export function isCodeworthy(login: string | null | undefined, text?: string | null): boolean {
  if (login && CODEWORTHY_LOGIN.test(login)) return true;
  return Boolean(text && CODEWORTHY_MARKER.test(text));
}

/**
 * Name one participant.
 *
 * The order of the checks is the order of confidence: CodeWorthy's own marker
 * or login is certain; a dedicated agent bot login is certain; a trailer in the
 * text the actor wrote is the tool's own stamp. Everything else is a person —
 * including a person whose editor happens to be an AI one, because nothing in
 * the record proves that and we do not print claims we cannot support.
 */
export function identify(input: IdentifyInput): Participant {
  const login = input.login ?? "unknown";
  const avatar = input.avatar ?? null;

  if (isCodeworthy(input.login, input.text)) {
    return { login: login === "unknown" ? "codeworthy" : login, label: "CodeWorthy", kind: "codeworthy", agent: null, avatar };
  }

  const byLogin = agentFromLogin(input.login);
  if (byLogin) return { login, label: byLogin.label, kind: "agent", agent: byLogin.id, avatar };

  const byText = agentFromText(input.text);
  if (byText) {
    // The human's login still owns the commit — the agent is how it was
    // written. Saying both is the honest rendering: "Claude Code · @darko".
    return { login, label: byText.label, kind: "agent", agent: byText.id, avatar };
  }

  // A bot we don't recognise is still not a person.
  if (input.type === "Bot" || /\[bot\]$/i.test(login)) {
    return { login, label: login.replace(/\[bot\]$/i, ""), kind: "agent", agent: "agent", avatar };
  }

  const you = Boolean(input.viewer && login.toLowerCase() === input.viewer.toLowerCase());
  return { login, label: you ? "You" : `@${login}`, kind: you ? "you" : "human", agent: null, avatar };
}

/** Strip the HTML markers and footers from a body before it is shown as a message. */
export function cleanBody(body: string | null | undefined): string {
  if (!body) return "";
  return body
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\r\n/g, "\n")
    .trim();
}
