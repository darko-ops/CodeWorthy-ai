// What the thread view claims, checked.
//
// Two things matter enough to pin down: that an agent is named from evidence
// the tool itself wrote (never from a guess), and that "needs you" fires for
// exactly the situations a human actually has to act on — because it is the
// only alarm on that screen, and an alarm that cries wolf is worse than none.
import { describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { FakeGitHub } from "../testing/fakeGitHub.js";
import type { BranchRef } from "../github/client.js";
import { agentFromLogin, agentFromText, cleanBody, identify } from "./agents.js";
import {
  actionsFor,
  archivedKey,
  branchKey,
  isFlagged,
  listThreads,
  needsYouFor,
  parseThreadKey,
  toneFor,
  withinWindow,
} from "./threads.js";

describe("naming who is talking", () => {
  it("names Claude Code from the trailer it stamps, under a human login", () => {
    const p = identify({
      login: "darko",
      text: "fix the retry path\n\nCo-Authored-By: Claude <noreply@anthropic.com>",
      viewer: "darko",
    });
    expect(p.kind).toBe("agent");
    expect(p.agent).toBe("claude-code");
    expect(p.label).toBe("Claude Code");
    // The human's login still owns the commit — the UI shows both.
    expect(p.login).toBe("darko");
  });

  it("names Cursor and Codex from their own bot logins", () => {
    expect(agentFromLogin("cursoragent")?.id).toBe("cursor");
    expect(agentFromLogin("chatgpt-codex-connector[bot]")?.id).toBe("codex");
    expect(agentFromLogin("copilot-swe-agent[bot]")?.id).toBe("copilot");
  });

  it("does NOT guess from prose", () => {
    // Someone writing "I used Claude to figure this out" is a human saying so,
    // not evidence that an agent authored the change. Labelling it otherwise
    // would put a claim in the record that nothing supports.
    expect(agentFromText("I used Claude to figure this out")).toBeNull();
    const p = identify({ login: "darko", text: "asked ChatGPT about this one", viewer: "sam" });
    expect(p.kind).toBe("human");
    expect(p.label).toBe("@darko");
  });

  it("knows CodeWorthy by its marker even when the login is missing", () => {
    const p = identify({ login: null, text: "<!-- codeworthy-gate -->\nBlocked: a secret in the diff." });
    expect(p.kind).toBe("codeworthy");
    expect(p.label).toBe("CodeWorthy");
  });

  it("reads the viewer's own messages as You", () => {
    expect(identify({ login: "darko", viewer: "DARKO" }).kind).toBe("you");
    expect(identify({ login: "darko", viewer: "sam" }).label).toBe("@darko");
  });

  it("treats an unknown bot as an agent, not a person", () => {
    const p = identify({ login: "renovate[bot]", type: "Bot" });
    expect(p.kind).toBe("agent");
    expect(p.label).toBe("renovate");
  });

  it("strips the HTML markers before showing a body", () => {
    expect(cleanBody("<!-- codeworthy-gate -->\n\nFound one thing.\n")).toBe("Found one thing.");
  });
});

describe("when a thread wants the human", () => {
  const open = { state: "open" as const };

  it("fires when CodeWorthy is blocking", () => {
    const n = needsYouFor({ ...open, gate: "blocked", flagged: 0 });
    expect(n?.reason).toBe("Blocked");
    expect(n?.tone).toBe("risk");
  });

  it("fires when the change is finished and only the merge is missing", () => {
    const n = needsYouFor({ ...open, gate: "passed", flagged: 0 });
    expect(n?.reason).toBe("Ready for you");
    expect(n?.tone).toBe("ok");
  });

  it("stays quiet on a branch an agent is still working on", () => {
    // The whole point of showing a pre-PR branch is to watch work happen. If
    // every push raised a flag the alarm would mean nothing by lunchtime.
    expect(needsYouFor({ state: "working", gate: "none", flagged: 0 })).toBeNull();
  });

  it("still speaks up on a working branch that went wrong", () => {
    expect(needsYouFor({ state: "working", gate: "none", flagged: 1 })?.tone).toBe("risk");
  });

  it("stays quiet on a draft nothing has gone wrong on", () => {
    expect(needsYouFor({ state: "draft", gate: "passed", flagged: 0 })).toBeNull();
  });

  it("stays quiet on an ordinary merged branch, and on a calm default branch", () => {
    expect(needsYouFor({ state: "merged", gate: "passed", flagged: 0 })).toBeNull();
    expect(needsYouFor({ state: "default", gate: "none", flagged: 0 })).toBeNull();
  });

  it("speaks up on a merged branch that carried an exception", () => {
    const n = needsYouFor({ state: "merged", gate: "passed", flagged: 2 });
    expect(n?.tone).toBe("risk");
    expect(n?.detail).toContain("2 things");
  });

  it("says unreviewed rather than ready when the gate couldn't run", () => {
    expect(needsYouFor({ ...open, gate: "unavailable", flagged: 0 })?.reason).toBe("Unreviewed");
  });
});

describe("which threads the window keeps", () => {
  const now = Date.parse("2026-09-12T12:00:00Z");
  const daysAgo = (n: number) => new Date(now - n * 86_400_000).toISOString();

  it("never hides an outstanding request, however old", () => {
    // An open pull request that has gone quiet for eight weeks is exactly the
    // thing you want to see. Ageing it out would be worse than the noise.
    for (const state of ["open", "draft", "default"] as const) {
      expect(withinWindow(state, daysAgo(400), 7, now), state).toBe(true);
    }
  });

  it("ages out a branch nobody has pushed to", () => {
    // A branch with no pull request that has not moved is abandoned, not in
    // progress. Agent-driven repos accumulate these fast — showing all of them
    // is the noise problem this list exists to avoid.
    expect(withinWindow("working", daysAgo(2), 7, now)).toBe(true);
    expect(withinWindow("working", daysAgo(60), 7, now)).toBe(false);
    expect(withinWindow("working", daysAgo(60), 90, now)).toBe(true);
  });

  it("drops finished work outside the window", () => {
    expect(withinWindow("merged", daysAgo(3), 7, now)).toBe(true);
    expect(withinWindow("merged", daysAgo(30), 7, now)).toBe(false);
    expect(withinWindow("merged", daysAgo(30), 90, now)).toBe(true);
    expect(withinWindow("closed", daysAgo(120), 90, now)).toBe(false);
  });

  it("drops finished work with no date rather than guessing", () => {
    expect(withinWindow("merged", null, 90, now)).toBe(false);
  });
});

describe("thread keys", () => {
  it("round-trips a branch name containing slashes", () => {
    // The reason keys live in the query string: this is the branch name every
    // agent actually generates.
    const key = branchKey("feat/idempotent-checkout");
    expect(parseThreadKey(key)).toEqual({ kind: "branch", branch: "feat/idempotent-checkout" });
  });

  it("round-trips an archived pull request", () => {
    expect(parseThreadKey(archivedKey(42))).toEqual({ kind: "archived", number: 42 });
  });

  it("refuses anything else rather than defaulting to a thread", () => {
    for (const bad of ["", "b:", "pr:", "pr:0", "pr:abc", "nonsense"]) {
      expect(parseThreadKey(bad), bad).toBeNull();
    }
  });
});

describe("what the human may do from the thread", () => {
  const pr = {
    number: 1, title: "t", body: null, state: "open",
    created_at: "", updated_at: "", html_url: "", base: { ref: "main" },
  };
  const ctx = { branch: "feat/x", branchGone: false, viewer: "darko", canPush: true, youApproved: false, authorIsViewer: false };

  it("offers a merge only when GitHub would actually allow it", () => {
    const a = actionsFor({ ...ctx, pr: { ...pr, mergeable: true, mergeable_state: "clean" } as never, state: "open" });
    expect(a.canMerge).toBe(true);
    expect(a.mergeBlocked).toBeNull();
  });

  it("explains a blocked merge as the rule working, not as a failure", () => {
    const a = actionsFor({ ...ctx, pr: { ...pr, mergeable: true, mergeable_state: "blocked" } as never, state: "open" });
    expect(a.canMerge).toBe(false);
    expect(a.mergeBlocked).toContain("the rule doing its job");
  });

  it("never offers a merge without write access", () => {
    const a = actionsFor({ ...ctx, canPush: false, pr: { ...pr, mergeable: true, mergeable_state: "clean" } as never, state: "open" });
    expect(a.canMerge).toBe(false);
    expect(a.mergeBlocked).toContain("write access");
  });

  it("refuses self-approval the way GitHub does, and says so", () => {
    const a = actionsFor({ ...ctx, authorIsViewer: true, pr: pr as never, state: "open" });
    expect(a.canApprove).toBe(false);
    expect(a.approveBlocked).toContain("your own");
  });

  it("tells a pre-PR branch where the conversation will happen", () => {
    const a = actionsFor({ ...ctx, pr: undefined, state: "working" });
    expect(a.canReply).toBe(false);
    expect(a.replyBlocked).toContain("feat/x");
    expect(a.replyBlocked).toContain("Open one");
  });

  it("says the default branch is read-only, and why", () => {
    const a = actionsFor({ ...ctx, pr: undefined, branch: "main", state: "default" });
    expect(a.replyBlocked).toContain("default branch");
  });

  it("says a merged branch is gone rather than pretending it could merge", () => {
    const a = actionsFor({ ...ctx, branchGone: true, pr: pr as never, state: "merged" });
    expect(a.mergeBlocked).toContain("branch is gone");
  });

  it("gives every refusal a reason", () => {
    const a = actionsFor({ ...ctx, pr: pr as never, state: "merged" });
    for (const [can, why] of [[a.canMerge, a.mergeBlocked], [a.canApprove, a.approveBlocked], [a.canReply, a.replyBlocked]]) {
      if (!can) expect(why, "a disabled action must say why").toBeTruthy();
    }
  });
});

describe("reading the spine", () => {
  it("counts every exception as flagged", () => {
    expect(isFlagged("exception.force_push")).toBe(true);
    expect(isFlagged("push.direct_to_default")).toBe(true);
    expect(isFlagged("gate.evaluated")).toBe(false);
  });

  it("colours a blocked secret as the control working, not as a leak", () => {
    expect(toneFor("protection.restored")).toBe("ok");
    expect(toneFor("exception.protection_weakened")).toBe("risk");
  });
});

describe("building the list", () => {
  // The spine is the only thing listThreads needs a database for, and these
  // cases are about which BRANCHES become threads — so an empty log is the
  // honest fixture, not a shortcut.
  const emptySpine = { query: async () => ({ rows: [] }) } as unknown as Pool;
  const day = 86_400_000;
  const ago = (d: number) => new Date(Date.now() - d * day).toISOString();

  function ref(name: string, days: number, extra: Partial<BranchRef> = {}): BranchRef {
    return {
      name,
      isDefault: name === "main",
      headSha: "a".repeat(40),
      committedAt: ago(days),
      headline: `work on ${name}`,
      message: `work on ${name}`,
      authorLogin: "darko",
      authorName: "darko",
      authorAvatar: null,
      ...extra,
    };
  }

  class Repo extends FakeGitHub {
    constructor(refs: BranchRef[], pulls: unknown[] = []) {
      super();
      this.branchRefs = refs;
      this.pulls = pulls;
    }
    pulls: unknown[];
    override listPullRequests(...a: any[]): Promise<unknown> {
      return this.rec("listPullRequests", a, this.pulls);
    }
  }

  const openPull = (number: number, head: string) => ({
    number, title: `PR ${number}`, body: null, state: "open",
    created_at: ago(4), updated_at: ago(3), html_url: "u",
    head: { ref: head, sha: "d".repeat(40) }, base: { ref: "main" },
    user: { login: "sam" },
  });

  /** A stand-in audit spine — the shape spineFor's query returns. */
  const spineWith = (rows: Array<Record<string, unknown>>) =>
    ({
      query: async () => ({
        rows: rows.map((r, i) => ({
          id: String(i + 1),
          ts: r.ts ?? ago(1),
          actor: r.actor ?? "codeworthy-steward",
          event_type: r.event_type,
          plain_english: r.plain_english ?? "something happened",
          payload: r.payload ?? {},
          number: r.number ?? null,
        })),
      }),
    }) as unknown as Pool;

  const list = (client: FakeGitHub, sinceDays = 30) =>
    listThreads(client, emptySpine, { repo: "acme/orders", sinceDays, viewer: "darko" });

  it("keeps CodeWorthy's own bookmarks out of the conversation", async () => {
    // The repo this was built in had sixteen of these — one per direct push to
    // main — against six branches anyone had actually worked on. Nobody talks
    // on a steward/edit branch; it is a marker pointing at a commit.
    const client = new Repo([
      ref("main", 1),
      ref("feat/checkout", 1),
      ...Array.from({ length: 16 }, (_, i) => ref(`steward/edit-${i}`, 1)),
    ]);
    const threads = await list(client);
    expect(threads.map((t) => t.branch)).toEqual(["main", "feat/checkout"]);
  });

  it("ages out branches nobody has pushed to, and keeps the live ones", async () => {
    const client = new Repo([
      ref("main", 40),
      ref("feat/live", 2),
      ref("feat/abandoned", 60),
    ]);
    const threads = await list(client, 30);
    // The default branch is the trunk and never ages out; the stale feature
    // branch does.
    expect(threads.map((t) => t.branch).sort()).toEqual(["feat/live", "main"]);
  });

  it("calls a branch with no pull request what it is", async () => {
    const client = new Repo([ref("feat/checkout", 1)]);
    const [t] = await list(client);
    expect(t!.state).toBe("working");
    expect(t!.number).toBeNull();
    expect(t!.key).toBe(branchKey("feat/checkout"));
  });

  it("joins a branch to its pull request, and takes the title from it", async () => {
    const client = new Repo(
      [ref("feat/checkout", 1)],
      [{
        number: 42, title: "Make checkout idempotent", body: null, state: "open",
        created_at: ago(2), updated_at: ago(1), html_url: "u",
        head: { ref: "feat/checkout", sha: "b".repeat(40) }, base: { ref: "main" },
        user: { login: "darko" },
      }]
    );
    const [t] = await list(client);
    expect(t!.state).toBe("open");
    expect(t!.number).toBe(42);
    expect(t!.title).toBe("Make checkout idempotent");
    expect(t!.branch).toBe("feat/checkout");
  });

  it("keeps a merged pull request readable after its branch is deleted", async () => {
    // GitHub deletes the head branch on merge for most repos. Without this the
    // conversation vanishes the moment it succeeds.
    const client = new Repo(
      [ref("main", 1)],
      [{
        number: 39, title: "Cache the tenant lookup", body: null, state: "closed", merged: true,
        merged_at: ago(2), created_at: ago(5), updated_at: ago(2), html_url: "u",
        head: { ref: "feat/gone", sha: "c".repeat(40) }, base: { ref: "main" },
        user: { login: "darko" },
      }]
    );
    const threads = await list(client, 30);
    const archived = threads.find((t) => t.number === 39);
    expect(archived?.key).toBe(archivedKey(39));
    expect(archived?.branch).toBeNull();
    expect(archived?.state).toBe("merged");

    // …and it obeys the window like any other finished work.
    expect((await list(client, 1)).some((t) => t.number === 39)).toBe(false);
  });

  it("stays quiet on an open pull request it has no verdict for", async () => {
    // "No verdict in the window" is not "the gate couldn't review this". We
    // don't know anything about it yet, so we don't claim it needs anyone.
    const client = new Repo([ref("feat/x", 1)], [openPull(7, "feat/x")]);
    const [t] = await list(client);
    expect(t!.gate).toBe("none");
    expect(t!.needsYou).toBeNull();
  });

  it("puts what wants a human above what is merely recent", async () => {
    // CodeWorthy has passed PR #7, so the merge is the only thing left — and
    // that is the human's. main is newer but is asking for nobody.
    const spine = spineWith([
      { number: 7, event_type: "gate.evaluated", payload: { decision: "passed", number: 7 }, ts: ago(3) },
    ]);
    const client = new Repo([ref("main", 0), ref("feat/ready", 3)], [openPull(7, "feat/ready")]);
    const threads = await listThreads(client, spine, { repo: "acme/orders", sinceDays: 30, viewer: "darko" });
    expect(threads[0]!.branch).toBe("feat/ready");
    expect(threads[0]!.needsYou?.reason).toBe("Ready for you");
    expect(threads[1]!.branch).toBe("main");
  });
});
