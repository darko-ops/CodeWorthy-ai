# GitHub Topology

How CodeWorthy uses GitHub: the org, the platform repo, and the per-candidate
assessment repos.

## Org

**`CodeWorthy-ai`** — the GitHub organization for everything CodeWorthy.

Rationale (see the discussion captured in the status work): CodeWorthy invites
outside people (candidates) into repositories and will provision repos
programmatically via a GitHub App. Both need proper org-level access boundaries,
not a personal namespace. Candidates are added as **outside collaborators scoped
to their single repo** — never org members — so they cannot see the platform
repo or any other candidate's repo.

## Repositories

| Repo | Visibility | Contents | Who can see it |
|---|---|---|---|
| `CodeWorthy-ai/CodeWorthy` | **private** | The platform monorepo — scenarios, evaluation engine, hidden tests, rubrics, operator scripts, the product site, docs | CodeWorthy team only. **Never shared with candidates.** |
| `CodeWorthy-ai/cw-<scenario>-<candidate>-<n>` | private | One assessment repo per candidate, assembled by `scripts/provision-candidate.sh` from committed platform state (leak-checked — no evaluation material) | The one candidate (outside collaborator) + the team |

The platform repo holds the answer keys (hidden tests, rubrics, reference
solutions). Its privacy is the outer wall; the provisioning leak check is the
inner wall. Both must hold — a candidate repo is a clean subset, never a clone
of the platform repo.

### Hidden-test isolation note (future)

Today hidden tests live inside the platform repo and reach candidate repos only
transiently, during a grading run (`run.sh` copies them in and deletes them on
exit). When the GitHub App / isolated evaluation runner lands (roadmap Phase
1.1 / 3), the stronger posture from `mvp-architecture.md` Principle 5 applies:
hidden tests execute in a CodeWorthy-controlled context the candidate branch
cannot inspect, with only the sanitized `--summary` leaving the environment. At
real volume, consider a separate org (or a dedicated private repo with no
candidate access) for the hidden-test material so a candidate-repo Actions
misconfiguration can never reach it.

## Wiring

The operator tooling is org-parameterized — point it at the org via env:

```bash
export CW_GITHUB_ORG=CodeWorthy-ai
```

`scripts/provision-candidate.sh` then creates each candidate repo under
`CodeWorthy-ai/` and adds the candidate as an outside collaborator. Pass
`--org` to override for a one-off.

## Team roles (org level)

The product's own Team screen models these; they map to GitHub org roles:

- **Owner** — full access + billing (founder).
- **Reviewer** — grades submissions and releases reports (org member, write on
  candidate repos).
- **Viewer** — read-only.

## Access rules (the short version)

1. The platform repo is private; candidates are never members of the org.
2. Each candidate is an outside collaborator on exactly one assessment repo.
3. Candidate repos are assembled by the leak-checked provisioning script, never
   forked or copied from the platform repo.
4. Hidden-test material never persists on a candidate-readable path.
