# @nextgen/embed

**The script tag.** This is one file that routes turns on a page
with no build step, no module system, and no network call per turn.

```bash
node packages/embed/build.mjs   # → dist/nextgen.js (script tag, ~57KB gzipped)
```

```html
<script src="/nextgen/nextgen.js" data-nextgen-role="COACH" defer></script>
```

That one line loads the role's bundle and mounts **the assistant layer** (`assistant.ts`):
an orb at the edge of the page that opens into a chat panel in its corner, which the visitor
can expand to fill the screen. It needs no
inline script and no inline style, so it works on a site with a strict
Content-Security-Policy — checked in a real browser by `tooling/scripts/check-csp.mjs`.

| Attribute | Does |
|---|---|
| `data-nextgen-role` | **required.** The signed-in user's role — or roles, space-separated, for a user who holds several (`"COACH PARENT"`: each role's registry is fetched, merged, and indexed in the browser); write it on the server, HTML-escaped. Without it nothing starts |
| `data-nextgen-base` | where the role's files are served. Default: the folder `nextgen.js` came from |
| `data-nextgen-target` | a CSS selector to mount inside, instead of the page's body. The assistant still covers the page |
| `data-nextgen-position` | which side the orb rests on: `bottom-right` or `top-right` dock it right, `bottom-left` or `top-left` left, at the bottom either way. Default: the emptier side. Anything else is ignored with a warning, and never becomes CSS |
| `data-nextgen-lang` | the assistant's language. Default: `<html lang>` |
| `data-nextgen-attach` | `on` offers a paperclip (and a camera on a phone) and hands files to the page as `nextgen:attach`. Default: off — see "Photos and files" |
| `data-nextgen-inset` | `x,y` in pixels: how far the orb and the panel keep from the corner. Default `20,20`. Raise `y` to clear the app's own floating button or account menu. Anything else is ignored with a warning |
| `data-nextgen-hide` | CSS selectors, comma-separated, for the app's own launchers — its chat button, its tour prompt — hidden while this assistant runs, so there is one entry point ([ADR-026](../../.claude/decisions/ADR-026.md)) |
| `data-nextgen-home` | the page(s) where the panel opens by itself. Default `/`; in a signed-in app, where users land (`/dashboard`) |
| `data-nextgen-decide` | `confirm`, `balanced` (default) or `eager` — how readily it moves the browser ([ADR-027](../../.claude/decisions/ADR-027.md)) |
| `data-nextgen-search` | the app's own search, a path with `{query}` — `/search?q={query}` — offered first for what no screen matches |
| `data-nextgen-navigation` | a CSS selector for the app's main navigation, when it is not a `<nav>`, `[role=navigation]` or `<aside>` |

## Tuning and teaching ([ADR-027](../../.claude/decisions/ADR-027.md))

Every app is different, so how bold and how clever it is belongs to the adopter:

- **`decide`** — `confirm` never moves without a yes (a decided turn is asked: "Shall I open Calendar?");
  `balanced` moves when the router decided and asks one question when it did not; `eager` also moves when
  one place is plainly ahead (ADR-023's bar). It never touches a limit, a refusal or an unmatched question.
- **`search`** — for what matched nothing: "Search for “photos of Ana in Porto”" on the app's own search
  page, first. Only a same-origin path with `{query}`; anything else is ignored.
- **What visitors teach it.** Every question it could not settle, and how the visitor settled it — a place
  picked, "neither", or nothing matching at all — is a `Lesson`: `{ question, route, how, from, offered }`,
  sent to `onLearn` and as a `nextgen:learn` event on the window, and to nothing else. It is the visitor's
  own words, so keeping it is the adopter's decision. `scan.mjs teach` turns a log of them into
  `askedAs` phrases in `knowledge.json` (read `review/TAUGHT.md` first; `--write` applies it), holding back
  anything that may identify someone and anything visitors settled two ways.
- **Languages** — English (the default, for any page not in Portuguese) and Portuguese, the interface,
  commands and small talk alike. Any line can still be replaced through the `words` option.
- **Types** — `nextgen.d.ts`, held to the real exports by `src/declarations.check.ts`.

If it cannot start — a missing file, a target that matches nothing — it says so with
`console.warn`, announces it on the window as **`nextgen:error`**, and throws nothing,
because a script tag has no caller to catch it:

```js
window.addEventListener('nextgen:error', (event) => {
  const { reason, message } = event.detail; // 'bundle-unavailable' | 'bundle-invalid' | 'mount-failed'
});
```

A 404 says whether the files are served there, and that a server started before the endpoint
existed must be restarted — the first real integration lost an hour to exactly that, in silence.

**A single-page app with token auth** has no server-rendered HTML to write the role into, and
the widget's own `fetch` would carry no `Authorization` header. Load `nextgen.js` without
`data-nextgen-role` (so it does not start itself) and start it from the app's code, with the
app's own authenticated fetch:

```js
const assistant = await NextGen.start('/api/v1/assistant/navigation-bundle', role, {
  fetch: (url) => fetch(url, { headers: { Authorization: `Bearer ${token}` } }),
  navigate: (route) => router.navigate(route),  // move without a page load
  home: ['/dashboard'],                          // where it opens by itself; never a public '/'
  inset: { x: 20, y: 144 },                      // clear the app's own floating button
  lang: 'pt-PT',
});
assistant.open();                     // the corner panel — bind it to the app's launcher or ⌘K
assistant.open({ expanded: true });   // full screen, the app's navigation still in view
assistant.ask('abrir as turmas');     // resolves to what was shown
assistant.close();
assistant.destroy();                  // on sign-out
```

`start()` rejects with a `StartError` whose `reason` is the same as the event's.

**In a single-page app**, stop its moves reloading the page. From your own code (so a
strict policy still allows it):

```js
window.addEventListener('nextgen:navigate', (event) => {
  event.preventDefault();
  router.navigate(event.detail.route);
});
```

Modified clicks (a new tab, a new window) are always left to the browser. The chat box on
its own is `mount(target, assistant)`; that and `start` are this package's source API,
exercised by its tests. An adopter receives only the script tag: the package is not installable
and there is no ES-module build (ADR-021).

**Styling under CSP.** The assistant's and the chat box's stylesheets are constructed and
adopted by their shadow roots, which a policy does not govern; a `<style>` element is used
only where the browser cannot construct one. Measured in Edge 153 under `style-src 'self'`:
the `<style>` element the chat box shipped with until 2026-09-13 was blocked, and it
rendered unstyled.

## See it before an adopter does

There is no adopter app required to look at this. `pnpm preview`, from the repository root,
builds the bundle and serves the real widget on a mock application built from a generated
registry, beside a bench that shows the whole trace behind every answer, and host-page
variants (no CSS, left nav, right nav, a phone frame) for placement. It is described in
[preview/README.md](../../preview/README.md). On the mock app only, `?open` opens the panel,
`?full` opens it full screen, `?ask=…` asks a question on load, and `?companion` pretends the app
already has an assistant of its own, so a state can be linked to.

## The assistant layer

- **The panel** ([ADR-026](../../.claude/decisions/ADR-026.md)). Tapping the orb opens a chat panel
  in its corner (420 × 660 at most; a sheet across the bottom of a phone). The page beside it stays
  in view and usable: the panel is a non-modal dialog, the page still scrolls, Tab walks on into
  it. Its header holds every control — **expand**, **start over** (always there), **read aloud**
  and **close** — and, when the app has an assistant of its own, a button that opens it. **Expanded**,
  it fills the screen *except the app's own navigation*: a sidebar against the left edge or a bar
  across the top is measured (`navFrame`, `nav.ts`) and left uncovered. Expanded it is modal —
  the page stops scrolling and Tab stays in — and reaching for the app's navigation returns it
  to its corner. Closing and opening again gives the panel, never the full screen.
- **Where it opens by itself.** On the adopter's home route (`home`, default `['/']`) it opens
  on arrival. In an app whose `/` is a public page outside the signed-in shell, name the page a
  signed-in user lands on (`/dashboard`), or bind `open()` to the app's own launcher. Every
  other page is left exactly as it was, with the small orb at the emptier edge (`inset` moves it).
  **Nothing is written beside the orb**: its name is for a screen reader, and what it says after
  a full page load ("You are on Calendar") is a live region only.
- **The orb** (`liquid.ts`, `mind.ts`) is a canvas: four translucent masses of one liquid, each a
  closed curve built from a few sine waves, drifting off-centre and blended with `screen`,
  with a dotted sphere inside it drawn by [thinking-orbs](https://github.com/Jakubantalik/Libraries.dev)'
  engine (only the engine: no React). The liquid is how the assistant feels; the dots are
  what it is doing. It keeps one state grammar: idle is the whole globe, evenly lit and turning
  quietly (`mind.ts`'s "resting" look: the searching globe with its scan taken out, at a third of
  the pace), listening follows the microphone (a waveform through the rings), thinking is that
  same globe with a scan across it and one droplet in orbit, speaking composes (an undulating
  sash), error is the resting globe contracted and turned toward red. A change of state crossfades. The state is always written in text too. Under
  `prefers-reduced-motion` the loop never starts and each state is one still frame.
- **The composer's light** (`beam.ts`) answers to the same state: a slow breath at rest, a
  lit segment travelling the bottom edge while it thinks, a glow that rises with the
  microphone or the voice while it listens or speaks, the danger colour on error. It is CSS
  in the assistant's adopted stylesheet — the look of `border-beam` and `voice-glow`,
  rebuilt, because the originals are React components that inject a `<style>` element. Its
  colours are the orb's accent turned either way round the hue wheel. It is absent under
  forced colours. [ADR-022](../../.claude/decisions/ADR-022.md) records the choice, the size
  it costs (+8KB gzipped) and the alternatives.
- **The conversation** (`assistant.ts`) has two layouts of one panel. Before anyone
  has said anything it is the orb, a greeting and a composer, and no
  pre-written questions. From the first question it is a **chat**: the orb shrinks to the top,
  the conversation fills the panel and scrolls, and the composer stays at the bottom. The
  greeting is the first message; the visitor's words appear on the right the moment they send
  them (as text, never as markup); a typing indicator shows while it works out an answer; the
  answer arrives on the left. **Less is more** ([ADR-030](../../.claude/decisions/ADR-030.md)): a move
  says "Opening X" and nothing else — the screen says the rest. **When the router will not act it asks one
  question, never shows a menu** (ADR-026): when one screen is plainly ahead (its score at least 1.5
  times the runner-up's, and not a declared limit close behind) or is the only match, "Looking for X?"
  ("That's in X. Open it?" for a task), with one line on what it is for in the adopter's own words, and
  "yes" takes it; when two are about as likely, "X or Y?", and "the second one" or a detail ("the injury
  one") answers it. Never a third name, and never an invented purpose: a screen with no declared purpose
  is a plain link. A refusal that points nowhere ends with one short line on what it can do instead, so it
  is never a dead end; nothing else carries a hint. It is only ever a link (`present.ts`); every turn is
  kept. Nothing sits under an answer of its own — no "Why?", no Copy; an answer from the app's own
  assistant carries its name and a **Copy**. **Start over** (the ↺ in the header, always there)
  returns to the greeting and drops any answer still being worked out; **↑ and ↓ in the composer**
  walk back through what was asked, only from an empty composer so they never overwrite what is
  being typed. A question and its answer sit closer together than one turn does to the next. The
  thread is a `role="log"` (announced in order, once complete), keeps the greeting and
  the latest 60 messages rather than growing all day, and is reachable by keyboard from the
  first option to the last. Focus moves in, Escape closes it and focus returns to the orb.
- **The adopter's look** (`theme.ts`). The screen, its buttons and the orb take the look of
  the page they sit on, read from what it renders: its background and text colour, its
  typeface, its brand colour (`--nextgen-accent`, a design system's `--primary`, the
  current navigation item, a primary button, a link), and the corner shape of its real
  buttons and fields. A light app gets a light screen. Colours are read as computed
  values, `oklch()` included, and readability is enforced: secondary text is pushed to
  4.5:1 and an accent too faint to see is not used. A page with no stylesheet of its own
  gets the Graphite HUD default.
- **No navigation of its own** (`nav.ts`, ADR-013, ADR-026). The app's own navigation is always
  in view — beside the panel, and beside the full screen too — so the assistant has no menu.
  It still reads that navigation, never changing it: a visitor who is lost is offered up to
  three places to begin from it, in its own words.
- **Why — for the adopter** ([ADR-030](../../.claude/decisions/ADR-030.md)). A visitor wants the
  answer, not its mechanics, so none are shown. Every routed turn's record still exists (Rule 9) and
  goes to the page as `nextgen:turn` — `{ trace }`: how it was decided, what it weighed and with what
  scores, what the validator removed — for the adopter to log or build their own "why" from. The one
  thing a visitor is told is ADR-017's: "Answered with help from a model", under a turn a model decided
  or wrote.
- **One language** ([ADR-030](../../.claude/decisions/ADR-030.md)). Everything on screen is in the
  page's language — the assistant's words and the app's screen names and descriptions alike. The
  registry carries the app's other languages (`translations`, from the kit's `languages`), and a
  translation that lacks a description shows none rather than another language's. A page in a language
  the app does not ship gets English where the app has it. `<html lang>` is followed live; an app that
  switches language without touching it calls `handle.setLanguage('pt-PT')`.
- **Guide.** When the registry declares steps for the screen the user lands on,
  the orb walks them through it one step at a time, highlighting the field. The text is
  always shown, including when an anchor cannot be trusted (`anchor.ts` refuses rather
  than mispoints). ⚠️ The generated fixture registries declare no steps yet, so the
  preview does not show it.
- **Starting what was asked** (`act.ts`, [ADR-031](../../.claude/decisions/ADR-031.md)). *"I want to
  schedule an event"* ends with the event form open, not only on the calendar. Once there (or at once,
  if the visitor already is), it reads the rendered page as a user does — each control by its
  accessible name — and finds the one that starts the task ("New event", "Novo evento"). It **presses**
  it only when the control can only open something: a link on this site, a tab, a control with
  `aria-haspopup`/`aria-expanded`/`aria-controls`, or one the registry lists in `opens` (from the page's
  source — `onClick={() => setOpen(true)}`, a `DialogTrigger` — or knowledge.json). Otherwise it
  **points** (the guide's ring, *"Tap «New event» to start"*). A control that saves, sends, pays,
  deletes or signs out is never pressed nor pointed at, nothing inside a form is touched, nothing is
  typed, and two equally likely controls mean it does nothing. The panel makes way so the form can be
  seen. The task crosses a full page load as a few content words in the arrival note, never the
  question. Any framework, any app: it reads the page, not the source. `act: 'point' | 'off'` limits it.
- **Travelling.** When a turn resolves to a destination the browser moves **at once** — never
  after the answer has been read aloud, never after an animation: "Opening Calendar" followed by
  nothing reads as broken. The panel stays open beside the new page
  (back in its corner if it was expanded), and the conversation carries on there; a screen with
  guided steps makes the panel give way to its guide. After a full page load, a short note in
  `sessionStorage` lets the next page announce where the user landed. Closing the panel while
  the answer is still being worked out cancels the trip.
- **Isolation.** Shadow DOM, as the chat box: the host's stylesheet cannot reach in and
  this one cannot leak out. The look is read from the page, never inherited from its
  cascade.

## Voice: on the device, or not at all (Rule 8)

`voice.ts` uses three browser capabilities, each only in its local form:

- **Microphone level** through an `AnalyserNode`: numbers, never audio. This is what the
  orb listens to.
- **Speech to text** only with `SpeechRecognition.processLocally = true`. Chrome's
  default recogniser streams audio to a Google server, so a browser that cannot
  recognise on the device gets the level meter and a request to type — never the cloud
  path. A recogniser that does not keep the setting is not started.
- **Speech out** only through a voice whose `localService` is true. **Silent by default**: an
  answer is read aloud once the visitor turns the speaker button on (remembered in
  `localStorage`), and during a hands-free conversation, which is spoken. A navigation aid that
  talks unbidden is a surprise in an office or a physio room.

**Hands-free.** The microphone button turns listening on for as long as the screen is open,
and the choice is remembered, so a returning visitor's landing page listens straight away.
`converse()` keeps one microphone stream, detects speech from its level (`voiceActivity`,
with hysteresis so a cough is not a question), starts the on-device recogniser again after
each utterance, and pauses while the assistant thinks and speaks so it never hears itself.
Closing the screen closes the microphone; the original pages never listen.

**Setting voice up.** Browsers ship on-device speech as a language pack downloaded once, and
only while handling a tap: Edge reports it as `downloadable`, and installing it without a tap
is refused. So the landing page never tries on its own; it says to tap the microphone. The
tap installs the pack, and availability is read again afterwards, so a refused download never
sticks for the visit. A recogniser that starts but reports nothing for four seconds is given
up on rather than listened to forever.

**Commands.** A short, closed list of things a visitor says to the assistant itself — close,
tour ("tutorial", "visita guiada", "show me around"), back, home, stop, repeat, stop listening, in
Portuguese and English (`commands.ts`) — is acted on at once and never routed. The tour is the app's
own (`companion.tour`), else the guided steps of the page the visitor is on; with neither, it is a
question like any other. Anything longer is a question.

**Small talk.** "Hi", "thanks", "bye", "how are you", "who are you", "what can you do", "I have no
idea what to do here" are answered, never routed (`chat.ts`): a router handed "hi" refuses it, and a
visitor greeted with a refusal has learned the assistant is not for them. Matching is exact on a short
list in Portuguese and English, tolerant of a stretched word ("hiii"), plus one rule for the two things
that cannot be listed — being lost and being thankful: every word must be a generic one and at least one
must be the marker, so a single word about the app ("I have no idea where the *calendar* is", "help me
*book*…") makes it a question for the router. A leading greeting is let go and the rest is routed
("hi, where are my kids?"). When the visitor is lost it offers up to three places to begin, taken from
the page's own navigation, in its own words, where the assistant can say what each is for. These turns
have no `TurnTrace` — Rule 9 covers routed turns — and so no `nextgen:turn`. A language other than these two gets
none of this: the visitor is routed, as before.

**The app's own assistant** ([ADR-026](../../.claude/decisions/ADR-026.md), `companion`). An app that already
has an assistant — a model-backed chat, a guided tour — merges it in rather than competing with it: the orb is
the one entry point, and nothing either had is lost.

```js
NextGen.start(base, role, {
  companion: {
    name: 'Assistente da escola',
    // What this assistant cannot place: a question that matches no screen, a topic the registry puts
    // outside the app, and anything attached. Resolve to plain text, or null to leave the turn here.
    ask: ({ text, files, route }) => schoolChat.answer(text, files, route),
    open: () => schoolChat.open(),          // a header button opens it whole: history, new chat, all of it
    tour: (route) => tutorial.start(route), // "tutorial" / "visita guiada" starts it
    hide: ['#school-chat-button', '[data-tour-prompt]'], // its launchers, while this one runs
  },
});
```

Its answer appears in the conversation under its own name ("Answered by Assistente da escola"), with a
Copy — this router did not decide it and cannot explain it (Rule 9). A declared limit on **acting** (a
payment, changing a record) is never handed over; it stays refused. If it declines, fails or says nothing,
this assistant answers as it would have without it.

**Photos and files** ([ADR-024](../../.claude/decisions/ADR-024.md), `attach.ts`). **On when the app's own
assistant can answer** (`companion.ask`), which is where they go; otherwise **off unless the page turns
them on** — `data-nextgen-attach="on"`, or `attach: true` — because most apps have nowhere to send a file and a
button that goes nowhere is a dead end (ADR-024's addendum). Turned on, the box has a paperclip, and
on a touch-first device a camera that opens the rear camera; a photo can also be pasted into the box and a
file dropped on the screen (desktop). What is attached waits in a tray of small chips, each with a way out,
and appears in the visitor's own message. **It never leaves the device**: the router is handed the words and
nothing else; no trace, prompt or request carries it; a photo's preview is drawn on a canvas by the browser's
own decoder, because a `blob:` URL is what a strict Content-Security-Policy refuses. With a companion, it goes
to `companion.ask` with the words; without one, the one place it goes is the page the assistant sits in, as a
cancelable event:

```js
window.addEventListener('nextgen:attach', (event) => {
  const { files, utterance, route } = event.detail; // File[], what they typed, where they were
  event.preventDefault();                           // "I've passed your attachment to the app"
});
```

If nothing takes it the visitor is told so — "your attachment stays on this device; I can't read it, but you
can add it on that page" — and their words are routed as usual. A message that is only a file is answered
("Thanks — I've got it … tell me what you want to do with it"), never refused. Limits are declared: four
files, 15 MB each, photos and common documents; SVG, HTML, scripts, archives and executables are turned away
by name and by type — and because `accept` is only a hint, a paste or a drop is judged by the same function.
**The page must still validate what it is given.** An app with nowhere to send a file leaves the attribute
out; `data-nextgen-attach="off"` (or `attach: false`) says the same explicitly.

**The look** is glass, metal and light, in CSS — no WebGL, no dependency, no React — and derived from the host:
the host's raised surface made translucent with a lit top-left edge; the host's accent as a metal (lit above,
shaded below, in a bright rim, with a sweep of light when reached for); the accent again as a soft aurora
behind the glass. Behind the conversation is **the page itself, blurred and veiled** in its own background
colour (`--ng-veil`, `--ng-panel`), translucent rather than opaque, so the app is still there underneath. A
light host gets white glass with soft depth. Blur is spent only where something is behind it (the panel, the
composer, the corner controls, the guide), not on every message. Without `backdrop-filter`, under
`prefers-reduced-transparency`, or in forced-colours mode, every surface is the host's solid colour, as before.

## The chat box

- **`present.ts`** is pure. It turns a turn into what to say, and whether to move:
  - It moves only for an executed `navigate` turn. It does not move for "what is X?",
    or to where the user already is.
  - It never performs a `read`, `write` or `destructive` capability, because a script
    tag has no dispatcher.
  - It fills a route's `:param` only from the page the user is on. Otherwise it explains
    and stays put.
  - A declared limit is shown in the registry's own refusal text. The words follow the
    page's language, Portuguese or English.
- **`widget.ts`** draws that inside a shadow root, so the host's stylesheet cannot reach
  it. It uses system colours, 48px targets, a visible focus ring, `role="search"`, a
  labelled input, and an `aria-live` result. Choices are real links, so every
  destination stays reachable without the assistant (Rule 7). Audited by
  `tooling/scripts/check-accessibility.mjs`, which runs the built bundle in a real DOM
  and found one real defect ([eval/a11y/RESULT.md](../../eval/a11y/RESULT.md)): focus
  fell to the document body when an answer replaced the link the user was standing on.
  **Automated checks pass; no screen reader has been used on it yet
  ([the NVDA pass](../../eval/a11y/NVDA-CHECKLIST.md)).**

## The router underneath

- **`create(bundle)`** takes a registry, its shipped index and its thresholds. It returns
  `route(utterance, context)`, `steps(capabilityId, root)` and the capability count. It
  fits **one** query encoder for that one registry, never a shared one — a re-fitted
  encoder silently changes every score.
- **`load(basePath, role, { fetch })`** fetches `registry.<role>.json`, `index.<role>.json` and
  `thresholds.hashing.json` from the page's own origin — through the caller's `fetch` when one is
  given, so a token can go with it — then calls `create`.
- **The index is sparse** ([ADR-028](../../.claude/decisions/ADR-028.md)): each screen's vector as the words
  it has, not the tens of thousands it does not. Measured, a 2,000-screen registry is a 7.3 MB index
  (150 MB dense), indexed in 0.4 s and answered in about 3 ms a question. Every score is what it was dense.
- **Complex apps** (ADR-028): a screen about one item (`/players/:id/stats`) that the page names no item
  for is reached through the list it is chosen from ("open Players, choose the one you want"), and two
  screens with one name are offered with their area ("Settings · Finance").

It is stages 1 and 2 of the router only. A script tag has no stage-3 transport, so a turn
that would need a model degrades to a clarifying question and never to a guess. `steps()`
uses the guided-step resolver in `src/anchor.ts`. That resolver would rather not
highlight anything than point at the wrong field.

## How it is tested

`src/embed.test.ts` builds the bundle, then runs it in a fresh V8 context holding only
`window`, `self`, `console` and `performance`. There is no `require`, no `process` and no
`fetch`. In that context it:
- routes real turns from the generator's own output;
- makes the same decision as the direct `route()` call;
- stays under 60KB gzipped;
- exposes `start`, `mount`, `mountAssistant` and `present`.

`src/present.test.ts` covers the presenter's rules, one test per case where moving or
acting would be wrong. `src/widget.test.ts` drives the chat box and `src/assistant.test.ts`
the assistant layer, each through a small fake DOM, because the repository has no DOM
library. `src/voice.test.ts` holds the on-device-only rules against fake browser APIs,
and `src/liquid.test.ts`, `src/mind.test.ts` and `src/beam.test.ts` the orb, its dots and the composer's light. `tooling/scripts/check-accessibility.mjs` audits
the launcher, the open screen and an answered screen, as well as the chat box.

**That test found two defects in the package's browser entry**, and neither could load in a
page: a `node:*` import reached through `core-inference`, and `process.env` read at module
scope. A browser-facing artefact is run with only a browser's globals, not only checked for
existence.

## Status

Not installable, and not published: this is workspace source. What ships is
`dist/nextgen.js`, the script tag, which `tooling/scripts/build-adapter.mjs` copies byte for
byte to `adapter/runtime/nextgen.js` and `scan.mjs build` copies into `bundle/` (ADR-018,
ADR-021). Until ADR-021 there was also an ES-module build and a tarball; nothing was ever
released, and nothing read the module.

**Serve each session only its own role's files**: Rule 17 is a delivery property.
