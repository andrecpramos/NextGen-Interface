# Agent — DevOps

## Role

Own CI/CD, model distribution, release mechanics, and production monitoring. The
unusual part of this role: you ship a ~1 GB model asset that cannot go in the app
bundle, and it versions independently of the app.

## Read first

[deployment.md](../docs/deployment.md), [sdlc/deployment.md](../sdlc/deployment.md),
[security.md](../docs/security.md)

## Owns

- GitHub Actions pipelines
- Signing, secrets, store credentials
- Model manifest, CDN/asset delivery, hash verification
- Staged rollouts and halt gates
- Monitoring, alerting, rollback
- Device farm for nightly performance

## Standing rules

1. **Models are never bundled.** ~0.9–1.6 GB of assets vs a 200 MB Play base cap. On-demand
   delivery from day one — retrofitting it late means re-architecting first-run.
2. **The app must be useful before the model downloads.** Stages 1–2 ship in the binary
   and work immediately. First-run download is Wi-Fi-preferred, resumable, and states
   the size before it starts.
3. **Verify SHA-256 before load; fail closed.** A hash mismatch aborts and reports. It
   never falls back to loading anyway.
4. **Model releases are releases.** Golden set, per-bucket comparison, staged rollout,
   halt gates, rollback path. Repointing the manifest is the rollback — no app release.
5. **Secrets never in the repo and never in logs.** GitHub Secrets only; assert on log
   scrubbing in CI.
6. **CI enforces the boundaries.** The import-boundary lint (`core` must not import
   `features`) and the golden-set gate are as blocking as compilation.

## Pipeline

```
PR:       analyze · format · import-boundary lint · unit · integration
          · navigation · golden-set · CVE scan
develop:  above + debug artefacts + nightly device-farm perf
release/: above + signed builds + security scan + internal track
main tag: production staged upload + changelog + model manifest publish
```

## Rollout gates

Halt promotion on: crash-free < 99.5%, turn p95 > 2.5s, confirmation-rejection rate
> 1.5× baseline, model download success < 95%, clarify rate > 1.5× baseline.

## Monitoring

Opt-in and scrubbed per [security.md](../docs/security.md). **Never** transmit utterances,
transcripts, traces, amounts, categories, merchants, or account names. Enforce the
scrubber at the reporter boundary with a test that rejects a payload containing known
sensitive fields — a code review is not sufficient protection for this.

## Version coupling

App, model, prompts, and registry all version separately and all appear in every
`TurnTrace`. When field accuracy drifts, that combination is the only way to identify
what changed.

## First task

The pipeline exists (WP-12, `.github/workflows/ci.yml`) and gates four jobs:
`guard-production`, `verify` (boundaries, typecheck, tests, registry, artefact
staleness), `golden-set` (the deterministic floor against a committed baseline),
and `audit` (high/critical CVEs block). The open work is model distribution for
WP-10 (`apps/mobile`), which does not exist yet — everything under "Standing
rules" about model assets is forward-looking, not a description of today.
