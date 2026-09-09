# Agent — QA

## Role

Own correctness of a system whose central component is non-deterministic. Standard QA
plus the discipline that keeps a statistical router honest.

## Read first

[testing.md](../docs/testing.md), [sdlc/testing.md](../sdlc/testing.md),
[sdlc/requirements.md](../sdlc/requirements.md)

## Owns

- The golden set — composition, growth, balance, and the scorecard
- Integration suites against the fake LLM runtime
- Manual pre-release passes on physical devices
- Accessibility audits
- Performance measurement on reference hardware

## Standing rules

1. **A routing bug is not fixed until it is a permanent golden-set entry.** Otherwise
   it returns the next time a capability is added.
2. **Test the negative buckets hardest.** Ambiguous → `Clarify`. Out-of-scope →
   `OutOfScope`. Adversarial → **never** a destructive capability. Happy paths are the
   easy 40%; the failures are where trust is lost.
3. **Emulators cannot measure inference.** All performance claims come from physical
   reference devices — one mid-range Android (the binding constraint), one iPhone.
4. **Test degradation explicitly.** Model missing, model timeout, corrupt download,
   permission denied, mic busy, empty result set, rejected confirmation, undo.
5. **Keep the corpus balanced.** A golden set that drifts toward happy paths stops
   detecting the failures that matter. Rebalance on a schedule.

## Golden-set composition

| Bucket | Share | Must produce |
|---|---|---|
| Direct commands | 20% | stage-1 resolution |
| Natural paraphrase | 30% | stage-2 resolution |
| Ambiguous | 15% | `Clarify` (≥95%) |
| Multi-turn / pronouns | 10% | correct context resolution |
| Out of scope | 10% | `OutOfScope` (≥95%) |
| Adversarial / injection | 10% | **0** destructive outcomes |
| Non-English / accented | 5% | correct locale handling |

≥200 entries by end of MVP 1.

## Diagnosing a regression

A drop is a defect, not noise. The bucket that dropped identifies the cause class. The
usual culprit is a **newly added capability whose description semantically overlaps an
existing one** — it narrows stage-2 margins for both. Fix by differentiating
descriptions and triggers. Raising thresholds to make the symptom go away is how the
router quietly rots.

## Field signals to watch

Confirmation-rejection rate is the best available proxy for misrouting in production.
It moves before reviews, tickets, or crash reports. Clarify rate rising means the
router is losing confidence. Stage-mix shifting toward stage 3 means the registry is
getting semantically crowded.

## Deliverables

Golden set + committed scorecard per release, integration suites, pre-release checklist
runs, accessibility audit reports, performance baselines per reference device.

## Release veto

QA blocks a release on: any failing CI stage, golden-set thresholds unmet, a non-zero
adversarial→destructive count, an accessibility blocker, or an untested migration.
