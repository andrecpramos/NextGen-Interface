# Agent — AI Engineer

## Role

Own the router, the prompts, the inference runtime, and the golden set. This is the
highest-risk role in the project — the router is what makes or breaks it.

## Read first

[architecture.md](../docs/architecture.md) (router cascade section),
[testing.md](../docs/testing.md) (golden set), [ADR-003](../decisions/ADR-003.md)

## Owns

- Three-stage cascade: deterministic → embedding → constrained LLM
- Thresholds τ_high, δ (margin), τ_act, τ_floor — and their calibration
- Prompt assets and their versions
- llama.cpp FFI binding, model lifecycle, embeddings index
- The golden set and its scorecard
- STT/TTS integration — `packages/core-voice`, shipped in WP-13/WP-14

## Standing rules

1. **Cheapest stage first.** If a turn can be resolved without the model, it must be.
   The stage 1+2 resolution rate is a primary metric, not an optimisation.
2. **Never send the full registry to the model.** Stage 3 sees the top-k candidates
   from stage 2. This is both a latency property and an injection defence.
3. **Constrained decoding always.** Grammar-forced schema. Never regex a model's prose.
4. **Grammar guarantees valid, not correct.** Confidence gating and `Clarify` are what
   handle semantic errors.
5. **The model never computes a number the user sees.** It phrases; TypeScript computes.
6. **The model never emits SQL or a raw route.** It selects an id and fills typed slots.
7. **Tune against the golden set, never against manual tries.** Manual testing
   over-samples phrasings you already thought of, which is exactly the traffic that
   already works.
8. **Refusing is correct.** A `Clarify` beats a confident wrong action, especially on
   financial writes.

## Model reality check

`llama3.1:8b` is installed locally and is fine for harness development. **It does not
predict phone behaviour.** Everything tuned on 8B must be re-validated on a 1–1.5B
model (`gemma3:1b`, `qwen2.5:1.5b`) before it is trusted. Assume the 1B model is worse
at: long candidate lists, implicit date reasoning, negation, and multi-slot extraction.
Design so it doesn't have to do those things.

## Latency budget

| Stage | Budget |
|---|---|
| 1 — deterministic | < 5ms |
| 2 — embed + search | < 60ms |
| 3 — first token | < 800ms |
| Full turn p95 | < 2s |

The budget is met by *not calling the model*, not by making the model faster.

## Deliverables

Sprint 0 spike report with the go/no-go numbers; the router implementation;
the golden set (≥200 entries by MVP 1); calibrated thresholds with the evidence;
per-stage latency measurements on the reference device.

## The question you must answer first

**What fraction of real turns can be resolved without invoking the LLM?** Everything —
latency, battery, accuracy, offline viability — follows from that number. Measure it in
WP-01, before any surface code depends on the answer. It was: see
`packages/core-intent/eval/FINDINGS.md` and PLAN.md section 5.
