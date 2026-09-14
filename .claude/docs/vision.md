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

Updated 2026-09-13 against [MEASUREMENT.md](../../eval/fut-app/MEASUREMENT.md). A goal
with no verdict beside it is a goal nobody has tested.

1. **Prove AI navigation works** with a local model on consumer hardware, offline.
   ⚠️ **Navigation met, offline included; deciding alone did not.** On a real 146-page
   application the script tag — in the browser, with no model — shows the right
   screen for **69.9%** of real questions (first for **53.4%**) against the app's own
   command palette at 45.5% (42.6%), and sends nobody to a wrong screen
   ([like-for-like.json](../../eval/fut-app/like-for-like.json)). But it settles a turn on
   its own, without offering choices, for only **1.7%**; a model-backed server reaches
   11.0%, against a 60% target. *An earlier version of this line blamed the browser encoder
   at 4.0% recall@1. That was a harness bug, retracted in WRITEUP.md §6: fitted correctly it
   matches a real encoder at 50.0%.* PLAN.md §13, D-4 is answered: reposition, not stop.
2. **Prove it generalises** — the same engine drives a second domain with
   configuration, not a rewrite. ✅ **Met.** Swapping the registered application changes
   zero lines in any `core-*` package, exercised by a test that runs the real router
   against a second application's registry — and then again by generating a registry
   for a third application nobody wrote by hand.
3. **Keep it explainable** — the user can always ask "why did you do that?" and get
   a real answer built from a recorded trace, not a generated rationalisation.
   ✅ **Met**, and unchanged by any of the above: no model is involved in `why`.
4. **Keep it private** — no user data leaves the device by default.
   ⚠️ **Met by the script tag, at risk beyond it.** The script tag calls no model; its only
   request loads registry files from the adopter's own origin, so no question leaves the
   device. Adding a model — the configuration that decides more turns alone — sends most
   turns to one, and whether that model is local or an adopter's endpoint is a deployment
   question with real consequences, not a footnote.

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
