# Vision

## Mission

Replace application navigation with an AI-orchestrated experience, so that the
location of a feature stops being the user's problem.

## The thesis

Every non-trivial app eventually grows an information architecture problem: features
exist but nobody can find them. The industry answer has been better menus, search,
onboarding tours, command palettes. Each is a patch on the same wound — the user is
required to hold a model of the app's structure in their head.

An LLM can hold that model instead. Given a registry of what every screen does and
what every action needs, a small local model can map "how much did I spend on food"
onto a route, a query, and a rendered answer. The menu becomes an implementation
detail.

## Goals, and what each one has actually measured

Updated 2026-09-10 against [MEASUREMENT.md](../../eval/fut-app/MEASUREMENT.md). A goal
with no verdict beside it is a goal nobody has tested.

1. **Prove AI navigation works** with a local model on consumer hardware, offline.
   ⚠️ **Half met, and the offline half failed.** On a real 146-page application the
   assistant reaches the right screen for **52.3%** of real questions against the app's
   own command palette at 45.5% — so navigation by asking works, and beats the
   incumbent where it was aimed. But only **2.4%** of turns settle without a model call,
   because the browser-capable encoder scores 4.0% recall@1 at 145 capabilities against
   a real encoder's 48.9%. *Offline* is currently unsupported by evidence at adopter
   scale. See PLAN.md §13, D-4 — it is an open decision, not a solved problem.
2. **Prove it generalises** — the same engine drives a second domain with
   configuration, not a rewrite. ✅ **Met.** Swapping the registered application changes
   zero lines in any `core-*` package, exercised by a test that runs the real router
   against a second application's registry — and then again by generating a registry
   for a third application nobody wrote by hand.
3. **Keep it explainable** — the user can always ask "why did you do that?" and get
   a real answer built from a recorded trace, not a generated rationalisation.
   ✅ **Met**, and unchanged by any of the above: no model is involved in `why`.
4. **Keep it private** — no user data leaves the device by default.
   ⚠️ **At risk from goal 1's failure.** The privacy story rested on most turns never
   reaching a model. At 2.4% model-free, 205 of 210 turns reach one. Whether that model
   is local or an adopter's endpoint is now a deployment question with real consequences,
   not a footnote.

## Non-goals

- **Not a chatbot.** Conversation is a control surface, not the product. If the
  answer is a table, render a table.
- **Not a cloud AI product.** Cloud models are an optional accelerator, never a
  dependency for core function.
- **Not an agent that acts unsupervised.** It does not move money, it does not send
  anything, it does not delete without confirmation.
- **Not a general assistant.** It knows this app's domain. It should decline
  gracefully outside it rather than hallucinate competence.
- **Not menu-free as dogma.** See the correction below.

## A correction to the original blueprint

The source blueprint states "No menu required" and "The user should never need to
know where a feature is located."

The first half is right as an *aspiration for the median interaction*. Taken
literally as an architecture rule, it fails on four counts:

1. **Accessibility.** A screen-reader user, or anyone who cannot use voice, needs a
   traversable structure. WCAG 2.2 does not have a conversational exemption.
2. **Discoverability.** Users cannot ask for features they don't know exist. Some
   surface — a home dashboard, a capability list — has to advertise the space.
3. **Failure mode.** A 1 GB model file that fails to load, or an intent engine that
   returns low confidence, must degrade to a usable app, not a dead one.
4. **Speed.** For a route the user visits daily, a tap is faster than a sentence.
   Forcing conversation on habitual actions is a regression.

**Adopted rule: AI-first, not AI-only.** The AI is the default and most capable path.
Conventional navigation exists underneath it, complete and unhidden — but it is not
the thing the interface leads with. This is a load-bearing decision, recorded as
[ADR-005](../decisions/ADR-005.md).

## Product principles

| # | Principle | What it actually constrains |
|---|---|---|
| 1 | AI First | A feature that cannot be invoked by intent is not done. The registry entry is part of the definition of done. |
| 2 | UI Second | Screens render state and collect structured input. They do not own navigation decisions. |
| 3 | Voice Native | Anything touchable is speakable. Voice is a first-class input path, not an add-on. |
| 4 | Offline First | Core loop — intent → action → navigation → answer — runs with the radio off. |
| 5 | Explainability | The app can always show: what it did, why, and which data it read. From a trace, not a story. |
| 6 | Domain Agnostic | Engine code never imports domain code. Domains register into the engine. |

## What success looks like

The user opens the app, says *"did I overspend on groceries this month"*, and gets a
number, a short sentence, and a chart — without ever having learned that a
"Categories" screen exists.

And when they ask *"how did you get that"*, they get the query, the date range, and
the 31 transactions it touched.

## Long-term

Finance is domain #1. If the seams are drawn correctly, domain #2 (CRM, inventory,
healthcare, productivity) is a package of: entities, actions, route registry, and a
knowledge pack — with zero changes to the engine. That is the real deliverable.

The test of the architecture is not whether the finance app works. It is how much
code the second domain requires.

**That test has since been run, and then raised.** The second application required
zero changes to the engine. The *third* was not written by hand at all: a generator
read an application's source and produced its registry, and the engine routed against
it without modification. The question has therefore moved on — from *"how much code
does a domain need?"* (answer: none, it is generated) to *"is the generated registry
good enough to route against?"*, which is what
[MEASUREMENT.md](../../eval/fut-app/MEASUREMENT.md) answers, in both directions.
