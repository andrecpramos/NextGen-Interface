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
  and `/profile/@:user`. They compete with each other during retrieval and there is no
  automatic way to tell them apart — writing a distinguishing word would mean writing it in
  the app's language.
- **A component name filling every language.** English identifiers must not end up in a
  non-English registry.
- **A header from an early return.** A loading or not-found branch's heading is not the
  screen's name.
- **Only reading `t(...)`.** An app calling `tp('announcements.title')` or any other wrapper
  loses its title keys and falls back to component names.

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

One description read, translated, *"The player can manage their navigation team."* Fluent,
grammatical, in the right language, the right length, and meaningless. No mechanical rule
catches that. Only someone reading it does.

Similarly: when a description names a role, only the role the sentence **opens as** is a claim
about audience. *"A doctor or coach can check an athlete's availability"* names an athlete
because the screen is about athletes, not because athletes can open it.

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

### You need real questions, and enough of them

32 questions over 8 screens is close to the floor — with only part of that on the calibration
side, the sweep chooses from very little. Questions written by an agent from the app's routes
are a weaker instrument than questions from someone who knows how the app's users speak. Twenty
real ones beat two hundred invented ones.

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
  or delete anything.
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
