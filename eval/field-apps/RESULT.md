# Field apps — what the kit found, against ground truth written first

**Ground truth:** [GROUND_TRUTH.md](GROUND_TRUTH.md), recorded by reading each app's tree
by hand before any adapter existed. **Run:** `nextgen init / build / doctor` from source,
into a kit folder outside each clone, 2026-09-13.

## Readiness item 3a — Next.js and Remix

| App | Destinations declared | Wrong destinations | Catch-alls reported | Audiences | App's files changed | `doctor` |
|---|---|---|---|---|---|---|
| taxonomy (Next.js 13.3, app router + `pages/api`) | **11 of 11** | **0** | **3 of 3** | 1 (no role guards exist) | **0** | exit 0 |
| indie-stack (Remix v2 flat routes) | **6 of 6** | **0** | — (none exist) | 1 (no role guards exist) | **0** | exit 0 |

Recall 17 of 17, precision 17 of 17, and 0 Rule 17 leaks — which, for two apps that gate
only on login, is the only acceptable count, not an achievement.

**What was not declared, correctly:** taxonomy's five `app/api/**/route.ts` handlers, its
`pages/api/auth/[...nextauth].ts`, its layouts and its `not-found`; indie-stack's
`healthcheck` and `logout` resource routes (no default export).

### The titles it wrote

| taxonomy | | indie-stack | |
|---|---|---|---|
| `/` | Home | `/` | Remix Notes |
| `/pricing` | Pricing | `/join` | Sign Up |
| `/register` | Create an account | `/login` | Login |
| `/dashboard/settings` | Settings | `/notes` | Notes |
| `/docs` | Doc | `/notes/new` | New Note |
| `/editor/:postId` | Editor | `/notes/:noteId` | Note Details |

Taken from `metadata.title` and Remix `meta` where the page declares one as a literal,
otherwise from the page component's name.

**Two found by this run and fixed before it was recorded:**
- taxonomy's home page came out as **"Index"**, because both conventions name the root page
  after its file (`IndexPage`, Remix's `Index`). At `/`, such a name now titles the
  screen "Home".
- The kit told Angular users "This looks like **a** Angular application".

**Still weak:** `/docs` is "Doc", from `DocPage`, because its title comes from
`generateMetadata`, which is code and is not evaluated. A navigation manifest fixes that; the
kit does not detect taxonomy's `config/dashboard.ts` (`{ title, href }`) as one.

## The four it does not read yet

`init` on sveltekit, movies (Nuxt), vue-realworld and angular-realworld stops before writing
anything, naming the framework and what the kit can read:

> This looks like a SvelteKit application (@sveltejs/kit in package.json). The kit reads React
> Router, Next.js and Remix today, so it cannot build a registry for this app yet. Nothing was written.

Before this item it said "No route table found". Readiness items 3b (SvelteKit, Nuxt) and 3c
(Vue Router, Angular) are measured against the same ground truth.

## What this does not show

- **Role extraction on a file-system router.** None of the six gates by role, so these runs
  cannot show a leak or its absence. A folder layout declares no roles at all: `init` warns
  when an app mentions roles, and `routeRoles` (by path prefix) is how an adopter declares them.
  Fixture-tested, not field-tested.
- **Custom `pageExtensions`** in `next.config`, and a React Router 7 `app/routes.ts` that lists
  routes explicitly instead of calling `flatRoutes()`, are not read.
- **Routing quality.** This measures discovery and titles, not whether a question reaches the
  right screen. That needs questions written for each app, which is the owner's field test.
