# Coding Standards

## Structure

Feature-first, Clean Architecture inside each feature. The critical boundary is
`core/` (domain-agnostic engine) vs `features/` (domain).

```
lib/
├── core/                        # THE PRODUCT — knows nothing about finance
│   ├── capability/              # registry, annotations, generated artefacts
│   ├── intent/                  # 3-stage router, scoring, thresholds
│   ├── action/                  # dispatcher, policy, confirmation, undo
│   ├── navigation/              # NavigationEngine, route validation
│   ├── conversation/            # turn state machine, transcript
│   ├── inference/               # llama.cpp FFI, embeddings, model lifecycle
│   ├── voice/                   # STT / TTS abstractions
│   ├── trace/                   # TurnTrace recorder + store
│   └── data/                    # Drift, encryption, migrations
│
├── features/
│   └── finance/
│       ├── domain/              # entities, repository interfaces, use cases
│       ├── data/                # Drift DAOs, repository implementations
│       ├── application/         # Riverpod providers, capability registrations
│       └── presentation/        # screens, widgets
│
└── app/                         # composition root, DI, router assembly
```

**Enforced rule:** nothing in `core/` may import from `features/`. This is checked in
CI with an import-boundary lint. If you need core to know something about a domain,
that knowledge belongs in a registration, not an import.

Inside a feature, dependencies point inward: `presentation → application → domain`,
`data → domain`. Domain imports nothing but Dart and its own types.

## SOLID, applied here

- **S** — a use case does one thing. `CreateTransaction` does not also update budgets;
  it emits an event a budget use case listens for.
- **O** — new capabilities are added by annotation + registration, never by editing a
  switch in the dispatcher. If you're editing a switch, the abstraction is wrong.
- **L** — every `LlmRuntime` implementation (llama.cpp, Ollama, cloud, fake) is
  substitutable. Tests run against the fake.
- **I** — narrow interfaces. `TransactionReader` and `TransactionWriter` are separate;
  the Query Engine only gets the reader.
- **D** — domain declares interfaces, infrastructure implements them. Riverpod wires
  them at the composition root only.

## Dart conventions

- `dart format`, `flutter analyze` clean, `very_good_analysis` lint set. No warnings
  merged.
- Files `snake_case.dart`, types `PascalCase`, members `lowerCamelCase`, private `_`.
- Prefer `sealed class` + exhaustive `switch` over enums-with-payload or visitor
  patterns. `Outcome` is sealed for exactly this reason — a new outcome type breaks
  compilation everywhere it must be handled. That is the point.
- Immutable models. `freezed` for unions and copies.
- `Result<T, E>` for expected failures; exceptions only for programmer error.
  Router misses, model timeouts, and empty queries are *expected*.
- No `dynamic` outside JSON boundary code. No `late` unless the lifecycle is
  genuinely two-phase and documented.
- Money is `int` minor units + currency code. **Never `double`.** Not once.
- All timestamps stored UTC; converted at the presentation edge only.

## Riverpod

- `Notifier` / `AsyncNotifier`, code-generated providers.
- Providers are declared next to what they provide, not in a global registry file.
- Widgets read providers; widgets do not contain logic. If a widget has an `if` on
  business state, that `if` belongs in a notifier.
- No provider reads from another feature's provider. Cross-feature communication goes
  through domain events or the capability dispatcher.

## Capability declarations

Every capability carries description, triggers, typed params, and **at least three
examples**. The examples are consumed by the golden-set test generator and the
few-shot pool — an under-documented capability is a failing test, not a style nit.

```dart
@Capability(
  id: 'budget.set',
  kind: CapabilityKind.write,
  route: '/budget/edit',
  description: 'Set or change the monthly spending limit for a category',
  triggers: ['set budget', 'change my limit', 'budget for'],
  params: {'category': ParamSpec.enumOf('Category'), 'amount': ParamSpec.money()},
  examples: [
    'set my food budget to 300',
    'change groceries limit to 250 euros',
    'I want to cap entertainment at 100',
  ],
)
```

## Prompts

- Prompts live in `assets/prompts/`, versioned `name.v3.txt`, never inline in Dart.
- Every prompt change bumps the version and re-runs the golden set. A prompt edit is
  a behavioural change and is reviewed like code.
- `promptVersion` is recorded in every `TurnTrace`.

## LLM code rules

Non-negotiable, because these are the failure modes that will actually bite:

1. **Never parse free-form model output.** Constrained decoding with a grammar, or
   don't call the model.
2. **Never let the model compute a number** that ends up in front of the user.
3. **Never let the model emit SQL, a route string, or an action id that isn't
   validated against the registry** before use.
4. **Always have a timeout and a fallback.** Model unavailable → stages 1–2 still work
   → degrade to clarify, never hang.
5. **Untrusted text** (transaction memos, imported CSV, file contents) is fenced and
   labelled untrusted in any prompt it enters. See [security.md](./security.md).

## Comments

Explain *why*, not *what*. The threshold tuning, the reason for a fallback ordering,
the bug a workaround addresses — those need comments. `// increment counter` does not.

## Git

Git Flow: `main`, `develop`, `feature/*`, `release/*`, `hotfix/*`.

Conventional Commits. Scope is the layer or feature: `feat(intent): add margin gate to
stage 2`.

PRs: green CI, golden-set accuracy not regressed, ADR for any architectural change.
The repo is **not yet initialised** — `git init` is Sprint 0.1.
