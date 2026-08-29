# SDLC — Testing (process)

The strategy, thresholds, and test-type detail live in
[../testing.md](../testing.md). This document covers **process**: who runs what, when,
and what blocks a release.

## Test-first rule

For capabilities, tests come from the declaration. Writing `examples:` in the
`@Capability` annotation generates golden-set entries before any implementation
exists. The first run must fail for the right reason — capability not implemented, not
capability not found.

## Per-commit (local, pre-push)

- `dart format --set-exit-if-changed`
- `flutter analyze`
- Unit tests for touched packages
- Golden set — **fast subset** (the buckets touching changed capabilities)

## Per-PR (CI, blocking)

| Stage | Blocks merge |
|---|---|
| Format + analyze | yes |
| Import-boundary lint | yes |
| Unit (coverage ≥ 80%) | yes |
| Integration (fake runtime) | yes |
| Navigation (registry-generated) | yes |
| Golden set — full, reference model | yes, on any regression |
| Widget + golden images | yes |
| Dependency CVE scan | yes on high/critical |

The golden-set scorecard is committed, so accuracy changes appear in the PR diff and
get discussed rather than silently absorbed.

## Nightly

- Performance suite on physical reference devices
- Full voice corpus (WER + end-to-end intent accuracy)
- Extended adversarial/injection corpus
- Memory and battery profiling
- Model-load and hash-verification integrity checks

## Pre-release

Manual, on real hardware, before any release branch is cut:

- [ ] Full MVP scripted set, airplane mode, cold install
- [ ] First-run experience *before* model download — app must be useful
- [ ] Model download: interrupt it, resume it, corrupt it (hash must fail closed)
- [ ] Accessibility pass: screen reader end-to-end, 200% text, reduced motion
- [ ] Confirmation and undo for every `write` and `destructive` capability
- [ ] Trace viewer accurate on 10 sampled turns — cross-check against the DB
- [ ] Network monitor: confirm zero egress with cloud disabled
- [ ] Migration from the previous released schema, with real-shaped data volume

## When the router regresses

A golden-set drop is treated as a defect, not as noise:

1. Identify which bucket dropped — the bucket tells you the cause class
2. Diff what changed: prompt version, thresholds, registry entries, model version
3. **Registry additions are the usual culprit** — a new capability with a description
   close to an existing one degrades stage-2 margins for both. Fix by differentiating
   descriptions and triggers, not by raising thresholds.
4. Add the specific failing utterances to the golden set permanently
5. Re-tune thresholds only after the semantic overlap is resolved

## Bug policy

Every routing bug becomes a permanent golden-set entry before it is closed. Every
crash becomes an integration test. A fix without a test is not a fix — the same
misrouting will reappear the next time a capability is added.

## Release gates

No release proceeds with: any failing CI stage, golden-set accuracy below the
thresholds in [../testing.md](../testing.md), a non-zero adversarial→destructive count,
an unresolved accessibility blocker, or an untested schema migration.
