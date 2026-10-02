# CLAUDE.md

Instructions for any AI agent working in this repository. Loaded automatically
every session; this file is about **process**.

**Everything else lives in [`.claude/`](.claude/README.md)** — one directory for
workflow *and* knowledge. The rules are [PLAN.md](.MDFiles/PLAN.md) §2, with their real
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

## Commands

pnpm workspace (`pnpm-workspace.yaml`); every package under `packages/*` uses
the same pair of scripts, so the pattern below is uniform — there is no lint
script in this repo.

```bash
pnpm preview                                   # the bench: ask, and see why it decided that
pnpm preview:check                             # the bench, in a headless browser

pnpm test                                      # every package (pnpm -r test)
pnpm --filter @nextgen/<pkg> test              # one package, e.g. core-intent
pnpm --filter @nextgen/<pkg> test -- <path>    # one file (vitest passthrough)
pnpm --filter @nextgen/<pkg> test -- -t <name> # one test by name

pnpm typecheck                                 # every package (pnpm -r typecheck)
pnpm --filter @nextgen/<pkg> typecheck         # one package
pnpm build                                     # the widget only: packages/embed/dist/nextgen.js
pnpm adapter:build                             # rebuild adapter/ after changing packages/
pnpm adapter:check                             # adapter/ is current, and a copy of it runs with nothing installed

pnpm registry:check                            # Rule 10: every committed registry validates
pnpm eval:apps                                 # generate, calibrate and route over the fixture apps
pnpm router:inspect                            # score distributions, recall@k — look here first
pnpm router:eval / router:baseline / router:floor   # cascade against the golden set
pnpm router:calibrate                          # sweep thresholds — never hand-tune them (Rule 14)
```

## Architecture

The package layout and the engine boundary are in
[README.md → Structure](README.md#structure) — read that first when touching
`packages/*`. In short: `core-*` is an application-agnostic engine (registry
schema, a three-stage router, model runtimes, an explainability trace);
`generator` reads an application's source and emits its registries, `embed` is
the widget that runs in the adopter's page, and `kit` drives both. All of it
is bundled by `tooling/scripts/build-adapter.mjs` into `adapter/`, the one
folder an adopter copies ([ADR-021](.claude/decisions/ADR-021.md)). No package
is installable or published. **`packages/core-*` depend only on other
`core-*`** — Rule 1, gated by `check-import-boundaries.mjs` in CI and by a hook
on every `core-*` edit (see `critical-infrastructure.md` §2) — and the
`boundary-auditor` agent checks the `switch`-on-application-type violations the
import gate can't see.

`.claude/docs/architecture.md` and `.claude/docs/testing.md` were rewritten on
2026-09-20; before that they described an earlier Dart/Flutter mobile finance
app. Three other docs are only partly about this repo and open with a status
note saying which parts: `security.md`, `ui-guidelines.md` and the older
`sdlc/` files. For anything architectural, trust README.md, the accepted ADRs in
`.claude/decisions/`, and the code over any of them.

## Before you push

CI gates these; running them locally first is faster than a red build.

```bash
node tooling/scripts/check-import-boundaries.mjs   # Rule 1: core-* depends only on core-*
node tooling/scripts/check-doc-links.mjs           # every relative doc link resolves
pnpm -r typecheck
pnpm -r test
pnpm registry:check                                # Rule 10: >=3 examples per capability
pnpm build                                         # the widget; the gates below read it
pnpm adapter:check                                 # adapter/ is current, and a copy runs with nothing installed
node tooling/scripts/check-derived-artefacts.mjs   # WP-46: shipped indexes/thresholds follow their inputs
node tooling/scripts/check-accessibility.mjs       # WP-45: no serious/critical a11y violation
node tooling/scripts/check-csp.mjs                 # the widget under a strict CSP, in a real browser
node --experimental-strip-types \
  eval/frameworks/evaluate-golden.mjs --embedder hashing --check   # the generated registries still decide the same
```

The golden-set gate and its tolerances are described in
[.claude/sdlc/ci-cd.md](.claude/sdlc/ci-cd.md); the reasoning is [ADR-011](.claude/decisions/ADR-011.md).

`/gates` runs all of it — including the ones not listed here — and reports PASS/FAIL per
gate, or delegate it to the `gate-runner` agent to keep it out of your context. The gate
list itself lives in [.claude/sdlc.config.json](.claude/sdlc.config.json) — hooks and
commands read that file, so it and CI must not drift.

**Which rule is actually enforced where** — and which are only written down — is the
register in
[.claude/docs/critical-infrastructure.md](.claude/docs/critical-infrastructure.md). Read it
before trusting that something is protected.

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
| about to repeat a known mistake | [.claude/docs/lessons.md](.claude/docs/lessons.md) — sixteen of them, with what each cost |

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
