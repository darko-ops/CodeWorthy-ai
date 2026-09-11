// What the thread view claims, checked.
//
// Two things matter enough to pin down: that an agent is named from evidence
// the tool itself wrote (never from a guess), and that "needs you" fires for
// exactly the situations a human actually has to act on — because it is the
// only alarm on that screen, and an alarm that cries wolf is worse than none.
import { describe, expect, it } from "vitest";
import { agentFromLogin, agentFromText, cleanBody, identify } from "./agents.js";
import { actionsFor, isFlagged, needsYouFor, toneFor } from "./threads.js";

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
  const open = { state: "open" as const, viewerIsAuthor: false };

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

  it("stays quiet on a draft nothing has gone wrong on", () => {
    expect(needsYouFor({ state: "draft", gate: "passed", flagged: 0, viewerIsAuthor: false })).toBeNull();
  });

  it("stays quiet on an ordinary merged pull request", () => {
    expect(needsYouFor({ state: "merged", gate: "passed", flagged: 0, viewerIsAuthor: false })).toBeNull();
  });

  it("still speaks up on a merged pull request that carried an exception", () => {
    const n = needsYouFor({ state: "merged", gate: "passed", flagged: 2, viewerIsAuthor: false });
    expect(n?.tone).toBe("risk");
    expect(n?.detail).toContain("2 things");
  });

  it("says unreviewed rather than ready when the gate couldn't run", () => {
    expect(needsYouFor({ ...open, gate: "unavailable", flagged: 0 })?.reason).toBe("Unreviewed");
  });
});

describe("what the human may do from the thread", () => {
  const pr = { number: 1, title: "t", body: null, state: "open", created_at: "", updated_at: "", html_url: "", base: { ref: "main" } };

  it("offers a merge only when GitHub would actually allow it", () => {
    const a = actionsFor({ ...pr, mergeable: true, mergeable_state: "clean" } as never, "open", {
      viewer: "darko", canPush: true, youApproved: false, authorIsViewer: false,
    });
    expect(a.canMerge).toBe(true);
    expect(a.mergeBlocked).toBeNull();
  });

  it("explains a blocked merge as the rule working, not as a failure", () => {
    const a = actionsFor({ ...pr, mergeable: true, mergeable_state: "blocked" } as never, "open", {
      viewer: "darko", canPush: true, youApproved: false, authorIsViewer: false,
    });
    expect(a.canMerge).toBe(false);
    expect(a.mergeBlocked).toContain("the rule doing its job");
  });

  it("never offers a merge without write access", () => {
    const a = actionsFor({ ...pr, mergeable: true, mergeable_state: "clean" } as never, "open", {
      viewer: "darko", canPush: false, youApproved: false, authorIsViewer: false,
    });
    expect(a.canMerge).toBe(false);
    expect(a.mergeBlocked).toContain("write access");
  });

  it("refuses self-approval the way GitHub does, and says so", () => {
    const a = actionsFor(pr as never, "open", {
      viewer: "darko", canPush: true, youApproved: false, authorIsViewer: true,
    });
    expect(a.canApprove).toBe(false);
    expect(a.approveBlocked).toContain("your own");
  });

  it("gives every refusal a reason", () => {
    const a = actionsFor(pr as never, "merged", {
      viewer: "darko", canPush: true, youApproved: false, authorIsViewer: false,
    });
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
