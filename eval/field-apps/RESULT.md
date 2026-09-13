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

## Readiness item 3b — SvelteKit and Nuxt

| App | Destinations declared | Wrong destinations | Catch-alls reported | Audiences | App's files changed | `doctor` |
|---|---|---|---|---|---|---|
| realworld (SvelteKit 2.52, Svelte 5) | **10 of 10** | **0** | — (none exist) | 1 | **0** | exit 0 |
| movies (Nuxt 4 nightly, `app/pages`) | **8 of 8** | **0** | — (none exist) | 1 | **0** | exit 0 |

With 3a, **35 of 35** destinations across four frameworks, and nothing declared that is not one.

movies was read with its 14 flat locale files (`internationalization/pt-PT.json`, keyed by the English
text itself), and English first, from `defaultLocale` in `nuxt.config.ts` — Nuxt sets `<html lang>` at
run time, so there is no static attribute to read.

### The titles it wrote

| realworld | | movies | |
|---|---|---|---|
| `/` | Home | `/` | Home |
| `/login` | Sign in | `/search` | Search |
| `/register` | Sign up | `/person/:id` | Person |
| `/settings` | Settings | `/genre/:no/movie` | Genre Movie |
| `/article/:slug` | Article | `/genre/:no/tv` | Genre Tv |
| `/profile/@:user/favorites` | Profile Favorites | `/:type/:id` | Type Id |

realworld's titles come from `<svelte:head><title>Sign in • Conduit</title>`: the part every title
shares after its separator is recognised as the site's name and removed, and the home page, whose
title is only "Conduit", becomes "Home".

**Found by this run and fixed before it was recorded — and what fixing it exposed:**
- movies' home page came out as **"App home"**. `qualifyTitles` prefixes a title that several screens
  share, and it counted a title once *per language*, so in an app with more than one language and an
  untranslated title, a screen looked like its own duplicate. It now counts once per screen.
- That fix removed a prefix three movies screens had only had **by accident**: "Genre movie" became
  "Movie", and "Genre tv" became "Tv" — for the pages of one genre, "Movie" is worse, not better. The
  cure is in the name of last resort: a page with no title of its own and no named component is now
  named from the last **two** named segments of its path, so it keeps its section ("Genre Movie",
  "Profile Favorites"). A declared title or a component name still wins.
- The counting bug predates this item. The committed `fut-app` registries were generated with it and
  are **not** regenerated here, because that would move artefacts calibrated against them (Rule 14). A
  rebuild will un-prefix titles that were identical in both of fut-app's languages.

**Still weak:**
- movies' `/:type` pages are "Type" and "Type Id". Their real titles are a conditional
  (`type === 'movie' ? 'Movies' : 'TV Shows'`) and data, which are code and not evaluated.
- realworld has two screens called "Editor" (`/editor`, `/editor/:slug`) and two called "Profile"
  (`/profile`, `/profile/@:user`). They compete with each other in stage 2. Telling them apart would
  mean appending a word to a title, and the kit has no way to write that word in the app's language.
- realworld's `/profile` is a `load` that always redirects. A redirect in a load function is not
  read from markup, so it is declared, which the ground truth also counts as a destination.

## The two it does not read yet

`init` on vue-realworld and angular-realworld stops before writing anything, naming the framework
and what the kit can read:

> This looks like an Angular application (@angular/router in package.json). The kit reads React
> Router, Next.js, Remix, SvelteKit and Nuxt today, so it cannot build a registry for this app yet.
> Nothing was written.

Readiness item 3c (Vue Router, Angular) is measured against the same ground truth.

## What this does not show

- **Role extraction on a file-system router.** None of the six gates by role, so these runs
  cannot show a leak or its absence. A folder layout declares no roles at all: `init` warns
  when an app mentions roles, and `routeRoles` (by path prefix) is how an adopter declares them.
  Fixture-tested, not field-tested.
- **Custom `pageExtensions`** in `next.config`, and a React Router 7 `app/routes.ts` that lists
  routes explicitly instead of calling `flatRoutes()`, are not read.
- **Routing quality.** This measures discovery and titles, not whether a question reaches the
  right screen. That needs questions written for each app, which is the owner's field test.
