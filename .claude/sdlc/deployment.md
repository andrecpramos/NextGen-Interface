# SDLC — Deployment (process)

Pipeline configuration, store constraints, and model distribution mechanics live in
[../deployment.md](../docs/deployment.md). This document covers the **release process**.

## Release train

Releases cut from `develop` into `release/x.y.z` when the MVP scope is met and the
pre-release checklist in [testing.md](./testing.md) passes.

```
develop ──┬─▶ release/1.2.0 ──(stabilise, no new features)──▶ main ──▶ tag v1.2.0
          │                                │
          └◀────── merge back ─────────────┘
```

Only fixes land on a release branch. A new feature request during stabilisation goes
to `develop` for the next train. No exceptions — this is the rule that keeps release
branches from becoming a second development line.

## Release roles (solo dev: same person, different hats — do them separately)

| Role | Responsibility |
|---|---|
| Release manager | Cuts the branch, owns the checklist, decides go/no-go |
| Security reviewer | Signs off per [../security.md](../docs/security.md) review triggers |
| QA | Executes the manual pre-release pass on physical devices |

## Go/no-go criteria

Proceed only if **all** hold:

- CI green on the release branch
- Golden-set thresholds met; adversarial→destructive count is zero
- Performance budgets met on the reference mid-range Android device
- Schema migration tested from the previously released version with realistic volume
- Accessibility pass complete with no blockers
- Model manifest published and hash-verified from a clean install
- Rollback path confirmed for app, model, and prompts

## Staged rollout

5% → 25% → 100%, with a minimum soak at each step. Promotion gates:

| Signal | Halt threshold |
|---|---|
| Crash-free sessions | < 99.5% |
| Turn latency p95 | > 2.5s |
| Confirmation-rejection rate | > 1.5× baseline |
| Model download success | < 95% |
| Clarify rate | > 1.5× baseline |

Confirmation-rejection rate is the key one. It is the closest available proxy for
"the router is misunderstanding people" in production, and it moves before reviews or
support tickets do.

## Model releases

Models version independently of the app. A model promotion is its own release:

1. Run the full golden set against the candidate model
2. Compare per-bucket accuracy and per-stage latency against the incumbent
3. No regression in any bucket, and adversarial count still zero
4. Publish to the manifest behind a staged percentage
5. Same halt thresholds apply
6. Rollback = repoint the manifest; clients recover on next check, **no app release**

## Hotfix

From `main`, `hotfix/x.y.z+1`, minimal diff, full CI, expedited manual pass on the
affected path only. Merge to `main` **and** `develop`. Post-incident note recorded in
the release log — what broke, what was missed, what test now covers it.

## Release log

Each release records: version, model + prompt + registry versions, golden-set
scorecard, performance numbers on the reference device, known issues, and rollout
outcome. This is what lets you answer "what changed?" six months later when field
accuracy has drifted.
