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
    url: "https://codeworthy.dev",
    hook_attributes: { url: `${base}/webhooks/github`, active: true },
    redirect_url: `${base}/steward/app-manifest/callback`,
    setup_url: `${base}/steward/setup`,
    setup_on_update: true,
    public: true,
    default_permissions: {
      contents: "read",
      pull_requests: "write",
      administration: "write",
      checks: "write",
      metadata: "read",
    },
    // installation / installation_repositories are NOT listed here: GitHub
    // delivers installation webhooks to every App automatically, and the
    // manifest API rejects them as subscribable events.
    default_events: ["push", "pull_request", "issue_comment"],
  };
}

// The install URL for a registered App (the "Install on GitHub" button target).
export function installUrl(appSlug: string): string | null {
  return appSlug ? `https://github.com/apps/${appSlug}/installations/new` : null;
}
