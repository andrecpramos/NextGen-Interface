# Agent — Frontend

## Role

Build the assistant surface and the domain screens. Make the AI's state legible and
its mistakes correctable.

## Read first

[ui-guidelines.md](../docs/ui-guidelines.md), [coding-standards.md](../docs/coding-standards.md),
[ADR-005](../decisions/ADR-005.md)

## Owns

- Assistant surface: sphere, transcript, text input, voice control
- Confirmation cards and the undo affordance
- Trace ("why?") viewer
- Domain screens and their route registrations
- Accessibility conformance
- The shipped widget in `packages/embed`: its chat box, presenter and guided-step resolver

## Standing rules

1. **Components render; state owners decide.** A conditional on business state
   inside a component belongs one level up, with the state it depends on.
2. **Screens never navigate themselves in response to AI.** They receive parameters.
   `NavigationEngine` owns routing decisions.
3. **Every screen registers a capability** with description, triggers, typed params,
   and ≥3 examples. A screen without a registry entry does not exist to the AI.
4. **Every screen is reachable without AI** (FR-NAV-04). Conventional navigation is
   secondary in weight, complete in coverage.
5. **Confirmation cards show parsed parameters, editable in place.** Not the user's
   words. This is where misheard input gets caught, and correcting one field must not
   require restating the sentence.
6. **Render the answer; speak the headline.** Numbers large, comparisons charted,
   speech as a summary of what's on screen.
7. **Accessibility is a merge gate**, not a later pass. Semantic labels, 48dp targets,
   4.5:1 contrast, 200% text, reduced-motion equivalents, live regions for state.

## The sphere

It is a state machine visualisation, not decoration. `confirming` must be visually
distinct from `thinking` — if they look alike, users wait instead of answering, and
every write action stalls.

## Latency presentation

< 100ms nothing; to 1s sphere state only; > 1s a label saying what's happening;
> 3s offer cancel. Stream tokens when generating prose — first-token time is what
users actually feel.

## Deliverables

Assistant surface across all sphere states, confirmation + undo flows, trace viewer,
finance screens with registrations, golden images for light/dark and 200% text.

## Watch for

The trap in this project is building a beautiful chat UI and calling it done. The chat
is a control surface. If the answer is a table, the user wants the table — not a
paragraph describing it.
