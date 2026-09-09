# UI Guidelines

## The core idea

The interface has one primary surface — the assistant — and a set of secondary
surfaces the assistant drives. The assistant is always reachable; the screens are
where answers land.

```
   ☰                                  ● local     ☾     ← menu · engine · theme

        ╭─────────────╮
        │             │
        │      ◯      │      ← sphere: state, not decoration
        │             │
        ╰─────────────╯

     What can I help with?

   ╭───────────────────────────╮
   │  Ask anything…          🎤 │
   ╰───────────────────────────╯

    ( how much did I spend )  ( find the payment to… )   ← examples, first turn only
```

**Discoverability still has to be solved** — you cannot ask for what you don't know
exists — but it is a *first-turn* problem, so its solution is a first-turn element.
Example prompts sit under the composer until there is a conversation, then go for
good. They are read from the capability definitions, which are the same strings the
golden set is generated from, so nothing is offered that the router has not been
measured on.

> **Revised 2026-08-30.** This originally specified a permanent row of live-figure
> tiles ("Spent €412 / Budget 82% / Recent 12 txn"). They were removed: a persistent
> strip of pre-built modules is weight on every turn to solve a problem that only
> exists on the first one, and the figures made the assistant look like a dashboard
> with a chat box attached — the exact inversion this document opens by rejecting.
> The **fast path for habitual actions** they also provided now lives in the drawer,
> where it is stronger: selecting an item runs the capability directly, with no
> router in the way. See "AI-first, not AI-only" below.

## The sphere is a state machine

It is the single indicator of what the system is doing. Each state is visually
distinct without relying on colour alone:

| State | Visual | Meaning |
|---|---|---|
| idle | slow breathing | ready |
| listening | amplitude-reactive | mic is open — must be unmistakable |
| transcribing | settling ripple | audio captured, converting |
| thinking | orbiting motion | routing / inference |
| confirming | steady, paused | **waiting on you** — not a spinner |
| acting | pulse | executing |
| speaking | synced to output | TTS playing, tap to interrupt |
| error | flat, muted | something failed, message shown |

Rules: never a state without a text label available; never a spinner where a
determinate indicator is possible; `confirming` must never look like `thinking`, or
users will wait instead of answering.

## AI-first, not AI-only

Per [ADR-005](../decisions/ADR-005.md), a conventional navigation structure exists
underneath the assistant. It is complete — every screen reachable — but secondary in
placement and visual weight.

Concretely: a nav drawer or bottom bar exists. It is not the thing the app opens on.
The assistant is.

As built: an off-canvas drawer behind one control, listing every `navigate`
capability read straight from the registry — so it is not a menu anyone maintains,
and it cannot come to advertise something the dispatcher will not run.

**Selecting from it does not go through the router.** This is the part that is easy
to get wrong. Turning a menu tap into a sentence and routing that sentence would put
the model back on the one path built to be free of it, and inherit the 20% the router
gets wrong at top-1. The drawer hands a capability id straight to the dispatcher, so
it resolves in about a millisecond and cannot be misrouted at all.

What it does **not** skip is policy. A `write` chosen from the menu still raises a
confirmation card, because policy attaches to the capability's kind and never to how
the user arrived ([ADR-004](../decisions/ADR-004.md)).

This is not a hedge. It is a requirement, for four reasons that don't go away:
accessibility, discoverability, model-failure degradation, and speed on habitual
actions.

## Confirmation

Write and destructive actions surface a confirmation card before execution. The card
shows **the parsed interpretation, not the user's words** — this is where
misunderstandings get caught:

```
   ╭──────────────────────────────────╮
   │  Add expense                     │
   │                                  │
   │  Amount      € 12.00             │
   │  Category    Food & Drink        │
   │  Date        Today, 29 Aug       │
   │  Account     Main                │
   │                                  │
   │  [ Edit ]          [ Confirm ]   │
   ╰──────────────────────────────────╯
```

Every field is editable in place. Correcting a wrong category must not require
restating the whole sentence. Destructive actions add an undo affordance that
survives navigation.

## Answers are rendered, not narrated

If the answer is a number, show the number large. If it's a comparison, show a chart.
The spoken line is a *summary of* the rendering, not a substitute for it.

Bad: *"You spent four hundred and twelve euros and ninety cents on food, which is
sixty-two euros and ninety cents over your three hundred and fifty euro budget…"*

Good: **€412.90** — *"€62.90 over budget"* — bar chart against the limit, spoken as
*"€412.90 on food — about €63 over."*

Speech is lossy and slow. Use it for the headline; render the detail.

## Explainability affordance

Every AI-produced answer carries a low-emphasis "why?" affordance. Tapping it opens
the trace view: what it understood, what else it considered and the scores, what it
ran, which rows it read, how long it took, and whether the turn was fully local.

This must be plain language over a real record, never model-generated narration.

## Accessibility

Non-negotiable, and the AI-first framing makes it *more* important, not less:

- Every interactive element has a semantic label; the sphere announces its state.
- Voice is never the only path. Text input is always present and equally capable.
- Touch targets ≥ 48dp. Contrast ≥ 4.5:1. Full keyboard traversal.
- Respect `prefers-reduced-motion` — the sphere degrades to a static state indicator.
- Support Dynamic Type up to 200% without clipping or horizontal scroll.
- Live regions announce state changes and arriving answers to screen readers.

## Motion

Motion communicates state transitions and spatial relationships. Nothing animates for
decoration alone. Durations 150–300ms, standard easing. Every animation has a
reduced-motion equivalent.

## Visual system

> **Superseded in part by [ADR-012](../decisions/ADR-012.md).** Material 3 was chosen
> when the stack was Flutter and it came free with the framework; [ADR-006](../decisions/ADR-006.md)
> then moved us to TypeScript, where it is an imported opinion rather than a default.
> The visual language is now a bespoke token system — "graphite HUD", cyberpunk
> register without neon, Apple design principles — defined in
> `packages/ui/src/tokens.css`. Everything else on this page stands.

- A bespoke design-token system, full light/dark parity — dark is not an afterthought,
  and light is a designed theme rather than an inversion.
- **One accent colour for AI-originated content**, so "the app said this" and "the AI
  said this" are always distinguishable. A second accent — warm, distinct in hue —
  means *waiting on the user*, and is half of what keeps `confirming` from reading as
  `thinking`.
- Depth from layered translucency and hairline borders. Shadows are neutral and dark;
  **no coloured shadow anywhere**, because a coloured shadow is a glow.
- Technical metadata — ids, scores, timings, table names — in a monospace face, so the
  machine record is visibly not prose.
- Financial figures in tabular numerals, aligned right, currency always shown.
- Negative amounts distinguished by more than colour (sign, and a shape cue).
- 8dp spacing grid.

## Latency perception

- < 100ms: no indicator.
- 100ms–1s: sphere state change only.
- \> 1s: show what's happening — "checking your transactions" — because a labelled
  wait feels far shorter than a blank one.
- \> 3s: offer cancel.
- Stream tokens as they arrive when the model is generating prose. Perceived latency
  is what matters, and first-token time is what users feel.
