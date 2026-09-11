# @nextgen/web

**The assistant surface.** One page: the conversation is the interface, and the panels
are what it drives. A second surface over the *same* `NextGenApp` composition root the
CLI uses — not a reimplementation.

```bash
pnpm web          # dev server, http://localhost:3000
pnpm web:build    # production build
pnpm web:start    # serve the production build
```

All three run from the repo root. From inside `apps/web/`, the same three are
`pnpm dev`, `pnpm build`, `pnpm start`.

## Prerequisites

Nothing beyond the workspace install. Ollama is **probed, not required**:

| Ollama | Status bar shows | Behaviour |
|---|---|---|
| running, with `qwen2.5:1.5b` | a teal dot and `local` | full three-stage cascade |
| not running | an amber dot and `no model` | stages 1–2 only, `hashing` encoder |

That fallback is ADR-008 in practice: nothing on the critical path requires the
network, so a missing model degrades the router instead of producing an error page.
Set `NEXTGEN_MODEL` to use a different chat model.

## Layout

```
app/            layout · page · Assistant (client component) · globals.css
app/api/        session · turn · confirm · navigate   — Node runtime; the engine lives here
lib/            engine · render · store · wire
```

**The engine is server-side, always.** `@nextgen/data` binds `node:sqlite` and the
runtime opens a local socket, so the whole assembly runs in route handlers under
`app/api/*`. `@nextgen/ui` is the only workspace package that reaches the browser.

## Three things the CLI never needed — all in `lib/engine.ts`

1. **A singleton.** The database is in-memory and the registry embeds 27 capabilities
   on load. Per-request construction would be slow *and* wrong — the second request
   would not see the first request's writes.
2. **Survival across HMR.** Next re-evaluates modules on every edit in dev. Without
   stashing the instance on `globalThis`, every save would silently reset your data.
3. **The pending-decision table** — below.

## The pending-decision table is a security boundary

The client is **never** given a `Decision`. A `confirm` turn returns a card and a
`turnId`; the decision itself stays on the server. `/api/confirm` recalls it, merges
the user's *edited values* into it, and re-approves through the dispatcher, which
applies ADR-004 policy to the result exactly as it did the first time.

Two rules do the work: **no new slots** (a key absent from the original decision is
dropped, not added) and **types are preserved** (`amount` is parsed by
`fromMajorUnits` from its string, digit by digit, because `value * 100` is how a cent
goes missing — Rule 6).

So the worst a hostile client can do is change a value on a capability the router
already chose and the user already saw. It cannot pick the capability and it cannot
skip the card. Replaying a spent `turnId` and forging one both return 409.

## The drawer does not use the router

`/api/navigate` takes a capability id, validates it against the registry, and hands it
to the dispatcher through `app.invoke()`. No routing, no model — it resolves in about
a millisecond.

That is Rule 7 in its strong form. "Reachable without the AI" cannot mean *typing a
sentence the router will probably get right*: that is still the AI, and top-1 is
measured at 80%. The menu path has to be one the model cannot be wrong about, so the
model is not on it.

Policy is untouched. A `write` chosen from the drawer still raises a confirmation
card and a `destructive` one still journals its undo, because policy attaches to the
capability's **kind**, never to how the user got there (ADR-004). Verified: `settings.currency`
returns `confirm`, `transaction.delete` returns `confirm` with `destructive: true`,
and an unknown id 404s before reaching the dispatcher.

## Two renderers, one engine

`#read` in the CLI returns padded text lines. `lib/render.ts` returns a headline, a
caption and rows with bars. Both read `SqliteQueryEngine`, which stays the only thing
allowed to compute a number the user sees (Rule 2) — the model formats nothing.

The cost: an `execute` turn queries twice, once inside `turn()` for the trace's
`dataRead` and once for the view. Microseconds against in-memory SQLite. If it ever
matters, the fix is to hoist `#read` into a shared package rather than to let one
renderer serve both surfaces badly.

## API

| Route | | |
|---|---|---|
| `GET /api/session` | engine status, the drawer's contents, first-turn examples |
| `POST /api/turn` | `{ utterance }` → decision + rendered view + trace |
| `POST /api/confirm` | `{ turnId, params }` → the write's outcome |
| `POST /api/navigate` | `{ capabilityId }` → the same envelope as `turn`, chosen without the router |

`lib/wire.ts` is the shared type contract. It imports nothing that touches `node:*`,
because both the handlers and the browser read it.

## Known gaps

- **No tests here yet.** The API contract is the natural integration-test target.
- **Routes are tracked, not navigated.** The registry's `route` is carried in
  `app.route` and returned on every turn, but there are no per-route *screens* under
  `/transactions`, `/budget` etc. The drawer runs each capability and renders its
  answer into the stream; it does not take you to a page, because there are none yet.
- **Data resets on restart.** The database is in-memory by design while the schema
  moves. Persisting is a one-line change in the composition root.
