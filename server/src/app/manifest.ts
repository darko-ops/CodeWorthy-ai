// The GitHub App manifest — the one-click way to register the CodeWorthy App.
//
// GitHub's "create from manifest" flow: we POST this manifest to
// github.com/settings/apps/new, the operator confirms, and GitHub hands back a
// temporary code we exchange for the App's id, private key, and webhook secret
// (see routes.ts). This makes "register the actual GitHub App" a button, not a
// 20-field form — and it declares, in one auditable place, exactly the
// permissions CodeWorthy asks for and why.
//
// The permission set is the honest minimum for the doctrine:
//   - contents: read           — read the diff; NEVER write code or merge
//   - pull_requests: write      — open draft PRs, post review comments
//   - administration: write     — configure branch protection (the one
//                                 privileged, consented capability)
//   - checks: write             — post the CodeWorthy PR review check
//   - metadata: read            — required baseline
// No "write" on contents, no merge scope — the App literally cannot be granted
// the power to merge or force-push, mirroring the client-surface doctrine.

export interface AppManifest {
  name: string;
  url: string;
  hook_attributes: { url: string; active: boolean };
  redirect_url: string; // where GitHub sends the temporary code after creation
  setup_url: string; // where GitHub sends the user after they INSTALL
  setup_on_update: boolean;
  public: boolean;
  default_permissions: Record<string, string>;
  default_events: string[];
}

export function buildAppManifest(baseUrl: string): AppManifest {
  const base = baseUrl.replace(/\/+$/, "");
  return {
    name: "CodeWorthy Steward",
    url: "https://codeworthy.ai",
    hook_attributes: { url: `${base}/webhooks/github`, active: true },
    redirect_url: `${base}/steward/app-manifest/callback`,
    setup_url: `${base}/steward/setup`,
    setup_on_update: true,
    public: true,
    default_permissions: {
      // write: safe-mechanics creates restore-point/feature branches (refs).
      // Never merges, never deletes, never force-updates — the client cannot
      // express those (github/client.ts + its doctrine test).
      contents: "write",
      pull_requests: "write",
      administration: "write",
      checks: "write",
      // issue_comment (micro-defense answers) requires the issues permission;
      // write lets Steward post its comments via the issues API.
      issues: "write",
      metadata: "read",
    },
    // installation / installation_repositories are NOT listed here: GitHub
    // delivers installation webhooks to every App automatically, and the
    // manifest API rejects them as subscribable events.
    //
    // check_suite: the repo's OWN CI finishing changes whether its tests are
    //   green, which the gate treats as blocking — without it, "don't merge on
    //   red" would only catch CI that finished before the PR event.
    // repository_ruleset / branch_protection_rule: someone weakening protection
    //   reaches us in seconds instead of at the next scheduled sweep.
    default_events: [
      "push",
      "pull_request",
      "issue_comment",
      "check_suite",
      "repository_ruleset",
      "branch_protection_rule",
    ],
  };
}

// The install URL for a registered App (the "Install on GitHub" button target).
export function installUrl(appSlug: string): string | null {
  return appSlug ? `https://github.com/apps/${appSlug}/installations/new` : null;
}


/**
 * The APPROVER App — a second, separate GitHub App.
 *
 * Separate identity is the whole point: the actor that reviews a change must
 * not be the actor that approves it, or the approval is the reviewer agreeing
 * with itself. That separation is enforced three ways, and this manifest is one
 * of them:
 *
 *   1. Here — the approver gets NO `checks` permission, so it cannot post the
 *      check that gates a merge, and NO `administration`, so it cannot change
 *      the rule it is approving under.
 *   2. In code — approver/client.ts is a separate surface with no merge, no
 *      check-run, and no protection capability (asserted by a doctrine test).
 *   3. At runtime — its own credentials and its own installation token.
 *
 * It subscribes to no events. The Steward calls it after a review lands, so it
 * needs no webhook of its own — fewer moving parts, and one less thing that can
 * fire out of order.
 */
export function buildApproverManifest(baseUrl: string): AppManifest {
  const base = baseUrl.replace(/\/+$/, "");
  return {
    name: "CodeWorthy Approver",
    url: "https://codeworthy.ai",
    hook_attributes: { url: `${base}/webhooks/github`, active: false },
    redirect_url: `${base}/steward/approver-manifest/callback`,
    setup_url: `${base}/steward/approver`,
    setup_on_update: false,
    public: true,
    default_permissions: {
      // Submit ONE review per pull request. That is the entire privileged act.
      pull_requests: "write",
      // Read the diff, for the independent second review in strict mode.
      contents: "read",
      metadata: "read",
      // Deliberately absent: checks (can't gate), administration (can't change
      // the rule it approves under), issues, workflows.
    },
    default_events: [],
  };
}
