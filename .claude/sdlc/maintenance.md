# SDLC — Maintenance

An AI-driven app degrades differently from a conventional one. Conventional apps break
loudly — a crash, a 500. This one degrades **quietly**: the router gets slightly worse
as capabilities accumulate, and nobody files a bug because nothing "broke". Maintenance
is mostly about detecting quiet degradation.

## Continuous signals

| Signal | Source | Watch for |
|---|---|---|
| Turn latency p50/p95, per stage | traces (opt-in) | stage-3 share creeping up |
| Stage-resolution mix | traces | stage 1+2 falling below 65% |
| Clarify rate | traces | rising = router losing confidence |
| Model download success | telemetry | < 95% |
| OOM kills | platform vitals | device-class correlation |

## The registry-growth problem

The single most predictable maintenance issue: **every capability added makes routing
slightly harder for the neighbouring capabilities.** Descriptions overlap
semantically, stage-2 margins narrow, more turns fall through to stage 3, latency
rises and accuracy falls.

Countermeasures, applied on a schedule rather than reactively:

- Re-run the full golden set on every registry change (already a CI gate)
- Quarterly registry review: find capability pairs with high embedding similarity and
  differentiate their descriptions and triggers
- Watch the stage-mix metric as the leading indicator — it degrades before accuracy
  does
- Consider hierarchical routing (domain → capability) once the registry exceeds ~80
  entries. Design for this before you need it; retrofitting it is painful.

## Cadence

**Weekly** — triage field reports (`doctor --report`); review clarify rates; add newly observed
failing utterances (consented) to the golden set.

**Monthly** — dependency updates and CVE review; a re-baseline of the deterministic floor; prompt-version review; capability-usage review (unused capabilities are noise
in the registry — remove or merge them).

**Quarterly** — registry similarity audit; model-upgrade evaluation; security review;
accessibility re-audit; ADR review (which decisions have quietly been superseded in
practice but not in writing?).

## Model upgrade procedure

Never swap a model in place. Treat it as a release — its own change, its own comparison:

1. Full golden set against the candidate, per bucket
2. Latency and memory, on a warmed model, run sequentially
3. Adversarial bucket must remain at zero destructive outcomes
4. Prompts may need re-tuning per model — **prompt versions are model-coupled** and
   the pairing must be recorded
5. Stage the rollout; keep the previous model in the manifest for rollback

## Prompt maintenance

Prompts are versioned assets and are reviewed like code. A prompt edit is a behavioural
change: bump version, re-run the golden set, record the scorecard. Never edit a shipped
prompt version in place — create the next one.

## Golden-set maintenance

The corpus is a living asset and the project's most valuable artefact after the code.
It grows from: every routing bug, every consented field failure, every new capability's
examples, and every adversarial technique that emerges.

Rebalance periodically so no bucket dominates — a corpus that drifts to 60% happy-path
stops detecting the failures that matter.

## Technical debt

Tracked explicitly with the cost of *not* fixing it. Debt that touches the router, the
claim validator, or the `core-*` boundary is paid down first, because
those compound. Presentation-layer debt can wait.

## Deprecation

Removing a capability: mark deprecated in the registry, keep routing it for one
release with a message pointing at the replacement, then remove. Keep the golden-set
entries and flip their expectation to the replacement — this catches the case where
users keep asking for the old thing.
