# Branching model

**Adopted:** 2026-08-30 · Repository: `andrecpramos/AI-Interface` (private)

```
main       production. Release only.
  ^
  | merge ONLY on the user's explicit instruction
  |
develop    integration. GitHub default branch. Everything lands here.
  ^
  | PR
  |
<feature>  cut FROM develop, merges back INTO develop
```

## The three rules

**1 · `main` is production and moves only on command.** No agent commits,
merges, pushes or opens a PR to `main` on its own initiative. It moves when the
user asks for a release, in that session, in words. "The work is finished" is not
such a request; "ship it to main" is.

**2 · `develop` is where all work lands.** It is set as the GitHub default
branch, so a PR opened without an explicit base targets `develop` automatically —
the safe thing happens when nobody is paying attention, which is the point.

**3 · Every branch is cut from `develop` and merges back into `develop`.** Never
branch from `main`. A branch cut from `main` misses whatever has already been
integrated and silently reverts it on merge.

## How each rule is enforced

Three independent layers, because any one of them can be missed.

| Layer | Mechanism | Catches |
|---|---|---|
| Context | [CLAUDE.md](../../CLAUDE.md) | Loaded into every session automatically — the agent reads the contract before doing anything |
| Session | [`.claude/hooks/branch-check.mjs`](../hooks/branch-check.mjs) | Fires on `SessionStart` and `PreCompact` with live branch state; forces the branch question in every new context window |
| Repository | `guard-production` job in [ci.yml](../../.github/workflows/ci.yml) | Fails any PR into `main` whose head is not `develop` |

The hook reports what it actually finds, and its message changes with the
situation:

- on `main` — *"PRODUCTION. Do not commit here."*
- on `develop` — small changes may land directly; larger ones get a branch
- on a feature branch — ahead/behind counts against `develop`
- on a **stale** feature branch — an explicit warning that it does not contain
  the tip of `develop` and will carry stale work on merge

All four states were verified against a throwaway clone.

## What is deliberately not enforced

**No GitHub branch protection rule on `main`.** A ruleset requiring a PR would
also block the user's own `git push origin main` after a local release merge —
turning "only on command" into "only via the GitHub UI". The policy is enforced
for the *agent*, which is what was asked for, while the human keeps a direct
path. If more than one person ever commits here, revisit this: add a ruleset
requiring a PR from `develop` and passing CI.

**`wp-01-1b-validation` still exists on the remote.** It is identical to `main`
and `develop` at the point this model was adopted, and a concurrent session is
still working on it locally. It is an ordinary feature branch under the new
rules and merges into `develop`. Nothing was deleted.

## Releasing

Only when the user asks:

```bash
git checkout main
git merge --ff-only develop     # refuse anything that is not a fast-forward
git push origin main
```

`--ff-only` is deliberate. If it refuses, `main` has commits `develop` does not,
which means something was pushed to production out of band — stop and find out
what before forcing anything.

### What an adopter receives

`main` moving **is** the release. There is no tag, no version number and no attached
artefact ([ADR-021](../decisions/ADR-021.md)): an adopter copies [`adapter/`](../../adapter/)
from the commit they choose, and [GETTING-STARTED.md](../../.MDFiles/GETTING-STARTED.md) says
so. Two things follow for whoever performs a release:

1. **`adapter/` must be current on `develop` before the merge.** It is committed build
   output, and CI's `build-adapter.mjs --check` fails if it is stale, so a red `develop` is
   the only way it reaches `main` stale.
2. **Never move `main` backwards or rewrite it.** With no tag to point at, the commit an
   adopter copied from is their only version identity, and it has to stay reachable.

If adopters turn out to need a version to name, that is an additive change to
`build-adapter.mjs`, decided in its own ADR. It is not a reason to restore the tarballs.

## Related

- [CLAUDE.md](../../CLAUDE.md) — the contract as the agent receives it
- [.claude/agent-workflow.md](./agent-workflow.md) — hook mechanics and the shared-tree rules
- [.claude/sdlc/ci-cd.md](./ci-cd.md) — what a branch must pass to merge
