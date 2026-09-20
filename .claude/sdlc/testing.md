# SDLC — Testing (process)

The strategy and what each gate holds live in [../docs/testing.md](../docs/testing.md). This
document covers **process**: who runs what, when, and what blocks a merge.

## Test-first rule

Say what should be true before you change anything: a turn in the relevant golden set, or
the signature another package will import. The first run must fail for the right reason —
*not implemented*, not *not found*. A test that was never seen failing may not be asserting
anything.

## Per-commit (local, pre-push)

The list is in [CLAUDE.md](../../CLAUDE.md), "Before you push", and `/gates` runs all of it,
including the gates that list omits. In short: typecheck, the unit tests, Rule 1's boundary
check, `pnpm registry:check`, and — if you changed anything that ships — `pnpm adapter:build`
then `pnpm adapter:check`. No linter is configured
(see [coding-standards.md](../docs/coding-standards.md)).

## Per-PR (CI)

`.github/workflows/ci.yml` runs every gate in [sdlc.config.json](../sdlc.config.json) that
does not need a model server or files outside this repository; what each enforces is in
[ci-cd.md](ci-cd.md). The committed scorecards are in the diff, so an accuracy change is
discussed rather than silently absorbed. Branch protection is not available on this
repository's plan: CI is advisory in the mechanical sense, and the local hooks are the only
layer that denies anything.

## What CI cannot run

`adversarial-live` needs a model server, and `kit-sync` needs `sdlc-kit/`, which lives outside
this repository. Run both through `/gates` before a change to a prompt, a threshold or a
hook. **Human checks**, before a claim is made rather than before a merge: the screen-reader
pass ([NVDA-CHECKLIST.md](../../eval/a11y/NVDA-CHECKLIST.md)) and the owner's acceptance run
([ACCEPTANCE-RUN.md](../../.MDFiles/ACCEPTANCE-RUN.md)).

## When the router regresses

A golden-set drop is treated as a defect, not as noise:

1. Identify which bucket dropped — the bucket tells you the cause class
2. Diff what changed: prompt version, thresholds, registry entries, model version
3. **Registry additions are the usual culprit** — a new capability with a description
   close to an existing one degrades stage-2 margins for both. Fix by differentiating
   descriptions and triggers, not by raising thresholds.
4. Add the specific failing utterances to the golden set permanently
5. Re-tune thresholds only after the semantic overlap is resolved

The `router-regression` skill has the commands.

## Bug policy

Every routing bug becomes a permanent golden-set entry before it is closed (Rule 12). A fix
without a test is not a fix — the same misrouting will reappear the next time the generator's
output changes.

## Merge gates

Nothing merges with a failing CI stage, a non-zero adversarial→destructive count, or a stale
`adapter/` or derived artefact. A claim about accessibility waits on the screen-reader pass.
