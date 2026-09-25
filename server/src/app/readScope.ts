// Who may read a repository's record, and which repositories that is.
//
// These pages (changelog, digest, health) were the product's one unauthenticated
// read surface, and the leak was structural rather than a missed check: the
// repository was named by a QUERY PARAMETER, so naming someone else's was the
// same request as naming your own, and naming none returned every repository in
// the database. A control that reads its own scope out of untrusted input is
// not a control.
//
// So scope is RESOLVED here, once, from something the caller had to be given:
//
//   1. a share token (?t=) — a capability for exactly one repo, and the repo is
//      read out of the token, never out of ?repo= beside it; or
//   2. a dashboard session — scoped to the repos that session can actually see
//      through its CodeWorthy installations.
//
// Nothing else resolves. There is deliberately no "no scope" answer: the
// portfolio-wide form is the signed-in user's own estate, never the estate.
import type { FastifyReply, FastifyRequest } from "fastify";
import type { Pool } from "pg";
import type { OverviewRepoInput } from "../health/overview.js";
import { listInstallations, listRepositories, userCanAccessRepo } from "./oauth.js";
import { getSession, type UserSession } from "./session.js";
import { shareTokenRepo } from "./shareToken.js";

/** One repository (a share link, or a named repo the session can see). */
export type ReadScope =
  | { kind: "repo"; repo: string; via: "share" | "session" }
  | { kind: "repos"; repos: string[]; via: "session" };

/** Every repo this user can see through their installations. */
export async function accessibleRepos(token: string): Promise<OverviewRepoInput[]> {
  const insts = await listInstallations(token);
  const out: OverviewRepoInput[] = [];
  for (const inst of insts) {
    const rs = await listRepositories(token, inst.id);
    for (const r of rs) {
      out.push({ full_name: r.full_name, private: r.private, default_branch: r.default_branch });
    }
  }
  return out;
}

/** The bearer session on this request, or null. Does not reply. */
export async function sessionFrom(pool: Pool, req: FastifyRequest): Promise<UserSession | null> {
  const header = req.headers.authorization ?? "";
  return getSession(pool, header.startsWith("Bearer ") ? header.slice(7) : "");
}

/**
 * Resolve what this request may read, or reply and return null.
 *
 * `?t=` wins when present: a share link is a deliberate grant, and checking it
 * first means a forwarded link keeps working for someone who also happens to be
 * signed in to their own unrelated account.
 */
export async function resolveReadScope(
  pool: Pool,
  req: FastifyRequest,
  reply: FastifyReply
): Promise<ReadScope | null> {
  const q = req.query as { repo?: string; t?: string };

  if (q.t) {
    const repo = shareTokenRepo(q.t);
    if (!repo) {
      reply.code(403).send({
        error: "bad_share_link",
        message: "This share link isn't valid any more. Ask whoever sent it for a fresh one.",
      });
      return null;
    }
    return { kind: "repo", repo, via: "share" };
  }

  const session = await sessionFrom(pool, req);
  if (!session) {
    reply.code(401).send({
      error: "unauthenticated",
      message: "Sign in, or open this with the share link from the dashboard.",
    });
    return null;
  }

  if (q.repo) {
    if (!(await userCanAccessRepo(session.token, q.repo))) {
      reply.code(403).send({ error: "no_access", message: "No access to that repository." });
      return null;
    }
    return { kind: "repo", repo: q.repo, via: "session" };
  }

  // No repo named: the caller's OWN estate, resolved from their installations.
  // An empty list is a real answer (a signed-in user with nothing installed)
  // and must stay empty — the readers below treat [] as "no rows", never as
  // "no filter", which is the distinction the whole leak turned on.
  return { kind: "repos", repos: (await accessibleRepos(session.token)).map((r) => r.full_name), via: "session" };
}

/** The filter a scope means to the audit-log readers. */
export function scopeFilter(scope: ReadScope): { repo?: string; repos?: string[] } {
  return scope.kind === "repo" ? { repo: scope.repo } : { repos: scope.repos };
}

/**
 * The same resolution, for the pages that need exactly one repository.
 *
 * The health page's portfolio form is not scoped down to a repo list — it reads
 * every vital across whatever it is given — and the signed-in equivalent
 * already exists, properly scoped, at /api/me/overview. So rather than build a
 * second portfolio reader here, this asks for a repo and says so.
 */
export async function resolveRepoScope(
  pool: Pool,
  req: FastifyRequest,
  reply: FastifyReply
): Promise<string | null> {
  const scope = await resolveReadScope(pool, req, reply);
  if (!scope) return null;
  if (scope.kind === "repos") {
    reply.code(400).send({
      error: "repo_required",
      message: "Name a repository: ?repo=owner/name. The whole-estate view is on your dashboard.",
    });
    return null;
  }
  return scope.repo;
}

/** A bounded integer query parameter. Junk reads as the default, never NaN. */
export function intParam(raw: string | undefined, fallback: number, min: number, max: number): number {
  const n = parseInt(raw ?? "", 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}
