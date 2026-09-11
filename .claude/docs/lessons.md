# Lessons — mistakes this repo has already made

> **Audited against the tree:** 2026-09-09
> Harvested from [PLAN.md](../../PLAN.md) §6 and from session work since.

Each entry is a real defect, what it cost, and the durable lesson. They are here
because **a bug without its lesson recorded gets reintroduced by the next person
who has the same good idea.**

## How a lesson gets enforced

Writing a lesson down is the weakest form of enforcement. In descending order of
strength:

1. **A gate** — the mistake cannot be committed.
2. **A type** — the mistake cannot be expressed.
3. **A `postEdit` reminder** — the lesson is delivered *at the moment of
   temptation*, when the file in question is being edited. Configured in
   [`sdlc.config.json`](../sdlc.config.json).
4. **This document** — read only by someone who already suspects a problem.

When adding a lesson, push it up this list as far as it will go. A lesson that
stays at level 4 will be re-learned.

---

## L1 · Thresholds are an artefact of the encoder, never a constant

**What happened.** `tauHigh` was guessed at 0.62. TF-IDF cosine similarity on this
corpus maxes out at 0.572 — so the threshold was *above the achievable ceiling*.
Every single turn escalated to the next stage. Accuracy: **10.4%**.

**Why it was hard to see.** The number looked reasonable. Nothing was broken;
there was no exception, no failing test. It was a plausible constant that happened
to be unreachable for this encoder.

**The lesson.** A similarity threshold has no meaning independent of the encoder
that produces the scores. Changing encoder invalidates every threshold. **Calibrate
per encoder; never hand-set, never copy between encoders.**

**Enforcement:** Rule 14 — **now a gate.** `tooling/scripts/check-thresholds.mjs`
compares the shipped operating point in `config.ts` against the calibration output
in `eval/scorecards/thresholds-<kind>.json` and fails on any divergence, in CI.

The gap it closes is precise: `pnpm router:calibrate` writes its recommendation to
a file **nothing reads at run time** — the shipped thresholds are hand-transcribed
literals. So the exact edit the rule forbids was also the edit nothing would
notice. A `postEdit` reminder on `packages/core-intent/eval/**` still fires at the
moment of temptation, which is the cheaper half of the defence.

---

## L2 · Deterministic values must win over model-extracted ones

**What happened.** Param spread order was reversed. The model answered "last month"
as *30 days back*; that value overwrote the correctly parsed calendar month.

**The fix.** `{ ...model, ...deterministic }` — deterministic last, so it wins.

**The lesson.** When a deterministic parser and a model both produce a value for
the same slot, the deterministic one is authoritative **always**. The spread order
encodes a correctness property, and it reads like a style choice.

**Enforcement:** Rule 11 — `convention`. **No test asserts this.** Reversing the
spread today would pass every gate. That is a live gap.

---

## L3 · Test design is part of the system

**What happened.** `forbidKinds` asserted on utterances that genuinely *did*
request deletion. Three false safety violations — the system was correct, the test
was wrong.

**The fix.** Split the assertion: *gate-holds* (the policy blocked it) versus
*never-selected* (the capability was never a candidate). Two different claims that
had been conflated into one.

**The lesson.** A safety test that cannot distinguish "correctly refused" from
"never considered" produces false alarms, and false alarms get suppressed. When a
safety test fails, suspect the test's model of the world before suspecting the
system.

---

## L4 · Domain membership is semantic, not lexical

**What happened.** Stage-2's `tauFloor` was used to decide out-of-scope. There was
**no feasible operating point on either encoder** — no threshold separated
in-domain from out-of-domain, because the distinction is not one of similarity
magnitude.

**The fix.** An `__out_of_scope__` sentinel evaluated at stage 3.

**The lesson.** "Is this request about this domain at all?" is a different question
from "which capability is closest?", and a distance threshold cannot answer it.
When no threshold works on any encoder, the question is wrong, not the number.

---

## L5 · A guard that fires on documentation gets disabled

**What happened.** The first `guard-git.mjs` blocked its own documentation. A
`SKILL.md` being written with `cat > file <<'EOF'` contained the words
`git push origin main` inside the heredoc, and the guard saw a production push.

Later the same session, the improved guard denied the command that was *testing*
it: `echo '{"command":"git add -A"}' | node guard-git.mjs` is not a broad stage,
but the matcher saw the words.

**The fix.** Strip heredoc bodies and `echo`/`printf` arguments before matching —
both are data this shell never executes.

**The lesson.** A guard's false-positive rate determines whether it survives. One
that blocks legitimate work gets removed within a day, and then it protects
nothing. **Precision matters more than coverage for anything that denies.**

**Enforcement:** 16 hook cases in the test suite, including both false positives.

---

## L6 · A gate can pass while checking nothing

**What happened.** The CI step "Registry artefacts are current" ran
`pnpm registry:build` — which builds **domain-modules** — and then diffed
`packages/domain-finance/generated/*`, files that build never writes. Two of its
three paths passed unconditionally. It was green for weeks while real drift in the
authoritative domain went ungated.

**Fixed.** The step now diffs `packages/domain-modules/generated/*`. The comment
above it records what it used to diff and why, so the next person to touch the
paths knows what the trap looked like. The underlying `OUT_INTENT` shared-path
collision is *not* fixed — a third domain forces that issue.

**The lesson.** A job name is marketing; the `run:` lines are the truth. **A gate
nobody has seen fail is a gate nobody knows works.** Make every new gate fail on
purpose once, and record that you did.

**Enforcement:** the "Gates seen failing on purpose" table in
[critical-infrastructure.md](critical-infrastructure.md). Still mostly empty,
which is the honest state.

---

## L7 · Enforcement layers that do not exist

**What happened.** [../sdlc/branching.md](../sdlc/branching.md) listed CI's
`guard-production` job as the repository-level enforcement layer for the branching
contract. Branch protection returns **403 — unavailable on a private repository on
this plan.** The job fails the run and prevents nothing.

**The lesson.** "CI checks it" and "CI *blocks* it" are different claims, and only
the second requires branch protection. Verify which one you have before writing
either down. Everything in this repo is enforced by policy plus local hooks — and
the hooks bind agents, not humans.

---

## L8 · Shell heredocs mangle content

**What happened.** Writing a regex-bearing `.mjs` file through a bash heredoc
stripped the backslashes, producing `replace(/\/g, '/')` — a syntax error. It
happened twice in one session, the second time after the lesson was already known.

**The lesson.** Use the file-writing tool for documents and for any code
containing regexes, backslashes, or `$`. Heredocs are for short, literal text.

---

## L9 · Output fields compete for attention like instructions do

**What happened.** WP-36 added an `explanation` field to the generator's prose
prompt — the one already producing `description` and `examples` for every screen.
The explanations came out fine. **Top-1 routing accuracy fell from 54.5% to
47.2%** on the pilot target, with nothing else changed: the *other two fields* got
worse, and the margin over the incumbent command palette collapsed from +9.0
points to +1.7.

**Why it was hard to see.** The change looked additive. WP-14 had already produced
the neighbouring lesson — *"one instruction alone; the rest into field
descriptions"* — and it was followed: the system message still carried a single
instruction, and the new field went into the schema exactly as that lesson
prescribes. The lesson had been read as being about the *system message*. It is
about the *completion*. Nothing in the diff suggested the two existing fields
would degrade, and nothing would have caught it except re-running the measurement.

**Fixed.** Two build-time calls per screen: routing prose in one, the served
explanation in the other. Build time is cached and paid once; routing accuracy is
paid on every turn by every user, so the trade is not close.

**The lesson.** **Adding a field to a working prompt is a change to the fields
already in it.** Treat it the way you would treat editing them — measure before
and after — and prefer a second call over a third field whenever the fields serve
different consumers. Here one is read by an embedder and one by a person, which
was the tell.

**Enforcement:** level 4 — written down only. `evaluate-golden.mjs` would catch a
recurrence, but nothing runs it automatically, and no gate compares top-1 across a
prompt change.

## L10 · A stateful object shared across a loop, and the measurement that died of it

**What happened.** `HashingEmbedder` is TF-IDF: `fit(corpus)` **replaces** its
vocabulary, IDF weights and dimensionality — instance state, not a pure function.
Every `eval/fut-app` harness created **one** embedder and passed it to
`loadRegistry` ten times, once per role. Each call re-fitted it. Nine of the ten
registries ended up holding vectors computed in a vector space that no longer
existed, and the query was embedded in the tenth. The scores were noise.

**What it cost — and this is why it earns an entry.** That harness produced
*"`hashing` gets **4.0%** recall@1 against `nomic-embed-text`'s 48.9%"*, which
[MEASUREMENT.md](../../eval/fut-app/MEASUREMENT.md) called **"the most
consequential finding in the run"**. It was the evidence that the zero-dependency
encoder "does not survive scale". It rewrote WP-24, it demoted the offline story,
and it was cited in the README, the write-up and the business case.

Fitted correctly, on the same registries and the same questions:

| | recall@1 | recall@5 |
|---|---|---|
| `hashing` — as measured by the broken harness | 4.0% | 11.4% |
| `hashing` — one embedder per registry | **50.0%** | **75.6%** |
| `nomic-embed-text` | **50.0%** | 73.3% |

The two encoders are **indistinguishable at recall@1**, and the zero-dependency
one is slightly *better* deeper in the ranking.

**Why it was hard to see.** The bug is invisible unless you are looking for it,
for three compounding reasons:

1. **It only affects the stateful encoder.** `nomic-embed-text` is a stateless
   HTTP call, so the control arm was never wrong. The encoder under suspicion was
   the only one being broken by the instrument.
2. **A twelvefold gap is exactly what you expect to see.** "TF-IDF loses badly to
   a neural encoder at scale" is a completely plausible result. It confirmed a
   prior, so nobody asked the instrument a second question.
3. **The repo already knew.** `apps/cli/src/app.ts` constructs a *second*
   embedder for module search with the comment *"sharing one with the router
   would mean each `.fit()` call stomps the other's fitted vocabulary (relevant
   only to the hashing embedder; the neural one is stateless)"*. The knowledge
   existed, in a comment, three directories away from the code that needed it.

**The durable lesson.** *A measurement that confirms what you expected is the one
to re-derive from a second direction.* This surfaced only because a scale study
built the corpus independently — fitting each subsample itself — and produced
45% where the harness said 4%. Two paths to the same number is the cheapest
protection there is, and it is the only reason this was caught at all.

The secondary lesson is narrower and older: **a stateful object handed to a loop
is a bug waiting for a second iteration.** `fit()` should arguably return a new
fitted encoder rather than mutating one — a shape that cannot be misused.

**Enforcement:** level 3 — `eval/fut-app/load-registries.mjs` is now the single
place that loads registries, it constructs one embedder per registry, and its
header says why. Nothing *prevents* a new harness from calling `makeEmbedder`
once and looping; that would need either an API change to `fit()` or a lint rule.
**Level 4 for the general case**, and the general case is the one that bit.

---

## L11 · An entry point that exists is not one that loads

**What happened.** WP-26 added `@nextgen/core-intent/browser` because the root export
imports `node:fs`. `check-packaging.mjs` confirmed the entry was declared and its file
was present. Nothing ever *loaded* it without Node. When WP-29 did, inside a V8 context
holding only `window`, it failed twice:
- `embedder.ts` imported the `core-inference` root, and through `model-store.ts` that
  reaches `node:crypto`, `fs` and `path`.
- `config.ts` and `ollama.ts` read `process.env` at module scope, which throws
  `process is not defined` on the first line a page runs.

**Why it was hard to see.** Every consumer that existed ran in Node, Next's server bundle
or vitest, and all three provide `process`. A module-scope read also looks like a
constant, not like a call that can throw.

**The durable lesson.** *Test an artefact in the environment it claims, not the one you
develop in.* A browser entry is proven by running it with only a browser's globals, not
by a manifest check.

**Enforcement:** level 1. `packages/embed/src/embed.test.ts` runs the built bundle in a
bare `vm` context on every `pnpm -r test`, so either import pattern returning breaks the
suite.

---

## L12 · A report cannot mention what the tool never saw

**What happened.** The generator's skip report exists so that nothing is dropped
silently (Rule 7's reasoning). On an app we do not own (WP-28), discovery found **1 of
8** routes, and the report listed **0** skips. `lazy: () => import()`, paths read from a
constants table and a tsconfig alias each made a route unreadable. Discovery then
`continue`d past it, *before* the code that records skips.

**Why it was hard to see.** A report of zero skips reads as "nothing to report". On
`fut-app`, where the generator was built, every route was the readable shape.

**The durable lesson.** *The branch that gives up has to record why, at the moment it
gives up.* A skip ledger kept downstream of the point where input can be lost is a
completeness claim with a hole where the failures are.

**Enforcement:** level 1 for these shapes. `discover-data-router.test.ts` asserts both
the reading and that an unevaluable path lands in `unreadable-route`. Level 4 for any
new `continue` added to discovery.

---

## Adding a lesson

Add an entry when a bug's cause was **not locally obvious** — when someone
competent would make the same mistake again. Not every bug qualifies; a typo does
not.

Each entry needs: what happened, why it was hard to see, the durable lesson, and
**the enforcement level it reached**. If it stayed at level 4, say so — that is
the signal that it will recur.
