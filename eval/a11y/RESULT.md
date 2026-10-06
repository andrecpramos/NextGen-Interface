# Accessibility, the automated half

**Run on:** 2026-09-12 · **Tool:** axe-core 4.13.0 in jsdom 30 · **Artefact:**
`packages/embed/dist/nextgen.js`, the file an adopter serves · **Data:**
`eval/frameworks/school/generated`, the `PARENT` role (first measured on 2026-09-12 against a
real application's registry; the fixture stands in for it since ADR-018).

**Verdict: 18 checks, 0 serious or critical violations — after one real defect
was found and fixed.** The claim is still not made: [the NVDA
pass](./NVDA-CHECKLIST.md) is the other half and has not been run.

Reproduce with `node tooling/scripts/check-accessibility.mjs`. It is a CI gate.

## What was actually tested

Not a mock of the widget — the **built bundle**, loaded into a real DOM the way a
script tag loads it, mounted on a host page that is itself accessible (title,
`main`, `h1`, a labelled nav), and driven with a real generated registry. The
host page is accessible on purpose: run axe over a bare `<body>` and it reports
the harness's missing title as a violation of the widget.

Four states, because a widget is only as accessible as its worst one:

| State | How it was reached | Serious/critical |
|---|---|---|
| idle | as mounted, before anything is asked | 0 |
| thinking | `aria-busy`, the state a slow device really sits in | 0 |
| choose | *"onde vejo as faltas do meu filho"* → a clarifying question with a link | 0 |
| limit | *"book an appointment for my son"*, a declared boundary | 0 |
| host page + widget | the whole document, where a duplicate id or a stolen landmark would show | 0 |

The refusal state carries an assertion of its own: the run **fails** if that
utterance stops coming back as a limit. Free-form Portuguese out-of-scope lands
in `choose` as often as not — that is the measured out-of-scope ceiling README states — and auditing a
clarify while calling it a refusal would make this document untrue.

## The defect this found

**Focus fell to nowhere when an answer was replaced.**

A keyboard or screen-reader user submits a question, and while it is in flight
tabs into the *previous* answer's links. The new answer lands, `replaceChildren`
removes the element they are standing on, and focus falls to the document body —
the user is silently returned to the top of the host page, mid-sentence. The
slower the device, the wider that window.

Nobody reading the code had noticed, and the widget's own header comment claimed
*"focus stays in the input"* — which was true only because nothing had ever moved
it out. Fixed: every replacement of the answer now goes through one function that
puts focus back in the question field **if the user was inside the answer**, and
leaves it alone otherwise. A widget that grabs focus on every answer is its own
accessibility bug, so both halves are tests (`widget.test.ts`, 27 tests).

Confirmed by removing the fix: exactly one test fails, and it is the right one.

## What passed, and what it means

| | |
|---|---|
| no positive `tabindex` | the host page keeps its own tab order — the widget adds two stops and reorders nothing |
| a real `<label for>` | `for="nextgen-q"` matches an id inside the shadow root |
| `Enter` submits | no pointer is ever required |
| `Escape` clears, focus stays | and the answer clears with it |
| focus survives replacement | the fix above |
| polite live region, present from mount | `role="status"` + `aria-live="polite"`, in the DOM before any content changes — a region created at the same moment as its content announces nothing |
| the widget speaks the page's language | `lang="pt"` → *"Pergunte para onde quer ir"*; `lang="en"` → *"Ask where to go"* |
| `prefers-reduced-motion` honoured | and nothing to suppress: no transition or animation is declared outside that block |
| 48px targets, visible focus ring | declared in the stylesheet (3 rules at 48px, `outline` on `:focus-visible`) |

## What this run cannot tell you

Stated here rather than buried, because an automated pass reads as more than it
is:

- **Colour contrast is `incomplete`, not `pass`.** jsdom computes no layout and no
  cascade. The widget also paints in system colours (`Canvas`, `CanvasText`,
  `LinkText`, `Highlight`), whose values belong to the user's OS, not to this
  code. Only a real browser at real settings can judge it — including forced
  colours / high contrast themes, which have never been looked at.
- **Nothing about how it sounds.** Announcement order, whether the live region
  interrupts, how a link's name reads aloud. axe checks that a region is marked
  correctly, never what a screen reader does with it.
- **Nothing as rendered.** Visible focus, target size and reflow at 200%/400%
  zoom are checked in the stylesheet, not on screen.
- **Only the embed widget**, which is the product's only user interface.
- **One role, one language pair.** `PARENT`, Portuguese and English.

Every one of those is an item in [NVDA-CHECKLIST.md](./NVDA-CHECKLIST.md).

## The honest statement, until the NVDA pass is run

> Automated accessibility checks pass with no serious or critical violations, and
> one real focus defect was found and fixed. No screen reader has been used on
> this yet.

That is what README, WRITEUP and the business case may say. Not more.
