# SDLC — Development

## Workflow

1. Pick an item that meets Definition of Ready ([planning.md](./planning.md))
2. Branch from `develop`: `feature/<area>-<short-name>`
3. Write the capability declaration **first** — id, kind, description, triggers,
   params, examples. The examples become golden-set entries before any logic exists.
4. Write the failing test
5. Implement
6. Run the golden set locally — check for regressions in *other* capabilities, which
   is the common surprise
7. PR into `develop` with the scorecard diff attached
8. Squash-merge on green

## Adding a capability — the standard path

```dart
// 1. Declare (features/finance/application/capabilities/budget_set.dart)
@Capability(
  id: 'budget.set',
  kind: CapabilityKind.write,
  route: '/budget/edit',
  description: 'Set or change the monthly spending limit for a category',
  triggers: ['set budget', 'change limit', 'budget for'],
  params: {
    'category': ParamSpec.enumOf('Category', required: true),
    'amount':   ParamSpec.money(required: true),
  },
  examples: [
    'set my food budget to 300',
    'change groceries limit to 250 euros',
    'cap entertainment at 100 a month',
  ],
)
class SetBudget implements Action<SetBudgetParams, Budget> { ... }

// 2. Regenerate — registry, routes, embeddings all rebuild from the annotation
//    dart run build_runner build --delete-conflicting-outputs

// 3. Golden-set entries are generated from `examples`; add the hard cases by hand:
//    ambiguity ("set my budget"), out-of-range ("set food budget to -50"),
//    adversarial, and paraphrases the examples don't cover.

// 4. Implement the use case, the route, the screen.
```

Nothing in `core/` is edited. If adding a capability requires editing `core/`, that is
a design defect — stop and record why.

## Working with the model

- **Never inline a prompt.** `assets/prompts/<name>.vN.txt`, loaded by version.
- **Never parse free-form output.** Grammar-constrained decoding, or no model call.
- **Always set a timeout** and implement the fallback path before the success path.
- **Log the trace before returning**, including on failure — failed turns are the ones
  you most need to inspect.
- Tune thresholds against the golden set, never against a handful of manual tries.
  Manual testing systematically over-samples the phrasings you happen to think of.

## Local development without Flutter

Flutter is not installed yet. Router work can proceed against Ollama
(`llama3.1:8b` present) in a scratch Python/Node harness — see
[roadmap.md](../docs/roadmap.md) Sprint 0.

Important: **8B results do not predict 1B results.** Any threshold or prompt tuned on
`llama3.1:8b` must be re-validated against a 1–1.5B model before it is trusted. Pull
`gemma3:1b` or `qwen2.5:1.5b` for that comparison.

## Code review

Reviewer checks, in priority order:

1. Does a model-produced value reach the DB, the UI, or a route without validation?
2. Is a user-visible number computed by the model rather than by Dart?
3. Does `core/` import `features/`?
4. Are failure paths implemented, or only the happy path?
5. Are there golden-set entries for the new behaviour, including the negative cases?
6. Is the trace complete for the new path?
7. Is untrusted text fenced before entering a prompt?
8. Only then: style, naming, structure.

## Branching

Git Flow. `main` is always releasable. `develop` is the integration branch.
`release/*` for stabilisation, `hotfix/*` from `main`.

Conventional Commits with layer or feature scope:

```
feat(intent): add margin gate to stage 2 acceptance
fix(action): reject unclassified capabilities instead of defaulting to read
perf(inference): unload model after 60s idle
test(golden): add 24 adversarial injection cases
docs(adr): ADR-006 supersede embedding model choice
```

## Tooling

`flutter analyze` + `very_good_analysis`, `dart format`, `build_runner` for registry
and Riverpod generation, `drift_dev` for schema, and the import-boundary lint that
enforces the core/features separation.

## Definition of Done

See [planning.md](./planning.md). The two most commonly skipped items, listed here
because they are the ones that matter: **golden-set entries added** and **manually
exercised on a physical device**.
