# Status

**As of 2026-09-20, branch `feature/drop-in-reset`.** One page. If it disagrees with the code,
the code wins and this page is the bug. The plan, the rules and the full work-package log are
in [PLAN.md](PLAN.md); this is what you read first.

## What this is

A drop-in AI navigation layer for a web app that already exists. A developer copies one folder
([`adapter/`](../adapter/)) into their repository; it reads the app's routes, roles and text,
and generates what the app's users then get: an assistant that takes them where they asked to
go and says what they will find there. Nothing is installed, nothing calls out, and no file of
the adopter's is modified.

## The engine, in two artefacts

| Runs | Where | Source | Ships as |
|---|---|---|---|
| **Scanner** — `init`, `build`, `doctor`, `calibrate` | once, on the adopter's machine | `kit` + `generator` | `adapter/scan.mjs` (3.6 MB, no dependencies) |
| **Assistant** — the three-stage router and the widget | in each visitor's browser | `embed` + `core-intent` | `adapter/runtime/nextgen.js` (86 KB) |

`preview/` is a bench for judging the result and is never exported. `core-capability`,
`core-inference` and `core-intent` are the engine both artefacts are built from, and sit below
everything else. No package is installable or published
([ADR-021](../.claude/decisions/ADR-021.md)). The structure and the one dependency rule are in
[architecture.md](../.claude/docs/architecture.md).

## What was verified today

Run on this branch, not quoted: typecheck clean; all unit tests pass; the Rule 1, egress,
prompt-fencing and model-numerics gates; documentation links; registry validation;
`adapter/` is current and **a copy of it runs in a directory with no `node_modules` and every
network path throwing**; stage-3 interop; derived artefacts and thresholds; the accessibility
audit of the built widget; the widget under a strict CSP in a real browser; the golden-set
gate; and the bench in a headless browser.

**Not run today:** anything needing a model server (`router:eval`, `adversarial-live`), and
the two checks only a person can make (below).

## What is measured, and where

Quoted from the repository, not re-measured today.

- **It reads apps it has never seen.** Six public apps, six routing frameworks, ground truth
  written first: 55 of 55 destinations, 0 wrongly declared, 0 files changed
  ([field-apps/RESULT.md](../eval/field-apps/RESULT.md)).
- **It does not leak screens between roles — after it did, once.** On a seventh app the first
  run leaked 15 of 48 role assignments and a pre-committed kill criterion fired; re-measured
  against the same ground truth, 48 of 48 and 0 leaks
  ([tutor-app/RESULT.md](../eval/tutor-app/RESULT.md)).
- **Routing quality**, on the reference fixture with no model: 0% sent to a wrong screen, 3.7%
  of in-scope questions wrongly refused, 50% of out-of-scope requests refused
  ([README](../README.md)). For most questions it *offers* up to three screens rather than
  deciding. PLAN.md §0 records that stages 1 and 2 settle **15.7%** of turns outright, while the
  README's table counts every turn that ended in a decision without a model; the two use
  different definitions of "settled", so read each source before quoting either.

## What is not done — and whose it is

| | Item | Who |
|---|---|---|
| 1 | **The owner's acceptance run** on a real application ([ACCEPTANCE-RUN.md](ACCEPTANCE-RUN.md), WP-35). Also the first time anyone but the author uses it, and the first measurement of the 15.7% on real questions | **owner** |
| 2 | **The screen-reader pass** ([NVDA-CHECKLIST.md](../eval/a11y/NVDA-CHECKLIST.md), about 15 minutes). Until then the claim is *"automated checks pass; no screen reader has confirmed it"* | **owner** |
| 3 | **Accept or reject [ADR-021](../.claude/decisions/ADR-021.md)** — retiring the tarball path, and repointing Rule 1 | **owner** |
| 4 | Decide whether Rules 5 (dispatcher policy) and 6 (money) stay. Both govern code that no longer exists; they are kept as tripwires for when WP-48's trigger fires | **owner** |
| 5 | `core-capability` exports code for hand-declared capabilities that nothing outside it calls (23 of its 41 exports are used by no production code outside the package). Removing it changes the engine's public surface, so it waits on a decision about the capability ladder | **owner** |
| 6 | `adapter/` carries no version: an adopter can say which commit they copied, not which release | when there is an adopter |
| 7 | WP-48, the prompt-injection defence — must land **before** any `write` or `destructive` capability ships | deferred, hard trigger |

## Known limits, stated rather than hidden

- **A guard written inside a page component is invisible to route discovery**, so such an app
  generates one audience and every screen reaches everyone. `init` warns and `doctor` lists the
  roles it found; the adopter has to compare them with their own
  ([FIELD-NOTES.md §1](../adapter/FIELD-NOTES.md)).
- **It declines about half of the requests for things the app cannot do.** It executes none of
  them and asks a question for the rest. A measured ceiling, accepted (PLAN.md §13, D-5).
- **The cheaper-inference claim is withdrawn.** On the private pilot, turns settling without a
  model fell far short of the 60% kill criterion (PLAN.md §13, D-4). What is claimed is a
  better way to navigate, not a cheaper one.
- **The scanner cannot use a model to write descriptions**, by construction. Descriptions come
  from the app's own labels.
- **The golden sets' questions are model-written**, so every accuracy number is an upper bound
  until real users ask real questions.

## Where to go next

| You want to… | Read |
|---|---|
| add it to an app | [GETTING-STARTED.md](GETTING-STARTED.md) |
| judge what an adopter would get | `pnpm preview` — [preview/README.md](../preview/README.md) |
| understand how it is built | [architecture.md](../.claude/docs/architecture.md), then [README.md](../README.md) |
| work on it | [CLAUDE.md](../CLAUDE.md), then the `new-feature` skill |
| see what was decided and why | [.claude/decisions/](../.claude/decisions/) |
| see what is enforced by what | [critical-infrastructure.md](../.claude/docs/critical-infrastructure.md) |
