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

> **Adding this to your app?** Start with **[GETTING-STARTED.md](GETTING-STARTED.md)**: one page,
> five steps. Everything below is about how it was built and measured.

## Does it work?

Measured on a real 146-page application it was never designed for, against a registry
no human wrote — and measured on **what an adopter installs**: the script tag, routing in
the browser with no model, against the app's own command palette, like for like
([like-for-like.json](eval/fut-app/like-for-like.json)):

| 176 real questions | Script tag, no model | The app's own command palette |
|---|---|---|
| Right screen shown first | **53.4%** | 42.6% |
| Right screen among what is shown (at most 3) | **69.9%** | 45.5% |
| Portuguese — the app's own language | **72.4%** | 37.1% |
| Guardians — infrequent users | **75.0%** | 18.8% |
| English | **65.0%** | 61.7% |
| Sent straight to a wrong screen | **0%** | — |

**It beats the incumbent by offering, not by deciding.** The script tag navigates on its
own for only **1.7%** of questions. For almost everything else it shows up to three screens
and the user picks one — a click more than a perfect guess, and it has sent nobody to a
wrong place.

**An earlier headline here, 56.8% vs 45.5%, measured a different configuration:** a server
running `nomic-embed-text` and `llama3.1:8b` to pick one screen. The script tag calls
neither. That run is kept, labelled, in
[MEASUREMENT.md](eval/fut-app/MEASUREMENT.md); it is not what an adopter gets.

**It does not decide for free.** The mechanism meant to settle most turns on its own does
not survive 145 capabilities — and that is settled rather than open: a fixed budget was
spent on every lever anyone had identified ([WP38.md](eval/fut-app/WP38.md)), and an
accepted ADR added a second, non-topical signal on top. With a model they moved the
number from **2.4% to 11.0%** against a 60% target. **The product is a better way to
navigate; a cheaper one is not claimed** until a deployment measures it.

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
packages/
  generator/       reads an app's source, emits one registry per role   <- the build step
  core-capability/ registry schema, validation, codegen — the contract
  core-intent/     the three-stage router, calibration, eval harness
  core-dispatch/   policy table, confirmation, undo, navigation
  core-trace/      TurnTrace records; explainability from a record
  core-inference/  swappable LLM + embedding runtimes
  core-voice/      Whisper STT + Piper TTS adapters
  data/            node:sqlite schema, migrations, repositories
  domain-modules/  reference application — the registered one
  domain-finance/  reference application — proof the engine is domain-agnostic

apps/cli           composition root, and the fastest way to see a turn
eval/fut-app       the measurement: ground truth, golden set, scorecards
tooling/scripts    the CI gates that are not tests
```

**The boundary that matters:** `packages/core-*` never imports an application package.
Applications register *into* the engine. This is now the product boundary — an adopter's
app sits exactly where `domain-modules` sits — and it is gated, not merely intended:
`node tooling/scripts/check-import-boundaries.mjs`.

`domain-modules` and `domain-finance` are **reference applications**, not the product.
They are what the generator is measured against.

## Run it

```bash
pnpm install --ignore-scripts    # a fresh clone needs the flag; see CLAUDE.md
pnpm app                         # the reference app in a terminal
pnpm app:offline                 # stages 1-2 only, no model, no Ollama needed
pnpm check                       # typecheck + 384 tests + registry validation
```

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
| Does this work, and what is the evidence? | **[MEASUREMENT.md](eval/fut-app/MEASUREMENT.md)** |
| What is the plan, and what is next? | [PLAN.md](.MDFiles/PLAN.md) |
| How do I add it to my app? | [GETTING-STARTED.md](GETTING-STARTED.md) |
| How do I run it? | [SETUP.md](.MDFiles/SETUP.md) |
| Why is it shaped this way? | [.claude/decisions/](.claude/decisions/) — 15 ADRs |
| What was already tried, and what did it cost? | [.claude/docs/lessons.md](.claude/docs/lessons.md) |
| What did the router actually score? | [FINDINGS.md](packages/core-intent/eval/FINDINGS.md) · [MEASUREMENT.md](eval/fut-app/MEASUREMENT.md) |
| Working in this repo as an agent? | [CLAUDE.md](CLAUDE.md) |

## Status

The engine is built and measured. The generation works. **The cost model is resolved, and
it resolved against us**: 11.0% of turns settle without a model call, against a 60% target
that was a pre-committed kill criterion and triggered. A fixed budget was then spent trying
to fix it, every lever was measured, and the claim was withdrawn rather than restated —
[PLAN.md](.MDFiles/PLAN.md) §13 D-4 and [WP38.md](eval/fut-app/WP38.md). The numbers are
published rather than buried, which is the point.

Built since then: the browser runtime, guided steps, the installable package, a script tag
that runs under a strict Content-Security-Policy, and the drop-in kit —
`nextgen init / build / doctor / preview / calibrate` ([INSTALL.md](.MDFiles/INSTALL.md)). The kit
reads React Router, Vue Router, Angular, Next.js, Remix, SvelteKit and Nuxt apps, and on six
public apps it had never seen it found every route in ground truth written beforehand and
changed none of their files ([RESULT.md](eval/field-apps/RESULT.md)).

Not done: a live deployment, and a field test by someone other than its author. The owner
runs both. Nothing here is production-ready.

**A disclosed limit (PLAN.md §13, D-5).** Some requests ask for things the app cannot do.
The assistant does not decline all of them. On `fut-app`'s 34 hand-written out-of-scope
requests:
- The browser path, with no model, declines **47.1%**, executes none of them, and asks a
  clarifying question for the rest.
- With a model in the loop, **41.2%** are declined.

The target was ~70%. Every mechanism that was tried is measured in PLAN.md §7.2 (WP-39,
WP-40). The ceiling is accepted and stated here, not hidden.

## Installing it, and the license

Adopters install eight tarballs attached to a GitHub Release. [GETTING-STARTED.md](GETTING-STARTED.md)
has the steps, [INSTALL.md](.MDFiles/INSTALL.md) the full reference, and [CHANGELOG.md](CHANGELOG.md) what each
release contains.

**Proprietary — all rights reserved.** Use requires a written agreement with the copyright
holder; see [LICENSE](LICENSE).
