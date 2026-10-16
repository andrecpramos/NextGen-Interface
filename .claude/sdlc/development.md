# SDLC — Development

## Workflow

1. Pick an item that meets Definition of Ready ([planning.md](planning.md))
2. Branch from `develop`: `feature/<area>-<short-name>`
3. Write the expectation **first** — a golden-set turn for what should be true, or the
   signature another package will import. Nothing here is a hand-written capability
   declaration; see "Changing what the generator emits" below.
4. Write the failing test
5. Implement
6. Run the golden set locally — check for regressions in *other* capabilities, which
   is the common surprise
7. PR into `develop` with the scorecard diff attached
8. Squash-merge on green

The agent-facing version of this loop, with the exact commands, is the
`new-feature` skill in [`.claude/skills/`](../skills/).

## Changing what the generator emits — the standard path

There is no hand-written capability declaration in this repository. A capability is what
`packages/generator` read from an application's routes, labels and translations
([`adapter/FIELD-NOTES.md`](../../adapter/FIELD-NOTES.md) is what that taught). Work here
is therefore one of: change how it reads or words something, change how the router scores
it, or change what ships to an adopter.

```bash
# 1. Say what should be true first: a turn in eval/frameworks/<app>/golden-set.jsonl
#    (>= 20 per app, some with "route": null). Rule 12 — a routing bug is not fixed
#    until it is a permanent golden-set entry.

# 2. Change the generator (or core-intent), then regenerate the fixture app's output.
node --experimental-strip-types packages/generator/src/cli.ts \
  eval/frameworks/school/generator.config.json --no-model
node --experimental-strip-types eval/frameworks/rebuild-indexes.mjs
pnpm eval:calibrate      # Rule 14 — sweep thresholds; NEVER hand-tune

# 3. Check nothing else moved. This is the common surprise.
pnpm eval:apps           # headline numbers; :check gates them against the committed scorecard
pnpm router:floor        # the router in isolation, stages 1+2 only
node tooling/scripts/check-derived-artefacts.mjs

# 4. If shipped code changed, the committed adapter/ is stale.
pnpm adapter:build && pnpm adapter:check
```

`packages/core-intent/eval/fixture-registry.json` is the **frozen** 7-capability fixture the
router is measured on in isolation. It is not an application and is not edited: changing it
invalidates the committed scorecards `check-scorecard.mjs` compares against
(`packages/core-intent/eval/README.md`).

Nothing in `packages/core-*` should need to know about an application. **If a change
requires a `core-*` package to import `generator`, `embed` or `kit`, that is a design defect
— stop and record why.** Rule 1's gate refuses it (ADR-021).

## Working with the model

- **Never inline a prompt.** Versioned prompt assets, loaded by version.
- **Never parse free-form output.** Schema-constrained decoding, or no model call.
- **Always set a timeout** and implement the fallback path before the success path.
- **Log the trace before returning**, including on failure — failed turns are the ones
  you most need to inspect.
- Tune thresholds against the golden set, never against a handful of manual tries.
  Manual testing systematically over-samples the phrasings you happen to think of.

## Local model development

The router harness runs against Ollama on `127.0.0.1:11434`:

```bash
pnpm router:inspect      # score distributions and recall@k — always look here first
pnpm router:floor        # stages 1+2 only, hashing encoder: the deterministic run
pnpm router:eval         # full cascade on qwen2.5:1.5b --topk=3 (the selected model)
pnpm router:baseline     # ditto on llama3.1:8b — the historical comparison point
pnpm router:calibrate    # threshold sweep — NEVER hand-tune thresholds
```

`--embedder=hashing` needs nothing running at all, which is why it is the
configuration CI gates on.

Two things make a timed run lie: a cold model load shows up as a ~22-second
stage-3 outlier, so warm the model with one throwaway call first; and parallel
runs share the GPU, so run models sequentially.

Important: **8B results do not predict 1B results.** Any threshold or prompt
tuned on `llama3.1:8b` must be re-validated against a 1–1.5B model before it is
trusted. Pull `gemma3:1b` or `qwen2.5:1.5b` for that comparison.

## Code review

Reviewer checks, in priority order:

1. Does a model-produced value reach the DB, the UI, or a route without validation?
2. Is a user-visible number computed by the model rather than by TypeScript?
3. Does a `packages/core-*` package depend on anything but another `core-*`? (Rule 1)
4. Are failure paths implemented, or only the happy path?
5. Are there golden-set entries for the new behaviour, including the negative cases?
6. Is the trace complete for the new path?
7. Is untrusted text fenced before entering a prompt?
8. Only then: style, naming, structure.

Checks 1–3 and 7 are what the `boundary-auditor` agent and `/rules-check` audit
mechanically; the rest still need a reader.

## Branching

`main` is production and moves only on the user's explicit instruction.
`develop` is the integration branch and the default. Every branch is cut from
`develop` and merges back into it. Full policy, including how a release is cut:
[branching.md](branching.md).

Conventional Commits with layer or feature scope:

```
feat(core-intent): add margin gate to stage 2 acceptance
fix(core-intent): refuse an unclassified capability instead of defaulting to read
perf(core-inference): unload model after 60s idle
test(golden): add 24 adversarial injection cases
docs(adr): ADR-006 supersede the client stack choice
```

## Tooling

```bash
node tooling/scripts/check-import-boundaries.mjs   # Rule 1 — core-* depend only on core-*
node tooling/scripts/check-thresholds.mjs          # Rule 14 — thresholds match calibration
pnpm -r typecheck                                  # strict TypeScript
pnpm -r test                                       # vitest
pnpm registry:check                                # Rule 10 — >=3 examples per capability
node tooling/scripts/check-scorecard.mjs           # the golden-set regression gate
```

`/gates` runs all of it. **No linter is configured** — there is no root lint script
and no package defines one. Typecheck and tests are the only automated style gates
today.

## Definition of Done

See [docs/RULES.md](../../docs/RULES.md#definition-of-done). The two most commonly
skipped items, listed here because they are the ones that matter: **golden-set
entries added**, and **an ADR written if an architectural choice was made** — an ADR
written after the work it records is a rationalisation, not a decision.
