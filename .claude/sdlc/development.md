# SDLC — Development

## Workflow

1. Pick an item that meets Definition of Ready ([planning.md](planning.md))
2. Branch from `develop`: `feature/<area>-<short-name>`
3. Write the capability declaration **first** — id, kind, description, triggers,
   params, examples. The examples become golden-set entries before any logic exists.
4. Write the failing test
5. Implement
6. Run the golden set locally — check for regressions in *other* capabilities, which
   is the common surprise
7. PR into `develop` with the scorecard diff attached
8. Squash-merge on green

The agent-facing version of this loop, with the exact commands, is the
`add-capability` skill in [`.claude/skills/`](../../.claude/skills/).

## Adding a capability — the standard path

```ts
// 1. Declare (packages/domain-modules/src/capabilities.ts)
defineCapability({
  id: 'module.capture',
  kind: 'write',                       // selects the ADR-004 policy: write => confirm
  route: '/modules/new',
  title: 'Remember this',
  description:
    'Save something the user wants remembered — extract the important information ' +
    'from what they said, wrote, or uploaded, and file it as a module',
  triggers: ['remember this', 'save this', 'take a note'],
  params: {
    body: { type: 'string', required: false, description: 'what you want me to remember' },
  },
  examples: [
    'remember that my passport expires in June 2027',
    'save this: the wifi password is on the router label',
    'note that the insurance renewal is in March',
  ],
});
```

```bash
# 2. Regenerate — the registry, the route table and the golden fixtures all
#    rebuild from that one declaration.
pnpm registry:build
pnpm registry:check      # validate only; this is the CI gate

# 3. Golden-set entries are generated from `examples`. Add the hard cases by
#    hand in packages/core-intent/eval/golden-set.jsonl: ambiguity, out-of-range,
#    adversarial, and the paraphrases the examples do not cover.

# 4. Check the new capability did not crowd its neighbours.
pnpm router:floor
```

Then implement the use case, the route, and the screen.

Nothing in `packages/core-*` is edited. **If adding a capability requires editing
a `core-*` package, that is a design defect — stop and record why.**

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

*(Historical: an earlier version of this section described working around a
missing Flutter install. That predates [ADR-006](../decisions/ADR-006.md), which
replaced Flutter with the TypeScript monorepo. The router work it anticipated was
done as WP-01 — see [PLAN.md](../../PLAN.md) section 7 and
[eval/FINDINGS.md](../../packages/core-intent/eval/FINDINGS.md).)*

## Code review

Reviewer checks, in priority order:

1. Does a model-produced value reach the DB, the UI, or a route without validation?
2. Is a user-visible number computed by the model rather than by TypeScript?
3. Does a `packages/core-*` package import a domain?
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
fix(core-dispatch): reject unclassified capabilities instead of defaulting to read
perf(core-inference): unload model after 60s idle
test(golden): add 24 adversarial injection cases
docs(adr): ADR-006 supersede the client stack choice
```

## Tooling

```bash
node tooling/scripts/check-import-boundaries.mjs   # Rule 1 — core never imports a domain
node tooling/scripts/check-thresholds.mjs          # Rule 14 — thresholds match calibration
pnpm -r typecheck                                  # strict TypeScript
pnpm -r test                                       # vitest
pnpm registry:check                                # Rule 10 — >=3 examples per capability
node tooling/scripts/check-scorecard.mjs           # the golden-set regression gate
```

`/gates` runs all of it. **No linter is configured** — `tooling/eslint-config` is
an empty stub, and there is no root lint script. Typecheck and tests are the only
automated style gates today.

## Definition of Done

See [planning.md](planning.md) and PLAN.md section 11. The two most commonly
skipped items, listed here because they are the ones that matter: **golden-set
entries added**, and **an ADR written if an architectural choice was made** —
WP-14 is the standing counter-example, and ADR-013 is still owed for it.
