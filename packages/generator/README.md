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
| `INFERRED.md` | Every candidate rule found in a handler or control but not confidently recognised, held back rather than guessed (ADR-020, WP-55). |
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
application's own labels. The output is flatter and says so. Derived examples use each
title's own language: "abre anúncios", "open announcements".

## How a screen is named

A title is the first thing stage 2 embeds and the first thing a user reads. It comes from
the application's own words, in each language the app ships (`resolveTitles` in
`generate.ts`), in this order:

1. the label its navigation gives it, from a configured manifest;
2. the heading the page renders — its page header's `title`, or its `<h1>` (`titleKeys` in
   `pages.ts`). Translation functions bound under another name count
   (`const { t: tp } = useTranslation('player')`), and so does a local `const title = …`. A
   header from an early return does not: it names a loading or failed moment;
3. a page-level `*.title` key, or a title the page declares as a literal;
4. a nav-shaped `{ label, route }` written anywhere else in the source (`readSourceLabels`).

A component's name is used only when the application names the screen in no language at all.

- **A wrapper page is read through what it renders** (`readScreen`). When a page's own file
  says nothing — `<PersonalSettingsLayout active="notif">…` — the app's own components one
  level down are read instead, with the page's string props put into template keys:
  `t(`sections.${active}`)` becomes `sections.notif`. The page is then named the way the
  layout shows it: "As Minhas Preferências · Notificações". A shared UI kit is never read.
- **A duplicate is judged inside a registry.** Two screens only compete when some role
  reaches both (ADR-014). A duplicate is qualified in the title's own language, with:
  - its nav group's label, the way the app's command palette writes it
    ("Plantel · Visão geral"), or
  - its area's name.

  An English folder name never qualifies a Portuguese title. Trigger ambiguity is judged
  the same way.
- **One screen at two addresses is declared once.** Two cases:
  - A static route that renders a redirect into a detail route with one parameter in the
    middle (`/my/children/medical` → `/my/children/:childId/medical`) is that page's entry
    point. The detail is skipped as `reached-through-resolver`, and the resolver takes the
    detail's facts.
  - A route-table `<Navigate>` to a screen declared at its own address is an old name for
    that screen, and is skipped as `redirect-alias`. One that lands a section on its own
    first page is kept.

How a screen is named was rebuilt against a real pilot; the failures it found, generalised, are in [FIELD-NOTES.md](../../adapter/FIELD-NOTES.md).

## Adapters

Set by `router` in the config (`init` detects it from `package.json` and the folder layout):

| `router` | Reads | Since |
|---|---|---|
| `react-router` (default) | a route table: a route-config array or nested `<Route>` elements, TypeScript or JavaScript | WP-25 |
| `next` | the `app` router (route groups, `[param]`, optional catch-alls at their base URL; private folders, `@slots`, interceptions, `route.*` handlers and special files are not pages) and the `pages` router beside it (`index`, `[param]`; `api/`, `_app`, `_document`, `404` are not) | readiness 3a |
| `remix` | flat routes in `app/routes`: `_index`, pathless `_layout.`, `name_`, `$param`, `(optional)`, `[.]` escapes, folder `route.tsx`. A module with no default export is a resource route, not a page; a layout and its `_index` are one destination | readiness 3a |
| `sveltekit` | `src/routes`: a folder with `+page.svelte` is a page; groups `(name)`, `[param]`, `[param=matcher]`, optional `[[param]]` (declared without it), a literal prefix such as `@[user]`; `+layout`, `+error` and a server-only route are not pages | readiness 3b |
| `nuxt` | `app/pages` (Nuxt 4) or `pages` (Nuxt 3): `index`, `[param]`, optional `[[param]]`, groups `(name)`, nested parent pages (a parent and its own `index` are one destination) | readiness 3b |
| `vue-router` | the route table in code, as `react-router`: `component` eager or `() => import(...)` lazy, through a Vite alias to a `.vue` file with or without its extension; `children`; a `redirect` entry is not a page; roles from `meta.roles` | readiness 3c |
| `angular` | the `Routes` array in code: `component`, `loadComponent` (default or named export), `loadChildren` into another file's routes, paths without a leading slash; a `redirectTo` entry is not a page; roles from `data.roles`; the page's text is its `templateUrl` or inline `template` | readiness 3c |

A **catch-all** (`[...slug]`, a Remix `$`) serves pages that come from content, not code, so it
is reported as a `catch-all` skip rather than declared. A page's own title is used when it is a
string literal: Next.js `metadata.title`, a Remix `meta` title, a Svelte `<title>`, or Nuxt's
`useHead` / `useSeoMeta` / `definePageMeta`. `generateMetadata`, a conditional or data is code, and
is not evaluated. A site name every title shares after its separator (`Settings • Conduit`) is
removed. `.vue` and `.svelte` pages are read as markup (`markup.ts`): literal headings and text, a
form's fields, and translation keys — never a heading built from data, and never a block shown only on
failure. Locales may be one flat file per language (`locales/pt-PT.json`), keyed by the text itself.

A folder layout declares no roles, so every route of a `next` or `remix` app goes to the app's
whole audience. **`routeRoles`** declares roles an app enforces in code, by path prefix:
`{ "/admin": ["ADMIN"] }`. The longest prefix matching at a segment boundary wins, and it
applies to every router. An application with no roles at all gets one registry for a single
`PUBLIC` audience. **A role named on a route** — by `routeRoles`, Angular `data.roles` or Vue
Router `meta.roles` — joins that audience: it gets its own registry, holding the screens open to
everyone and the ones narrowed to it, and no other registry holds a screen narrowed away from it.
A `canActivate` or `beforeEnter` guard is code, and authentication is not a role: neither is read.

Measured on six public apps not written for it, against ground truth recorded first:
[eval/field-apps/RESULT.md](../../eval/field-apps/RESULT.md).

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
`packages/embed` refuses rather than guesses. If a label matches twice, or a selector finds
an element whose name contradicts the label, the step renders as text with nothing
highlighted. It never points at the wrong field.

See [eval/field-apps/RESULT.md](../../eval/field-apps/RESULT.md) for what it scored on apps it had never seen
against a 146-page application it was not designed for.
