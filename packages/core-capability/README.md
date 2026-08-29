# @nextgen/core-capability

The capability registry: schema, typed builders, validation and codegen.

**Boundary:** owns the contract that routing, navigation and the intent engine all read,
so they cannot drift. It depends on nothing else in the workspace — a contract that
imports its consumers is not a contract.

## One definition, four artefacts

A domain writes `defineCapability(...)`. From that single source, codegen emits:

| Artefact | Consumed by |
|---|---|
| `registry.json` | the intent engine (stage-2 retrieval, stage-3 menu) |
| `routes.json` | the app router |
| embedding index | stage 2, precomputed at build time |
| golden entries | the regression suite |

Because both the route and the routable intent come from one definition, *a route
cannot exist that the AI does not know about, and the AI cannot know about a route that
does not exist.*

`capabilityDocument()` matters more than it looks: it is the exact text stage 2 embeds,
and both the runtime loader and the codegen call it. Before, the loader built that
string itself and codegen would have had to reimplement it and hope. Changing it
invalidates every cached vector and shifts every score — treat it as versioned.

## Kinds

`navigate` · `read` · `write` · `destructive` — the [ADR-004](../../.ai/decisions/ADR-004.md)
policy table — plus `unsupported`.

`unsupported` ([ADR-009](../../.ai/decisions/ADR-009.md)) is a **declared limit**: a class
of request the application deliberately does not serve, written with a description,
examples and an authored refusal. It is matched by the same retrieval as everything
else, which is what turns out-of-scope detection from a judgement the model makes into
ordinary routing — and therefore something that behaves identically on a 1B model.

Note the distinction the whole safety model rests on:

- **`unsupported`** — classified, deliberate, with a message. The product working.
- **unclassified** — a missing or unknown `kind`. A defect that must fail the build.

They look identical to the user and are opposites to the developer.

## Validation

`validateRegistry()` runs in CI (`pnpm registry:check`) and fails the build on:

- a missing or unknown `kind` — the ADR-004 fail-closed rule
- fewer than **3 examples** — they are the retrieval document, the few-shot pool *and*
  the test fixtures, so two is under-specified in three places at once
- a duplicate trigger — stage 1 takes the first registration, so the second capability
  silently becomes unreachable by phrase
- a path parameter (`/budget/:id`) that is not declared, or declared optional
- a param naming an enum the registry does not declare — unfillable, so the turn
  escalates forever
- a boundary entry with a route, with params, or without a refusal; or a refusal on an
  executable capability

Shared routes are a warning, not an error: a list and its filtered view legitimately
share a screen, but it is also what an accidental copy-paste looks like.
