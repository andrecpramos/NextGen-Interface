# `@nextgen/generator`

Reads an application's source and emits **one capability registry per role**,
plus a report of every route it refused to declare and why.

This is WP-25 — the piece PLAN.md §1.4 calls "build time, once". Everything else
in the platform consumes what this produces.

```bash
node --experimental-strip-types packages/generator/src/cli.ts <config.json> \
  [--out dir] [--model llama3.1:8b] [--no-model] [--endpoint http://localhost:11434]
```

## What it emits

| File | What it is |
|---|---|
| `registry.<ROLE>.json` | A plain `RegistryFile` holding only what that role can reach, each capability carrying its declared `explanation`. This is what ships. |
| `master.json` | Every capability with its `roles` annotation, for review and diffing. Never shipped to a browser. |
| `SKIPPED.md` | Every discovered route that did **not** become a capability, with the application's own words as evidence. |
| `prose-cache.json` | Model-written descriptions and examples, keyed by a hash of the facts that produced them. This is what makes regeneration deterministic. |

## The two rules it exists to keep

**Rule 16 — it never writes inside the application it reads.** `writeOutput`
refuses an output directory inside `appRoot`, and `generate.test.ts` fingerprints
the whole fixture tree before and after a full run. An installer that edits a
repository it does not own cannot be cleanly uninstalled and turns every upgrade
into a merge conflict.

**Rule 17 — a capability a role cannot reach is absent from its registry, not
hidden in it.** `splitByRole` is where that happens, and `emit.test.ts` proves it
by diffing two role registries rather than by reading the code that builds them.
The `roles` annotation is stripped on the way out: the registry a session
receives *is* its entitlement, so nothing at run time needs to be told who else
can see what.

Role extraction has a zero-tolerance kill criterion (PLAN.md §8). There is no
"probably open to everyone" branch anywhere in `discover.ts`: a guard expression
that cannot be evaluated with certainty yields `null`, and `null` is a recorded
skip, never a default.

## What decides whether a route becomes a capability

In order, each failure recorded with evidence:

1. **The role guard must be readable.** `readRoles('A','B')` is inlined only
   after its declaration is *proven* to be `(...xs) => [...xs]` — a helper that
   removed a role would otherwise be read as granting it.
2. **It must not be dev-only** — `import.meta.env.DEV` is structural, visible in
   the AST.
3. **The application must not say it is legacy.** That judgement lives in prose
   and nowhere else, so `prose.ts` reads route comments and nav-manifest reasons.
   Reading them *correctly* is the hard part: a marker naming a different route
   before it, or describing "the legacy routes below", is not about this one.
4. **It must not be a bookmark shim.** Decided from the component's body — does
   every branch render a redirect, and does that redirect leave its own section
   — never from its name. `MatchHubRedirectPage` is a destination;
   `DashboardPage` is not.

Anything not confidently `read` or `navigate` is **omitted, never guessed**
(decided 2026-09-08). A missing capability degrades safely, because Rule 7
guarantees the app still works without us. A wrongly declared one sends a user
confidently to the wrong place.

## Where the model is, and is not

The model writes **prose and nothing else** — a description, a declared
explanation, and example utterances. Route, role, id and kind are all decided
mechanically before a prompt exists, and none of them can be read back out of a
completion. That is what makes it safe to put the adopter's own page copy in
front of a model at all (Rule 15): the worst a hostile string in their source can
achieve is a bad sentence, and even that is length-capped.

Three fields, three jobs:

| Field | Job | Read by |
|---|---|---|
| `description` | be **distinctive**, so stage 2 can tell this screen from 144 others | the embedder |
| `explanation` | be **readable**, and answer "what is this screen for?" | the user, verbatim |
| `examples` | be **the words a user would actually type** | the embedder, and the golden set |

`explanation` is deliberately **not** part of `capabilityDocument`. Adding it
would change every vector and invalidate every calibrated threshold (Rule 14) —
it is what gets *served*, not what gets *matched*, and keeping the two apart is
what lets an adopter rewrite a bad answer without recalibrating anything.

Each explanation carries an `explanationSource`: the adopter's own file, relative
to their source root. A wrong answer in their assistant is one path away from the
page that produced it.

Runs without a model at all (`--no-model`), deriving prose from the
application's own labels. The output is flatter and says so.

## Adapters

React Router in both dialects (a route-config array, and nested `<Route>` elements), in
TypeScript or JavaScript sources. An application with no roles at all gets one registry
for a single `PUBLIC` audience.

**The data-router shape** (WP-28, 2026-09-11) is also read:
- `lazy: () => import(...)`;
- paths taken from a constants table such as `paths.app.users.path`, followed through
  constants and named imports;
- imports through a tsconfig `paths` alias such as `@/*`.

On a public app we do not own, these were invisible, and discovery found **1 of 8**
routes. It now finds 8. **What discovery still cannot read, it reports.** An unevaluable
path or a missing component becomes an `unreadable-route` skip in `SKIPPED.md`, instead of
disappearing (see [lessons.md L12](../../.claude/docs/lessons.md)). The
`fixtures/data-router-app/` fixture holds this.

## Guided steps (WP-27)

A page with a form gets `steps` on its capability. Each step is one sentence per field,
plus one for the submit button, in the app's first language. Each step carries an
**anchor**:
- the field's accessible name and role, which is primary (decided in D-3);
- a build-time CSS selector, as the fallback.

`steps.ts` writes them, and `pages.ts` reads the form fields. The runtime resolver in
`packages/ui` refuses rather than guesses. If a label matches twice, or a selector finds
an element whose name contradicts the label, the step renders as text with nothing
highlighted. It never points at the wrong field.

See [`eval/fut-app/REPORT.md`](../../eval/fut-app/REPORT.md) for what it scored
against a 146-page application it was not designed for.
