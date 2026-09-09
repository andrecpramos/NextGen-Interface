---
name: new-domain
description: Add a new domain package to the platform (a sibling of domain-modules and domain-finance) — entities, ports, use cases, capability registrations, codegen, and the composition-root wiring. Use when introducing a new subject area the assistant should handle, or when auditing whether the engine is still genuinely domain-agnostic.
---

# Adding a domain

This is the platform's whole thesis under test. The measure of success is
**how little code a domain requires, and whether `packages/core-*` has to change
at all to support it.** WP-14 added the modules domain touching no `core-*`
package except a 7-line addition to `core-inference/src/types.ts` for image
input, and `core-voice`, which did not exist yet. Anything worse than that is a
signal the engine leaked, not that the domain is unusual.

**The recurring test, applied to every design decision here:** *what would a
third domain have to change in `core-*` to use this?* If the answer is anything
but "nothing", the design is wrong.

## Rule 1 governs everything

`packages/core-*` **never** imports a domain. Domains register **into** the
engine; the engine never enumerates them. There is no `switch` over domain types
anywhere in `core-*`, and if you find yourself adding one, the abstraction is
wrong — the thing you want belongs in a registration.

Gated by `node tooling/scripts/check-import-boundaries.mjs`, which checks both
directions: the declared dependency in `package.json`, and every actual import
specifier under `src/`. A clean manifest with a stray deep import fails, and so
does the reverse.

## The shape to copy

`packages/domain-modules` is the reference. `packages/domain-finance` is the
same shape and stays in the repo precisely so that "does the engine still work
for a domain it was not designed around" has a standing answer.

```
packages/domain-<name>/
├── package.json          # deps: @nextgen/core-capability, @nextgen/core-inference
├── tsconfig.json
├── scripts/
│   └── build-registry.ts # codegen — copy verbatim, change only the paths
├── generated/            # COMMITTED: routes.json, golden.generated.jsonl
└── src/
    ├── entities.ts       # types + repository PORTS (interfaces), no implementations
    ├── events.ts         # domain events + the bus
    ├── use-cases.ts      # one thing each; emit events rather than reaching sideways
    ├── capabilities.ts   # defineCapability / defineBoundary / defineRegistry
    ├── domain.test.ts
    └── index.ts          # the public surface — the composition root imports only this
```

## Steps

### 1. Entities and ports

Types and repository **interfaces** only. The domain declares what it needs;
infrastructure implements it. `packages/data` provides the SQLite-backed
implementations, wired at the composition root — the domain never imports it
outside `devDependencies` for tests.

Interfaces stay narrow. A reader and a writer are separate interfaces so the
query path can be handed the reader alone.

Two invariants that are not style choices:

- **Money is signed integer minor units plus a currency code. Never float.** Not
  in an entity, not in a DTO, not in a test fixture (Rule 6, ADR-010).
- **All timestamps stored UTC**, converted only at the presentation edge.

### 2. Mark the untrusted fields

**A domain's free text is attacker-reachable the moment it crosses into a
prompt** (Rule 15). `Module.body` and `Transaction.memo` are the existing
examples, and both carry a comment at the declaration saying so. Do the same for
yours, at the type, where the next reader will see it.

Anything that surfaces such a field into a prompt fences and labels it. See
[.claude/docs/security.md](../../../.claude/docs/security.md).

### 3. Use cases

One use case does one thing. `CreateTransaction` does not also update budgets —
it emits `TransactionCreated`, and a budget use case listens. That keeps each one
single-purpose and makes the ordering explicit and testable.

**The model never computes a number the user sees** (Rule 2). It phrases; the use
case computes, from the store. This has already caught a real bug — see PLAN.md §6.

**The model never emits SQL and never a raw route** (Rule 3). It selects a
capability id and fills typed slots, and every identifier it produces is
validated against the registry before use (Rule 4).

### 4. Capabilities

Use the `add-capability` skill — it covers the declaration, codegen, and the
router check in full.

Two domain-level points it assumes you have already decided:

- **`kind` selects the dispatcher's policy** (ADR-004, Rule 5): `read` executes,
  `write` confirms, `destructive` confirms and issues an undo token, unclassified
  **refuses**. Policy is code in the dispatcher, never prompt text.
- **Declare the domain's limits** as `defineBoundary` entries. Out-of-scope is
  matched by the same retrieval as everything else, never judged by the model
  (ADR-009, Rule 13).

Keep the registry small. Capabilities are *kinds of turn*, not topics — the
router recognises which kind, and the harder judgment happens inside the
capability's own execution with a larger model. Every capability added narrows
stage-2 margins for its neighbours.

### 5. Codegen — and the shared-path trap

```bash
pnpm registry:check      # validate; the CI gate
```

> ⚠️ `OUT_INTENT` in every `build-registry.ts` points at the **one** global
> `packages/core-intent/eval/registry.json`. Only one domain's build script can
> be authoritative at a time — running a second domain's build silently
> overwrites the registry the router reads. The root `registry:build` script is
> the authoritative one (`domain-modules` since WP-14). If you add a third
> domain, decide explicitly which one the root script points at, and check
> `git diff packages/core-intent/eval/registry.json` before every commit.

### 6. Wire it at the composition root — and only there

Add the workspace dependency to `apps/cli` and `apps/web`, and register through
the domain's `index.ts`. That import is the only place the app knows the domain's
name. Nothing in `packages/core-*` changes.

**Every route the AI can reach must be reachable without it** (Rule 7, ADR-005).
Conventional navigation is secondary in weight, complete in coverage.

### 7. Prove the boundary held

```bash
node tooling/scripts/check-import-boundaries.mjs
pnpm -r typecheck
pnpm -r test
pnpm registry:check
pnpm router:floor        # the new capabilities did not crowd the existing ones
```

Then answer, in the PR body: **which `core-*` files did this need, and why?**
A non-empty answer is the interesting result — it is either a genuine engine gap
worth an ADR, or a leak worth fixing before it sets.

## Related

- `add-capability` skill — the declaration and its gates in detail
- `write-adr` skill — a new domain that required a `core-*` change owes one
- [.claude/docs/architecture.md](../../../.claude/docs/architecture.md) — the layers and how they talk
- [ADR-004](../../../.claude/decisions/ADR-004.md) · [ADR-009](../../../.claude/decisions/ADR-009.md) · [ADR-010](../../../.claude/decisions/ADR-010.md)
