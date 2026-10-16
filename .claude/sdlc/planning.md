# SDLC — Planning

## Purpose

Decide what to build and in what order, with the riskiest assumption tested first.

## Inputs

- The open gaps in [critical-infrastructure.md](../docs/critical-infrastructure.md), ranked —
  the rules that are written down but not yet enforced.
- The limits stated in [README.md](../../README.md) — what the product does not yet claim.
- The latest golden-set scorecards, and any routing bug reported by an adopter (Rule 12).

## Planning rules

1. **Risk-first ordering.** The item most likely to invalidate the architecture goes first.
   A polished shell around a router that cannot route is a wasted month.
2. **Every item has an exit criterion**, expressed as a measurement. "Improve intent
   accuracy" is not an item. "Stage 1+2 resolution ≥ 65% on the golden set" is.
3. **Every measured item states its kill criterion before it runs** — the result that would
   mean stopping or changing course. Written afterwards, it is a rationalisation.
4. **Capability items include their registry entry and examples.** A feature without
   examples cannot be tested and cannot be routed to.

## Definition of Ready

An item may start when it has:

- A user-facing statement of the outcome
- Acceptance criteria that are checkable
- For capabilities: id, kind, description, triggers, params, at least 3 examples
- Known dependencies resolved or explicitly stubbed
- A note on what would make it slip

## Definition of Done

The checklist is in [docs/RULES.md](../../docs/RULES.md#definition-of-done). In short:

- Code merged to `develop`, CI green
- Unit tests written, and the built artefact run where it applies (`pnpm adapter:check`)
- Golden-set entries added for any new capability; suite not regressed
- Derived artefacts regenerated in the same commit (`check-derived-artefacts.mjs`)
- Trace recording verified for the new path
- Docs updated — including an ADR if an architectural choice was made
- Exercised where it will run — a real browser or the bench (`pnpm preview`), not only jsdom

## Estimation

Reserve about 20% for model-behaviour work: calibration, prompt iteration, golden-set
expansion. This work is real, recurring, and invisible in feature-only planning, which is
why most AI projects overrun.

## Risk review

Review the ranked gaps at every planning session. For each: still real? impact changed?
mitigation working? A new risk is added with a response, not just a description. Any risk
marked **fatal** with no active mitigation blocks the plan.
