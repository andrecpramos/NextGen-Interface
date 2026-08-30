# CLAUDE.md

Instructions for any AI agent working in this repository. Loaded automatically
every session. The architecture rules live in [PLAN.md](PLAN.md) §2 and the ADRs
in [.ai/decisions/](.ai/decisions/); this file is about **process**.

## Branching — binding

```
main       production. Protected by policy. Release only.
  ^
  | merge ONLY when the user explicitly asks for a release
  |
develop    integration. Default branch. Everything lands here.
  ^
  | PR
  |
<feature>  cut FROM develop, merges back INTO develop
```

1. **`main` is production. Never commit, merge, push or open a PR to it on your
   own initiative.** It moves only when the user asks for a release, in that
   session, in words. "The work is finished" is not such a request.
2. **`develop` is where all work lands.** It is the GitHub default branch, so a
   PR opened without an explicit base already targets it correctly.
3. **Every new branch is cut from `develop`** — never from `main` — and merges
   back into `develop`.
4. Before making any code change in a new context window, **ask whether to stay
   on the current branch or cut a new one from `develop`**, and wait. Read-only
   work — questions, reviews, explanations that write no files — is exempt.

A `SessionStart` / `PreCompact` hook restates this with live branch state; see
[.ai/sdlc/branching.md](.ai/sdlc/branching.md) for the full policy and
[.ai/agent-workflow.md](.ai/agent-workflow.md) for how it is enforced.

## This tree is shared

More than one agent session works in this checkout at the same time. Files you
did not touch appear, change, and disappear mid-session.

- **Never `git add -A` or `git commit -a`.** Stage explicit paths, always.
- **Re-check `git status` immediately before committing** — the tree may have
  moved since you last looked.
- A modified or untracked file you did not create belongs to someone else.
  Leave it. Do not commit it, revert it, or "clean it up".

## Before you push

CI gates these; running them locally first is faster than a red build.

```bash
node tooling/scripts/check-import-boundaries.mjs   # Rule 1: core never imports a domain
pnpm -r typecheck
pnpm -r test
pnpm registry:check                                # Rule 10: >=3 examples per capability
```

The golden-set gate and its tolerances are described in
[.ai/sdlc/ci-cd.md](.ai/sdlc/ci-cd.md); the reasoning is [ADR-011](.ai/decisions/ADR-011.md).

## Environment

- **Node 23.6+ required**, despite `engines` saying `>=20`. The repo runs
  TypeScript through `node` directly and uses `node:sqlite`. On Node 20 install
  succeeds and everything fails at run time.
- **A fresh clone needs `pnpm install --ignore-scripts`.** pnpm 11 exits 1 with
  `ERR_PNPM_IGNORED_BUILDS`, and the `onlyBuiltDependencies` list in
  `pnpm-workspace.yaml` does not suppress it. Your working checkout hides this —
  a populated `node_modules` leaves no builds to ignore. Nothing here needs a
  native build, so skipping them is safe; CI does exactly this.
- `jq` is **not** on PATH here. Use Node for JSON in scripts and hooks.
- Five `package.json` files carry a PowerShell UTF-8 BOM that `JSON.parse`
  rejects. Strip it when reading a manifest.
