# Coding Standards

**Stack:** TypeScript, pnpm workspaces, Node 23.6+, vitest, and esbuild for the widget
bundle.

## Structure

The critical boundary is `packages/core-*` (the application-agnostic engine) sitting below
everything that reads or serves an application.

```
packages/
├── core-capability/     # the registry contract: schema, validation, typed builders
├── core-inference/      # LLM + embedding runtimes, the untrusted-text fence
├── core-intent/         # 3-stage router, scoring, thresholds, calibration, the trace
├── generator/           # reads an application's source, emits one registry per role
├── embed/               # the widget: one script tag, strict CSP
└── kit/                 # init / build / doctor / calibrate / preview

adapter/                 # what an adopter copies — committed build output of the above
preview/                 # the bench — never exported
eval/                    # fixture apps, ground truth for public apps, the a11y record
tooling/scripts/         # the CI gates that are not tests
```

**Enforced rule (Rule 1):** `packages/core-*` depend only on other `core-*` packages — never on
`generator`, `embed` or `kit`. Checked by `node tooling/scripts/check-import-boundaries.mjs`,
in both directions — the declared dependency in `package.json` *and* every actual import
specifier under `src/`, including a relative path out of the package. If the engine needs to
know something an application-facing package holds, that knowledge arrives as a
**registration or a callback**, never an import. No package is installable or published
(ADR-021).

## SOLID, applied here

- **S** — a function does one thing. `validateClaims` strips a model's unsafe sentences and
  does not also decide what to say instead.
- **O** — new behaviour is added by registration or by generation, never by editing a
  `switch` over an application's type inside the engine. If you are editing a switch to add
  a case, the abstraction is wrong.
- **L** — every inference runtime (Ollama, llama.cpp, cloud, fake) is
  substitutable. Tests run against the fake; nothing in a test path needs a model.
- **I** — narrow interfaces. A reader and a writer are separate, so the query
  path can be handed the reader alone.
- **D** — the engine declares interfaces (`core-inference`'s runtimes, the registry
  contract); `generator`, `embed` and `kit` implement or consume them, and `kit` is where
  they meet at build time.

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
  Not in an entity, not in a DTO, not in a test fixture (Rule 6).
- All timestamps stored UTC; converted at the presentation edge only.

> **No linter is configured.** There is no root lint script and no package defines
> one. Typecheck and tests are the only automated style gates today. Do not claim a
> lint rule enforces something; none does.


## Capability entries

Capabilities are not declared by hand in this repository: `packages/generator` reads an
application's source and emits them (ADR-013, ADR-018). `defineCapability` remains in
`core-capability` as a typed builder that tests use; nothing an adopter runs declares a
capability with it. Every entry the generator emits carries a description, an
**explanation**, triggers, typed params, and **at least three examples**. The examples feed
the retrieval text and the golden-set fixtures — an under-documented capability is a failing
CI gate (`pnpm registry:check`), not a style nit.

```json
{
  "id": "communication.my_announcements",
  "kind": "navigate",
  "route": "/my/announcements",
  "title": "Anúncios",
  "description": "Anúncios — part of the communication area of the application, at /my/announcements.",
  "explanation": "Anúncios is a screen in the communication area … It shows: Enviado por, …",
  "explanationSource": "features/communication/pages/MyAnnouncementsPage.tsx",
  "examples": ["abre anúncios", "leva-me para anúncios", "…"],
  "triggers": ["anuncios", "announcements"]
}
```

The **description is the retrieval surface** — stage 2 embeds it. Two
capabilities whose descriptions overlap semantically compete, and both get worse.
Differentiate by what makes them different, not by adding adjectives to both.

The **explanation is the answer surface** — it is what a user is told, verbatim,
and it is deliberately **not** embedded. Keeping the two apart is what lets you
rewrite a bad answer without shifting a single vector or recalibrating a single
threshold (Rule 14). Write the description for the embedder and the explanation
for the person.

⚠️ **When a model writes these, ask for them in separate calls.** Adding
`explanation` to the completion that already produced `description` and `examples`
cost **7 points of top-1 accuracy** on a real registry — the explanation was fine
and the other two fields got worse. Output fields compete for attention exactly
like stacked instructions do.

The committed registries under `eval/frameworks/<app>/generated/` are derived from the
generator. **Regenerate them in the same commit as the change that alters them** — CI fails
on the drift, not on the edit. The exact order is in the `new-feature` skill.

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
   TypeScript computes. This has already caught a real bug.
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
