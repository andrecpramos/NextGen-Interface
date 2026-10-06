# UI Guidelines

The principles the widget in `packages/embed` is built and checked against. The visual
language itself (the orb, the panel, the host-derived glass) is set by the ADRs:
[ADR-012](../decisions/ADR-012.md), [ADR-022](../decisions/ADR-022.md),
[ADR-026](../decisions/ADR-026.md), [ADR-030](../decisions/ADR-030.md) and
[ADR-035](../decisions/ADR-035.md). Accessibility is gated by `check-accessibility.mjs`.

## A guest on someone else's page

The widget sits inside an application it did not design. It adds a layer and restyles
nothing (Rule 16). Its surfaces derive their colours from the host's own scheme and
accent (`theme.ts`), so it reads as part of *their* application, and it costs next to
nothing at rest ([ADR-029](../decisions/ADR-029.md)).

## AI-first, not AI-only

Every screen the assistant can reach stays reachable without it
([ADR-005](../decisions/ADR-005.md), Rule 7). The assistant never replaces the host's own
navigation, never adds a second one, and never becomes the only path to anything.

## The orb is a state, not a decoration

It is the single indicator of what the assistant is doing. Each state is distinct without
relying on colour alone, and each has a text label available to assistive technology:

| State | Meaning |
|---|---|
| `idle` | ready |
| `listening` | the microphone is open, and this must be unmistakable |
| `thinking` | routing, or waiting on the adopter's model |
| `speaking` | an answer is being read aloud; tap to interrupt |
| `error` | something failed, and a message says what |

Never a spinner where a determinate indicator is possible.

## Offer, don't guess

When the router is not sure, it asks one question rather than showing a menu: "Are you
looking for X?" when one screen leads, "Do you mean X, or Y?" when two are close. It never
names a third screen, because a visitor who has never seen the app cannot rank unfamiliar
names ([ADR-026](../decisions/ADR-026.md)).

## Explainability

Every answer carries a low-emphasis *Why?* affordance. It opens what the assistant
understood, what else it considered and by what margin, which stage decided, and whether a
model on the adopter's site was involved. It is plain language over the recorded trace,
never model-generated narration (Rule 9).

## Accessibility

Non-negotiable, and the AI-first framing makes it more important, not less:

- Every interactive element has a semantic label; the orb announces its state.
- Voice is never the only path. Text input is always present and equally capable.
- Contrast at least 4.5:1, full keyboard traversal, visible focus.
- Respect `prefers-reduced-motion`: the orb degrades to a static state indicator.
- Respect reduced transparency and forced colours: every surface falls back to the host's
  solid colour.
- Live regions announce state changes and arriving answers to screen readers.

## Motion

Motion communicates state transitions and spatial relationships. Nothing animates for
decoration alone. Every animation has a reduced-motion equivalent, and every animation in
a closed panel is paused.

## Latency perception

- Under 100 ms: no indicator.
- 100 ms to 1 s: the orb changes state, nothing more.
- Over 1 s: say what is happening, because a labelled wait feels far shorter than a blank
  one.
- Over 3 s: offer a way out.
