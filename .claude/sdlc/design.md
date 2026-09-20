# SDLC — Design

## Purpose

Turn requirements into a buildable structure, and record the choices that are
expensive to reverse.

## Required design artefacts

| Artefact | Covers | Lives in |
|---|---|---|
| System architecture | Layer boundaries, dependency rule | [architecture.md](../docs/architecture.md) |
| Router cascade | Three stages, thresholds, gates | [architecture.md](../docs/architecture.md) |
| Capability registry schema | The registry contract | [architecture.md](../docs/architecture.md) |
| Sequence diagrams | Turn flows, incl. failure paths | this document |
| Navigation graph | Routes, params, guards | generated from registry |
| UX specs | The assistant surface — historical, see the note in that file | [ui-guidelines.md](../docs/ui-guidelines.md) |
| ADRs | Binding decisions + rationale | [decisions/](../decisions/) |

## Entity model and write-action sequence — removed

The entity model of the earlier finance app (accounts, transactions, budgets) and the
sequence for a confirmed write action (dispatcher, action engine, database) were removed on
2026-09-20. That app, its database and its dispatcher were deleted with ADR-018, and nothing
in this repository holds them. `TurnTrace` is described in
[architecture.md](../docs/architecture.md). The write-with-confirmation flow returns with
WP-48 (PLAN.md §7.5) and is not specified until then. **Its one durable design note stands:**
a confirmation shows the *parsed parameters*, not the utterance, because that is where a
misheard "twelve" for "twenty" is caught.

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

- [ ] Does it respect the dependency rule? (`core-*` depend only on `core-*` — Rule 1)
- [ ] If it touches the model: is there a timeout, a fallback, and a trace entry?
- [ ] If it produces a number the user sees: is that number computed in TypeScript?
- [ ] If it accepts a model-produced identifier: is it validated against the registry?
- [ ] If it's a capability: kind classified, ≥3 examples, params typed?
- [ ] If it handles untrusted text: is that text fenced before entering a prompt?
- [ ] Is the failure path designed, or only the success path?
- [ ] Is it reachable without AI? (Rule 7)
- [ ] Does it need an ADR?

## When an ADR is required

Any decision that is expensive to reverse: a dependency that spreads across layers, a
change to a layer boundary, the inference runtime, the router cascade
shape, the action policy table, or anything that weakens a stated principle. Number
sequentially, never delete, supersede by writing a new one.
