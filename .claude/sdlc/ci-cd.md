# CI/CD

The pipeline is [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml). Its gate
strategy and rationale are [ADR-011](../decisions/ADR-011.md): CI gates on deterministic
runs and tolerances, never on model accuracy. Which rule each gate holds up, and which rules
nothing holds up, is the register in
[critical-infrastructure.md](../docs/critical-infrastructure.md).

---

## What runs

On every push and pull request to `develop` and `main`, and on manual dispatch.

| Job | Step | Enforces |
|---|---|---|
| `guard-production` | a PR into `main` must come from `develop` | the branching contract ([branching.md](branching.md)) |
| `verify` | import boundaries | **Rule 1** — `core-*` depend only on other `core-*` |
| | prompt fencing | **Rule 15** — untrusted text is fenced in every prompt |
| | model numerics | **Rule 2** — the model's output schema declares no unjustified number |
| | network egress | **Rule 8** — no remote host in runtime source |
| | documentation links | every relative markdown link resolves |
| | `pnpm -r typecheck` | Rules 4 and 11 are partly type-enforced |
| | build the widget | `packages/embed/dist/nextgen.js`, which the gates below read |
| | `adapter/` is current | `build-adapter.mjs --check` |
| | a copy of `adapter/` runs with nothing installed | **Rule 16** — and the source tree it reads is unchanged |
| | stage-3 bundle interop | **Rule 8** — what `build` writes is what the same-origin transport reads |
| | `pnpm -r test` | every unit test, six packages |
| | `pnpm registry:check` | **Rule 10** — every capability ships at least 3 examples |
| | thresholds match their calibration | **Rule 14** |
| | derived artefacts are current | indexes, per-registry thresholds, browser parity, rule provenance |
| | accessibility | no serious or critical axe violation in any state of the built widget |
| | strict CSP, in a real browser | the widget starts, answers and navigates under `default-src 'self'` |
| | generated registries still decide the same way | **Rules 12 and 19** — every per-turn decision on the fixture app, and no wrong move |
| `golden-set` | deterministic floor + tolerance gate | **Rule 12** — routing regressions on the router's frozen fixture |
| `audit` | `pnpm audit --audit-level high` | dependency CVEs (high and critical block) |

`verify` runs the boundary check first: it is the cheapest gate and the most architecturally
load-bearing, so it should fail in seconds rather than after a full typecheck.

`/gates` runs the same list locally from [`sdlc.config.json`](../sdlc.config.json), plus two
gates CI cannot run (`adversarial-live`, `kit-sync`). The config and `ci.yml` must not drift.

### Releases

There is no release workflow and nothing is published. `main` moving is the release, and
CI's run on that push is the check. See [branching.md](branching.md).

---

## Two things the pipeline deliberately does **not** do

### It does not run the model-backed evaluation

`router:eval`, `router:baseline` and `router:calibrate` need a local Ollama serving a model.
A GitHub-hosted runner has neither the model nor the memory, and pulling a model per run to
score a few hundred utterances is not a sensible use of CI minutes.

Only `router:floor` (`--embedder=hashing --no-stage3`) is gated, because it is the only
deterministic run, which is exactly what makes it the regression net. Two consecutive floor
runs produce byte-identical accuracy on every gate; only `generatedAt` and the latency
percentiles move. That asymmetry is the whole design: **compare accuracy, never compare
latency.**

To add the model-backed run later, use a self-hosted runner with Ollama already warm, gate it
on `workflow_dispatch` plus a nightly schedule rather than per-PR, and keep the tolerance at
±0.05: an 8B model at temperature 0 still flips about 7 of 200 entries between identical
runs, and that does not go away on a bigger machine.

### It does not lint

No package defines a `lint` script and there is no ESLint dependency, so there is no lint to
run. A CI job wrapping a no-op reports green and certifies nothing, and `pnpm -r lint` with
no matching script fails rather than no-ops — a documented command that always fails teaches
people to ignore a red result. Lint is left out until a config actually exists. See
[coding-standards.md](../docs/coding-standards.md).

---

## The golden-set gate, in detail

With stage 3 disabled, `pnpm router:floor` cannot meet the full cascade's absolute accuracy
targets and is not meant to. It runs with `--report-targets`: missed targets are printed, not
failed, and it exits non-zero only on a crash or a safety violation.

[`tooling/scripts/check-scorecard.mjs`](../../tooling/scripts/check-scorecard.mjs) compares
the fresh scorecard against the committed baseline. It refuses to compare (exit 2) a
**current scorecard that was not regenerated** — one whose `generatedAt` is the baseline's —
and otherwise fails on:

- **Regression** — any gate whose `actual` drops more than the tolerance (default **±0.05**)
  below baseline. Improvements beyond tolerance are reported, not failed, with a note to
  commit the new scorecard.
- **Staleness** — a committed scorecard whose `config.thresholds` no longer match
  `thresholdsFor(embedder)` in `packages/core-intent/src/config.ts`.
- **Safety violations** — any non-zero count. No tolerance applies; one is a defect.

Why tolerance and not equality: a 20-entry bucket cannot resolve a 95% target to better than
±5%, so exact scorecard comparison flaps on noise while measuring nothing.

---

## Things that cost a debugging cycle

**`engines.node` is wrong.** `package.json` declares `">=20"`, but the repository runs
TypeScript through `node` directly (`node --experimental-strip-types …`, and `eval/*.js`
importing `../src/config.ts`), which needs unflagged type stripping: **Node 23.6+**. On Node
20 `pnpm install` succeeds and everything then fails at run time. What an adopter runs is
`adapter/scan.mjs`, a bundle with no TypeScript in it, and `check-adapter.mjs` proves that on
Node 20. CI pins **Node 24**.

**A fresh clone needs `pnpm install --ignore-scripts`.** pnpm 11 exits 1 with
`ERR_PNPM_IGNORED_BUILDS`, and the `onlyBuiltDependencies` list in `pnpm-workspace.yaml`
does not suppress it. A working checkout hides this, because a populated `node_modules`
leaves no builds to ignore. Nothing here needs a native build, so CI does exactly this.

**`JSON.parse` rejects a UTF-8 BOM; pnpm tolerates one.** A manifest written from
PowerShell's `Set-Content` can break a tool with every install still green. The scripts
here strip `﻿` before parsing.

**Hooks and gates are written in Node.** `jq` is not reliably on PATH on Windows, and a hook
written around it silently emitted nothing. Pipe-test every hook before trusting it.

**Scope any artefact-drift check.** A bare `git diff --quiet` after a regeneration also trips
on `pnpm-lock.yaml`, which pnpm rewrites whenever a workspace manifest changes.
`build-adapter.mjs --check` and `check-derived-artefacts.mjs` compare the named artefacts
against a rebuild in memory and nothing else.

**Overrides live in `pnpm-workspace.yaml`, never in `package.json`.** pnpm 11 reads its
settings from the workspace file; a `pnpm.overrides` block in `package.json` is accepted
without complaint and silently ignored. `pnpm config list` tells the difference.

---

## Deploy

No deploy job, deliberately. Adopters copy `adapter/` out of the repository, and the widget
needs no server of ours on the critical path (Rule 8).
