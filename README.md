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

> **Adding this to your app?** Start with **[GETTING-STARTED.md](docs/GETTING-STARTED.md)**:
> one page, five steps. Everything below is about how it works and how it is measured.

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
application in [eval/frameworks](eval/frameworks), and is a CI gate. On the reference
fixture (a school portal: 11 capabilities, 3 roles, 2 languages, 69 questions), with no
model:

| | |
|---|---|
| Sent straight to a wrong screen | **0%** — the gate fails on any ([ADR-041](.claude/decisions/ADR-041.md)) |
| Sent straight to the right screen | 70.9% (39 of 55) |
| In-scope questions wrongly refused | 0% |
| Out-of-scope refused | 71.4% (10 of 14) |
| Settled with no model call | 100% of turns reached a decision without one |

**These are an upper bound.** They include the fixture's `knowledge.json`
([ADR-023](.claude/decisions/ADR-023.md)), written against these same questions by the
tool's author.

**When it is not sure, it asks one question rather than guessing.** If one screen leads, it
asks "Are you looking for X?". If two are close, it asks "Do you mean X, or Y?". It never
shows a menu and never names a third screen, because a visitor who has never seen the app
cannot rank unfamiliar names ([ADR-026](.claude/decisions/ADR-026.md)). That costs a tap
more than a perfect guess, but it sends nobody to a wrong place.

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

## The rules

Twenty numbered rules hold for every change, and most are enforced by a test, a CI gate or
a package boundary: **[docs/RULES.md](docs/RULES.md)**. The load-bearing ones:

1. **The registry is the contract.** One declaration generates the route and the thing
   the router selects, so they cannot drift.
2. **The cascade escalates only when it must**, and the model is constrained to a
   shortlist it did not choose. ([ADR-003](.claude/decisions/ADR-003.md))
3. **The application declares its own limits**, and a request outside them is refused by
   retrieval rather than by a model's judgement. ([ADR-009](.claude/decisions/ADR-009.md))
4. **A capability a user cannot reach is absent from the registry they receive**, not
   hidden in it. ([ADR-014](.claude/decisions/ADR-014.md))
5. **The installer never modifies the adopter's source.** It reads their code and writes
   only new, additive artefacts.
6. **The model never computes a number the user sees, never emits SQL, and never
   produces an identifier that is not validated against the registry.**
7. **Nothing on the critical path needs a network**, and nothing a visitor says goes to a
   third party.
8. **Without a model, it never moves a visitor to a wrong screen, and it never acts.**

## Structure

```
adapter/           WHAT AN ADOPTER COPIES — one folder, no package manager, no network
  AGENTS.md        the front door: what to do, and the decisions that are the
                   developer's to make rather than the agent's
  FIELD-NOTES.md   what real applications taught this tool; read before trusting output
  scan.mjs         init / build / doctor / calibrate, in one file, no dependencies
  runtime/         the assistant, already compiled

docs/              GETTING-STARTED.md for adopters, RULES.md for contributors

preview/           THE BENCH — never exported. `pnpm preview`
                   ask and see the whole trace; the real widget on a mock app

packages/          the source that builds the adapter
  generator/       reads an app's source, emits one registry per role   <- the build step
  core-capability/ registry schema, validation, codegen — the contract
  core-intent/     the three-stage router, calibration, eval harness
  core-inference/  swappable LLM + embedding runtimes
  embed/           the widget, as one script tag under a strict CSP
  kit/             init / build / doctor / preview / calibrate

eval/frameworks    the measurement: a fixture app, its golden set and generated output
eval/field-apps    six public apps, ground truth written before the tool ran
tooling/scripts    the CI gates that are not tests
```

**The boundary that matters:** the engine knows nothing about any particular application.
The only application it ever sees is the adopter's, at run time, as declared data it reads
— never as an import ([ADR-018](.claude/decisions/ADR-018.md)).

**Both deliverables are checked by running them.** `pnpm adapter:check` copies `adapter/`
and a fixture application into a scratch directory outside this repository — with no
`node_modules` anywhere above it — and runs `init`, `build` and `doctor` for real, then
fingerprints the application to prove nothing was written into it. `pnpm preview:check`
loads the bench in a headless browser and asserts two turns from the committed golden set.

## Run it

Node 23.6 or newer.

```bash
pnpm install --ignore-scripts    # a fresh clone needs the flag; see CLAUDE.md
pnpm preview                     # the bench: ask, and see why it decided that
pnpm check                       # typecheck + every test + registry validation
pnpm eval:apps                   # generate, calibrate and route over the fixture app
pnpm adapter:build               # rebuild adapter/ after changing packages/
pnpm adapter:check               # prove a copy of it runs with nothing installed
pnpm export:adopter <folder>     # the folder an adopter is handed: adapter/, the docs, the licence, checksums
```

`pnpm preview` is where to start: it serves the real widget on a mock application built
from a generated registry, plus a bench showing the full trace behind every answer.

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

## Where to look

| Question | File |
|---|---|
| How do I add it to my app? | **[GETTING-STARTED.md](docs/GETTING-STARTED.md)** |
| Does this work on an app it has never seen? | **[field-apps/RESULT.md](eval/field-apps/RESULT.md)** · [tutor-app/RESULT.md](eval/tutor-app/RESULT.md) |
| What goes wrong when it meets a real app? | **[adapter/FIELD-NOTES.md](adapter/FIELD-NOTES.md)** |
| What rules does every change follow? | **[docs/RULES.md](docs/RULES.md)** |
| Which of those rules are actually enforced, and where? | [critical-infrastructure.md](.claude/docs/critical-infrastructure.md) |
| Why is it shaped this way? | [.claude/decisions/](.claude/decisions/) — the ADRs |
| How is the code laid out? | [architecture.md](.claude/docs/architecture.md) |
| Working in this repo as an agent? | [CLAUDE.md](CLAUDE.md) |

## Limits, stated plainly

- **It is not production-tested at scale.** It has not been measured on a live deployment
  with real visitors' questions, or field-tested by someone other than its author. Treat
  every accuracy figure above as a measurement on test applications.
- **It declines about half of the requests for things an app cannot do**, unless the
  developer describes what the app cannot do. It carries out none of them, and asks a
  clarifying question for the ones it does not decline. On the reference fixture it
  declines 71.4% with its `knowledge.json`, which is an upper bound.

  The cause is known and is a lesson for adopters rather than a bug: a declared limit is
  reached by *similarity*, so generic boundaries — "questions about anything else" — do not
  resemble the questions they are meant to catch. The practical guidance is in
  [FIELD-NOTES.md §5](adapter/FIELD-NOTES.md).
- **A cheaper assistant is not claimed.** The product is a better way to navigate. How
  often it settles a turn without a model on a large real app has to be measured on that
  app.
- **English and Portuguese only.** It speaks the page's language when that is one of the
  two, and English otherwise.

## Installing it, and the license

An adopter **copies one folder**, [`adapter/`](adapter/), with no package manager, no registry
and no private release ([ADR-018](.claude/decisions/ADR-018.md),
[ADR-021](.claude/decisions/ADR-021.md)). [GETTING-STARTED.md](docs/GETTING-STARTED.md) has
the steps. The packages under `packages/` are the source that builds it: none is installable
and none is published.

**Proprietary — all rights reserved.** Use requires a written agreement with the copyright
holder; see [LICENSE](LICENSE).
