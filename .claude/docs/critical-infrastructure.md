# Critical infrastructure and the rules that bind it

> **Audited against the tree:** 2026-09-09, on `feature/sdlc-kit` (cut from `develop`).
> Re-audit trigger: any change to `.github/workflows/ci.yml`, any new gate, any
> new rule in PLAN.md §2, or a release.

Every component whose failure is not a local bug, the rules that govern it,
**where each rule is actually enforced**, and whether it is currently obeyed.

The distinction that runs through this document is between a rule that is
*written down* and a rule that is *enforced*. A written rule is obeyed until
someone is in a hurry. Every row says which kind it is, and
[the gap list](#enforcement-gaps-ranked) collects the ones that are only written
down.

**Nothing here claims protection that does not exist.** If a cell says
`convention`, there is no gate.

Rule numbers are [PLAN.md](../../PLAN.md) §2. The ADRs in [decisions/](../../.claude/decisions)
are the constitution; this file maps how they are held up. The machine-readable
version of the gate list is [`sdlc.config.json`](../sdlc.config.json).

---

## 0 · The finding that reframes every row below

**No gate in this repository can block a merge.**

`GET /repos/andrecpramos/AI-Interface/branches/{develop,main}/protection` returns
**403 — "Upgrade to GitHub Pro or make this repository public to enable this
feature."** Branch protection is unavailable on a private repository on this plan.

Every consequence follows from that one fact:

- CI jobs go red. Nothing stops the merge button.
- The `guard-production` job — "only develop may merge to main" — **fails the run
  and prevents nothing.** [sdlc/branching.md](../sdlc/branching.md) lists it as the
  "Repository" enforcement layer. That layer does not mechanically exist.
- Every `"blocking": true` in `sdlc.config.json` means *policy says do not merge
  this*, not *the platform will not let you*.

This is not a reason to remove the CI jobs — a red build a human respects is real
enforcement, and it is what this repo has. It is a reason to stop describing them
as though they were mechanical, and to know that **the local hooks are the only
enforcement that actually denies anything.**

---

## 1 · The capability registry and its codegen

**What.** `packages/domain-*/src/capabilities.ts` is the only contract between the
engine and a domain. One declaration generates three artefacts: the registry the
router matches against, the route table the app navigates by, and the golden-set
fixtures asserting those two agree.

**Blast radius.** A wrong or stale registry means the router reaches a route that
does not exist, or a screen the AI cannot see. It is the single point every other
subsystem reads.

| Rule | Enforcement | Status |
|---|---|---|
| Rule 10 — every capability ships ≥3 examples | `pnpm registry:check` in CI (`registry-check` gate) | **enforced** |
| Rule 13 — limits declared, not inferred | the `unsupported` kind + `defineBoundary`, asserted in both domains' tests | **enforced** |
| Generated artefacts match the committed ones | CI step "Registry artefacts are current" | ⚠️ **2 of 3 paths vacuous — see below** |

> ⚠️ **The staleness gate is two-thirds decorative.**
>
> `pnpm registry:build` resolves to `--filter @nextgen/domain-modules`. Reading
> `packages/domain-modules/scripts/build-registry.ts:33-66`, that build writes
> exactly three files:
>
> - `packages/core-intent/eval/registry.json` (`OUT_INTENT`)
> - `packages/domain-modules/generated/routes.json`
> - `packages/domain-modules/generated/golden.generated.jsonl`
>
> The CI step (`ci.yml:95-105`) diffs:
>
> - `packages/core-intent/eval/registry.json` ✅ real
> - `packages/domain-finance/generated/routes.json` ❌ **this build never writes it**
> - `packages/domain-finance/generated/golden.generated.jsonl` ❌ **likewise**
>
> Those two finance files are dated 30 Aug and have not moved since. The gate
> therefore passes on them unconditionally. Real drift in
> `domain-modules/generated/` — the domain that is actually authoritative — is
> **ungated**.
>
> `sdlc.config.json`'s `registry-stale` gate already diffs
> `packages/domain-modules/generated`, so `/gates` checks the right thing while
> CI does not. That divergence is itself a defect: they must be the same command.

> ⚠️ **The underlying fragility: `OUT_INTENT` is one global path.**
> Every domain's `build-registry.ts` writes the same
> `packages/core-intent/eval/registry.json`, so **only one domain's build can be
> authoritative at a time**. `pnpm registry:build` (domain-modules) is the
> authoritative one; `pnpm registry:build:finance` silently replaces the registry
> the router reads. The script's own header comment flags this at line 23.
>
> Mitigated locally: `guard.extraDeny` in `sdlc.config.json` now denies
> `pnpm registry:build:finance` and names the alternative. That is a hook, not a
> fix — a third domain forces the real one.

---

## 2 · The engine/domain boundary

**What.** `packages/core-*` must never import a domain. Domains register *into*
the engine; the engine never enumerates them.

**Blast radius.** The invariant the entire "how little code does a new domain
need" thesis rests on. Once broken it is rarely broken back.

| Rule | Enforcement | Status |
|---|---|---|
| Rule 1 — core never imports a domain | `node tooling/scripts/check-import-boundaries.mjs`, in CI and as a `postEdit` hook on every `packages/core-*` write | **enforced** |
| Rule 5 — policy is code in the dispatcher, never prompt text | `core-dispatch` tests | **enforced** |

The `postEdit` hook is the addition from this install: the boundary check now runs
within ~75ms of any edit to `packages/core-*`, so the failure arrives while the
change is still in the agent's head rather than in CI.

---

## 3 · The router and its calibration

**What.** The three-stage cascade, its thresholds, and the golden-set scorecard
that says whether it still works.

**Blast radius.** Degrades **quietly**. Accuracy falls a fraction per capability
added, with no bug report, because nothing breaks.

| Rule | Enforcement | Status |
|---|---|---|
| Rule 12 — a routing bug is not fixed until it is a permanent golden-set entry | none | **convention** |
| Rule 14 — thresholds are calibrated per encoder, never hand-set | none on this branch — `tooling/scripts/check-thresholds.mjs` **does not exist here** | **convention** |
| Golden-set regression against the committed baseline | `check-scorecard.mjs`, tolerance 0.05, in CI | **enforced** (subject to §0) |

> Note on `pnpm router:floor || true` in `ci.yml:137` — this is **not** a silenced
> failure. The floor run exits 1 by design: with stage 3 disabled it cannot meet
> absolute accuracy targets and is not meant to. The gate is the scorecard
> comparison in the next step. `sdlc.config.json` records this as
> `expectNonZero: true` so no runner misreports it.

> ⚠️ Rule 14 is cited in PLAN.md as costing accuracy three times, and on this
> branch **nothing checks it.** `check-thresholds.mjs` exists on
> `docs/plan-restructure`, unmerged. Until that lands, a hand-edited threshold
> ships silently. The `postEdit` reminder on `packages/core-intent/eval/**` is a
> nudge, not a gate.

---

## 4 · The branching contract

**What.** `main` is production and moves only on request; `develop` takes
everything; branches cut from `develop`.

**Blast radius.** A branch cut from `main` silently reverts integrated work on
merge. An unrequested push to production ships whatever happened to be local.

| Layer | Mechanism | Status |
|---|---|---|
| Context | [CLAUDE.md](../../CLAUDE.md), loaded every session | **enforced** (for agents) |
| Session | `.claude/hooks/branch-check.mjs` on `SessionStart`/`PreCompact`, live git state | **enforced** (for agents) |
| Local | `.claude/hooks/guard-git.mjs` on `PreToolUse` — **the only layer that denies anything** | **enforced** (for agents) |
| Repository | `guard-production` job in `ci.yml:43` | ⚠️ **advisory only — see §0** |

**Every one of these binds agents, not humans.** A person can push to `main` from
this checkout and nothing in the repository will stop them. That is a deliberate
choice recorded in [sdlc/branching.md](../sdlc/branching.md) — a protection rule
would also block the maintainer's own release push — but it means the contract's
real enforcement surface is exactly one hook file.

---

## 5 · The shared working tree

**What.** More than one agent session works in this checkout simultaneously.

**Blast radius.** Not hypothetical: nine component files, a modified manifest and
a lockfile-rewriting install landed in this tree from another session inside a
four-minute window during WP-12. Nothing was lost only because that session
staged named paths.

| Rule | Enforcement | Status |
|---|---|---|
| Never `git add -A` / `git add .` / `git commit -a` | `guard-git.mjs`, active because `sharedTree: true` | **enforced (new, this install)** |
| Re-check `git status` immediately before committing | `ship-it` skill | **convention** |
| A dirty file you did not create is someone else's | CLAUDE.md | **convention** |

Before this install, all three were convention. The first is now denied at the
tool call.

---

## Enforcement gaps, ranked

By blast radius first, cost to fix second.

| # | Gap | Blast radius | Cheapest fix | Effort |
|---|---|---|---|---|
| 1 | **CI staleness gate diffs `domain-finance/generated`, which `pnpm registry:build` never writes.** 2 of 3 paths pass vacuously | Registry drift in the authoritative domain ships ungated. Router reaches routes that do not exist; nobody learns until a user does | In `ci.yml:98-100`, change the two `domain-finance` paths to `packages/domain-modules/generated`. `sdlc.config.json`'s `registry-stale` gate already has it right — copy that command | **S** |
| 2 | **Rule 14 (calibrated thresholds) is enforced by nothing on `develop`** | A hand-edited threshold ships silently. PLAN.md records this class of mistake costing accuracy three times | Merge `docs/plan-restructure` (which carries `check-thresholds.mjs`), or port that one script and add it to the gate list | **S** |
| 3 | **No gate can block a merge** (§0) | Every "blocking" claim in the docs is policy, not mechanism | Make the repo public, or upgrade the plan, then require the `quality` and `golden-set` checks on `develop`. If neither: change the docs to say "policy", not "blocks" | **S** (doc) / **M** (plan) |
| 4 | Rule 12 — a routing bug must become a permanent golden-set entry | The same misrouting reappears the next time a capability is added | Nothing mechanical can check this. Add it to the PR template as a checkbox and accept it is a convention | **S** |
| 5 | No linter configured — no `tooling/eslint-config`, no `lint` script anywhere | Style and a class of correctness bugs go unchecked; typecheck and tests are the only automated gates | Add a flat ESLint config and one `lint` gate. Do it when it is cheap, not because the register says so | **M** |

---

## Gates seen failing on purpose

A gate nobody has seen fail is a gate nobody knows works. This table starts nearly
empty, which is the honest state.

| Gate | Last seen failing correctly | How it was made to fail |
|---|---|---|
| `guard-git` (broad staging) | 2026-09-09 | Piped `git add -A` to the hook; got a deny naming explicit staging as the alternative |
| `guard-git` (production write) | 2026-09-09 | Piped `git push origin main`; got a deny naming `develop` |
| `guard-git` (branch from production) | 2026-09-09 | Piped `git checkout -b feature/x main`; got a deny with the correct command |
| `guard-git` (echoed text false positive) | 2026-09-09 | Piped a payload *containing* `git add -A` as echoed text; correctly allowed |
| `check-gates` (post-edit failure) | 2026-09-09 | Throwaway repo with a `postEdit` command exiting 1; hook surfaced it and still exited 0 |
| `doc-links` | 2026-09-09 | Added a link to a non-existent file; gate exited 1 naming `file:line` and the target |
| `import-boundaries` | — | not yet deliberately broken |
| `registry-check` | — | not yet deliberately broken |
| `scorecard` | — | not yet deliberately broken |

Fill one row per session rather than claiming the set.
