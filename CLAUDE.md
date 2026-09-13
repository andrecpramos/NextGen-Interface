# CLAUDE.md

Instructions for any AI agent working in this repository. Loaded automatically
every session; this file is about **process**.

**Everything else lives in [`.claude/`](.claude/README.md)** — one directory for
workflow *and* knowledge. The rules are [PLAN.md](PLAN.md) §2, with their real
enforcement mapped in [.claude/docs/critical-infrastructure.md](.claude/docs/critical-infrastructure.md); the ADRs are
[.claude/decisions/](.claude/decisions/); the mistakes already made are
[.claude/docs/lessons.md](.claude/docs/lessons.md).

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
[.claude/sdlc/branching.md](.claude/sdlc/branching.md) for the full policy and
[.claude/sdlc/agent-workflow.md](.claude/sdlc/agent-workflow.md) for how it is enforced.

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
node tooling/scripts/check-doc-links.mjs           # every relative doc link resolves
pnpm -r typecheck
pnpm -r test
pnpm registry:check                                # Rule 10: >=3 examples per capability
node tooling/scripts/check-derived-artefacts.mjs   # WP-46: shipped indexes/thresholds follow their inputs
node tooling/scripts/check-accessibility.mjs       # WP-45: no serious/critical a11y violation
node --experimental-strip-types \
  eval/fut-app/evaluate-golden.mjs --embedder hashing --check   # the generated registries still decide the same
pnpm build && node tooling/scripts/check-install.mjs   # the tarballs install outside this repo, and run on Node 20
node tooling/scripts/check-csp.mjs                     # the widget under a strict CSP, in a real browser
```

The golden-set gate and its tolerances are described in
[.claude/sdlc/ci-cd.md](.claude/sdlc/ci-cd.md); the reasoning is [ADR-011](.claude/decisions/ADR-011.md).

`/gates` runs all of it and reports PASS/FAIL per gate, or delegate it to the
`gate-runner` agent to keep it out of your context. The gate list itself lives in
[.claude/sdlc.config.json](.claude/sdlc.config.json) — hooks and commands read that file,
so it and CI must not drift.

**Which rule is actually enforced where** — and which are only written down — is
the register in
[.claude/docs/critical-infrastructure.md](.claude/docs/critical-infrastructure.md). Read it before
trusting that something is protected. Its top entry is not theoretical: the CI
staleness gate currently diffs a directory the build never writes.

## The workflow is in `.claude/`

Don't re-derive these procedures — they are written down. Full map:
[.claude/README.md](.claude/README.md).

| You are… | Use |
|---|---|
| adding or changing a capability | `new-feature` skill |
| making an architectural choice | `write-adr` skill — the reversibility test is in it |
| finishing work: gates → commit → PR | `ship-it` skill |
| checking a diff against the rules | `/rules-check` |
| asking what is actually enforced | `/sdlc-audit`, or the `sdlc-auditor` agent |
| ending a session | `/handoff` |
| suspicious the docs have drifted | `docs-keeper` agent |
| installing this SDLC in another repo | `sdlc-bootstrap` skill (the `sdlc-kit` folder lives outside this repo) |
| about to repeat a known mistake | [.claude/docs/lessons.md](.claude/docs/lessons.md) — fourteen of them, with what each cost |

Three hooks enforce what you would otherwise have to remember: the branching
contract at every context boundary, a guard denying broad staging and writes to
production, and an immediate gate check on edits that could break Rule 1 or the
calibration discipline. Review them with `/hooks`.

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
