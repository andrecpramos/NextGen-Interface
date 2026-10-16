# What real applications taught this tool

You are installing a navigation assistant into an application you did not write. This file
is the accumulated record of **what goes wrong when this tool is pointed at a real app** —
distilled from runs against eight applications across six routing frameworks, six of them
public repositories the tool had never seen.

Read it before you accept any generated output as correct. Every heading below is a failure
that actually happened, and most of them **failed silently**: the tool reported success, the
output looked plausible, and something was wrong anyway.

The single most useful habit: **when the tool says it guessed, it means it.** A line marked
`GUESSED` is not a well-informed default. It is the tool telling you it had nothing to read.

---

## 1 · Roles and who can see what

This is the only category where a mistake is a **security** defect rather than a quality one.
Treat everything here as blocking.

### An app in a monorepo: roles and pages live in sibling packages

One real app's source came out as **0 screens, 65 left out** — every route "role guard could
not be evaluated" — because its route table reads `ROUTE_ROLES` from `@acme/core/permissions` and its
pages from `@acme/engine/…`, workspace packages beside the app, and the scan resolved only relative
imports and path aliases. The kit now walks up from the app to the workspace root (`pnpm-workspace.yaml`,
or `workspaces` in `package.json`, npm and yarn), and follows a bare import into **a package the
workspace declares** through its `exports` (explicit subpaths and `*` wildcards) — and into nothing else:
not `node_modules`, not a package the repository does not list. `init` finds the role module by
resolving what the route table imports, so it reads one file per import, not the whole monorepo. Rerun
on the full app: **56 screens across 10 roles**, roles found automatically, the most restricted role
reaching only its own `/my/*` screens.

Things to check on a monorepo: `explanationSource` paths now begin `../../packages/…`; and translations
that live in a package rather than the app are read only if `localesDir` lists their folder (it takes a list, one
folder per package, merged key by key with the first listed winning). A route table
that ends `...adminRoutes` is followed into the module that declares the array (with that module's own
imports). So is a *computed* spread built from arrays the source writes out — such as
`...workspaces.flatMap((w) => w.routes).filter(…).map(…)`, which assembles routes from installed
workspaces: each workspace's routes are read in their own module, a page given by a helper spread
(`...page(() => import('./X'))`) is that import, a role set from a pack's own table (`PACK_ROLES.x`) is
read through its import, and an entry marked `redirect: true` is skipped as no screen. A spread that
calls code to make its routes, a `.map` that changes a route's path or guard, or a `.filter` over routes
that are also spread under a guarded parent (the filter may be all that keeps a guarded screen out of
the open table) still cannot be read statically and is **listed in `SKIPPED.md` with the expression quoted** — before, it vanished without a
word — and `doctor` should not be read as covering those screens. **Always copy the whole
repository when rehearsing** — copying only the app folder makes every sibling package vanish and
reproduces the 0-screen failure for a reason that is your setup, not the scanner.

### A role guard the parser cannot read must drop the route, never widen it

The worst failure recorded happened on an app that gates routes on a parent element:

```tsx
<Route element={<ProtectedRoute user={user} allowedRoles={['ADMIN']} />}>
  <Route path='/admin/users' element={<UserManagement />} />
```

The parser could not read that shape, and the fallback at the time was "no permissions module
found, so everything is public". Result: **four admin screens and seven member-only screens
were shipped to every user** — 15 role leaks out of 48 assignments. The reports all said fine:
`0 route(s) deliberately skipped`, and *"Built, and nothing needs fixing."* The only signal
anywhere was one line saying the role table was guessed as `(none)`.

That shape is read now. The rule it established is the one to hold onto: **an unreadable guard
drops its route and reports it**, because a guard nobody can parse is not an absent guard.

### There are at least three places an app keeps its roles, and one is still unreadable

| Where the roles live | Read? |
|---|---|
| A permissions module the route table resolves against | yes |
| On a parent route's element, inherited by children (`allowedRoles`, `roles`, `requiredRoles`, `anyOfRoles`) | yes |
| On a parent route's own `roles`, which its children never exceed | yes |
| On a JSX route's spread props — `<Route {...guard}>` | **no** (known limitation) |
| **Inside the page component** — `<Authorization allowedRoles={[ROLES.ADMIN]}>` wrapping the body | **no** |

The third shape is invisible to route discovery. The route table is not lying; it simply says
nothing. An app built this way generates **one audience**, and every screen goes to everyone.

**What to do:** ask the developer whether authorization lives inside their page components. If
it does, the generated role split is meaningless and must be declared by hand.

### A folder layout declares no roles at all

Next.js, Remix, SvelteKit and Nuxt express routes as directories. There is nowhere in that
structure to say who may open one. If the app has role-gated screens, they must be declared
by path prefix in the config:

```json
"routeRoles": { "/admin": ["ADMIN"], "/staff": ["ADMIN", "STAFF"] }
```

Then build again. Without this the app has one audience, whatever its real access control does.

### The inverse failure: a role that reaches nobody

A route carrying `data: { roles: ['ADMIN'] }` once narrowed correctly **and no ADMIN registry
was ever built**, because the app had no permissions module and the only audience was an
invented `PUBLIC`. The admin screen did not leak — it reached no one at all, which is just as
wrong and much quieter.

A role named anywhere on a route now joins the application's audience. When you review the
output, check both directions: no screen reaching a role that should not see it, **and** every
role having a registry with screens in it.

### Controls only some roles may use

What a screen lets a visitor do — "Cancelar aula", "Publicar", "Aprovar inscrição" — is read from its
controls, in the page and the app's own components it renders (ADR-042). On a real app almost every
control that changes data is behind a condition: `{canWrite && <Button>…}`, with `canWrite =
hasCapability(roles, ...CAPABILITY_ROLES.communicationManage)`. Those conditions are read against the
permissions module (and a pack's own), and a control goes only into the registries of the roles they let
through — a parent is never told to press "Aprovar".

A condition about who that the scan **cannot** read drops the control: a flag from a hook (`const {
canDelete } = usePermissions()`), a `<Can>` whose rule is not a role list. **Read `review/CONTROLS.md`**:
every screen's controls with the roles in brackets, and at the end every control left out. Check both
directions, as for screens — a control listed for a role that does not have it, and one missing that the
role uses every day. The first is a Rule 17 defect; the second is a request the assistant will not place.

Two things the list will show, both deliberate. A control only the item's author may use ("Delete
Article" under `article.author.username === user.username`) is left out: a registry has no way to say
"its author only". And in Vue, Svelte and Angular no role is evaluated at all — the templates are read as
text — so there every control under a condition about who is left out. Rehearsed on three implementations
of the same app (Svelte, Vue, Angular), all three came out the same.

A word that merely starts like a permission flag is not one. Until 2026-10-16 the scan read `can…`
case-insensitively, so `status === 'CANCELLED'` looked like `canX` and dropped every control behind it — on
one real app, attendance and "Reopen" for every role. If `CONTROLS.md` leaves out controls whose
condition is about an item's state, that is a defect to report, not a setting.

### Never serve the review output

The build writes two things. One is a bundle you serve. The other is a review folder
containing **every screen in the app, annotated with every role that can open it**. It is
marked never-serve for a reason.

If the tool's folder sits anywhere a dev server publishes as static files — a typical Vite or
CRA project root, anything under `public/` — that file becomes fetchable by URL the moment the
server starts. This is not hypothetical; it is what happened the first time the tool was
pointed at a real app. Put the folder outside the served root.

Serve each signed-in user **only their own role's registry**. The registry a session receives
*is* its entitlement; there is no second filtering step for a bug to live in.

---

## 2 · Screen names

Names matter more than they look like they should: the title is generated first and is then
fed into the screen's description, so **a bad title produces a bad description**, and the two
compound.

### Where a name comes from, in order

1. A title the page declares as a literal — `metadata.title`, a Remix `meta`, a
   `<svelte:head><title>`, a translation key.
2. The page component's name.
3. The last two named segments of the path.

Anything computed is invisible. A title from `generateMetadata`, a conditional
(`type === 'movie' ? 'Movies' : 'TV Shows'`), or a title assembled from fetched data is **code**,
and code is not evaluated. Those screens fall through to their component name.

### Failures worth checking for in the output

- **The root page named after its file.** Both React and Remix conventions call it `Index`, so
  `/` came out titled *"Index"*. At the root, that becomes "Home".
- **The site name repeated on every screen.** `"Sign in • Conduit"` — the part every title shares
  after its separator is the site's name and is removed. The home page, titled only `"Conduit"`,
  becomes "Home".
- **A screen that looks like its own duplicate.** Duplicate titles must be counted once per
  *screen*, not once per *language*: in a multilingual app an untranslated title otherwise
  collides with itself and gets prefixed with its section.
- **Over-eager de-duplication.** Fixing the above removed a prefix three screens had only had by
  accident, and *"Genre movie"* became *"Movie"* — worse, for the pages of one genre. Hence
  rule 3 above naming from the last **two** segments, so a screen keeps its section.
- **Two routes sharing one component share a title.** `/editor` and `/editor/:slug`; `/profile`
  and `/profile/@:user`; `/classes/new` and `/classes/:id/edit`. They compete with each other during
  retrieval. Where the two addresses end in different words, the title is now told apart with
  that word ("Class Form · new" / "· edit") — the developer's own word, in their own
  language, never a translation. Two addresses that end alike are still left as they are, and
  those are worth a look.
- **A locale in front of every route is not a section.** On a next-intl app every route began
  `/:locale/…`; every screen was "in the locale area" (`locale.auth_login`), and the locale was
  declared as a parameter the visitor must supply, so even "sign in", matched at 1.00, ended as a
  question. A leading parameter is now never an area, and a locale prefix (`:locale`, `:lang`) is
  not a slot — the widget fills it from the page the visitor is on: from the URL, and when the URL
  carries none (`localePrefix: 'as-needed'`, the default language) from `<html lang>`. That fallback
  assumes `<html lang>` is exactly the locale code the routes use — next-intl sets it so — and it
  applies only to a parameter *named* like a locale, so an item parameter is never filled by it.
  Untested against a running `as-needed` app; check which the app uses and try one link.
- **A component name filling every language.** English identifiers must not end up in a
  non-English registry.
- **A header from an early return.** A loading or not-found branch's heading is not the
  screen's name.
- **Only reading `t(...)`.** An app calling `tp('announcements.title')` or any other wrapper
  loses its title keys and falls back to component names.
- **The route's component is the guard, not the page.** `<Route element={<ProtectedRoute>
  <FeedbackFormPage /></ProtectedRoute>} />` named the screen "Protected Route" and described it
  with the login wall's own words. A guard-shaped wrapper (`Protected…`, `Require…`, `…Guard`,
  `…Route`) with exactly one child is now read as that child; who may reach it is still read from
  the guard's props. A wrapper that is not named like a guard (a layout shell) is read through as
  before, and two children are never guessed between.
- **next-intl.** `const t = await getTranslations('portal.member')` and `useTranslations('ns')`
  bind a namespace exactly as `useTranslation('ns')` does; before this, every page of a next-intl
  app was described from nothing. Its messages are one nested file per language.
- **HTML entities.** `Terms &amp; conditions` is now `Terms & conditions`.
- **What the page "shows" came from wherever `t()` was called first.** On one real app that meant toasts
  ("Registo guardado com sucesso!"), delete confirmations ("Eliminar item?"), the shared
  namespace's buttons ("Eliminar, Cancelar") — and, in 9 of 56 screens, a sentence with its placeholder
  still in it ("Progresso de {{name}}"). A sentence with `{{x}}`, `{x}` or `%s` in it is now dropped,
  and strings whose *key* says toast, error, success, confirm, delete, dialog, validation, or that live in
  `common`/`shared`/`actions`, come after what the page renders, and only when it renders nothing else.
  The rule reads the developer's key names, so an app whose keys say nothing (`t('a1')`) gets none of it.
- **A route that only `<Navigate>`s** was titled "Navigate · schedule". It is now named for its address.

### One page with two addresses ties every question between them

A route that picks an item and redirects, plus the item's own page, are one destination
declared twice. Every question splits evenly between them and neither wins. Redirect aliases
and resolver-reached routes should be **skipped with their evidence recorded**, not declared.

One caveat that is deliberately left alone: a redirect performed in an effect
(`navigate(...)`) rather than as a `<Navigate>` element is not detected, because reading
effects as redirects would also merge every list page that opens a detail on click.

---

## 3 · Descriptions

A description is the largest part of what retrieval matches against. A wrong one misroutes
**silently** — route, role and id all correct, user still lands somewhere else. It is the one
output with no mechanical check on it.

Measured rate on 20 descriptions across readable apps: **15 right, 4 vague, 1 wrong.**

### Description quality tracks how much real copy a page exposes

This is the finding that explains almost all the others. A page carrying a doc comment gets an
accurate description. A page that says nothing in its own file — a layout shell, a redirect, a
wrapper whose words live in the sections it renders — gets a generic sentence. In one app, 19
of 141 screens were in that position.

If the descriptions come back vague, the fix is usually in the app (give the page a doc
comment) or in the title, not in the prompt.

**A Next.js app's components were never read** until 2026-10-16. Its routes are `src/app`, its
components `src/components`, imported as `@/components/…`, and the scan accepted only files inside the
routes folder — so a page that delegates to a component (most of them: a login page is a shell around
`<LoginForm />`) was described from its own few words, and none of its buttons were read. Rehearsed on
a real next-intl app, screens with something to do went from 0 to 4 of 12. The scan now reads the
whole project the routes folder sits in (up to its `package.json`), and still nothing outside it. If an
app's descriptions look thin and its pages import from a sibling folder, this is the first thing to check.

**What the visitor is shown under a screen's name** is the first sentence of its explanation, and
with no model that sentence used to be a template in English with a route in it ("Entrar is a
screen in the auth area of this application, at /:locale/auth/login."). It is now what the screen
shows ("This screen shows: Sign in, Access the members' portal…"), in the app's own language when that
is Portuguese or English, each item clipped at a word. The area and the route stay in
`description`, which retrieval matches on and no one reads. A screen the scanner can say nothing
about is still "X is a screen in this application" — read `review/KNOWLEDGE-GAPS.md` for those.

**The app's language.** A Next.js app that routes by locale sets `<html lang={locale}>` per request, so
the kit fell back to the first language *alphabetically* — English, for a Portuguese organisation whose
routing file says `defaultLocale: 'pt'`. It now reads `defaultLocale` from `i18n/routing.ts`,
`next.config` or the middleware, and only accepts one the app has messages for.

A page whose component is declared **in the route table's own file** (`function MainPage() {
return <><Hero /><Pricing /></> }` two lines above `<Route element={<MainPage />}>`) used to
have no file to read, and the one screen a one-page site is made of was described as "a screen
in this application, at /". It is now read through the sections it composes, and only those —
the header and footer the app renders around its routes are chrome. If a one-page site's home
still reads thin, that is the next place to look, and it is `knowledge.json`'s to fix (ASK 9).

### A failure state is not the screen — but an authorization fallback is

One screen was described as *"A user tries to view comments but sees an error message and
attempts to refresh the screen."* The page shows a discussion. The only literal text under it
was an error boundary's fallback, so that was handed over as the screen's content, and it was
described faithfully.

`fallback`, `errorFallback`, `loadingFallback` and `errorElement` subtrees are ignored now.
**But not `forbiddenFallback`** — the first version of the fix skipped that too, and a screen
whose only clue about its audience was *"Only admin can view this."* fell from *"An admin views
a list of registered users"* to *"A person views…"*.

The distinction worth keeping: an authorization fallback describes **who the screen is for**,
which is true of the screen. An error fallback describes **a moment**, which is not.

### Two screens with the same description are one screen

Nine screens in one app shared a description with another. Every duplicate sat under a
placeholder title. Check the output for repeated sentences before anything else — it is a
retrieval defect that needs no judgement to spot, and it is invisible in normal use.

### What no check will catch

One description read, translated, *"The member can manage their navigation group."* Fluent,
grammatical, in the right language, the right length, and meaningless. No mechanical rule
catches that. Only someone reading it does.

Similarly: when a description names a role, only the role the sentence **opens as** is a claim
about audience. *"A teacher or counsellor can check a student's attendance"* names a student
because the screen is about students, not because students can open it.

---

## 4 · Example phrasings

Each screen ships with example phrasings; they are a large part of what the deterministic
stages match. Two findings, both counter-intuitive:

- **Eight examples per screen beat four**, with most of them in the application's first
  language.
- **Model-written examples routed *worse* than mechanically derived ones.** The model split
  them evenly across the app's two languages and wrote elegant variety; the derived examples
  repeat the title's own words in each language, which is exactly what the default encoder
  rewards. The gap closed only when the count went up and the language mix was corrected.

The model also writes examples its instructions forbid — statements rather than requests, and
tasks the screen does not perform. If you review generated examples, those are what to look
for.

---

## 5 · Calibration

**Never hand-tune a threshold.** A hand-tuned threshold encodes the last question someone
happened to try. Thresholds are an artefact of the encoder and come from the calibration sweep.

### The calibration number is not the real number

A sweep guarantees 100% precision on the turns it calibrated against. On held-out turns from
the same app it was **83.3%** — it sends some users to the wrong screen, confidently. That gap
is the entire reason the split exists. If you report a calibration figure without a held-out
figure beside it, you are reporting nothing.

### "Refuses nothing" is a result, not a blank

On one app the sweep found no margin that refuses anything without also refusing real requests.
The thresholds it produced therefore **never refuse**: an out-of-scope question becomes a
clarifying question instead of a stated limit. The first version of the command reported that
as ordinary numbers in a table, which is exactly how a bad calibration gets accepted.

If you see `out-of-scope refused: 0.0%`, the refusal half did not fail to perform — it failed
to find any setting at all.

### Declared limits have to be concrete

The same run's boundaries were *"Acting outside this application"*, *"Changing records for
you"*, *"Questions about anything else"*. Real out-of-scope questions do not resemble those
closely enough for similarity to connect them. Boundaries written in the app's own vocabulary
work; generic ones are decoration.

### Uncalibrated, on a thin app, the limits win over screens that score nothing

The opposite failure to "decoration", found by running this kit on a small real app it had not
seen (a 2-route landing page, no `knowledge.json`, uncalibrated). Descriptions came from the
page's own labels alone, so a visitor's everyday words matched no screen at all: every real
screen scored ~0.00, and a declared limit with the slightest word in common (0.07–0.16) cleared
the default margin and **won**. Of 12 everyday questions ("how do I sign up", "who is on the
team", "what is the price", "how does it work"), **7 were refused** — as "changing records",
"acting outside this application" and "anything else". Four unrelated controls ("what is the
weather tomorrow", "write me a poem") scored 0.19–0.32 and were refused too, so a limit's
*absolute* score did separate them here; it did not on the reference fixture, where in-scope
turns reach 0.15 and true refusals start at 0.14. Twelve questions written by the tool's author
are an anecdote, not a calibration.

**What the kit now does about it.** A bundle built with *no calibration* carries `boundaryFloor:
0.15` in its `thresholds.hashing.json`: a declared limit must score at least that in its own right,
not just lead a near-zero screen, before it may refuse. On the same 12 questions, refusals fell from
7 to 1 (the one left, "what are your opening hours", scored 0.16), and all seven out-of-scope controls
were still refused — "delete my account" and "send an email to the office" through the action-verb path,
which is independent evidence and is not held to the floor (ADR-015). The 0.15 is not fitted: it is the
"barely a match" bar the likely-one tier already uses for a screen, applied to a limit too — but it
*was* chosen after this data was seen, so treat it as a stand-in. **A calibration replaces the whole
set and the floor goes with it**; calibrated profiles never carry one, and the sweep does not decide it
(Rule 14). The price: an uncalibrated app refuses fewer out-of-scope requests and asks instead.

Still, in this order: **write `knowledge.json`** (ASK 9 — what each screen is for, the words users say),
which is what makes a screen score at all; then **calibrate on questions the developer wrote** (this
section, below), which is the only thing that sets the margin for this app; and say plainly to the
developer that until then the assistant is more cautious about refusing and less able to tell screens
apart. The assistant also no longer offers two arbitrary screens when nothing matched — it says so and
offers the app's own navigation.

### You need real questions, and enough of them

32 questions over 8 screens is close to the floor — with only part of that on the calibration
side, the sweep chooses from very little. Questions written by an agent from the app's routes
are a weaker instrument than questions from someone who knows how the app's users speak. Twenty
real ones beat two hundred invented ones.

---

## 5b · An app that moves on, and a model that reads half the question

Two failures found when the tool had lived in a real app for a few weeks. Both were silent.

### The config the app has outgrown

One real app moved its pages into new packages. `nextgen.config.json` still listed the old locale
folders — which still existed, emptied of everything the pages used — so the build said *"6 locale folders
merged"* and every title, heading and control of the moved pages resolved to nothing: screens named after
their components, controls not read, 53% of the keys the pages use (1,264 of 2,387) found nowhere.

The build now warns when a fifth or more of the keys the pages use resolve in no folder listed, and names
their namespaces. **After the app is restructured, rebuild and read the warnings** — and if one names a
namespace, find the folder that holds it and put it in `localesDir`.

### The model must be given room for the whole question

Stage 3 shows the model every screen of the visitor's role (ADR-043): several thousand tokens on a real app.
**Ollama's default context is 2,048 tokens, and past it Ollama cuts the front of the prompt without a
word** — the instructions and half the screens go, and the model still answers, from what is left.
Measured on a real app: right screens fell from 88% to 37%, and "what's the weather on Saturday" was sent to
an unrelated screen. The request carries `contextTokens`; the proxy must give the model at least that
(Ollama `options.num_ctx`) and accept a body of at least 128 KB. If answers look random after turning
stage 3 on, check this first: Ollama's response reports `prompt_eval_count`, and a value stuck at 2,048 or
4,096 is a cut prompt.

---

## 6 · What to tell the developer to expect

Set this expectation before they see it, not after.

- **It offers; it rarely decides.** On the measured configuration it navigates on its own for
  under 2% of questions. For nearly everything else it shows up to three screens and the person
  picks. That is a click more than a perfect guess — and it has sent nobody to a wrong place.
- **It does not decline everything it should.** Out-of-scope refusal measured **41–47%** against
  a 70% target. The rest become clarifying questions rather than wrong moves. This ceiling is
  disclosed, not hidden: every mechanism tried against it was measured and none moved it.
- **The cheap path is smaller than hoped.** The share of turns settled with no model call
  measured **11–17%** against a 60% target that was a pre-committed kill criterion, and it
  triggered. The claim was withdrawn rather than restated. **The product is a better way to
  navigate; a cheaper one is not claimed.**
- **It performs no actions.** It moves between screens and shows links. It does not save, send
  or delete anything. Asked to, it says where that is done and with which control — "That's done in
  Lessons. Use “Cancel lesson” there." — never that the app cannot (ADR-042).
- **With a model, it understands requests that name no screen** ("o Tiago vai faltar amanhã"), because
  the model sees the whole role's app (ADR-043). On a real app that took right screens from 67% to 87% of
  indirect questions and wrong moves from 16 to 3 of 67, at about two seconds more per question that
  reaches the model.
- **Every screen it can reach stays reachable without it.** That one is not negotiable.

---

## 7 · Accessibility

The widget is the product's only user interface, so its worst state is its accessibility.

The real defect found by automated auditing, worth knowing because it recurs in any
replace-the-answer UI: **focus fell to nowhere when an answer was replaced.** Someone tabs into
the previous answer's links while a new question is in flight; the new answer lands, the
element they are standing on is removed, and focus drops to the document body — silently
returning them to the top of the host page, mid-sentence. The slower the device, the wider the
window.

The fix has two halves and both are load-bearing: focus returns to the question field **if the
person was inside the answer**, and is left alone otherwise. A widget that grabs focus on every
answer is its own accessibility bug.

**What automated checks cannot tell you**, and what to say honestly:

- Colour contrast comes back `incomplete`, not `pass`. A headless DOM computes no layout and no
  cascade, and the widget paints in system colours whose values belong to the viewer's OS.
  Forced-colours and high-contrast themes have never been examined.
- Nothing about how it *sounds* — announcement order, whether the live region interrupts, how a
  link's name reads aloud. A checker verifies a region is marked correctly, never what a screen
  reader does with it.
- **No screen reader has been used on this.** If anyone asks whether it is accessible, that is
  the sentence to give them.

---

## 8 · Two rules the tool holds, that you should not relax

1. **It never modifies the app's source.** Everything it writes goes into its own folder. This
   is asserted by fingerprinting the whole target tree before and after a run. If you find
   yourself editing the app's files to make the tool work, stop and ask the developer first —
   and say exactly which file and why.
2. **A capability the current user cannot reach is absent from the registry they receive**, not
   hidden in it. Not filtered at render. Absent.
