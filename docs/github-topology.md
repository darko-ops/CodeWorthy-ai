# GitHub Topology

How CodeWorthy uses GitHub: the account, the platform repo, and the
per-candidate assessment repos.

## Account

**`darko-ops`** — the personal account is home for everything CodeWorthy during
the validation phase (decision 2026-08-03, superseding the earlier
`CodeWorthy-ai` org experiment: one operator, no team yet — org-level access
boundaries add ceremony without adding safety until there are org members to
bound). Candidates are added as **repo collaborators scoped to their single
repo**, so they cannot see the platform repo or any other candidate's repo —
that isolation property holds identically on a personal account.

Revisit when there is a second teammate or the GitHub App lands (roadmap Phase
3): programmatic provisioning and reviewer roles are the point where an org
earns its keep. The `CodeWorthy-ai` org still exists; its `CodeWorthy` repo is
a retired stale copy (archive it) and nothing should push there.

## Repositories

| Repo | Visibility | Contents | Who can see it |
|---|---|---|---|
| `darko-ops/CodeWorthy-ai` | **private** | The platform monorepo — scenarios, evaluation engine, hidden tests, rubrics, operator scripts, the product site, docs | Operator only. **Never shared with candidates.** |
| `darko-ops/cw-<scenario>-<candidate>-<n>` | private | One assessment repo per candidate, assembled by `scripts/provision-candidate.sh` from committed platform state (leak-checked — no evaluation material) | The one candidate (collaborator) + the operator |
| `darko-ops/CodeWorthy` | archived | The original working repo, read-only history | — |

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
real volume, consider a dedicated private repo (or org) with no candidate
access for the hidden-test material so a candidate-repo Actions
misconfiguration can never reach it.

## Wiring

`scripts/provision-candidate.sh` creates each candidate repo under `darko-ops/`
by default. Override for a one-off (or a future org move) with `--org` or:

```bash
export CW_GITHUB_ORG=<owner>
```

## Access rules (the short version)

1. The platform repo is private; candidates never gain access to it.
2. Each candidate is a collaborator on exactly one assessment repo.
3. Candidate repos are assembled by the leak-checked provisioning script, never
   forked or copied from the platform repo.
4. Hidden-test material never persists on a candidate-readable path.
5. Exactly one writable copy of the platform repo exists
   (`darko-ops/CodeWorthy-ai`); every other copy is archived or read-only by
   convention — stale writable copies are how histories fork.
