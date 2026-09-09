# Coding Standards

**Stack:** TypeScript, pnpm workspaces, Node 23.6+, vitest, Next.js for the web
surface. [ADR-006](../decisions/ADR-006.md) superseded the original Flutter choice
and [ADR-007](../decisions/ADR-007.md) superseded Drift; if you find Dart or
Riverpod described anywhere as current, it is drift — report it.

## Structure

The critical boundary is `packages/core-*` (the domain-agnostic engine) versus
`packages/domain-*` (a domain).

```
packages/
├── core-capability/     # registry schema, validation, codegen — the engine/domain contract
├── core-intent/         # 3-stage router, scoring, thresholds, the eval harness
├── core-dispatch/       # dispatcher, policy table, confirmation, undo, navigation
├── core-inference/      # LLM + embedding runtime adapters, model lifecycle
├── core-voice/          # STT / TTS abstractions
├── core-trace/          # TurnTrace recorder and store
├── data/                # SQLite (node:sqlite), schema, migrations, query engine
├── ui/                  # design system
├── domain-modules/      # THE registered domain since WP-14
└── domain-finance/      # the reference domain — proof the engine is domain-agnostic

apps/
├── web/                 # Next.js assistant surface — a composition root
└── cli/                 # the same stack as a CLI — the other composition root

tooling/scripts/         # the CI gates that are not tests
```

**Enforced rule:** nothing in `packages/core-*` may import a domain package.
Checked by `node tooling/scripts/check-import-boundaries.mjs`, in both
directions — the declared dependency in `package.json` *and* every actual import
specifier under `src/`. If core needs to know something about a domain, that
knowledge arrives as a **registration**, never an import.

Inside a domain, dependencies point inward: use cases depend on entities, and
`capabilities.ts` declares the surface. The domain declares repository interfaces
(ports); `packages/data` implements them; the composition root wires the two. A
domain imports `@nextgen/core-capability` and `@nextgen/core-inference`, and
nothing else from the engine.

## SOLID, applied here

- **S** — a use case does one thing. `commitCapture` does not also recompute
  related modules; it emits an event and a listener does.
- **O** — new capabilities are added by declaration and registration, never by
  editing a switch in the dispatcher. If you are editing a switch to add a
  feature, the abstraction is wrong.
- **L** — every inference runtime (Ollama, llama.cpp, cloud, fake) is
  substitutable. Tests run against the fake; nothing in a test path needs a model.
- **I** — narrow interfaces. A reader and a writer are separate, so the query
  path can be handed the reader alone.
- **D** — domains declare interfaces, infrastructure implements them, and the
  composition roots (`apps/web`, `apps/cli`) are the only places they meet.

## TypeScript conventions

- **`strict`, plus `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`,
  `noImplicitOverride` and `noFallthroughCasesInSwitch`** — see
  `tsconfig.base.json`. `pnpm -r typecheck` is a merge gate.
- **No build step.** Node runs the TypeScript directly (23.6+ type stripping), so
  **imports carry the real extension** — `from './capabilities.ts'`, not
  `'./capabilities'`. This surprises people; it is deliberate, and it is why the
  Node floor is 23.6 rather than the `>=20` in `engines`.
- Files kebab-case, types PascalCase, members camelCase.
- **Discriminated unions over enums-with-payload.** `Outcome` and `Result<T>` are
  unions on a literal tag field precisely so that a new variant breaks
  compilation everywhere it must be handled. That is the point, not a nuisance.

```ts
export type Result<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly reason: string };
```

- **`readonly` by default** on interface members and union payloads. Immutability
  is the convention here, not the exception.
- **`Result<T>` for expected failures; exceptions for programmer error.** Router
  misses, model timeouts and empty result sets are *expected*.
- **Runtime guards at data boundaries.** A registry is data, so a capability kind
  arrives as an unvalidated string. Typing it as `CapabilityKind` at the boundary
  would make the "unclassified to refuse" path look like dead code to the
  compiler and quietly delete the check ADR-004 requires. Narrow with a guard.
- **Inject the clock.** "Never `new Date()` inline" is a comment in the real
  code — a use case has to be deterministic under test.
- No `any` outside JSON-boundary code, and no non-null assertion unless the
  invariant is documented on the line above.
- Money is signed **integer minor units plus a currency code**. Never a float.
  Not in an entity, not in a DTO, not in a test fixture ([ADR-010](../decisions/ADR-010.md)).
- All timestamps stored UTC; converted at the presentation edge only.

> **No linter is configured.** `tooling/eslint-config` is an empty stub — its
> manifest names a `main` that does not exist, and there is no root lint script.
> Typecheck and tests are the only automated style gates today. Do not claim a
> lint rule enforces something; none does.

## Capability declarations

Every capability carries a description, triggers, typed params, and **at least
three examples**. The examples feed the golden-set generator and the few-shot
pool — an under-documented capability is a failing CI gate (`pnpm registry:check`),
not a style nit.

```ts
defineCapability({
  id: 'module.capture',
  kind: 'write',                     // selects the dispatcher policy — ADR-004
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
})
```

The **description is the retrieval surface** — stage 2 embeds it. Two
capabilities whose descriptions overlap semantically compete, and both get worse.
Differentiate by what makes them different, not by adding adjectives to both.

Declarations generate three artefacts (`pnpm registry:build`): the registry the
router reads, the route table the app reads, and the golden-set fixtures that
assert those two agree. **Regenerate in the same commit** — CI fails on the
drift, not on the edit.

## Prompts

- Prompts are versioned assets, never inline string literals scattered through
  logic. A prompt edit is a behavioural change and is reviewed like code.
- Every prompt change re-runs the golden set, and the prompt version is recorded
  in every `TurnTrace` — when field accuracy drifts, the app/model/prompt/registry
  version combination is the only way to identify what changed.

## LLM code rules

Non-negotiable, because these are the failure modes that actually bite:

1. **Never parse free-form model output.** Constrained decoding against a schema,
   or do not call the model. A grammar guarantees *valid*, not *correct* —
   confidence gating and clarify handle the semantic errors.
2. **Never let the model compute a number the user sees.** It phrases;
   TypeScript computes, from the store. This has already caught a real bug —
   PLAN.md section 6.
3. **Never let the model emit SQL, a route string, or a capability id that is not
   validated against the registry** before use. An unknown id becomes a clarify,
   never a best-effort guess.
4. **Always a timeout and a fallback.** Model unavailable, stages 1-2 still
   resolve, degrade to clarify. Never hang.
5. **Untrusted text is fenced and labelled.** `Module.body`, memo-style free
   text, imported files, OCR output — attacker-reachable by definition (Rule 15).
   See [security.md](security.md).
6. **Cheapest stage first.** If a turn can resolve without the model, it must.
   The stage 1+2 resolution rate is a primary metric, not an optimisation.

## Comments

Explain *why*, not *what*. The threshold tuning, the reason for a fallback
ordering, the bug a workaround addresses, the ADR a line implements — those need
comments, and the existing code is dense with them for exactly that reason.
A comment restating the statement below it does not.

## Git

`main` (production), `develop` (integration, the default), and feature branches
cut from and merged back into `develop`. Full policy:
[sdlc/branching.md](../sdlc/branching.md).

Conventional Commits, scoped to the package or layer:
`feat(core-intent): add margin gate to stage 2`.

**Stage explicit paths — never `git add -A` and never `git commit -a`.** This
tree is worked on by more than one session at a time; a broad stage commits
someone else's half-finished work. Enforced by `.claude/hooks/guard-git.mjs`.

PRs: green CI, golden-set accuracy not regressed, and an ADR for any
architectural change.
