# Deployment

## Targets

| Platform | Priority | Notes |
|---|---|---|
| Android | 1 | primary; the constraining device class for inference |
| iOS | 2 | Core ML / MLX path worth evaluating later |
| Web (PWA) | 3 | **no llama.cpp** — WebGPU/WASM or cloud fallback; core loop differs |
| Desktop | 4 | easiest inference target, smallest audience |

The web target is not a free ride from Flutter's single codebase. On-device inference
does not port. Web either runs a WASM/WebGPU runtime with a much smaller model, or
falls back to cloud — which conflicts with the offline principle. Decide explicitly
before building it; do not let it happen by accident.

## Model distribution — plan this early

A quantised 1B model (~700 MB) + embeddings (~20 MB) + whisper tiny (~75 MB) + Piper
voice (~60 MB) is roughly **0.9–1.6 GB of assets**.

Play Store base APK/AAB is capped at 200 MB. App Store has cellular-download limits.
**Models cannot be bundled.**

Approach:
- Ship the app with stages 1–2 fully functional and no LLM. It is useful on first
  launch, immediately, before any download.
- Prompt for the model download on first run, over Wi-Fi, resumable, with a clear size
  figure shown before it starts.
- Android: Play Asset Delivery, on-demand. iOS: On-Demand Resources or a direct CDN
  fetch.
- Verify SHA-256 before load; fail closed.
- Models are versioned independently of the app. A model upgrade must not require an
  app release, and must not silently change behaviour — a model version change re-runs
  the golden set before it is published to any channel.

## CI/CD — GitHub Actions

```
PR:
  analyze → format → unit → integration → navigation → golden-set → widget
  + import-boundary lint (core must not import features)
  + dependency CVE scan

merge to develop:
  above + build debug artefacts + nightly device-farm perf

release/*:
  above + signed release builds + security scan + internal-track deploy

tag on main:
  production upload (staged rollout) + changelog + model manifest publish
```

Signing keys and store credentials in GitHub Secrets. Never in the repo, never in CI
logs.

## Release channels

Internal (every develop merge) → Closed beta (release branches) → Production (staged
5% → 25% → 100%, with crash-rate and router-accuracy gates between steps).

## Versioning

- App: SemVer, `major.minor.patch+build`
- Models: `family-size-quant-vN` e.g. `gemma3-1b-q4km-v2`
- Prompts: `name.vN.txt`
- Registry: schema version, migrated like the DB

All four are recorded in every `TurnTrace`. When accuracy drops in the field, you need
to know which combination produced it.

## Migrations

Drift schema migrations are versioned and tested with a fixture DB at every prior
version. Migration failure must never lose data — take a backup copy before migrating
and restore on failure. Financial data loss is unrecoverable and unforgivable.

## Monitoring

Opt-in, scrubbed per [security.md](security.md).

Watch: crash-free rate, cold-start time, turn latency p50/p95 per stage,
stage-resolution mix, clarify rate, confirmation-rejection rate (**the best available
proxy for misrouting in production**), model download success rate, OOM kills.

A rising confirmation-rejection rate means the router is degrading in the field before
users bother to report it. Alert on it.

## Rollback

- App: halt staged rollout, ship previous build
- Model: manifest points back to the previous version; clients pick it up on next
  check — no app release needed
- Prompts: shipped with the app, so a prompt rollback is an app rollback. Consider
  moving prompts to the model manifest in MVP 2 for the same fast-rollback path.

## Store review notes

Both stores ask about AI features. Be prepared to state: inference is on-device, no
data leaves the device by default, no user-generated content is shared, and the AI
does not perform financial transactions. Have the privacy nutrition labels ready and
accurate — "no data collected" is only claimable if telemetry is genuinely opt-in and
scrubbed.
