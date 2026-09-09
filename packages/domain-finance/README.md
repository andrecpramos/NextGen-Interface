# @nextgen/domain-finance

Domain #1. Entities, ports, domain events, use cases, and the 27 capability definitions
the registry is generated from.

**Boundary:** this package imports the engine's contract (`@nextgen/core-capability`).
**No `core-*` package imports this one** — asserted mechanically in `domain.test.ts`, per
package, over both source text and declared dependencies.

That check is the architecture's central claim made testable. The real measure of this
project is how little code domain #2 requires; if any `core-*` package reaches into
finance, that test is already failed and nobody would find out until the second domain
was attempted.

## Ports point neither way

The domain declares the repository interfaces. `@nextgen/data` implements them — and
because TypeScript is structural, **neither package imports the other's version**.
`@nextgen/data` is a *dev* dependency here, needed only to assert the fit at compile time.

A port the adapter imports is a port the adapter can quietly widen. This one cannot drift
without the assertion failing — which it did on the first run: `data` typed `account.type`
as `string` while the domain says it is one of four values. That got fixed where rows
actually enter, so the read path narrows honestly instead of asserting and hoping.

## Use cases do one thing and emit an event

Each validates its preconditions, does the one write, and emits — it does not reach into
another aggregate to keep something else up to date.

`watchBudgets` is the illustration: it is a **subscriber**, not something
`createTransaction` calls. The moment recording a transaction also recomputes budgets, the
two aggregates are welded together and domain #2 inherits the weld.

Every use case returns a `Result` rather than throwing. A use case refusing is ordinary
product behaviour — "that account doesn't exist", "income isn't spending" — and the caller
turns it into a clarifying question, not a stack trace. A throwing *subscriber* cannot
unmake what already happened, either: the event is a statement of fact.

## The sign lives here

[ADR-010](../../.claude/decisions/ADR-010.md) §2 left this owed to the domain, and this is
where it is paid. `createTransaction` takes an unsigned **magnitude** and applies the
direction from the category's kind.

"twenty euros" and "minus twenty euros" both mean the quantity 20. Whether it leaves or
arrives is a property of what it was spent on, not of the sentence — which is why the
router's parser stays sign-free and a second domain reusing `core-intent` inherits no
finance opinions.

## Changing the registry

`src/capabilities.ts` is the source of truth. After editing it:

```bash
pnpm registry:build    # regenerate registry.json, routes.json, golden fixtures
pnpm registry:check    # the CI gate
pnpm router:calibrate  # thresholds are per-registry as well as per-encoder (ADR-009)
```

That last one is not optional. `boundaryMargin` depends on what else is in the corpus, so
adding or removing capabilities invalidates it exactly as changing the encoder would.
