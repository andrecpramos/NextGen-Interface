# SDLC — Planning

## Purpose

Decide what to build and in what order, with the riskiest assumption tested first.

## Cadence

Two-week iterations. Each opens with a planning session and closes with a
demo + retro. Solo development, so ceremony is minimal — but the artefacts are not
optional, because they are what AI coding agents read.

## Inputs

- [vision.md](../docs/vision.md) — direction and non-goals
- [roadmap.md](../docs/roadmap.md) — MVP scope and risk register
- Previous iteration's traces, golden-set scorecard, and retro

## Planning rules

1. **Risk-first ordering.** The item most likely to invalidate the architecture goes
   first. That is why Sprint 0 is a router spike and not a Flutter scaffold — a
   beautiful app shell around a router that can't route is a wasted month.
2. **Every item has an exit criterion**, expressed as a measurement. "Improve intent
   accuracy" is not an item. "Stage 1+2 resolution ≥ 65% on the golden set" is.
3. **Capability items include their registry entry and examples.** A feature without
   examples cannot be tested and cannot be routed to.
4. **No item spans an MVP boundary.** If it does, split it.

## Definition of Ready

An item may enter an iteration when it has:
- A user-facing statement of the outcome
- Acceptance criteria that are checkable
- For capabilities: id, kind, description, triggers, params, ≥3 examples
- Known dependencies resolved or explicitly stubbed
- An estimate, and a note on what would make it slip

## Definition of Done

- Code merged to `develop`, CI green
- Unit + integration tests written, coverage not reduced
- Golden-set entries added for any new capability; suite not regressed
- Registry entry generated and route test passing
- Trace recording verified for the new path
- Docs updated — including an ADR if an architectural choice was made
- Manually exercised on a physical device, not only the emulator

## Estimation

Story points, relative. Track velocity from iteration 3 onward — earlier numbers are
noise. Explicitly reserve ~20% for LLM behaviour work: threshold tuning, prompt
iteration, golden-set expansion. This work is real, recurring, and invisible in
feature-only planning, which is why most AI projects overrun.

## Risk review

The register in [roadmap.md](../docs/roadmap.md) is reviewed at every planning session.
For each: still real? impact changed? mitigation working? New risks are added with an
owner and a response, not just a description.

Any risk marked **fatal** that has no active mitigation blocks the iteration plan.
