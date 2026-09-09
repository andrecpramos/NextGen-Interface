# Testing Strategy

The hard problem: **the router is non-deterministic and its correctness is
statistical.** Standard unit testing does not cover it. The strategy below separates
deterministic code (test normally) from model-dependent behaviour (evaluate against a
scored dataset, with thresholds enforced in CI).

## Layers

### 1. Unit — 80%+ coverage target

Domain logic, use cases, resolvers, scoring, policy. Fast, no I/O, no model.

Priority targets, because these are where correctness actually lives:
- Money arithmetic — int minor units, rounding, currency mismatch, negatives
- Date-range parsing — "last month", "this week", "since March", boundaries,
  month-end, leap years, DST, timezone conversion
- Slot resolution — enum matching, fuzzy category matching, ambiguity detection
- Confidence gating — every branch of the threshold table
- Dispatcher policy — each `CapabilityKind`, plus the unclassified fail-closed path

### 2. Golden set — the real router test

**The most important test asset in the project.** A versioned corpus of utterances
paired with expected outcomes.

```jsonc
{
  "id": "gs-0142",
  "utterance": "how much did I spend on food last month",
  "context":   { "route": "/home", "today": "2026-08-29" },
  "expect": {
    "capability": "spending.by_category",
    "params": { "category": "food", "from": "2026-07-01", "to": "2026-07-31" },
    "maxStage": "embedding"        // must NOT need the LLM
  }
}
```

Composition — deliberately adversarial, not just happy paths:

| Bucket | Share | Purpose |
|---|---|---|
| Direct commands | 20% | stage-1 coverage |
| Natural paraphrase | 30% | stage-2 coverage |
| Ambiguous | 15% | must produce `Clarify`, **not** a guess |
| Multi-turn / pronouns | 10% | context resolution |
| Out of scope | 10% | must produce `OutOfScope`, not a hallucinated action |
| Adversarial / injection | 10% | must never reach a destructive capability |
| Non-English + accented | 5% | locale handling |

Minimum 200 entries by end of MVP 1. Grows from real traces (with consent) and from
every bug: **a routing bug is not fixed until it is a golden-set entry.**

CI gates:

| Gate | Threshold |
|---|---|
| Top-1 capability accuracy | ≥ 90%, no regression vs. `develop` |
| Param exactness on matched capability | ≥ 85% |
| Ambiguous → Clarify | ≥ 95% |
| Out-of-scope → OutOfScope | ≥ 95% |
| Adversarial → destructive capability | **0 tolerance** |
| Stage 1+2 resolution rate | ≥ 65% |

Run on every commit against the reference model. A prompt change, threshold change,
model swap, or registry change all re-run this suite. Results are committed as a
scorecard so regressions are visible in the diff.

### 3. Integration

Full pipeline with a **fake LLM runtime** returning scripted outputs — deterministic,
fast, runs everywhere. Tests: utterance → intent → action → DB write → navigation →
trace recorded. Also every failure path: model timeout, model missing, empty result,
confirmation rejected, undo.

### 4. Navigation

For every registry entry: the route exists, required params are declared, the screen
builds with those params, deep links resolve, back stack is sane. Generated from the
registry — a new capability without a working route fails CI automatically.

### 5. Widget & golden image

Assistant surface in each sphere state, confirmation card, trace viewer, charts.
Golden images for light/dark and for 200% text scale.

### 6. Voice

- STT: fixed audio corpus (clean, noisy, accented, PT + EN), assert WER below
  threshold; end-to-end intent accuracy from audio matters more than raw WER
- TTS: no crash on long/numeric/currency strings; barge-in cancels within 200ms
- Permission-denied and mic-busy paths

### 7. Performance — on real hardware

Emulator numbers are meaningless for inference. Reference devices: one mid-range
Android (the binding constraint), one recent iPhone.

| Metric | Budget |
|---|---|
| Cold start to interactive | < 2s |
| Stage 1 | < 5ms |
| Stage 2 (embed + search) | < 60ms |
| Stage 3 first token | < 800ms |
| Full turn p95, text in | < 2s |
| Full turn p95, voice in | < 3s |
| Peak RSS with model loaded | < 1.2 GB |
| Battery, 10-min session | < 4% |
| Sustained inference thermal | no throttle in 20 turns |

### 8. Security

Automated: no sensitive data in logs; DB unreadable without key; telemetry scrubber
rejects known-sensitive payloads; model hash verification fails closed.

Manual before each release: injection corpus, key storage review, permission audit.

## Test data

Deterministic seeded fixtures for a synthetic user with ~500 transactions across 18
months. Same seed everywhere, so a failing assertion is reproducible. **No real
financial data in fixtures**, including the developer's own.

## CI

Every PR: analyze → format check → unit → integration → navigation → golden set →
widget. Nightly: performance on device farm, security scan, full voice corpus.

Merge blocked on: any test failure, coverage below 80%, golden-set regression, or a
new capability without examples.
