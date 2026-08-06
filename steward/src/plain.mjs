// Plain-language drafting helpers. Everything Steward says must read like a
// smart colleague explaining it — these are the deterministic (no-LLM)
// versions used for commit coaching and PR scaffolds.

export function describeDiffStats(files) {
  // files: [{ filename, additions, deletions, status }]
  const added = files.filter((f) => f.status === "added").length;
  const removed = files.filter((f) => f.status === "removed").length;
  const changed = files.length - added - removed;
  const lines = files.reduce((n, f) => n + (f.additions ?? 0) + (f.deletions ?? 0), 0);
  const parts = [];
  if (changed > 0) parts.push(`changes ${changed} file${changed === 1 ? "" : "s"}`);
  if (added > 0) parts.push(`adds ${added} new file${added === 1 ? "" : "s"}`);
  if (removed > 0) parts.push(`removes ${removed} file${removed === 1 ? "" : "s"}`);
  return `${parts.join(", ") || "touches no files"} (~${lines} lines)`;
}

export function draftPrBody({ branch, commits, filesSummary }) {
  const commitLines = (commits ?? [])
    .slice(0, 10)
    .map((c) => `- ${c.message.split("\n")[0]}`)
    .join("\n");
  return [
    "## What this change does",
    "",
    `_Drafted by CodeWorthy Steward from the commits on \`${branch}\` — please edit,`,
    "especially the parts only a human can know (the **why**, and what to watch after release)._",
    "",
    commitLines || "- (no commit messages found)",
    "",
    `This change ${filesSummary}.`,
    "",
    "## Why",
    "",
    "_(fill in: what problem does this solve?)_",
    "",
    "## What could break, and how we'd know",
    "",
    "_(fill in: the risk and the signal you'd watch)_",
  ].join("\n");
}

export function mainPushCoaching({ branch, backupBranch, pusher, commitCount }) {
  return [
    `**Heads up from CodeWorthy Steward** — ${commitCount === 1 ? "a commit" : `${commitCount} commits`} went directly to \`${branch}\`.`,
    "",
    `That's risky because \`${branch}\` is what's live: a mistake here has no review step in front of it.`,
    backupBranch
      ? `A restore point was saved as \`${backupBranch}\` — if anything looks wrong, that branch is exactly how things were before this push.`
      : "",
    "",
    "**Next time, the safe flow is:** make a branch → push it → Steward drafts the pull request for you → you review and merge. It takes one extra click and gives every change an undo point.",
    "",
    "To have Steward set up this guardrail automatically (so direct pushes are politely blocked), add a file named `.steward.yml` containing `protect: true` to the repository.",
  ]
    .filter(Boolean)
    .join("\n");
}

export function microDefenseQuestion() {
  return [
    "**One-question check from CodeWorthy Steward** (keeps you the owner of this change):",
    "",
    "> In one or two sentences: **what does this change do, and what's the most likely way it could break?**",
    "",
    "Reply to this comment and the `steward/micro-defense` check will turn green. Your answer is recorded in the change log — it is never graded.",
  ].join("\n");
}
