# @nextgen/embed

**The script tag (Ladder C3, PLAN.md WP-29).** This is one file that routes turns on a page
with no build step, no module system, and no network call per turn.

```bash
node packages/embed/build.mjs   # → dist/nextgen.js (script tag, ~51KB gzipped)
```

```html
<script src="/nextgen/nextgen.js" data-nextgen-role="COACH" defer></script>
```

That one line loads the role's bundle and mounts **the assistant layer** (`assistant.ts`):
an orb at the edge of the page that opens into a full-screen assistant. It needs no
inline script and no inline style, so it works on a site with a strict
Content-Security-Policy — checked in a real browser by `tooling/scripts/check-csp.mjs`.

| Attribute | Does |
|---|---|
| `data-nextgen-role` | **required.** The signed-in user's role; write it on the server, HTML-escaped. Without it nothing starts |
| `data-nextgen-base` | where the role's files are served. Default: the folder `nextgen.js` came from |
| `data-nextgen-target` | a CSS selector to mount inside, instead of the page's body. The assistant still covers the page |
| `data-nextgen-position` | which side the orb rests on: `bottom-right` or `top-right` dock it right, `bottom-left` or `top-left` left, at the bottom either way. Default: the emptier side. Anything else is ignored with a warning, and never becomes CSS |
| `data-nextgen-lang` | the assistant's language. Default: `<html lang>` |

If it cannot start — a missing file, a target that matches nothing — it says so with
`console.warn` and throws nothing, because a script tag has no caller to catch it.

**In a single-page app**, stop its moves reloading the page. From your own code (so a
strict policy still allows it):

```js
window.addEventListener('nextgen:navigate', (event) => {
  event.preventDefault();
  router.navigate(event.detail.route);
});
```

Modified clicks (a new tab, a new window) are always left to the browser. The chat box on
its own (WP-41) is `mount(target, assistant)`; that and `start` are this package's source API,
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
[preview/README.md](../../preview/README.md). On the mock app only, `?open` opens the screen
and `?ask=…` asks a question on load, so a state can be linked to.

## The assistant layer

- **The landing page.** On the adopter's home route (`home`, default `['/']`) the assistant
  screen *is* the landing page: open on arrival, and closing it shows the original landing
  page underneath (Rule 7). Every other page is left exactly as it was, with the small orb
  at the emptier edge. A single-page app that reaches its landing route on its own router
  can call `open()`.
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
- **The screen** (`assistant.ts`) is a modal dialog with two layouts of one page. Before anyone
  has said anything it is a landing page: the orb, a greeting and a composer, and no
  pre-written questions. From the first question it is a **chat**: the orb shrinks to the top,
  the conversation fills the screen and scrolls, and the composer stays at the bottom. The
  greeting is the first message; the visitor's words appear on the right the moment they send
  them (as text, never as markup); a typing indicator shows while it works out an answer; the
  answer arrives on the left with its options as rows and its "Why?" beneath — and when the router
  will not act but one screen is plainly ahead (its score at least 1.5 times the runner-up's, and
  not a declared limit close behind), that screen is offered first as "you probably want X" ("you can
  probably do that on X" when the visitor asked for a task), with what it is for in the adopter's own
  words, and one alternative beneath it. **At most two places are ever offered**, each with its purpose
  (never an invented one: a screen with no declared purpose is a plain link), because someone who has
  never seen the app cannot rank three names; an answer that was a guess ends "Not what you meant? Tell
  me a bit more", and a refusal ends with what the assistant can do instead. It is only ever a link
  (`present.ts`); every turn is
  kept. Under each answer is one quiet row: **Copy** (as plain text, where the browser has a
  clipboard) and **Why?**. **Start over** (the ↺ in the corner, once there is a conversation)
  returns to the greeting and drops any answer still being worked out; **↑ and ↓ in the composer**
  walk back through what was asked, only from an empty composer so they never overwrite what is
  being typed. A question and its answer sit closer together than one turn does to the next. The
  thread is a `role="log"` (announced in order, once complete), keeps the greeting and
  the latest 60 messages rather than growing all day, and is reachable by keyboard from the
  first option to the last. Focus moves in, Tab stays in, Escape closes it and focus returns
  to the orb.
- **The adopter's look** (`theme.ts`). The screen, its buttons and the orb take the look of
  the page they sit on, read from what it renders: its background and text colour, its
  typeface, its brand colour (`--nextgen-accent`, a design system's `--primary`, the
  current navigation item, a primary button, a link), and the corner shape of its real
  buttons and fields. A light app gets a light screen. Colours are read as computed
  values, `oklch()` included, and readability is enforced: secondary text is pushed to
  4.5:1 and an accent too faint to see is not used. A page with no stylesheet of its own
  gets the Graphite HUD default.
- **The menu** (`nav.ts`). The top-left button opens the adopter's own navigation — their
  links, in their order, with the current page marked — rather than a second one of ours
  (ADR-013). Where the page has none, it lists the registry's places (`suggestionsFor`).
  Following a link travels there with the orb; choosing the page the user is already on
  just closes the screen.
- **Why?** Every answer carries a native disclosure rendered from its own turn record: how
  it was decided, how long it took, whether a model was called, and the candidates it
  weighed with their scores. Rung A1's "explain its own decisions" — never model prose
  (Rule 9).
- **Guide.** When the registry declares steps for the screen the user lands on (WP-27),
  the orb walks them through it one step at a time, highlighting the field. The text is
  always shown, including when an anchor cannot be trusted (`anchor.ts` refuses rather
  than mispoints). ⚠️ The generated fixture registries declare no steps yet, so the
  preview does not show it.
- **Travelling.** When a turn resolves to a destination, the screen dissolves, the same
  orb flies to the emptier edge (`chooseDockSide`, `dock.ts`) and the browser moves. A
  short note in `sessionStorage` lets the next page's orb say where the user landed.
  Closing the screen first cancels the trip.
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
- **Speech out** only through a voice whose `localService` is true. Every answer is read
  aloud unless the visitor turns it off with the speaker button (remembered in
  `localStorage`).

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
menu, back, home, stop, repeat, stop listening, in Portuguese and English (`commands.ts`) — is
acted on at once and never routed. Anything longer is a question.

**Small talk.** "Hi", "thanks", "bye", "how are you", "who are you", "what can you do", "I have no
idea what to do here" are answered, never routed (`chat.ts`): a router handed "hi" refuses it, and a
visitor greeted with a refusal has learned the assistant is not for them. Matching is exact on a short
list in Portuguese and English, tolerant of a stretched word ("hiii"), plus one rule for the two things
that cannot be listed — being lost and being thankful: every word must be a generic one and at least one
must be the marker, so a single word about the app ("I have no idea where the *calendar* is", "help me
*book*…") makes it a question for the router. A leading greeting is let go and the rest is routed
("hi, where are my kids?"). When the visitor is lost it offers up to three places to begin, taken from
the page's own navigation, in its own words, where the assistant can say what each is for. These turns
have no `TurnTrace` — Rule 9 covers routed turns — and so no "Why?". A language other than these two gets
none of this: the visitor is routed, as before.

**Photos and files** ([ADR-024](../../.claude/decisions/ADR-024.md), `attach.ts`). The box has a paperclip, and
on a touch-first device a camera that opens the rear camera; a photo can also be pasted into the box and a
file dropped on the screen (desktop). What is attached waits in a tray of small chips, each with a way out,
and appears in the visitor's own message. **It never leaves the device**: the router is handed the words and
nothing else; no trace, prompt or request carries it; a photo's preview is drawn on a canvas by the browser's
own decoder, because a `blob:` URL is what a strict Content-Security-Policy refuses. The one place it goes is
the page the assistant sits in, as a cancelable event:

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
**The page must still validate what it is given.** An app with nowhere to send a file turns the buttons off
with `data-nextgen-attach="off"` (or `attach: false`).

**The look** is glass, metal and light, in CSS — no WebGL, no dependency, no React — and derived from the host:
the host's raised surface made translucent with a lit top-left edge; the host's accent as a metal (lit above,
shaded below, in a bright rim, with a sweep of light when reached for); the accent again as a soft aurora
behind the glass on an otherwise opaque backdrop. A light host gets white glass with soft depth. Blur is spent
only where something is behind it (the composer, the corner controls, the drawer, the docked bubbles), not on
every message. Without `backdrop-filter`, under `prefers-reduced-transparency`, or in forced-colours mode, every
surface is the host's solid colour, as before.

## The chat box

- **`present.ts`** is pure. It turns a turn into what to say, and whether to move:
  - It moves only for an executed `navigate` turn. It does not move for "what is X?"
    (WP-36), or to where the user already is.
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
  ([the NVDA pass](../../eval/a11y/NVDA-CHECKLIST.md), PLAN.md WP-45).**

## The router underneath

- **`create(bundle)`** takes a registry, its shipped index and its thresholds. It returns
  `route(utterance, context)`, `steps(capabilityId, root)` and the capability count. It
  fits **one** query encoder for that one registry, never a shared one
  ([L10](../../.claude/docs/lessons.md)).
- **`load(basePath, role)`** fetches `registry.<role>.json`, `index.<role>.json` and
  `thresholds.hashing.json` from the page's own origin, then calls `create`.

It is stages 1 and 2 of the router only. A script tag has no stage-3 transport, so a turn
that would need a model degrades to a clarifying question and never to a guess. `steps()`
uses the guided-step resolver in `src/anchor.ts` (WP-27). That resolver would rather not
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
scope. See [lessons.md L11](../../.claude/docs/lessons.md).

## Status

Not installable, and not published: this is workspace source. What ships is
`dist/nextgen.js`, the script tag, which `tooling/scripts/build-adapter.mjs` copies byte for
byte to `adapter/runtime/nextgen.js` and `scan.mjs build` copies into `bundle/` (ADR-018,
ADR-021). Until ADR-021 there was also an ES-module build and a tarball; nothing was ever
released, and nothing read the module.

**Serve each session only its own role's files**: Rule 17 is a delivery property.
