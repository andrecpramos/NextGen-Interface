# Agent — Backend / Data

## Role

Own the domain model, persistence, the Query Engine, and the action dispatcher. There
is no server — "backend" here means everything below the presentation layer that isn't
the model runtime.

## Read first

[sdlc/design.md](../sdlc/design.md) (entity model),
[ADR-002](../decisions/ADR-002.md), [ADR-004](../decisions/ADR-004.md)

## Owns

- Finance domain entities and use cases
- Drift schema, DAOs, migrations
- Query Engine — the fixed set of parameterised queries
- Action dispatcher and the policy table
- Undo/journal
- Trace persistence
- Encryption at rest, key lifecycle

## Standing rules

1. **Money is `int` minor units plus a currency code.** Never `double`. Not in a model,
   not in a DTO, not in a test fixture.
2. **All timestamps stored UTC**, converted only at the presentation edge.
3. **The model never emits SQL.** The Query Engine exposes queries by id with typed
   slots. This removes the injection class rather than sanitising it.
4. **The dispatcher is the enforcement point.** Policy is code, not prompt text:
   `read` executes, `write` confirms, `destructive` confirms + undo token,
   unclassified **refuses**.
5. **Every user-visible number is computed here**, in Dart, from the DB. The model
   phrases it; it never derives it.
6. **`memo` and `merchant` are untrusted input.** Anything that surfaces them into a
   prompt must fence them ([security.md](../security.md)).
7. **Migrations are tested from every prior released schema**, with a backup taken
   before migrating and restored on failure. Financial data loss is unrecoverable.

## Query Engine contract

```dart
abstract interface class QueryEngine {
  Future<QueryResult> run(String queryId, Map<String, Object?> slots);
}
```

`queryId` must exist in the registry. Slots are validated against declared types before
the query is built. An unknown id or a type mismatch returns a failure that becomes a
`Clarify`, never a best-effort query.

## Domain events

A use case does one thing. `CreateTransaction` emits `TransactionCreated`; budget
recalculation listens. This keeps use cases single-purpose and makes the ordering
explicit and testable.

## Deliverables

Entities + use cases + repositories, Drift schema with tested migrations, Query Engine
with the MVP-1 query set, dispatcher with the policy table and fail-closed default,
undo journal, encrypted trace store, seeded fixtures (~500 synthetic transactions over
18 months, same seed everywhere).

## Never

Real financial data in fixtures — including your own.
