// The micro-defense (M3) — a PRESENCE check, never an auto-graded judgment.
//
// Policy row (Ownership · root-cause · AI collaboration): before merging
// anything non-trivial, the human answers one question in their own words. This
// keeps them owning the change instead of merging blind. CodeWorthy checks only
// that they ANSWERED — the quality of the answer is never machine-scored, on
// purpose: auto-judging it would turn a moment of ownership into a hoop, and
// (per the assessment doctrine) we never collapse a human's understanding into a
// pass/fail number a model decided.
import { MICRO_DEFENSE_QUESTION } from "./prompt.js";

export { MICRO_DEFENSE_QUESTION };

// A hidden marker in the posted comment lets us recognize our own question
// later without re-parsing prose.
export const MICRO_DEFENSE_MARKER = "<!-- codeworthy-micro-defense -->";

export interface CommentLike {
  author: string | null;
  body: string;
}

export interface MicroDefenseStatus {
  answered: boolean;
  answer: string | null; // the author's words, kept verbatim — shown, never scored
}

// Green when the PR author has replied after the question was posted. Any
// non-empty reply from the author counts — we surface their words, we do not
// grade them.
export function microDefenseStatus(prAuthor: string | null, comments: CommentLike[]): MicroDefenseStatus {
  const askedIdx = comments.findIndex((c) => c.body.includes(MICRO_DEFENSE_MARKER));
  if (askedIdx === -1) return { answered: false, answer: null };
  for (let i = askedIdx + 1; i < comments.length; i++) {
    const c = comments[i]!;
    const isAuthor = prAuthor != null && c.author === prAuthor;
    // Don't count our own posted comment as an answer.
    if (isAuthor && !c.body.includes(MICRO_DEFENSE_MARKER) && c.body.trim().length > 0) {
      return { answered: true, answer: c.body.trim() };
    }
  }
  return { answered: false, answer: null };
}
