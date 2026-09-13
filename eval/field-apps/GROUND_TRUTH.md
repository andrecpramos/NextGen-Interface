# Field apps — ground truth, written before any adapter existed

Six public applications, one per routing style the kit did not read on 2026-09-13. Each
is listed here **by reading its source tree by hand, before a single line of adapter code
was written**, so the adapters are scored against what the application is and not against
what they happen to find. This is WP-31's method, applied to frameworks rather than to
one app ([PLAN.md §8](../../PLAN.md): ground truth independent of the generator, or the
score is meaningless).

None of these is tuned for. The owner's own field test is on a project nobody here has
seen; these six exist so that "adapts to unknown projects" is a measurement before that
test, not a hope.

**Cloned shallow into a scratch folder, never into this repository.** Only this file and
the results are committed. Re-clone at the commits below to reproduce.

| App | Framework | Repository | Commit |
|---|---|---|---|
| taxonomy | Next.js 13.3 (app router + a `pages/api`) | github.com/shadcn-ui/taxonomy | `298a885` |
| realworld | SvelteKit 2 / Svelte 5 | github.com/sveltejs/realworld | `df79670` |
| movies | Nuxt 4 (`app/pages`) | github.com/nuxt/movies | `ce256d6` |
| vue-realworld | Vue 3 + vue-router 5 | github.com/gothinkster/vue-realworld-example-app | `f7e48c8` |
| angular-realworld | Angular 21 standalone | github.com/gothinkster/angular-realworld-example-app | `dd99ed2` |
| indie-stack | Remix v2 flat routes | github.com/remix-run/indie-stack | `56abb93` |

## What "correct" means

- **A destination** is a URL a person could ask to be taken to, which renders a page.
- **Not a destination:** API/route handlers, resource routes (a loader or action with no
  page), layouts, error and not-found pages, and components that merely live beside a page.
- **A content catch-all** (`[...slug]`) matches pages that come from content, not code. It
  cannot be declared as one screen, and it must be **reported** as left out, never dropped
  silently (lessons.md L12). An *optional* catch-all (`[[...slug]]`) also matches its own
  base URL, which is a destination.
- **Roles.** None of the six gates a route by role. Every gate is authentication only
  (next-auth middleware, a SvelteKit `redirect` in `load`, `meta.requiresAuth`, an Angular
  `canActivate`, a Remix `requireUserId`). A login wall does not change which role sees a
  screen, so the correct output for each is **one audience**, and **0 Rule 17 leaks** is
  the only acceptable count.

## taxonomy — Next.js app router

**11 destinations**

| Path | Source | Notes |
|---|---|---|
| `/` | `app/(marketing)/page.tsx` | route group `(marketing)` is not a URL segment |
| `/pricing` | `app/(marketing)/pricing/page.tsx` | `metadata.title = "Pricing"` |
| `/blog` | `app/(marketing)/blog/page.tsx` | |
| `/guides` | `app/(docs)/guides/page.tsx` | `metadata` |
| `/docs` | `app/(docs)/docs/[[...slug]]/page.tsx` | optional catch-all: its base URL is a destination |
| `/login` | `app/(auth)/login/page.tsx` | `metadata` |
| `/register` | `app/(auth)/register/page.tsx` | `metadata` |
| `/dashboard` | `app/(dashboard)/dashboard/page.tsx` | login required (middleware); `metadata` |
| `/dashboard/billing` | `app/(dashboard)/dashboard/billing/page.tsx` | login required; `metadata` |
| `/dashboard/settings` | `app/(dashboard)/dashboard/settings/page.tsx` | login required; `metadata` |
| `/editor/:postId` | `app/(editor)/editor/[postId]/page.tsx` | login required |

**Reported, not declared:** `/[...slug]`, `/blog/[...slug]`, `/guides/[...slug]` (content
catch-alls). **Not pages:** `app/api/**/route.ts` (5), `pages/api/auth/[...nextauth].ts`,
every `layout.tsx`, `app/(editor)/editor/[postId]/not-found.tsx`.

A navigation config exists, `config/dashboard.ts`, as `{ title, href }` arrays.

## realworld — SvelteKit

**10 destinations**

| Path | Source |
|---|---|
| `/` | `src/routes/+page.svelte` |
| `/article/:slug` | `src/routes/article/[slug]/+page.svelte` |
| `/editor` | `src/routes/editor/+page.svelte` |
| `/editor/:slug` | `src/routes/editor/[slug]/+page.svelte` |
| `/login` | `src/routes/login/+page.svelte` |
| `/register` | `src/routes/register/+page.svelte` |
| `/profile` | `src/routes/profile/+page.svelte` (has a `+page.js` load; may redirect) |
| `/profile/@:user` | `src/routes/profile/@[user]/+page.svelte` — a literal `@` before the parameter |
| `/profile/@:user/favorites` | `src/routes/profile/@[user]/favorites/+page.svelte` |
| `/settings` | `src/routes/settings/+page.svelte` — login required (`load` redirects) |

**Not pages:** `+error.svelte`, `+layout.*`, and the components beside the pages
(`Nav.svelte`, `Pagination.svelte`, `PreloadingIndicator.svelte`, `ArticleMeta.svelte`,
`Comment*.svelte`, `Editor.svelte`), and `get_articles.js`. Titles are in
`<svelte:head><title>Settings • Conduit</title>`, with a site suffix.

## movies — Nuxt 4

**8 destinations**

| Path | Source |
|---|---|
| `/` | `app/pages/index.vue` |
| `/search` | `app/pages/search.vue` |
| `/:type` | `app/pages/[type]/index.vue` |
| `/:type/:id` | `app/pages/[type]/[id].vue` |
| `/:type/category/:query` | `app/pages/[type]/category/[query].vue` |
| `/genre/:no/movie` | `app/pages/genre/[no]/movie.vue` |
| `/genre/:no/tv` | `app/pages/genre/[no]/tv.vue` |
| `/person/:id` | `app/pages/person/[id].vue` |

`@nuxtjs/i18n` with `langDir: 'internationalization'`, `defaultLocale: 'en'`, `strategy: 'no_prefix'`.

## vue-realworld — Vue Router

**10 destinations**, all in `src/router/index.js` as `{ path, component: () => import("@/views/X") }`
— extensionless, through a Vite alias `@`, resolving to `src/views/X.vue`.

`/`, `/tag/:tag`, `/login`, `/register`, `/settings` (requiresAuth), `/profile/:username`,
`/profile/:username/favorites`, `/article/:slug`, `/editor` (requiresAuth), `/editor/:slug`
(requiresAuth).

## angular-realworld — Angular

**10 destinations** — the same ten URLs as vue-realworld.

- In `src/app/app.routes.ts`, as `loadComponent: () => import('./…component')`.
- `profile` arrives through `loadChildren: () => import('./features/profile/profile.routes')` — a
  second file whose **default export** is the routes. It gives `/profile/:username` (whose own
  `''` child is its content) and `/profile/:username/favorites`.
- `editor` is a path with `children` `''` and `:slug`.
- Guards are `canActivate: [requireAuth]` (settings, editor) and an inline "not signed in" guard
  on login/register — authentication, not roles.
- Page text is in `templateUrl` HTML files. `<html>` has no `lang`.

## indie-stack — Remix flat routes

**6 destinations**

| Path | Source |
|---|---|
| `/` | `app/routes/_index.tsx` |
| `/join` | `app/routes/join.tsx` — `meta` title "Sign Up" |
| `/login` | `app/routes/login.tsx` |
| `/notes` | `app/routes/notes.tsx` (layout with a page) + `app/routes/notes._index.tsx` (its index) — one destination |
| `/notes/new` | `app/routes/notes.new.tsx` — login required |
| `/notes/:noteId` | `app/routes/notes.$noteId.tsx` — login required |

**Not pages:** `healthcheck.tsx` (a loader, no default export), `logout.tsx` (an action and a
loader, no default export).
