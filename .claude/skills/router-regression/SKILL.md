---
name: router-regression
description: Diagnose and fix a drop in router accuracy — a failing golden-set gate, a red check-scorecard.mjs comparison, a bucket that regressed, or a capability the router stopped reaching. Use when router:floor / router:eval scores fall, when CI's golden-set job goes red, or before touching any threshold.
---

# Diagnosing a router regression

**A drop is a defect, not noise.** The router is statistical but the corpus is
fixed — the same golden set against the same encoder gives the same answer. If
the number moved, something you changed moved it.

**The one rule that governs this whole skill: never raise a threshold to make a
failing case pass.** Thresholds are calibrated against the full corpus with an
explicit objective, never hand-set and never copied between encoders (Rule 14).
Hand-tuning has cost accuracy three times in this repo — Findings 1 and 11.
Raising a threshold moves the symptom, keeps the cause, and quietly rots the
router for every capability that was fine.

## Step 1 — reproduce deterministically

```bash
pnpm router:floor       # stages 1+2 only, hashing encoder: no Ollama, no variance
```

This is the **only** deterministic configuration, which is why it is the one CI
gates. It exits non-zero by design — with stage 3 disabled it cannot meet
absolute accuracy targets and is not meant to. Ignore the exit code; read the
scorecard.

Compare against the committed baseline, exactly as CI does:

```bash
node tooling/scripts/check-scorecard.mjs \
  --baseline <the committed scorecard from before your change> \
  --current  packages/core-intent/eval/scorecards/hashing-nostage3.json \
  --tolerance 0.05
```

If the floor run is clean and only the model-backed run (`pnpm router:eval`)
moved, you are looking at stage-3 variance, not a routing regression — go to
"When it is stage 3" below.

## Step 2 — read the scorecard, in this order

`packages/core-intent/eval/scorecards/hashing-nostage3.json`:

| Field | What a change in it means |
|---|---|
| `registryOverlap` | **Look here first.** Non-empty means two capabilities' descriptions are semantically close. This is the usual culprit. |
| `buckets` | Which bucket dropped identifies the cause class — see the table below. |
| `stageMix` | Shifting toward `embedding`/stage 3 means the registry is getting crowded. |
| `modelFreeRate` | Falling means stages 1+2 are resolving less; latency and offline viability follow this number. |
| `safetyViolations` | Must be empty. A non-zero adversarial→destructive count is a release blocker, not a regression. |
| `failures` | The individual misses, with what was expected and what was got. |

### What each bucket tells you

| Bucket that dropped | Almost always means |
|---|---|
| `direct` | A trigger string changed or collided. Stage 1 is deterministic — this is a literal-match bug, and the cheapest of all to fix. |
| `paraphrase` | Stage-2 retrieval. A description changed, or a new capability is competing with this one. |
| `ambiguous` | Margins narrowed — two candidates now score too close for `delta` to separate. Same cause as paraphrase, different symptom. |
| `oos` | A boundary entry (ADR-009) stopped matching, or a real capability's description widened until it swallows out-of-scope traffic. |
| `adversarial` | **Stop.** This is a safety gate, not an accuracy metric. Nothing ships until it is zero again. |

## Step 3 — the usual cause, and the actual fix

> A newly added capability whose description semantically overlaps an existing
> one narrows stage-2 margins for **both**.

Confirm it:

```bash
pnpm router:inspect                                   # score distributions, recall@k
node packages/core-intent/eval/inspect.js --embedder=hashing "the failing utterance"
```

`inspect` on a single utterance shows the ranked candidates and their scores.
Two capabilities within `delta` of each other on a phrase that clearly belongs to
one of them is the diagnosis.

**Fix by differentiating the declarations, not the thresholds:**

- Rewrite the two descriptions so they describe what makes them *different*. The
  description is the retrieval surface — adding adjectives to both makes it worse.
- Move an overlapping trigger to whichever capability actually owns it.
- Ask whether the new capability should exist at all. The router recognises the *kind*
  of turn; collapsing two crowded capabilities into one with richer execution is often
  the right fix.
- In a generated registry "the declaration" is what the generator wrote from the
  application's own labels and routes, so the fix is in the generator's naming and trigger
  code, then regenerate. The frozen `packages/core-intent/eval/fixture-registry.json` is
  not edited (`packages/core-intent/eval/README.md`).

Then regenerate and re-run:

```bash
node --experimental-strip-types packages/generator/src/cli.ts \
  eval/frameworks/family/generator.config.json --no-model   # if the generator changed
node --experimental-strip-types eval/frameworks/rebuild-indexes.mjs
pnpm router:floor && pnpm eval:apps
```

## Step 4 — only if the corpus itself changed

If you added golden-set entries and the encoder's operating point genuinely
needs to move, calibrate — do not hand-edit:

```bash
pnpm router:inspect      # distributions FIRST, so you know what you are asking for
pnpm router:calibrate    # sweeps the space, writes scorecards/thresholds-<embedder>.json
```

The objective it optimises is stated in `eval/calibrate.js` and is worth
respecting: maximise the share of turns stage 2 accepts outright, **subject to a
hard floor on the precision of those acceptances**. Precision is a constraint,
not a term to trade. An unnecessary escalation costs ~500ms; a wrong acceptance
on a write capability corrupts data behind a confirmation card the user taps
through.

Thresholds are **per encoder**. `thresholds-hashing.json` and
`thresholds-ollama.json` are not interchangeable — copying one to the other is
Finding 11, and it has already happened once.

## When it is stage 3

The model-backed runs need Ollama on `127.0.0.1:11434` and are not deterministic:

```bash
pnpm router:eval         # qwen2.5:1.5b --topk=3, the selected configuration
pnpm router:baseline     # llama3.1:8b, the historical comparison point
pnpm router:compare      # side-by-side across scorecards
```

Two things make these numbers lie:

1. **Cold load.** Warm the model with one throwaway call before a timed run, or a
   22-second first-token outlier lands in your p95.
2. **Concurrency.** Run models sequentially. Parallel runs share the GPU and the
   latency numbers become meaningless.

And the standing reality check: **8B results do not predict 1B results.**
Anything tuned on `llama3.1:8b` is re-validated on a 1–1.5B model before it is
trusted. Assume the small model is worse at long candidate lists, implicit dates,
negation, and multi-slot extraction — and design so it does not have to do them.

## Step 5 — close it out

Rule 12: **a routing bug is not fixed until it is a permanent golden-set entry.**
Otherwise it returns the next time a capability is added. Add the failing
utterance to `packages/core-intent/eval/golden-set.jsonl` in its correct bucket,
re-run `pnpm router:floor`, and commit the scorecard with the fix.

## Related

- [ADR-003](../../decisions/ADR-003.md) — why the cascade is three stages
- [ADR-009](../../decisions/ADR-009.md) — out-of-scope as retrieval, not judgement
- [ADR-011](../../decisions/ADR-011.md) — why CI gates on tolerances, never on model accuracy
- `packages/core-intent/eval/FINDINGS.md` — Findings 1 and 11, the threshold lessons
