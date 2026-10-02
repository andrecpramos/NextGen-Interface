---
name: new-feature
description: Implement a new feature or change an existing one, following this repo's development loop — branch, declare the contract first, failing test, implement, gates, PR. Use when starting any non-trivial code change, or when asked how work is done in this repo.
---

# The development loop

Adapt this to what the repo's `.claude/sdlc/development.md` says. Where the two
disagree, that document wins — it is the repo's, this is the kit's default.

## 1 · Branch

Ask whether to stay on the current branch or cut a new one from the integration
branch, and **wait for the answer**. Once per context window, before the first
edit. Read-only work is exempt.

Propose a concrete name: `feature/<area>-<short-name>`.

## 2 · Ready?

Check the Definition of Ready in `.claude/sdlc/planning.md`. The item needs a
user-facing outcome, checkable acceptance criteria, and resolved-or-stubbed
dependencies.

If it does not meet them, say which and ask. Starting on an unready item is how a
session ends with three half-finished things.

## 3 · Declare the contract first

Whatever this repo's "the thing other code depends on" is — an interface, a
schema, a capability declaration, an API shape — **write it before the logic
behind it.**

Two reasons: the contract is what other work can proceed against, and writing it
first is the only reliable moment to notice it is wrong. Writing it after the
implementation produces a contract shaped like the implementation.

In this repo it is one of two things, whichever your change touches:

- **A signature another package imports** — the type or function in `core-capability`,
  `core-intent` or `core-inference` that `generator`, `embed` or `kit` build against.
  Write it before the logic behind it.
- **What the generator emits for an application.** Capabilities are not declared by
  hand: `packages/generator` reads an application's source and emits one registry per role
  (ADR-013, ADR-018). So the contract is the expectation — a turn in
  `eval/frameworks/<app>/golden-set.jsonl` (at least 20, some with `"route": null`) — and
  every capability the generator produces still carries **at least three examples** (Rule 10).

The registries under `eval/frameworks/family/generated/` are committed derived artefacts.
If your change alters what the generator emits, or what the encoder is fed, regenerate them
**in the same commit**. `check-derived-artefacts.mjs` fails on a stale one and does not fix
it; this order is the one that reproduces the committed files (apart from a `generatedAt`
timestamp):

```bash
node --experimental-strip-types packages/generator/src/cli.ts \
  eval/frameworks/family/generator.config.json --no-model   # emit the registries
pnpm router:calibrate                                        # only if the encoder's input changed
node --experimental-strip-types eval/frameworks/rebuild-indexes.mjs
pnpm eval:calibrate                                          # Rule 14: sweep thresholds, never hand-tune
node tooling/scripts/check-derived-artefacts.mjs
pnpm registry:check                                          # validate only — this is the CI gate
```

If your change alters shipped code (`generator`, `embed`, `kit`, or anything they import),
the committed `adapter/` is stale: `pnpm adapter:build`, and commit it with the change.

## 4 · Failing test

Write it, run it, and **confirm it fails for the right reason** — "not
implemented", not "not found", not a typo in the test name.

A test that was never seen failing is a test that may not be asserting anything.
This is the same principle as making a new gate fail on purpose.

## 5 · Implement

Against the checks that will be applied in review, in priority order:

1. Does an unvalidated external value reach storage, the UI, or execution?
2. Is something the user will trust as authoritative produced where it cannot be trusted?
3. Does a `packages/core-*` package import `generator`, `embed` or `kit`? (Rule 1)
4. Are failure paths implemented, or only the happy path?
5. Are the negative cases tested?
6. Is untrusted text isolated before it reaches an interpreter?

**Write the failure path before the success path.** Written second means written
last, and last means never.

## 6 · Gates

`/gates`, or the `gate-runner` agent.

Run the checks for things you did *not* touch, too. **Regressions elsewhere are
the common surprise** — especially in any system where adding an entry affects
its neighbours.

## 7 · Ship

The `ship-it` skill: stage explicit paths, conventional commit, PR into the
integration branch.

---

## If this feature required changing packages/core-*

Stop. That is the signal the design is wrong, not that the boundary is
inconvenient.

The recurring test: *what would a second application have to
change in packages/core-* to work?* If the answer is anything but "nothing", record why
before proceeding — and consider whether an ADR is owed.

Working around a boundary gate is never the fix. If the gate is wrong, that is a
finding worth reporting; if it is right, the design needs to change.
