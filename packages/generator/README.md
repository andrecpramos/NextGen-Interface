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
| `registry.<ROLE>.json` | A plain `RegistryFile` holding only what that role can reach. This is what ships. |
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

The model writes **prose and nothing else** — a description and example
utterances. Route, role, id and kind are all decided mechanically before a
prompt exists, and none of them can be read back out of a completion. That is
what makes it safe to put the adopter's own page copy in front of a model at all
(Rule 15): the worst a hostile string in their source can achieve is a bad
sentence.

Runs without a model at all (`--no-model`), deriving prose from the
application's own labels. The output is flatter and says so.

## Adapters

React Router, in both dialects — a route-config array and nested `<Route>`
elements — plus TypeScript or JavaScript sources. An application with no roles
at all gets one registry for a single `PUBLIC` audience.

See [`eval/fut-app/REPORT.md`](../../eval/fut-app/REPORT.md) for what it scored
against a 146-page application it was not designed for.
