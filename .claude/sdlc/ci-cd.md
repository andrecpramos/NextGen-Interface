# CI/CD — WP-12

**Status:** implemented 2026-08-30 · [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml)
**Supersedes** the sketch in [.claude/docs/deployment.md](../docs/deployment.md) §CI/CD, which described a
Flutter pipeline (`analyze`, `widget`, device farm) from before [ADR-006](../decisions/ADR-006.md)
moved the stack to a TypeScript monorepo. The deployment targets in that document still stand;
the job list did not.

Gate strategy and its rationale: [ADR-011](../decisions/ADR-011.md).

---

## What runs

Three jobs on push to `main`, on PRs into `main`, and on manual dispatch.

| Job | Gate | Enforces |
|---|---|---|
| `verify` | import boundaries | **Rule 1** — `core-*` never imports a domain |
| | `pnpm -r typecheck` | Rules 4, 5, 11 are type-enforced |
| | `pnpm -r test` | 129 unit tests |
| | `pnpm registry:check` | **Rule 10** — every capability ships ≥3 examples |
| | registry artefacts current | generated ≠ committed is silent drift |
| `golden-set` | deterministic floor + tolerance gate | **Rule 12** — routing regressions are caught, not argued about |
| `audit` | `pnpm audit --audit-level high` | dependency CVEs |

`verify` runs the boundary check first: it is the cheapest gate and the most
architecturally load-bearing, so it should fail in seconds rather than after a
full install-and-typecheck.

---

## Two things the pipeline deliberately does **not** do

### It does not run the model-backed evaluation

`router:eval`, `router:baseline` and `router:calibrate` all need a local Ollama
serving `qwen2.5:1.5b` or `llama3.1:8b`. A GitHub-hosted runner has neither the
model nor the VRAM, and pulling ~1 GB per run to score 200 utterances is not a
sensible use of CI minutes.

Only `router:floor` (`--embedder=hashing --no-stage3`) is gated. Per PLAN.md §10
it is *the only deterministic run*, which is exactly what makes it the regression
net. Measured on this repo, two consecutive floor runs produced **byte-identical
accuracy on every gate**; only `generatedAt` and the latency percentiles moved
(p95 0.228 ms → 0.277 ms). That asymmetry is the whole design: **compare accuracy,
never compare latency.**

To add the model-backed run later, use a self-hosted runner with Ollama already
warm, gate it on `workflow_dispatch` plus a nightly schedule rather than per-PR,
and keep the tolerance at ±0.05 — the 8B non-determinism in WP-01 Finding 10 (7 of
200 entries flipping between identical runs) does not go away on a bigger machine.

### It does not lint

There is no lint to run. `tooling/eslint-config` contains a `package.json` naming
`"main": "index.js"` and **no `index.js`**, no ESLint dependency, and not one
package in the workspace defines a `lint` script.

The root `pnpm lint` has since been **removed** rather than left in place: `pnpm -r
lint` with no matching script does not no-op, it fails with
`ERR_PNPM_RECURSIVE_RUN_NO_SCRIPT`. A documented command that always fails teaches
people to ignore a red result, which is the habit this whole file exists to prevent.
The root `build` script went the same way and for a plainer reason — the workspace
runs TypeScript directly and no package has ever defined `build`. The only real build
in the repo is `pnpm web:build` (Next.js, production).

A CI job wrapping a no-op is worse than no job: it reports green and certifies
nothing. Lint is left out until the config actually exists. That is the one item
of WP-12's stated scope not delivered here.

---

## The golden-set gate, in detail

`pnpm router:floor` **exits 1 by design** — with stage 3 disabled it cannot meet
the absolute accuracy targets and is not meant to (top-1 lands at 0.408 against a
0.90 target). The workflow therefore runs it with `|| true`. That is not a
silenced failure; the real gate is the next step.

[`tooling/scripts/check-scorecard.mjs`](../../tooling/scripts/check-scorecard.mjs)
compares the fresh scorecard against the committed baseline and fails on:

- **Regression** — any gate whose `actual` drops more than the tolerance (default
  **±0.05**) below baseline. Improvements beyond tolerance are reported, not
  failed, with a note to commit the new scorecard.
- **Staleness** — a committed scorecard whose `config.thresholds` no longer match
  `thresholdsFor(embedder)` in `packages/core-intent/src/config.ts`. One was found
  in exactly that state during WP-01: committed, plausible, and asserting a
  `tauFloor` the codebase had already abandoned. It went stale within hours of
  being written, which is why this is a gate and not a review item.
- **Safety violations** — any non-zero count. No tolerance applies; one is a defect.

Why tolerance and not equality: a 20-entry bucket cannot resolve a 95% target to
better than ±5%, so exact scorecard comparison flaps on noise while measuring
nothing. Verified against four synthetic scorecards — a 0.108 drop fails, a 0.033
drop passes, an injected stale `tauFloor` fails, and an injected safety violation
fails.

---

## Learnings from wiring this up

Each of these cost a real debugging cycle. They are recorded so the next agent
does not pay for them twice.

**`engines.node` is wrong.** `package.json` declares `">=20"`. The repo cannot run
on Node 20. It executes TypeScript through `node` directly — `node
scripts/build-registry.ts`, `node src/index.ts`, and `eval/*.js` importing
`../src/config.ts` — which needs unflagged type stripping (**Node 23.6+**), and
`packages/data` needs `node:sqlite` (22.5+). On Node 20 `pnpm install` succeeds
and everything then fails at run time. CI pins **Node 24**. The declared range
should be corrected to match; it is left alone here because it is a published
constraint, not a CI detail.

**Five `package.json` files carry a UTF-8 BOM** — `tooling/eslint-config`,
`tooling/tsconfig`, `packages/core-voice`, `packages/ui`, `services/api`. They were
written by PowerShell, whose `Set-Content` defaults to the ANSI/BOM'd encodings.
`JSON.parse` rejects a BOM outright, so any tool that reads a manifest must strip
`﻿` first. Both scripts here do. pnpm tolerates them, which is why this went
unnoticed.

**`jq` is not on PATH on this machine**, despite Git Bash being present. The first
version of the SessionStart hook was written around `jq` and silently emitted
nothing. Hook and gate scripts are written in Node, which the repo already
requires. Pipe-test every hook before trusting it.

**Scope the artefact-drift check.** A bare `git diff --quiet` after
`pnpm registry:build` also trips on `pnpm-lock.yaml`, which pnpm rewrites whenever
any workspace manifest changed — an unrelated red build. The check names the three
files the builder writes and nothing else.

**The CVE gate is calibrated, not arbitrary.** It blocks on high and critical only.
The sole advisory in the pre-WP-09 dependency set was one moderate
(`drizzle-kit > @esbuild-kit/esm-loader > esbuild`).

**This prediction came true, and is resolved — 2026-08-31.** WP-09 landed and the
job went red exactly as forecast: `pnpm audit --audit-level high` exited 1 on two
high PostCSS advisories, GHSA-6g55-p6wh-862q and GHSA-r28c-9q8g-f849, both reached
through `apps__web > next > postcss`.

The fix was **not** bumping Next, which is what this section originally assumed.
Next 15.5.24 depends on postcss at an *exact* pin of `8.4.31`, so the only version
of Next that could move it is 16.x — a major upgrade, and no way to carry a security
fix. Instead there is now a resolution override in `pnpm-workspace.yaml` pinning
`postcss: ^8.5.26`, a patch-level move inside 8.x that Next uses only in its CSS
build pipeline. The audit went from 5 advisories (3 moderate, 2 high) to 1 moderate,
and the gate exits 0.

⚠️ **Overrides live in `pnpm-workspace.yaml`, never in `package.json`.** pnpm 11.1.2
reads its settings from the workspace file; a `pnpm.overrides` block in
`package.json` is accepted without complaint and silently ignored. `pnpm config list`
is the way to tell the difference — if the key is not in that output, pnpm is not
using it, no matter how many times you reinstall.

---

## Deploy

No deploy job yet, deliberately. `apps/web` is under construction (WP-09) and
[ADR-008](../decisions/ADR-008.md) keeps the device as the source of truth, so
there is no server on the critical path to ship.

MCP connectivity was verified during this work: **Supabase** and **Vercel** both
authenticate and respond. Neither holds a project for this repo — the only
project on either account is `WeFitAll`, unrelated. Nothing was created; a
deploy target is a decision to make when there is something to deploy, and
`vercel.create_git_project` needs the GitHub repository to exist first.

Still requiring authorization before they can be used: Atlassian, Gmail, Google
Calendar, Google Drive, Figma. These need an interactive OAuth flow through
claude.ai connector settings.

---

## Repository — one step still owed

The repository was **not** created. `gh` is installed (2.89.0) and the active
account is `andrecpramos`, but the stored token is invalid — `gh api user` returns
`401 Bad credentials` and `gh auth status` reports *"The token in keyring is
invalid."* Re-authenticating needs an interactive browser flow, which a
non-interactive session cannot perform.

Everything else is ready. `main` has been fast-forwarded to `wp-01-1b-validation`
(a strict fast-forward — 8 ahead, 0 behind, nothing rewritten), so the CI workflow
is on the default branch and runs on the first push. No remote is configured yet,
deliberately: `gh repo create --source=.` adds it.

To finish, in an interactive terminal:

```bash
gh auth login -h github.com          # browser flow, needs 'repo' scope
gh repo create "AI Interface" --private --source=. --remote=origin --push
```

GitHub slugs the name to **`AI-Interface`**; the display name keeps the space.
Verify with `gh repo view --json name,visibility,defaultBranchRef`.

The first CI run is expected **green**: typecheck, 129 tests, `registry:check`,
the boundary check and the scorecard gate were all run locally against this commit
and pass, and on committed dependencies `pnpm audit --audit-level high` finds
nothing (the PostCSS advisories belong to `apps/web`, which is not committed yet).

Note that `packages/ui` and `apps/web` were under active construction in this
working tree by a concurrent session while WP-12 was implemented, and are **not**
part of the WP-12 commit. Push order matters: whoever commits that work should
re-run the gates, because it is what will first turn the `audit` job red.

**Done — 2026-08-31.** That work was committed on `wp-01-1b-validation` and every
gate was re-run against it: boundary check, `pnpm -r typecheck`, `pnpm -r test`
(248), `pnpm registry:check`, `pnpm install --frozen-lockfile`, and
`pnpm audit --audit-level high`. The audit was the one that failed, and it is fixed
above. One discrepancy worth noting rather than quietly editing: this section
records 129 tests for the WP-12 commit, but `pnpm -r test` reports 248 both before
and after the UI work — `packages/ui` and `apps/web` add no tests of their own, so
the two numbers should agree. Whoever wrote the 129 should confirm which is right.
