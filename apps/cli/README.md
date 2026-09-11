# @nextgen/cli

**The composition root.** The first and only place every package is wired into an actual
turn: utterance → router → dispatcher policy → domain use case → database → trace.

```bash
pnpm app            # with qwen2.5:1.5b via Ollama
pnpm app:offline    # stages 1-2 only, no model at all
```

## Why this exists

Before it, seven packages had 238 passing tests and had **never been run together**. That
is where integration defects live, and wiring this up immediately found two that no
isolated suite could reach:

- a *loaded* registry did not satisfy the dispatcher's port, because the port asked for a
  whole `RegistryFile` (enums in source form) when a loaded registry carries them compiled
- `OllamaOptions` rejected an explicit `undefined` under `exactOptionalPropertyTypes`

`apps/web` (WP-09) wraps this same assembly behind a UI. Nothing here is throwaway — the
CLI is a surface, not a prototype.

## What a turn does

1. `route()` — stage 1 trigger, stage 2 embedding, stage 3 constrained LLM
2. `Dispatcher.decide()` — ADR-004 policy on the *kind*, consulting no confidence score
3. only then, data: a fixed parameterised query, or a use case behind a confirmation
4. `TraceRecorder` wraps the whole thing in a `finally`, so a turn that throws is still
   recorded

`confirm()` is a separate call on purpose. The confirmation is not a formality the caller
can skip; it only exists once the user has seen the parsed parameters.

## Worth trying

| | |
|---|---|
| `pnpm app:offline` then `transfer 500 to my brother` | refused in ~0ms with no model — ADR-009 end to end |
| `pnpm app:offline` then `what did the weekend cost me` | asks instead of guessing — the degradation path |
| any turn, then `why` | the explanation, rendered from the record with no model and no network |
| delete a module, confirm, then `undo` | the module comes back exactly as it was, with the same id and timestamps (WP-18) |

## Wired

The CLI registers `domain-modules`, which has been the reference app since WP-14. How each
capability behaves:
- **Reads** (`module.list`, `module.search`) execute.
- **`module.capture`** is a write, so it asks for confirmation first.
- **`module.delete` and `module.revert`** confirm and then run, **and each can be undone**.
  Type `undo` straight after either one. The undo restores from the journal row that was
  captured before the action ran. A token cannot be spent twice. Undoing the revert of a
  module that has since been deleted is refused, rather than bringing the module back.

`domain-finance` is exercised by `domain-swap.test.ts`, not registered here.
