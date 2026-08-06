// Pull-request handler: description scaffolding (safe-mechanics), the
// micro-defense (advise — presence is checked, content is never graded), and
// the flag-gated AI review (advise only; see llm.mjs — the model never gates).
import { microDefenseQuestion } from "../plain.mjs";
import { loadConfig } from "../policy.mjs";
import { runAdviseReview } from "../llm.mjs";

export const MICRO_DEFENSE_CHECK = "steward/micro-defense";
export const MICRO_DEFENSE_MARKER = "<!-- steward:micro-defense -->";

export async function handlePullRequest({ payload, broker, audit, env = process.env }) {
  const action = payload.action;
  if (!["opened", "ready_for_review"].includes(action)) return { skipped: action };
  const pr = payload.pull_request;
  if (pr.user?.type === "Bot") return { skipped: "bot PR" };

  const repoFull = payload.repository.full_name;
  const [owner, repo] = repoFull.split("/");
  const installationId = payload.installation.id;
  const client = await broker.clientFor(installationId);
  const config = await loadConfig(client, owner, repo, payload.repository.default_branch);
  const results = {};

  // Safe-mechanics: an empty description gets a drafted one, clearly marked.
  if (!pr.body || pr.body.trim().length === 0) {
    await client.updatePullBody(
      owner,
      repo,
      pr.number,
      [
        "_Drafted by CodeWorthy Steward because the description was empty — please edit._",
        "",
        `## What this change does`,
        "",
        `${pr.title}`,
        "",
        "## Why / what could break",
        "",
        "_(only you can fill this in — one honest sentence beats a template)_",
      ].join("\n")
    );
    await audit({
      installationId,
      repo: repoFull,
      actor: "steward",
      eventType: "pr_description_drafted",
      payload: { pr: pr.number },
      plainEnglish: `Pull request #${pr.number} had no description, so Steward drafted one for ${pr.user.login} to edit.`,
    });
    results.descriptionDrafted = true;
  }

  // Micro-defense: one question, answered by a human reply. The check turns
  // green on *presence* of an answer — understanding is scaffolded, not graded.
  const changedLines = (pr.additions ?? 0) + (pr.deletions ?? 0);
  if (config.micro_defense && changedLines >= config.micro_defense_threshold && !pr.draft) {
    const check = await client.createCheckRun(owner, repo, {
      name: MICRO_DEFENSE_CHECK,
      head_sha: pr.head.sha,
      status: "in_progress",
      output: {
        title: "Waiting for your one-sentence answer",
        summary:
          "Reply to Steward's question on the pull request. Any honest answer turns this green — it is never graded.",
      },
    });
    await client.createIssueComment(
      owner,
      repo,
      pr.number,
      `${MICRO_DEFENSE_MARKER}\n${microDefenseQuestion()}`
    );
    await audit({
      installationId,
      repo: repoFull,
      actor: "steward",
      eventType: "micro_defense_asked",
      payload: { pr: pr.number, checkRunId: check.id, changedLines },
      plainEnglish: `Steward asked the one-question check on pull request #${pr.number} (${changedLines} changed lines).`,
    });
    results.microDefense = { checkRunId: check.id };
  }

  // Advise-only AI review, doubly gated: server flag AND repo config.
  if (env.STEWARD_LLM === "1" && config.llm_review) {
    results.aiReview = await runAdviseReview({
      client,
      audit,
      owner,
      repo,
      repoFull,
      installationId,
      pr,
      env,
    });
  }

  return results;
}

// A human replied on a PR where the micro-defense is pending → green.
export async function handleIssueComment({ payload, broker, audit, pending }) {
  if (payload.action !== "created") return { skipped: payload.action };
  if (payload.comment.user?.type === "Bot") return { skipped: "bot comment" };
  if (!payload.issue?.pull_request) return { skipped: "not a PR comment" };

  const repoFull = payload.repository.full_name;
  const [owner, repo] = repoFull.split("/");
  const installationId = payload.installation.id;
  const key = `${repoFull}#${payload.issue.number}`;
  const checkRunId = pending.get(key);
  if (!checkRunId) return { skipped: "no pending micro-defense" };

  const client = await broker.clientFor(installationId);
  await client.updateCheckRun(owner, repo, checkRunId, {
    status: "completed",
    conclusion: "success",
    output: {
      title: "Answered",
      summary: "The author answered the one-question check. The answer lives on the pull request and in the change log.",
    },
  });
  pending.delete(key);
  await audit({
    installationId,
    repo: repoFull,
    actor: payload.comment.user.login,
    eventType: "micro_defense_answered",
    payload: { pr: payload.issue.number, answer: payload.comment.body.slice(0, 500) },
    plainEnglish: `${payload.comment.user.login} answered the one-question check on pull request #${payload.issue.number}.`,
  });
  return { completed: true };
}
