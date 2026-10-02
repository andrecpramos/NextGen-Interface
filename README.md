# NextGen Interface

**A drop-in AI navigation layer for a web app that already exists.**

Point a tool at an application's source. It reads the routes and the components,
generates a description of everything the app can do, and produces a bundle shipped
with the site. The app's users then get an assistant that **knows their app**: it takes
them where they asked in their own words, and tells them what they will find there.

> *"I need to file an expense claim"* → navigates to `/finance/expenses/new` and says
> *"This is the expense form. Fill in the amount and date, attach the receipt, and pick
> the project it belongs to."*

The old site keeps working exactly as it does. **Every screen the assistant can reach
stays reachable without it** — that one is not negotiable
([ADR-005](.claude/decisions/ADR-005.md)).

> **Adding this to your app?** Start with **[GETTING-STARTED.md](.MDFiles/GETTING-STARTED.md)**: one page,
> five steps. Everything below is about how it was built and measured.

## Does it work?

The claim is *"it works on a web app it has never seen"*, so that is what is measured:
applications this repository did not write, with ground truth recorded **before** the tool
was run on them.

### It reads apps it has never seen

Six public applications, six routing frameworks, ground truth written first
([RESULT.md](eval/field-apps/RESULT.md)):

| | |
|---|---|
| Destinations found | **55 of 55** |
| Declared that were not destinations | **0** |
| Files changed in any app | **0** |

Next.js app router, Remix flat routes, SvelteKit, Nuxt, Vue Router and Angular. It names
each screen in the app's own words, and reports what it refused to declare and why.

### It does not leak screens between roles — after it did, once

On a seventh public app with three roles, **the first run leaked 15 of 48 role
assignments** — admin screens delivered to everyone — because the app gated routes in a
shape the parser could not read, and an unreadable guard defaulted to "public". That was a
pre-committed kill criterion and it fired ([RESULT.md](eval/tutor-app/RESULT.md)).

The rule it produced: **an unreadable guard drops its route and reports it.** Re-measured
against the same ground truth: **48 of 48 correct, 0 leaks, 0 screens missing.**

One shape is still unreadable, and it is stated rather than buried: a guard *inside* the
page component (`<Authorization allowedRoles={…}>`) is invisible to route discovery, and an
app built that way generates a single audience. [FIELD-NOTES.md](adapter/FIELD-NOTES.md)
tells the installing agent to ask about exactly this.

### Routing quality, reproducible from this repository

`pnpm eval:apps` runs the whole pipeline — generate, calibrate, route — over the fixture
applications in [eval/frameworks](eval/frameworks), and is a CI gate. On the reference
fixture (11 capabilities, 3 roles, 2 languages, 68 questions), with no model:

| | |
|---|---|
| Sent straight to a wrong screen | **0%** |
| In-scope questions wrongly refused | 3.7% |
| Out-of-scope refused | 50.0% |
| Settled with no model call | 100% of turns reached a decision without one |

**It offers rather than decides.** For most questions it shows up to three screens and the
person picks — a click more than a perfect guess, and it has sent nobody to a wrong place.

### The pilot, and why its numbers are no longer here

Until 2026-09-17 the headline was a pilot against a private 146-page application: **53.4%
right screen first against that app's own command palette at 42.6%**, over 176 real
questions, and **11.0% of turns settled without a model against a 60% target** — a
pre-committed kill criterion that triggered, after which the cheap-inference claim was
withdrawn rather than restated.

**Those measurements happened; their evidence is deliberately no longer in this
repository.** The generated artefacts were the complete screen inventory of a real
application, by role, and a tool whose whole claim is generality should not ship one app's
private structure as its proof. They are in git history at
[`2d500d8`](https://github.com/andrecpramos/AI-Interface/commit/2d500d8), and cannot be
verified from a fresh clone.

What survives from that pilot is what generalises: every naming and description failure it
found is written up in [FIELD-NOTES.md](adapter/FIELD-NOTES.md), and the fixture in
`eval/frameworks/family` reproduces its hard cases — two addresses for one screen,
placeholder titles, untranslated duplicates — without being it.

**The product is a better way to navigate; a cheaper one is not claimed** until a
deployment measures it.

## The idea

> **The capability registry, not a prompt, is the application's contract.** The model
> never computes, never emits SQL and never picks a route — it selects a *declared id*
> and fills *typed slots*. Everything that must be correct — policy, navigation,
> refusal, the app's limits — is declared data the engine reads.

A three-stage cascade routes each turn, cheapest first:

1. **Deterministic** — phrase match. ~2ms, no model.
2. **Embedding** — cosine against a precomputed index. Milliseconds, no model.
3. **The model** — only for what 1 and 2 cannot settle, choosing an id from a shortlist
   of three. It never sees the full list. ([ADR-003](.claude/decisions/ADR-003.md))

Type `why` after any turn and it explains itself from the recorded trace **with no model
involved** — which stage decided, what else it considered and by what margin. That is a
product feature, not a debug tool: *"prove why it sent this user there"* is what a
regulated adopter asks first.

## Structure

```
adapter/           WHAT AN ADOPTER COPIES — one folder, no package manager, no network
  AGENTS.md        the front door: what to do, and the eight decisions that are
                   the developer's to make rather than the agent's
  FIELD-NOTES.md   what real applications taught this tool; read before trusting output
  scan.mjs         init / build / doctor / calibrate, in one file, no dependencies
  runtime/         the assistant, already compiled

preview/           THE BENCH — never exported. `pnpm preview`
                   ask and see the whole trace; the real widget on a mock app

packages/          the source that builds the adapter
  generator/       reads an app's source, emits one registry per role   <- the build step
  core-capability/ registry schema, validation, codegen — the contract
  core-intent/     the three-stage router, calibration, eval harness
  core-inference/  swappable LLM + embedding runtimes
  embed/           the widget, as one script tag under a strict CSP
  kit/             init / build / doctor / preview / calibrate

eval/frameworks    the measurement: fixture apps, one per routing framework
eval/field-apps    six public apps, ground truth written before the tool ran
tooling/scripts    the CI gates that are not tests
```

**The boundary that matters:** the engine knows nothing about any particular application.
The only application it ever sees is the adopter's, at run time, as declared data it reads
— never as an import. Until 2026-09-17 two reference-application packages lived here to
prove that; they were deleted along with the terminal app and everything else that never
reached an adopter ([ADR-018](.claude/decisions/ADR-018.md)).

**Both are built and both are checked by running them.** `pnpm adapter:check` copies
`adapter/` and a fixture application into a scratch directory outside this repository —
with no `node_modules` anywhere above it — and runs `init`, `build` and `doctor` for real,
then fingerprints the application to prove nothing was written into it.
`pnpm preview:check` loads the bench in a headless browser and asserts two turns from the
committed golden set.

## Run it

```bash
pnpm install --ignore-scripts    # a fresh clone needs the flag; see CLAUDE.md
pnpm preview                     # the bench: ask, and see why it decided that
pnpm check                       # typecheck + every test + registry validation
pnpm eval:apps                   # generate, calibrate and route over a fixture app
pnpm adapter:build               # rebuild adapter/ after changing packages/
pnpm adapter:check               # prove a copy of it runs with nothing installed
```

`pnpm preview` is where to start: it serves the real widget on a mock application built
from a generated registry, plus a bench showing the full trace behind every answer.
`pnpm app` and `pnpm app:offline` went with the composition root in
[ADR-018](.claude/decisions/ADR-018.md); the bench replaces them.

Ollama is probed, not required. Without it the router drops to its deterministic stages
and says so, rather than guessing.

### Generate a registry from an application

```bash
node --experimental-strip-types packages/generator/src/cli.ts <config.json> \
  [--model llama3.1:8b] [--no-model]
```

It emits one `registry.<ROLE>.json` per role, a master inventory for review, and a
report of every route it refused to declare and why. **It writes nothing into the
application it reads** — that is asserted by fingerprinting the whole target tree
before and after a run.

### Measure the router

```bash
pnpm router:inspect     # score distributions, recall@k — always look here first
pnpm router:calibrate   # sweep thresholds — never hand-tune them
pnpm router:eval        # full cascade against the golden set
```

Warm every model with a throwaway call first and run them sequentially, or every latency
figure is meaningless.

## The load-bearing ideas

1. **The registry is the contract.** One declaration generates the route and the thing
   the router selects, so they cannot drift.
2. **The cascade escalates only when it must**, and the model is constrained to a
   shortlist it did not choose. ([ADR-003](.claude/decisions/ADR-003.md))
3. **Policy is code in the dispatcher, never prompt text.** Read executes, write
   confirms, destructive confirms and undoes, unclassified **refuses**.
   ([ADR-004](.claude/decisions/ADR-004.md))
4. **The application declares its own limits**, and a request outside them is refused by
   retrieval rather than by a model's judgement.
   ([ADR-009](.claude/decisions/ADR-009.md)).
5. **A capability a user cannot reach is absent from the registry they receive**, not
   hidden in it. ([ADR-014](.claude/decisions/ADR-014.md))
6. **The installer never modifies the adopter's source.** It reads their code and writes
   only new, additive artefacts.
7. **The model never computes a number the user sees, never emits SQL, and never
   produces an identifier that is not validated against the registry.**

## Where to look

| Question | File |
|---|---|
| Does this work on an app it has never seen? | **[field-apps/RESULT.md](eval/field-apps/RESULT.md)** · [tutor-app/RESULT.md](eval/tutor-app/RESULT.md) |
| What goes wrong when it meets a real app? | **[adapter/FIELD-NOTES.md](adapter/FIELD-NOTES.md)** |
| **What is the state right now?** | **[STATUS.md](.MDFiles/STATUS.md)** — one page |
| What is the plan, and what is next? | [PLAN.md](.MDFiles/PLAN.md) §0 |
| How do I add it to my app? | [GETTING-STARTED.md](.MDFiles/GETTING-STARTED.md) |
| How do I run this repo itself (as a contributor)? | §Run it, above · [PLAN.md](.MDFiles/PLAN.md) §10 |
| Why is it shaped this way? | [.claude/decisions/](.claude/decisions/) — 21 ADRs |
| What was already tried, and what did it cost? | [.claude/docs/lessons.md](.claude/docs/lessons.md) |
| What did the router actually score? | [FINDINGS.md](packages/core-intent/eval/FINDINGS.md) · `pnpm eval:apps` |
| Working in this repo as an agent? | [CLAUDE.md](CLAUDE.md) |

## Status

The engine is built and measured. The generation works. **The cost model is resolved, and
it resolved against us**: on the pilot, turns settling without a model call fell far short
of the 60% target that was a pre-committed kill criterion, and it triggered. A fixed budget
was then spent trying to fix it, every lever was measured, and the claim was withdrawn
rather than restated — [PLAN.md](.MDFiles/PLAN.md) §13 D-4. The numbers were published
rather than buried, which is the point.

Built since then: the browser runtime, guided steps, a script tag that runs under a strict
Content-Security-Policy, and the drop-in kit — `init / build / doctor / preview / calibrate`,
bundled into `adapter/scan.mjs` ([GETTING-STARTED.md](.MDFiles/GETTING-STARTED.md)). The kit
reads React Router, Vue Router, Angular, Next.js, Remix, SvelteKit and Nuxt apps, and on six
public apps it had never seen it found every route in ground truth written beforehand and
changed none of their files ([RESULT.md](eval/field-apps/RESULT.md)).

Not done: a live deployment, and a field test by someone other than its author. The owner
runs both. Nothing here is production-ready.

**A disclosed limit (PLAN.md §13, D-5).** Some requests ask for things the app cannot do,
and the assistant does not decline all of them. It declines roughly **half**, executes none
of them, and asks a clarifying question for the rest — measured at 50.0% on the reference
fixture and between 41% and 47% on the pilot, against a ~70% target.

The cause is known and is a lesson for adopters rather than a bug: a declared limit is
reached by *similarity*, so generic boundaries — "questions about anything else" — do not
resemble the questions they are meant to catch. Every mechanism tried against this is
measured in PLAN.md §7.2 (WP-39, WP-40), and the practical guidance is in
[FIELD-NOTES.md §5](adapter/FIELD-NOTES.md). The ceiling is accepted and stated here, not
hidden.

## Installing it, and the license

An adopter **copies one folder**, [`adapter/`](adapter/), with no package manager, no registry
and no private release ([ADR-018](.claude/decisions/ADR-018.md),
[ADR-021](.claude/decisions/ADR-021.md)). [GETTING-STARTED.md](.MDFiles/GETTING-STARTED.md) has
the steps. The packages under `packages/` are the source that builds it: none is installable
and none is published. It was six tarballs on a GitHub Release until ADR-021; nothing was ever
released, so nobody was on that path.

**Proprietary — all rights reserved.** Use requires a written agreement with the copyright
holder; see [LICENSE](LICENSE).
