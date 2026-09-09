# SDLC — Design

## Purpose

Turn requirements into a buildable structure, and record the choices that are
expensive to reverse.

## Required design artefacts

| Artefact | Covers | Lives in |
|---|---|---|
| System architecture | Layer boundaries, dependency rule | [architecture.md](../docs/architecture.md) |
| Router cascade | Three stages, thresholds, gates | [architecture.md](../docs/architecture.md) |
| Capability registry schema | The engine↔domain contract | [architecture.md](../docs/architecture.md) |
| Sequence diagrams | Turn flows, incl. failure paths | this document |
| ERD | Finance entities | this document |
| Navigation graph | Routes, params, guards | generated from registry |
| UX specs | Sphere states, confirmation, trace view | [ui-guidelines.md](../docs/ui-guidelines.md) |
| ADRs | Binding decisions + rationale | [decisions/](../../.claude/decisions) |

## Entity model — finance domain

```
┌──────────────┐        ┌──────────────┐        ┌──────────────┐
│ Account      │1      *│ Transaction  │*      1│ Category     │
│──────────────│────────│──────────────│────────│──────────────│
│ id           │        │ id           │        │ id           │
│ name         │        │ accountId FK │        │ name         │
│ type         │        │ categoryId FK│        │ parentId FK  │
│ currency     │        │ amountMinor  │        │ icon         │
│ openingMinor │        │ currency     │        │ kind         │
└──────────────┘        │ occurredAt   │        └──────┬───────┘
                        │ memo         │  UNTRUSTED    │1
                        │ merchant     │               │
                        │ createdAt    │               │*
                        └──────────────┘        ┌──────▼───────┐
                                                │ Budget       │
┌──────────────┐        ┌──────────────┐        │──────────────│
│ TurnTrace    │       *│ DataRef      │        │ id           │
│──────────────│────────│──────────────│        │ categoryId FK│
│ turnId       │        │ table        │        │ periodStart  │
│ transcript   │        │ rowIds       │        │ periodEnd    │
│ decidedAt    │        │ range        │        │ limitMinor   │
│ candidates   │        └──────────────┘        └──────────────┘
│ outcome      │
│ modelId      │   ← every turn, no exceptions
│ promptVer    │
│ latencyMs    │
│ undoToken    │
└──────────────┘
```

Design notes that are not obvious:

- `amountMinor` is `int`. Currency travels with the amount — a multi-currency account
  set makes aggregation currency-aware or wrong.
- `memo` and `merchant` are **untrusted input**. Anything that puts them in a prompt
  must fence them ([security.md](../docs/security.md)).
- Categories are a tree (`parentId`), because "food" must aggregate "groceries" and
  "restaurants". The router's enum matching resolves to leaves and rolls up.
- `TurnTrace` is a first-class entity, not a log file. It is queried by the trace
  viewer and exported for eval-set construction.

## Sequence — write action with confirmation

```
User        Conversation   Router      Dispatcher   ActionEngine   DB     Trace
 │  "add 12 euros coffee"      │            │            │          │       │
 ├──────────▶│                 │            │            │          │       │
 │           ├── Utterance ───▶│            │            │          │       │
 │           │        stage1 miss           │            │          │       │
 │           │        stage2 → transaction.create 0.79   │          │       │
 │           │        stage3 → slots{12.00, food, today} │          │       │
 │           │                 ├── Perform ▶│            │          │       │
 │           │                 │      kind=write → CONFIRM REQUIRED │       │
 │◀── confirmation card (parsed params, editable) ───────┤          │       │
 │  [Confirm]│                 │            │            │          │       │
 ├──────────────────────────────────────────▶│          │          │       │
 │           │                 │            ├── execute ─▶│─ insert ▶│      │
 │           │                 │            │            │◀─ ok ────┤       │
 │◀── "Added €12.00 to Food" + navigate /transactions ───┤          │       │
 │           │                 │            │            │          │  write│
 │           │                 │            │            │          ├──────▶│
```

The confirmation card shows **parsed parameters**, not the utterance. That is where a
misheard "twelve" vs "twenty" gets caught, and it is the single highest-value UX
detail in the system.

## Sequence — degradation when the model is unavailable

```
Utterance ─▶ stage1 miss ─▶ stage2 → best 0.52, margin 0.04 (ambiguous)
          ─▶ stage3 → model not downloaded / load failed / timeout
          ─▶ FALLBACK: Clarify with stage-2 top-3 as tappable options
          ─▶ Trace: decidedAt=embedding, llmError=<reason>
```

The app never hangs and never guesses. It asks, using what it already knows. This path
is tested by fault injection, not assumed.

## Design review checklist

Before implementation starts on any component:

- [ ] Does it respect the dependency rule? (`core` must not import `features`)
- [ ] If it touches the model: is there a timeout, a fallback, and a trace entry?
- [ ] If it produces a number the user sees: is that number computed in Dart?
- [ ] If it accepts a model-produced identifier: is it validated against the registry?
- [ ] If it's a capability: kind classified, ≥3 examples, params typed?
- [ ] If it handles untrusted text: is that text fenced before entering a prompt?
- [ ] Is the failure path designed, or only the success path?
- [ ] Is it reachable without AI? (FR-NAV-04)
- [ ] Does it need an ADR?

## When an ADR is required

Any decision that is expensive to reverse: a dependency that spreads across layers, a
change to a layer boundary, the inference runtime, the DB engine, the router cascade
shape, the action policy table, or anything that weakens a stated principle. Number
sequentially, never delete, supersede by writing a new one.
