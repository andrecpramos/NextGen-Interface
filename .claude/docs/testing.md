# Testing Strategy

Where this file and an accepted ADR disagree, the ADR wins.

The hard problem: **the router's correctness is statistical, and stage 3 is a model.**
Standard unit testing does not cover it. The strategy separates deterministic code (test
normally), model-dependent behaviour (evaluate against a scored dataset, gated on a
*tolerance against a committed baseline*, never on an absolute accuracy —
[ADR-011](../decisions/ADR-011.md)), and built artefacts (prove them where they will run).

## Layers

### 1. Unit — `pnpm test`

vitest, in every package. Fast, no network, no model. The priorities
are where correctness actually lives: slot resolution, the confidence gates and every branch
of the threshold table, registry validation, the claim validator that strips a model's prose
(ADR-019), and the generator's role extraction (Rule 17).

### 2. The golden set — the router's real test

**The most important test asset in the project.** A versioned corpus of utterances paired
with expected outcomes. Two exist, for two different questions:

| Corpus | Answers | Size |
|---|---|---|
| `packages/core-intent/eval/golden-set.jsonl`, against the **frozen** `fixture-registry.json` | how does the router behave *in isolation*? | 85 |
| `eval/frameworks/<app>/golden-set.jsonl`, against what the generator emits for a fixture app | does the whole pipeline — generate, calibrate, route — still decide the same? | 69 for `school` |

```jsonc
{ "id": "gs-0001", "bucket": "direct", "utterance": "remember this",
  "expect": { "capability": "module.capture", "maxStage": "deterministic" } }
```

`maxStage` says the turn must not need a more expensive stage than that. The frozen
corpus is deliberately adversarial, not just happy paths — `direct` 8, `paraphrase` 24,
`ambiguous` 11 (must clarify, **not** guess), `multiturn` 10, `out_of_scope` 13 (must refuse),
`adversarial` 13 (must never reach a destructive capability), `non_english` 6. An app's own
corpus is `navigate`, `explain` and `out_of_scope`, with at least 20 turns, some with
`"route": null`.

**A routing bug is not fixed until it is a golden-set entry** (Rule 12).

What CI gates, and how:

| Gate | What it holds |
|---|---|
| `router:floor` → `check-scorecard.mjs` | the model-free run (hashing encoder, stage 3 off) against the committed baseline scorecard, within a tolerance. Deterministic, so it is the only cascade configuration CI can run |
| `eval:apps:check` | the generated registries still decide the same way as their committed scorecard |
| `check-thresholds.mjs` | thresholds are the calibrated ones, never hand-set (Rule 14) |
| `check-derived-artefacts.mjs` | shipped indexes, thresholds and the browser's decisions follow their inputs |
| `check-adversarial.mjs` | adversarial → destructive stays at **zero**. Needs a model server, so it runs locally, not in CI |

The model-backed runs (`router:eval`, `router:baseline`) need a local Ollama and are
compared by a person. Warm a model with a throwaway call first and run models sequentially,
or every latency figure is meaningless.

### 3. Fixture applications — `eval/frameworks/`

One synthetic app per routing framework (React Router, Next.js, Remix, SvelteKit, Nuxt, Vue
Router, Angular), under `packages/generator/fixtures/`, each reproducing hard cases seen in
the field: one screen at two addresses, placeholder titles, a title untranslated in one of
two languages, a guard on a parent route.

### 4. Public applications we did not write — `eval/field-apps/`, `eval/tutor-app/`

The product's claim is *"it works on a web app it has never seen"*, so it is measured on
public apps with **ground truth written before the tool ran**. The first run on a
three-role app leaked 15 of 48 role assignments and a pre-committed kill criterion fired
(`eval/tutor-app/RESULT.md`). Only documents live here; no application code does.

### 5. The built artefact, where it will run

Unit tests cannot see a failure of a bundle in a bare directory, and every defect found
while building `adapter/` was one. So the artefact is run, not asserted about:

| Gate | Runs |
|---|---|
| `build-adapter.mjs --check` | what is committed in `adapter/` is what `packages/` builds |
| `check-adapter.mjs` | a copy of `adapter/` in a directory with no `node_modules` above it and every network path throwing: `init`, `build`, `doctor`, then a fingerprint of the application to prove nothing was written into it (Rule 16) |
| `check-stage3.mjs` | kit and embed agree on the stage-3 wire, across a mocked network |
| `check-csp.mjs` | the widget under a strict Content-Security-Policy, in a real browser |
| `check-accessibility.mjs` | axe over the **built** widget, every state a user can reach |
| `preview:check` | the bench, in a headless browser, asserting two turns from the golden set |

### 6. Static rule gates

`check-import-boundaries.mjs` (Rule 1), `check-prompt-fencing.mjs` (Rule 15),
`check-model-numerics.mjs` (Rule 2), `check-network-egress.mjs` (Rule 8),
`check-doc-links.mjs`, and `pnpm registry:check` (Rule 10). Each was made to fail on
purpose before it was trusted; the record is in
[critical-infrastructure.md](./critical-infrastructure.md), "Gates seen failing on purpose".

### 7. What only a person can check

A screen-reader pass ([`eval/a11y/NVDA-CHECKLIST.md`](../../eval/a11y/NVDA-CHECKLIST.md),
about 15 minutes), and an acceptance run on a real application by someone who did not
build the tool. Until they are done the claims are *"automated accessibility checks pass;
no screen reader has confirmed it"*, and no cost-per-session figure at all.

## Test data

Fixtures are synthetic and checked in. **No real application's structure lives here.**
The reference fixture in `eval/frameworks/` reproduces the hard cases real apps present —
two addresses for one screen, placeholder titles, untranslated duplicates, wrapper pages —
in a made-up school portal.

## CI

`.github/workflows/ci.yml` runs the gates above in `verify` (typecheck, build the widget, every
gate in sections 5 and 6, the unit tests, registry and derived-artefact checks), `golden-set`
(the deterministic floor against the baseline) and `audit`, plus a guard that only `develop`
may merge to `main`. Their
order and what each enforces is in [ci-cd.md](../sdlc/ci-cd.md). Branch protection is not
available on this repository's plan, so every CI gate is advisory in the mechanical sense.
