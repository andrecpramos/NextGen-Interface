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

## Readiness item 3c — Vue Router and Angular

| App | Destinations declared | Wrong destinations | Reported | Audiences | App's files changed | `doctor` |
|---|---|---|---|---|---|---|
| vue-realworld (Vue 3, vue-router 5) | **10 of 10** | **0** | — | 1 | **0** | exit 0 |
| angular-realworld (Angular 21) | **10 of 10** | **0** | 1 duplicate (below) | 1 | **0** | exit 0 |

**All six apps: 55 of 55 destinations across six frameworks, 0 declared that are not one, 0 app files
changed.**

vue-realworld imports every page as `() => import("@/views/Home")` — no extension, through a Vite alias
with no tsconfig to declare it. angular-realworld loads its profile routes from a second file with
`loadChildren`, and keeps every page's text in a `templateUrl` HTML file or an inline `template`.

**The one thing reported:** angular-realworld's `/profile/:username` is both a route with a component
and that route's own empty-path child, so the second was reported as a duplicate of the first rather
than declared twice. It is one destination, correctly counted once.

### The titles it wrote

| vue-realworld | | angular-realworld | |
|---|---|---|---|
| `/` | Home | `/` | Home |
| `/login` | Login | `/login` | Login auth |
| `/settings` | Settings | `/settings` | Settings |
| `/tag/:tag` | Tag home | `/tag/:tag` | Article home |
| `/editor` | Editor article Edit | `/editor` | Article editor |
| `/profile/:username/favorites` | Profile | `/profile/:username/favorites` | Profile Favorites |

**Found by this run and the first build, fixed before they were recorded:**
- **A role written on a route never joined the application's audience.** On the Angular fixture,
  `data: { roles: ['ADMIN'] }` narrowed `/admin` correctly, but with no permissions module the audience
  was the single `PUBLIC` one, so no ADMIN registry was ever built: the admin screen did not leak, it
  reached nobody. The same was true of readiness 3a's `routeRoles`, whose test checked discovery and not
  what was built. A role named on a route now joins the audience, and a screen open to everyone reaches
  it too; a narrowed screen keeps exactly its own roles. Asserted on the built registries (Rule 17).
- **Both home pages were renamed by the duplicate-title rule.** Two routes sharing one component look
  like two screens with one title, and the section prefix used for that made `/` "App home". The
  placeholder section `app` no longer prefixes anything, and the root page keeps its title.

**Still weak:** a page shared by two routes shares a title, prefixed by section ("Tag home",
"Article home"); vue-realworld's editor is "Editor article Edit", from a component called `ArticleEdit`;
angular-realworld's sign-in pages are "Login auth" and "Register auth", from one `AuthComponent`. All of
them are the names the apps gave their code, which is all there is to read when a page declares no title.

## What is left unread

`init` still names TanStack Router and Solid Router and writes nothing. Neither is in the ground truth.

## What this does not show

- **Role extraction, in the field.** None of the six gates by role, so these runs cannot show a leak
  or its absence. Roles written on routes are fixture-tested, down to the built registries. A folder layout declares no roles at all: `init` warns
  when an app mentions roles, and `routeRoles` (by path prefix) is how an adopter declares them.
  Fixture-tested, not field-tested.
- **Custom `pageExtensions`** in `next.config`, and a React Router 7 `app/routes.ts` that lists
  routes explicitly instead of calling `flatRoutes()`, are not read.
- **Routing quality.** This measures discovery and titles, not whether a question reaches the
  right screen. That needs questions written for each app, which is the owner's field test.
