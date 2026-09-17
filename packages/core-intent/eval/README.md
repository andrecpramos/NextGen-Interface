# `core-intent`'s own evaluation

This measures **the router in isolation**, against a fixed application it can never
change. It is not the product measurement — that is
[eval/frameworks](../../../eval/frameworks), which runs the whole pipeline (generate →
calibrate → route) over fixture applications, one per routing framework.

## `fixture-registry.json` — frozen, on purpose

Seven capabilities: `module.capture`, `.list`, `.search`, `.delete`, `.revert`, and two
declared `unsupported.*` boundaries. It is the registry that
`packages/domain-modules` used to generate, kept as a fixture when that package was
deleted ([ADR-018](../../../.claude/decisions/ADR-018.md)).

**It is a fixture, not a domain.** `core-intent` knows no application; `evaluate.js`
refuses to run without `--registry=`. This file is what the 85 entries in
`golden-set.jsonl` expect and what the committed scorecards in `scorecards/` were
produced from, so **changing it invalidates the baseline CI compares against**
(`check-scorecard.mjs`). If the router needs a different shape to be exercised, add a
second fixture rather than editing this one.

Why keep it at all, when `eval/fut-app` is the real target: a 7-capability registry with
two boundaries isolates router behaviour that 145 capabilities drown out — stage-1
precision, and whether a declared boundary is reached by retrieval rather than by a
model's judgement ([ADR-009](../../../.claude/decisions/ADR-009.md)). It also runs in
seconds with no model.

## Running it

```bash
pnpm router:floor      # stages 1-2 only, hashing embedder, no model — what CI runs
pnpm router:inspect    # score distributions and recall@k — look here first
pnpm router:eval       # the full cascade, needs a local model server
pnpm router:calibrate  # sweep thresholds; never hand-tune them (Rule 14)
```

All of them pass `--registry=eval/fixture-registry.json` from the root scripts.
