# UI Guidelines

## The core idea

The interface has one primary surface — the assistant — and a set of secondary
surfaces the assistant drives. The assistant is always reachable; the screens are
where answers land.

```
        ╭─────────────╮
        │             │
        │      ◯      │      ← sphere: state, not decoration
        │             │
        ╰─────────────╯

     What can I help with?

   ╭───────────────────────────╮
   │  Ask or say something…  🎤 │
   ╰───────────────────────────╯

   ┌────────┬────────┬────────┐   ← capability surfacing, not a menu
   │ Spent  │ Budget │ Recent │
   │ €412   │ 82%    │ 12 txn │
   └────────┴────────┴────────┘
```

Those tiles at the bottom are load-bearing. They solve the discoverability problem
(you cannot ask for what you don't know exists) and they're tappable — the fast path
for habitual actions.

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

Per [ADR-005](decisions/ADR-005.md), a conventional navigation structure exists
underneath the assistant. It is complete — every screen reachable — but secondary in
placement and visual weight.

Concretely: a nav drawer or bottom bar exists. It is not the thing the app opens on.
The assistant is.

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

- Material 3, dynamic colour, full light/dark parity — dark is not an afterthought.
- One accent colour for AI-originated content, so "the app said this" and "the AI said
  this" are always distinguishable.
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
