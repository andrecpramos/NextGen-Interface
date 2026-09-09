# @nextgen/core-dispatch

The dispatcher and the engines it drives: [ADR-004](../../.claude/decisions/ADR-004.md)
policy, navigation, query and undo.

**Boundary:** this is where enforcement lives. Everything the model influences arrives
as data — a capability id and a bag of slots — and everything that happens next is
decided by code.

## Policy is a function of `kind` alone

`decide()` takes no confidence score, and there is deliberately no way to pass it one.

That is not an oversight, it is the finding: on `gemma3:1b` the confidence gate held
back 2.9% of calls while the model answered *"what is the capital of France"* at 0.95
(FINDINGS Finding 8). A policy that consulted confidence would have degraded exactly
where it was most needed. This one did not — the adversarial bucket scored 20/20 with
zero safety violations on every model tested, including the one that refuses nothing.

| kind | policy |
|---|---|
| `read`, `navigate` | execute immediately |
| `write` | confirmation card showing **parsed parameters**, editable in place |
| `destructive` | confirmation + an undo token journalled **before** it runs |
| `unsupported` | refuse, with the authored message (ADR-009) |
| *unclassified* | **refuse.** Fail closed. |

`policyFor()` returns `null` for an unclassified kind rather than a default. The
realistic failure is not someone marking a delete as `read` — it is someone adding a
capability and forgetting to classify it. Defaulting to `read` would silently grant free
execution to whatever comes next.

A destructive action with no undo journal configured is **refused**, not executed.
Losing the ability to undo is a reason not to act, not a reason to skip the undo.

## Engines

- **`NavigationEngine`** — concrete. Turns a capability id plus slots into a route,
  fills `:segments`, drops undeclared params, and refuses rather than building a broken
  URL. There is no path from model output to a route string that does not pass through a
  registry lookup here, so a hallucinated `/expensez` cannot exist (Rule 3).
- **`QueryEngine`** — interface. The model selects an id and typed slots; an
  implementation maps that onto a fixed parameterised query set. **Never SQL from a
  model.** Implemented in WP-04.
- **`UndoJournal`** — interface. Records before the action; the affordance outlives the
  screen. Implemented in WP-04.
