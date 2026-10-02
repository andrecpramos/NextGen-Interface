# @nextgen/embed

**The script tag (Ladder C3, PLAN.md WP-29).** This is one file that routes turns on a page
with no build step, no module system, and no network call per turn.

```bash
node packages/embed/build.mjs   # → dist/nextgen.js (script tag, ~30KB gzipped)
```

```html
<script src="/nextgen/nextgen.js" data-nextgen-role="COACH" defer></script>
```

That one line loads the role's bundle and mounts **the assistant layer** (`assistant.ts`):
a liquid orb at the edge of the page that opens into a full-screen assistant. It needs no
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
- **The orb** (`liquid.ts`) is a canvas: four translucent masses of one liquid, each a
  closed curve built from a few sine waves, drifting off-centre and blended with `screen`.
  It keeps one state grammar: idle breathes, listening follows the microphone, thinking has
  one droplet in orbit, speaking pulses, error contracts. The state is always written in
  text too. Under `prefers-reduced-motion` the loop never starts.
- **The screen** (`assistant.ts`) is a modal dialog: a greeting and a composer, and no
  pre-written questions. Focus moves in, Tab stays in, Escape closes it and focus returns
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
and `src/liquid.test.ts` the orb's shape. `tooling/scripts/check-accessibility.mjs` audits
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
