# PLAN.md — Implementation Plan & Agent Handoff

**Last verified:** 2026-08-30 · **Branch:** `wp-01-1b-validation` · **Tracked files:** 99+
**Progress:** WP-01…WP-09 ✅ · **`apps/web` is the assistant surface, running the whole stack** — see [SETUP.md](SETUP.md).
MVP 1 is functionally complete; **WP-12** (CI/CD) landed alongside it. Next: **WP-11**
(docs cleanup), then MVP 2.

> **If you are an agent picking this up cold, read this file top to bottom before
> touching anything.** It tells you the goal, the rules you must not break, exactly
> what exists, exactly what does not, and what to build next in what order.
>
> Then read [.claude/docs/architecture.md](.claude/docs/architecture.md) and the ADRs in
> [.claude/decisions/](.claude/decisions/). Those are binding. This file is the schedule;
> they are the constitution.

---

## 1. The goal

Build an **AI-native application platform** where conversation is the primary
interface and screens are a rendering layer the AI drives. The user should never need
to know where a feature lives — the capability registry knows, and the AI reads the
registry.

Personal finance is **domain #1**, not the product. The product is the reusable engine
underneath: intent → action → navigation → explanation.

**The real test of success:** how little code domain #2 requires. If adding a CRM
module means changing `packages/core-*`, the architecture has failed.

---

## 2. Non-negotiable rules

Any agent working in this repo must respect these. They are enforced by tests, ADRs,
or package boundaries — breaking them is a defect, not a style choice.

| # | Rule | Where it comes from |
|---|---|---|
| 1 | `packages/core-*` **never** imports `domain-finance`. Domains register into the engine. | [architecture.md](.claude/docs/architecture.md), enforced by pnpm workspace deps |
| 2 | The model **never computes a number the user sees.** It phrases; code computes. | [ADR-003](.claude/decisions/ADR-003.md) — and a real bug caught by it, see §6 |
| 3 | The model **never emits SQL** and never a raw route. It selects an id + typed slots. | [ADR-007](.claude/decisions/ADR-007.md) |
| 4 | Every model-produced identifier is **validated against the registry** before use. | [ADR-003](.claude/decisions/ADR-003.md) |
| 5 | Policy is **code in the dispatcher**, never prompt text. read→execute, write→confirm, destructive→confirm+undo, unclassified→**refuse**. | [ADR-004](.claude/decisions/ADR-004.md) |
| 6 | Money is **integer minor units + currency code**. Never float. Not once. | [ADR-007](.claude/decisions/ADR-007.md) |
| 7 | Every screen reachable by AI is reachable **without** it. | [ADR-005](.claude/decisions/ADR-005.md) |
| 8 | **The device is the source of truth.** Nothing on the critical path requires network. | [ADR-008](.claude/decisions/ADR-008.md) |
| 9 | Every turn produces a **TurnTrace**. Explainability is a record, never model narration. | [architecture.md](.claude/docs/architecture.md), enforced by `core-trace` |
| 10 | Every new capability ships with **≥3 examples** and golden-set entries. | [.claude/docs/coding-standards.md](.claude/docs/coding-standards.md) |
| 11 | Deterministic slot values **always win** over model-extracted ones. | §6, learned the hard way |
| 12 | A routing bug is not fixed until it is a **permanent golden-set entry**. | [.claude/sdlc/testing.md](.claude/sdlc/testing.md) |
| 13 | The application's **limits are declared in the registry**, not left to the model to infer. | [ADR-009](.claude/decisions/ADR-009.md) |
| 14 | Thresholds are **calibrated per encoder**, never hand-set and never copied between encoders. | Findings 1 and 11 — cost accuracy three times |

---

## 3. Original blueprint → what actually happened

Traceability against the founding prompt. Nothing here is aspirational — "Done" means
verified on disk.

### Documentation & process

| Blueprint asked for | Status | Where |
|---|---|---|
| `.claude/` folder structure | ✅ Done | [.claude/](.claude/) — 27 files |
| `project.md`, `vision.md`, `roadmap.md`, `architecture.md` | ✅ Done | [.claude/](.claude/) |
| `coding-standards.md`, `ui-guidelines.md`, `security.md`, `testing.md`, `deployment.md` | ✅ Done | [.claude/](.claude/) |
| `sdlc/` × 7 phase docs | ✅ Done | [.claude/sdlc/](.claude/sdlc/) |
| `agents/` × 6 role briefs | ✅ Done | [.claude/roles/](.claude/roles/) |
| `decisions/` ADR-001…003 | ✅ Done — **12 ADRs**, not 3 | [.claude/decisions/](.claude/decisions/) |
| SDLC Phase 1 Planning (vision, roadmap, metrics, risks) | ✅ Done | [roadmap.md](.claude/docs/roadmap.md) |
| SDLC Phase 2 Requirements (FR + NFR) | ✅ Done — IDs assigned, testable | [sdlc/requirements.md](.claude/sdlc/requirements.md) |
| SDLC Phase 3 Design (ERD, sequence diagrams, nav flow) | ✅ Done | [sdlc/design.md](.claude/sdlc/design.md) |
| SDLC Phase 4–7 (dev, test, deploy, maintain) | ✅ Documented, ⛔ not executed | [.claude/sdlc/](.claude/sdlc/) |

### Architecture — the five AI layers

| Layer | Blueprint | Status |
|---|---|---|
| 1 · Conversation (voice, text, history) | required | ◐ **Text built — WP-08/09.** Voice is WP-13 |
| 2 · Intent Recognition | required | ✅ **Built & measured at 1B** — `packages/core-intent` |
| 3 · Action (intent → execution) | required | ◐ **Dispatcher + policy built** — `core-dispatch`; query/undo impls in WP-04 |
| 4 · Navigation (AI controls routing) | required | ✅ **Built** — `NavigationEngine`, routes generated from the registry |
| 5 · Knowledge (domain intelligence) | required | ⛔ Not built — MVP 3 |

**Persistence** (not an AI layer, but everything above needs it): ✅ `packages/data` — schema, migrations, the fixed query set, undo journal, seeded fixtures.

### Tech stack

| Blueprint proposed | Decision | Why |
|---|---|---|
| Flutter + Riverpod + GoRouter | ❌ **Rejected** | [ADR-006](.claude/decisions/ADR-006.md) — no Dart experience; TS monorepo instead |
| Drift / Isar | ❌ **Rejected** | [ADR-007](.claude/decisions/ADR-007.md) — Drizzle; SQLite reasoning kept. **Built in WP-04**, on `node:sqlite` |
| Local-first, no backend | ⚠️ **Amended** | [ADR-008](.claude/decisions/ADR-008.md) — backend exists, device stays source of truth |
| llama.cpp / ONNX inference | ✅ **Interface built — WP-06** | Ollama live; `llama.rn` / WebGPU declared, gated by WP-10 / WP-09 |
| Whisper STT + Piper TTS | ✅ Accepted, ⛔ not built | |
| Gemma 3 1B / Qwen 2.5 1.5B | ✅ **Tested — WP-01** | `qwen2.5:1.5b` selected; `gemma3:1b` rejected. [FINDINGS Part II](packages/core-intent/eval/FINDINGS.md) |
| Registry-based AI navigation | ✅ **Built — WP-03** | `defineCapability()` + codegen; route and intent generated together |

### MVP roadmap

| | Blueprint scope | Status |
|---|---|---|
| **MVP 1** — prove AI navigation | chat, local LLM, intent, AI routing, finance CRUD | ✅ **Complete** — engine, data, trace, inference, domain, design system and web surface all built and wired |
| **MVP 2** — voice + analytics | Whisper, Piper, spending analytics | 0% |
| **MVP 3** — coaching + domain #2 | goals, predictions, second domain | 0% |

---

## 4. What exists right now (verified)

```
NextGen_Interface/
├── .claude/                       27 docs, 12 ADRs         ✅ COMPLETE
├── apps/
│   ├── cli/                   TypeScript, strict        ✅ COMPOSITION ROOT
│   │   └── src/               app · index · 10 tests — the whole stack, runnable
│   ├── web/                   Next.js 15, React 19       ✅ ASSISTANT SURFACE (WP-09)
│   │   ├── app/               layout · page · Assistant · api/{session,turn,confirm,navigate}
│   │   └── lib/               engine (singleton + pending decisions) · render · store · wire
│   ├── mobile/                EMPTY
│   └── desktop/               EMPTY
├── packages/
│   ├── core-intent/           TypeScript, strict        ✅ IMPLEMENTED
│   │   ├── src/               types · cascade · stages · embedder · slots · text · config · registry
│   │   ├── src/*.test.ts      42 unit tests (dates · money · enums · rules)
│   │   └── eval/              200-entry golden set · evaluate · calibrate · inspect · compare · 9 scorecards
│   ├── core-capability/       TypeScript, strict        ✅ IMPLEMENTED
│   │   └── src/               types · define · validate · codegen · audit · 30 tests
│   ├── core-dispatch/         TypeScript, strict        ✅ IMPLEMENTED (new, WP-03)
│   │   └── src/               policy · dispatcher · engines · 26 tests
│   ├── core-trace/            TypeScript, strict        ✅ IMPLEMENTED
│   │   └── src/               types · recorder · store · explain · 28 tests
│   ├── core-inference/        TypeScript, strict        ✅ IMPLEMENTED (WP-06)
│   ├── core-voice/            5 lines                  ⬜ scaffold
│   ├── domain-finance/        TypeScript, strict        ✅ IMPLEMENTED
│   │   ├── src/               capabilities · entities · events · use-cases · 34 tests
│   │   └── generated/         routes.json · golden.generated.jsonl
│   ├── data/                  TypeScript, strict        ✅ IMPLEMENTED
│   │   └── src/               money · schema/{spec,sqlite,postgres} · migrate
│   │                          repositories · query-engine · undo · fixtures · 43 tests
│   └── ui/                    TypeScript, strict        ✅ DESIGN SYSTEM (WP-08)
│       └── src/               tokens.css · ui.css · Sphere · Composer · Answer
│                              ConfirmationCard · NavDrawer · TracePanel · types
├── services/api/              4 lines                  ⬜ empty by design (ADR-008)
├── infrastructure/            dirs only
├── tooling/                   eslint-config · tsconfig
└── PLAN.md                    this file
```

**Toolchain:** Node 25.1.0 · pnpm 11.1.2 · git 2.51.2 · Ollama with `llama3.1:8b`,
`qwen2.5:1.5b`, `gemma3:1b` + `nomic-embed-text`. All 15 workspace packages resolve.

### Known gaps in the scaffold itself

1. ~~**No package owns the dispatcher, action engine, navigation engine, or query
   engine.**~~ ✅ **Fixed by WP-03** — `packages/core-dispatch` holds the ADR-004
   policy table, `NavigationEngine`, and the `QueryEngine` / `UndoJournal`
   interfaces. The query and undo implementations are WP-04.
2. ~~**`core-intent` is JavaScript, not TypeScript.**~~ ✅ **Fixed by WP-02.** Ported
   under `strict` with `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`;
   Rules 4, 5 and 11 are now compile errors rather than review items. The `eval/`
   harness stays `.js` and imports the `.ts` sources directly via Node's native type
   stripping, so there is still no build step between changing the router and
   measuring it.
3. **Several `.claude/` docs contain Dart examples** — `coding-standards.md`,
   `architecture.md`, `ui-guidelines.md`, and the agent briefs. The architecture they
   describe is language-neutral and correct; only the syntax is stale. Fixed by
   **WP-11**.

---

## 5. Measured results — the router

From [packages/core-intent/eval/FINDINGS.md](packages/core-intent/eval/FINDINGS.md).
Reproduce with `pnpm router:eval`; compare models with `node eval/compare.js`.

### Stage-3 model comparison — WP-01, the decisive run

The question the whole architecture rested on: **can a phone-class model do stage-3
work?** Answer: **yes, if it is `qwen2.5:1.5b` and not `gemma3:1b`.**

| | `llama3.1:8b` | `qwen2.5:1.5b` | `gemma3:1b` |
|---|---|---|---|
| Top-1, direct+paraphrase | 90.0% | **84.0%** | 73.0% |
| Top-1, whole corpus | 82.4% | 78.4% | 67.2% |
| Out-of-scope detected | 85.0% | 30.0% | **0.0%** |
| Turn latency p95 | 941ms | **151ms** | 375ms |
| Safety violations | 0 | 0 | 0 |
| Size | 4.9 GB | 986 MB | 815 MB |

**The stop-criterion was not triggered.** Two results changed the plan, though — both are
mechanisms that worked on the 8B and quietly stop working at 1B:

- **No out-of-scope detection exists on target hardware.** Stage 2 cannot do it (either
  encoder); stage 3 cannot at 1B. `gemma3:1b` never once emitted the sentinel in 140
  constrained calls and answered "what is the capital of France" with `settings.currency`
  at 0.95 confidence. Needs a model-independent mechanism — **new ADR, folded into WP-03**.
- **`TAU_ACT_BY_KIND` no longer catches anything.** It held back 15.7% of stage-3 calls
  on the 8B, 0.7% on `qwen2.5:1.5b`. Small models report high confidence unconditionally.

Everything delegated to *structure* rather than model competence held on every model: the
schema enum (0 hallucinated ids in ~1000 calls), registry validation, the ADR-004 policy
table, deterministic-slot precedence, and adversarial safety at 20/20.

### The 8B harness baseline

| Gate | Target | Measured | |
|---|---|---|---|
| Top-1 capability accuracy | ≥90% | 82.4% | ❌ |
| Param exactness | ≥85% | 98.3% | ✅ |
| Ambiguous → clarify | ≥95% | 43.3% | ❌ * |
| Out-of-scope detected | ≥95% | 90.0% | ❌ |
| Model-free resolution | ≥65% | 30.0% | ❌ * |
| Adversarial → destructive | 0 | **0** | ✅ |
| Turn latency p95 | <2000ms | 964ms | ✅ ** |

\* Both are depressed by test-design artefacts, not only by router quality — see
FINDINGS §"What the number actually means". The golden set is deliberately 35%
un-resolvable-before-stage-3, and the ambiguous bucket conflates two different
requirements.
\*\* Desktop, 8B model. Says nothing about phone-class inference. WP-01 measured that
separately, above.

These are the numbers from the original harness run. A same-config re-run during WP-01
gave 82.4% / 98.3% / 46.7% / **85.0%** / 30.0% / 0 / **941ms** — identical on four gates,
one entry apart on the other two. That variance is real and is Finding 10; do not read any
single run as exact.

---

## 6. Bugs already found and fixed — do not reintroduce these

| Bug | Symptom | Fix | Lesson |
|---|---|---|---|
| `tauHigh` guessed at 0.62; TF-IDF cosine maxes at 0.572 | Every turn escalated; 10.4% accuracy | Calibrate per encoder | **Thresholds are an artefact of the encoder, never a constant** |
| Param spread order reversed | Model answered "last month" as *30 days back*, overwrote correct calendar month | `{ ...model, ...deterministic }` | Rule 11. Enforce with types, not convention |
| `forbidKinds` asserted on utterances that genuinely request deletion | 3 false safety violations | Split assertion: gate-holds vs never-selected | Test design is part of the system |
| Stage-2 `tauFloor` used for out-of-scope | No feasible operating point on **either** encoder | `__out_of_scope__` sentinel at stage 3 | Domain membership is semantic, not lexical |

---

## 7. Work packages

Ordered by dependency. **WP-01 first** — it can invalidate the architecture.

---

### WP-01 · Validate a 1B model ✅ **COMPLETE — 2026-08-29**

**Goal:** Determine whether a phone-class model can do stage-3 work at all.

**Outcome: it can.** `qwen2.5:1.5b` at `topK: 3` reaches **84–86% top-1** on
direct+paraphrase against the 8B's 90%, runs **6× faster** (151ms p95 vs 941ms), and
records zero safety violations. The stop-criterion (<~70% ⇒ redesign) was not triggered.
`gemma3:1b` was tested and **rejected**: 73%, and it never emits the out-of-scope
sentinel.

**Delivered**
- Scorecards for both 1B models, plus a same-session 8B baseline, in
  [eval/scorecards/](packages/core-intent/eval/scorecards/)
- [FINDINGS.md Part II](packages/core-intent/eval/FINDINGS.md) — Findings 7–10
- [ADR-003](.claude/decisions/ADR-003.md) status: provisional → **Accepted**, with three
  claims amended inline
- `eval/compare.js` — side-by-side scorecard comparison; `--topk=<n>` flag on the
  evaluator; per-bucket top-1, per-bucket stage-3 latency and stage-3 health counters
  added to the scorecard

**What it changed for everything downstream**

Two mechanisms this plan assumed were working are model-dependent and stop working at 1B.
Neither blocks WP-02; both must be closed before MVP 1 ships.

1. **Out-of-scope detection does not exist on target hardware** (Finding 7). Stage 2
   cannot do it with either encoder; stage 3 cannot at 1B. Needs a mechanism that does not
   depend on model capability — a fitted stage-2 rejection classifier over (top score,
   margin, entropy), a dedicated binary in-domain classifier, or accepting misroutes and
   making recovery trivial in the UI. **Choose in WP-03 and write the ADR.**
2. **`TAU_ACT_BY_KIND` reads a signal small models do not produce** (Finding 8). Replace
   self-reported confidence with something the model cannot inflate — stage-2 margin, or
   stage-2/stage-3 agreement. **Fold into WP-02's type work and WP-03's dispatcher.**

Also learned, and load-bearing for WP-12: **the gates are not deterministic.** Two
identical 8B runs at temperature 0 flipped 7 of 200 entries. CI must gate on tolerances,
not exact scorecard equality (Finding 10).

---

### WP-02 · Port `core-intent` to TypeScript ✅ **COMPLETE — 2026-08-29**

**Goal:** The engine was the one untyped package. Types are the enforcement mechanism
for Rules 4, 5 and 11.

**Outcome:** ported under `strict`, `noUncheckedIndexedAccess` and
`exactOptionalPropertyTypes`. `pnpm -r typecheck` and `pnpm -r test` are both green
across all 11 workspace packages.

**The point of the exercise — three rules that are now compile errors**

```
error TS2345: Argument of type 'DeterministicParams' is not assignable to
parameter of type 'ModelParams'.
```

That is what you get for writing the merge backwards. `mergeParams(model, deterministic)`
takes two distinct nominal types, so **Rule 11 has exactly one spelling that compiles**.
Verified by deliberately reintroducing the original bug — the one that cost 44 points of
param exactness and passed review — and confirming it no longer builds.

- **Rule 5** — `Capability.kind` is typed `string`, *not* `CapabilityKind`, because the
  registry is data. Narrowing at the boundary would have made ADR-004's "unclassified →
  refuse" path unreachable code and silently deleted the check. `isCapabilityKind()`
  narrows at the point of use instead.
- **Rule 4** — stage 3 returns a capability id only after a registry lookup; an unknown
  id becomes `hallucinatedId` and can never become a route.

**Also done**

- `src/types.ts`: `Utterance`, `ScreenContext`, `Capability`, `ParamSpec`,
  `CapabilityKind`, `TurnTrace`, and the `Outcome` discriminated union from
  architecture.md (`Navigate | Answer | Perform | Clarify | OutOfScope`) with
  `toOutcome()` as the single place the kind → outcome mapping is written down. The
  dispatcher that consumes it is WP-03.
- Stage-3 confidence renamed **`selfReportedConfidence`** throughout. It is not a
  calibrated probability and at 1B it is nearly a constant (Finding 8); the type should
  not imply otherwise.
- 42 vitest unit tests for `slots.ts` — month boundaries, leap years, DST transitions,
  ISO weeks, number words, currency, integer-minor-unit invariants, enum roll-up and
  longest-match, plus Rules 5 and 11 directly.
- `package.json`: `test` is now vitest, and the golden-set floor moved to `eval:floor`.
  A `test` script that always exits 1 by design is a `test` script people stop reading.
  **`pnpm router:eval` now defaults to `qwen2.5:1.5b --topk=3`** — the model WP-01
  selected — with `router:baseline` keeping the 8B for comparison.

**Acceptance — met**

- `pnpm --filter @nextgen/core-intent typecheck` passes under `strict` ✅
- `pnpm router:floor` produces a scorecard **byte-identical** to the pre-port run:
  same gates, same buckets, same stage mix, all 96 failure records unchanged ✅
- Stage-3 path re-verified on `qwen2.5:1.5b`: 80.0% top-1, 98.2% param exactness,
  40.0% out-of-scope, 0 safety violations, 145ms p95 — every figure matching the
  pre-port run within the ±1-entry noise band Finding 10 documents ✅

> **On "identical scorecard numbers":** only `--embedder=hashing --no-stage3` is
> genuinely deterministic, and that is the run used as the regression net. Any run that
> invokes a model cannot be byte-compared — Finding 10 measured 7 of 200 entries
> flipping between two identical 8B runs. Do not read a one-entry bucket change after a
> refactor as a regression.

**Three defects the unit tests found, all in `resolveMoney`, all left as decisions**

Money semantics belong to the domain, not to a domain-agnostic router, so these are
pinned by tests and marked `DECISION OWED` rather than fixed here:

| Input | Result | Problem |
|---|---|---|
| `"-50"` | `+5000` | Leading minus silently dropped — a refund is indistinguishable from a charge |
| `"minus 50 euros"` | `+5000` | `"minus"` is not a number word |
| `"convert 50 euros to dollars"` | `EUR` | First currency wins by declaration order, with no signal to the caller |
| `"12.345"` | `1234` | Truncated, not rounded |

None is exercised by the golden set, which is why they survived. **Owed by WP-04** (which
defines the money column) and **WP-07** (which defines what a transaction amount means).

---

### WP-03 · `core-capability` + `core-dispatch` ✅ **COMPLETE — 2026-08-29**

**Goal:** The contract between engine and domains, and a home for the dispatcher.

**Built**

- **`packages/core-capability`** — `defineCapability()` / `defineBoundary()` /
  `defineRegistry()`; the registry validator; codegen; `similarityAudit()` promoted
  here from `core-intent`. Depends on nothing else in the workspace.
- **`packages/core-dispatch`** (new package, closes scaffold gap #1) — the ADR-004
  policy table as code, `NavigationEngine`, and the `QueryEngine` / `UndoJournal`
  interfaces WP-04 implements.
- **`packages/domain-finance/src/capabilities.ts`** — the 20 finance capabilities as
  real definitions, plus 7 declared limits. `pnpm registry:build` generates
  `eval/registry.json`, `routes.json` and golden fixtures from it.

**One definition, four artefacts.** `capabilityDocument()` is the piece that matters:
it is the exact text stage 2 embeds, and both the runtime loader and the codegen call
it. Previously the loader built that string inline, so any precomputed embedding index
would have had to reimplement it and hope.

**ADR-009 — out-of-scope is declared, not judged**

This is the substantial part, and it closes the largest risk WP-01 opened.

Before choosing, the obvious alternative was measured: Finding 2 had concluded "stage 2
cannot detect out-of-scope" from *a single scalar cut on the top score*. Sweeping five
features (top, margin, mean, entropy, spread) reached **20% recall** — the conclusion
survives the stronger test, and the distributions show why it is not a matter of a
better boundary:

| Utterance | | Top score |
|---|---|---|
| "what's my credit score" | out of scope | **0.637** |
| "transfer 500 to my brother" | out of scope | 0.500 |
| "no not that one" | **in domain** | **0.363** |

Out-of-scope requests to a finance app are mostly *about finance*. What separates the
classes is not what the sentence is about — it is what the application does. Which
[ADR-004](.claude/decisions/ADR-004.md) rule 3 already stated, in prose, where no code could
read it.

**So the registry declares it.** A new kind, `unsupported`, describes a class the app
deliberately does not serve, with an authored refusal, no route and no params. It is
retrieved by the same machinery as everything else, gated by a calibrated
`boundaryMargin`. Out-of-scope becomes routing.

| Stage-3 model | OOS before | after | contributed by the model |
|---|---|---|---|
| `llama3.1:8b` | 85% | 85% | large — its sentinel already worked |
| `qwen2.5:1.5b` | 40% | **60%** | 20 points |
| `gemma3:1b` | **0%** | **40%** | **none — entirely model-free** |

**It helps in exact proportion to how badly the model fails**, which is the property
that makes it safe to depend on. Nothing regressed: `direct` top-1 rose 97.5% → 100%,
`paraphrase` 75.0% → 76.7%, model-free resolution 30% → 35%, safety violations still 0.

⚠️ **Finding 1, for the third time.** `boundaryMargin` was first set to the value
calibrated on `nomic-embed-text` and carried onto the TF-IDF encoder, costing 3.3
points of paraphrase accuracy. Calibrated properly it is **0.105 for TF-IDF and 0.075
for nomic** — `calibrate.js` now sweeps it. Do not hand-set it, and never copy one
between encoders.

**Acceptance — met**

- A capability defined in one place produces a working route **and** a routable intent;
  they are generated together and cannot drift ✅
- Unclassified `kind` → dispatcher **refuses**, tested explicitly across empty,
  misspelled and invented kinds, plus a test that it never defaults to `read` ✅
- Registry validation runs in CI (`pnpm registry:check`) and **fails the build** on a
  capability with <3 examples — verified by breaking one ✅
- `eval/registry.json` regenerated from real definitions; all 20 original capabilities
  round-trip with byte-identical retrieval documents ✅
- 98 unit tests across the three packages; `pnpm -r typecheck` and `pnpm -r test` green ✅

**Still owed**

- The remaining 40–60% of out-of-scope input. Bounded by how well the boundary is
  written, which is tractable — but widening `unsupported.general` against the golden
  set would measure only how well it had been tuned against the golden set, so it was
  deliberately not done.
- Non-English still drifts toward the boundary entries. The margin holds it at zero
  false refusals; the English-only registry is unchanged.
- The precomputed embedding index has a generator but is not yet wired into the runtime
  loader, which still embeds at startup.

---

### WP-04 · `data` — schema, migrations, query engine ✅ **COMPLETE — 2026-08-29**

**Goal:** Persistence for the finance domain, per [ADR-007](.claude/decisions/ADR-007.md).

**Built:** `Account`, `Transaction`, `Category` (tree), `Budget`, `TurnTrace`,
`DataRef` and `undo_journal`; repositories behind the interfaces the domain declares;
the fixed query set; the undo journal; and seeded fixtures. 43 tests.

**[ADR-010](.claude/decisions/ADR-010.md) — money, finally decided.** WP-02 left three
`DECISION OWED` items; this closes them:

- `amountMinor` is a **signed** integer minor unit. Negative leaves the account. The
  alternative — magnitude plus a direction column — makes every aggregate a `CASE`, and
  the one thing that must never be wrong is a sum.
- **The parser keeps returning an unsigned magnitude, and that is now correct on
  purpose.** "twenty euros" and "minus twenty euros" both mean the quantity 20; direction
  belongs to the capability. What was wrong was that it was silent about it.
- **Currency mismatch is refused, never converted.** A rate has a date and a source, and
  a wrong one silently corrupts every historical aggregate that touched it.

**A real bug, found by writing the test:** `fromMajorUnits` computed
`Math.round(value * 100)`. `1.005 * 100` is `100.49999999999999`, so it returned a
cent short — and `+ Number.EPSILON` does not save it, because EPSILON is relative to 1
while the error is at the scale of 100. It now parses the decimal **string** digit by
digit. Passing a *number* still yields whatever the float already holds (`1.005` → 100,
because the literal genuinely is 1.00499999999999989 before the function sees it); both
behaviours are pinned by tests and the README says to pass strings.

**Same definitions, both dialects.** The entity model is written once in
`schema/spec.ts`; `sqlite.ts` and `postgres.ts` are built from it and a parity test
asserts table-for-table and column-for-column agreement. Money is `integer` in SQLite
and `bigint` in Postgres — Postgres `integer` is 32-bit and would overflow at ~21
million in a two-decimal currency.

**Acceptance — met**

- `amountMinor` is `integer` everywhere, asserted **structurally** against the schema
  rather than by review ✅
- All timestamps UTC — the repository refuses a non-`Z` timestamp ✅
- Category roll-up correct against fixtures, including a **three-level** tree that a
  two-level join would silently under-report, and excluding refunds from "spending" ✅
- Migration from every prior version preserves all rows; a failing migration leaves the
  database at the last good version, and the file path restores from backup ✅
- No real financial data in fixtures — all generated from a fixed seed, invented
  merchants ✅

---

### WP-05 · `core-trace` — TurnTrace ✅ **COMPLETE — 2026-08-30**

**Goal:** Explainability from a record, not narration (Rule 9).

**Built:** the `TurnTrace` type from [architecture.md](.claude/docs/architecture.md); a recorder
that cannot be bypassed; an AES-256-GCM encrypted store with a ring buffer and export;
and `explain()`, which renders "why did you do that?" from the record alone. 28 tests.

**Zero model prose, enforced twice.** There is no `setReasoning` on the recorder and no
field on `TurnTrace` a free-text model answer could land in — and because a trace crosses
the storage boundary as a plain object, where types stop, `put()` also rejects
`reasoning`, `explanation`, `rationale`, `modelResponse` and four more at runtime.
Verified against the router: stage 3 requests a `reasoning` field in its schema, and the
cascade never reads it out of the response.

**Every turn produces a trace, including the ones that threw.** The turn runs *inside*
the recorder and the record is written in a `finally`, because the paths that most need a
trace are the ones that failed before reaching the end. Errors are recorded and rethrown.
A turn that never reports an outcome is recorded as `error` — forgetting to say how a
turn ended is not the same as it having gone well.

**The most useful field turned out to be `paramSources`.** For every value the user can
see, the explanation says whether code worked it out, the model read it, or it came from
the screen. That is the question someone checking a number actually has — and after
Finding 3, the one the next developer has too.

**Acceptance — met**

- 100% of turns produce a trace, including failures and out-of-scope ✅
- Trace contains **zero** model-generated prose, enforced by types and again at storage ✅
- "Why did you do that?" renders entirely from the record — no model, no network ✅
- `dataRead` lists tables, row counts and date ranges ✅
- Encrypted at rest with tamper detection; ring buffer; full export ✅

---

### WP-06 · `core-inference` — runtime adapters ✅ **COMPLETE — 2026-08-30**

**Goal:** One interface, swappable runtimes. The mitigation for the ADR-006 mobile-
inference risk — if `llama.rn` fails, only this package changes.

**Built:** `LlmRuntime` and `EmbeddingRuntime`; `OllamaLlmRuntime` and
`OllamaEmbeddingRuntime` (extracted from `core-intent`); `FakeLlmRuntime` and
`FakeEmbeddingRuntime`; `ModelStore` with download, SHA-256 verification and idle
unload; and honest, throwing placeholders for `llama.rn` and WebGPU. 18 tests here plus
17 cascade integration tests.

**`core-intent` no longer contains a single `fetch` call.** Both the chat transport and
the encoder transport moved out, so swapping the runtime on a phone touches nothing in
the cascade. Verified: `grep -rn "fetch(" packages/core-intent/src/` returns nothing.

**The platform runtimes throw rather than pretending.** `new LlamaRnRuntime()` fails with
what has to happen before it can exist. A runtime that silently returned nothing would let
the app appear to work on a platform where inference has never run, and that discovery
belongs in development rather than in a store review.

**Verify before load, fail closed.** A model file is executable weight fetched over a
network, and a truncated download looks identical to a substituted one. Downloads land on
a `.part` file and are renamed into place only after the hash matches, so an interrupted
download cannot be mistaken for a complete one on the next launch. The hash is re-checked
on *every* load, not only after download.

**A found bug, in the tests rather than the code.** The cascade integration fixture
inherited the production `boundaryMargin` of 0.105 and produced a false refusal: on a
five-capability toy registry every real capability scores exactly 0.000, so any nonzero
boundary score wins. `boundaryMargin` is an artefact of the **registry** as well as the
encoder — [ADR-009](.claude/decisions/ADR-009.md) now says so, and a domain that adds
capabilities must re-calibrate.

**Acceptance — met**

- `core-intent` no longer talks to Ollama directly — it takes a runtime ✅
- Integration tests run against `FakeRuntime`: no network, deterministic ✅
  (and deliberately so — Finding 10 makes a suite built on real inference flaky)
- Timeout and fallback on every call; a missing model degrades to stages 1–2 and asks,
  rather than throwing ✅
- Constrained decoding is mandatory in the type — `schema` is required, with no overload
  that omits it — plus the parse-failure fallback Finding 6 requires ✅
- Model lifecycle: download, **SHA-256 verify before load, fail closed**, idle unload ✅

**Behaviour unchanged:** `pnpm router:floor` byte-identical, and `qwen2.5:1.5b --topk=3`
reproduces 80.0% top-1 / 98.2% param exactness / 60.0% out-of-scope / 0 safety violations.

---

### WP-07 · `domain-finance` ✅ **COMPLETE — 2026-08-30**

**Goal:** The first domain. Proves the engine is domain-agnostic.

**Built:** entities and repository **ports**; domain events with an `EventBus`; use
cases (`createTransaction`, `updateTransaction`, `deleteTransaction`, `setBudget`,
`deleteBudget`, `createAccount`, `watchBudgets`); and the 27 capability definitions
from WP-03. 34 tests.

**The dependency edge runs neither way.** The domain declares the ports; `@nextgen/data`
implements them — and because TypeScript is structural, neither package imports the
other's version. `@nextgen/data` is a *dev* dependency here, needed only to assert the
fit. That is stronger than the usual arrangement: a port the adapter imports is a port
the adapter can quietly widen.

**That assertion immediately earned its place.** It failed on first run: `data` typed
`account.type` as `string` while the domain says it is one of four values. Fixed where
rows actually enter — `SqliteAccountRepository.insert` now validates it — so the read
path narrows honestly instead of asserting and hoping.

**Use cases do one thing and emit an event rather than reaching sideways.** `watchBudgets`
is a *subscriber*: recording a transaction does not recompute budgets. The moment it did,
the two aggregates would be welded together and domain #2 would inherit the weld. A
throwing subscriber cannot unmake what already happened, either — the event is a
statement of fact.

**The sign lives here**, which is what [ADR-010](.claude/decisions/ADR-010.md) §2 said the
domain owed: `createTransaction` takes a magnitude and applies direction from the
category's kind. "twenty euros" is the quantity 20; whether it leaves or arrives is a
property of what it was spent on, not of the sentence.

**Acceptance — met**

- **Zero imports from `domain-finance` into any `core-*` package** — asserted
  mechanically, per package, over both source text and declared dependencies ✅
- Every capability: kind classified, params typed, ≥3 examples ✅
- All MVP-1 CRUD reachable by intent **and** by conventional navigation — every
  executable capability has a route (Rule 7) ✅

---

### WP-08 · `ui` — design system ✅ **COMPLETE — 2026-08-30**

**Built:** `packages/ui` — token system (`tokens.css`), component styles (`ui.css`),
and six components: `Sphere` + `SphereStatus`, `Composer`, `Answer`,
`ConfirmationCard`, `NavDrawer`, `TracePanel`.

**Visual language changed.** Material 3 was superseded by a bespoke token system —
"graphite HUD", cyberpunk register **without neon**, Apple design principles. See
[ADR-012](.claude/decisions/ADR-012.md); [ui-guidelines.md](.claude/docs/ui-guidelines.md) carries
the pointer. Every *structural* rule in that document survived and is implemented.
Tailwind, suggested above, was rejected in the same ADR — the tokens are the design
system and a utility layer over them adds a build dependency and no expressiveness.

**The sphere** is 8 states distinguished by **form first**: a body in orbit
(`thinking`), four still corner brackets (`confirming`), amplitude rings
(`listening`), an inward ripple (`transcribing`), an outward pulse (`acting`), synced
bands (`speaking`), a broken rim with a strike (`error`), slow breathing (`idle`).
Colour is the second channel, never the first — which is what makes the
`prefers-reduced-motion` fallback carry the same information with the animation off.

⚠️ `listening` / `transcribing` / `speaking` are **implemented but unreachable** until
WP-13 wires voice. The mic button renders disabled and says so rather than pretending.

**Acceptance:** 48px targets enforced in `.ngx-btn`/`.ngx-nav`; both
themes' text pairs checked ≥ 4.5:1 at the point the token is defined; type scale in
`rem` and no fixed-height text boxes, so 200% does not clip; `prefers-reduced-motion`
kills every animation and transition; `SphereStatus` is an `aria-live` region and the
sphere carries `role="img"` with its state in the label. **Not yet verified with a
real screen reader or an automated axe pass** — that is the honest gap.

---

### WP-09 · `apps/web` — the assistant surface ✅ **COMPLETE — 2026-08-30**

**Built:** Next.js 15 App Router + React 19 + Zustand. `apps/web` is a second surface
over the *same* `FinanceApp` composition root as the CLI — it does not reimplement the
assembly, which was the whole premise.

```
app/            layout · page · Assistant (client) · globals.css
app/api/        session · turn · confirm     — Node runtime, the engine lives here
lib/            engine · render · store · wire
```

**Three things the CLI never needed**, all in `lib/engine.ts`: a singleton (the
database is in-memory, so per-request construction would lose writes), survival across
HMR via `globalThis`, and the **pending-decision table**.

⚠️ **That table is a security boundary, not a cache.** The client is never given a
`Decision`. It gets a card and a `turnId`; the decision stays server-side, and
`/api/confirm` merges the user's *edited values* into the remembered decision and
re-approves it through the dispatcher. A client cannot choose the capability and
cannot skip the card. Verified: replaying a spent `turnId` and forging one both 409.

Three small additions were made to `apps/cli/src/app.ts` to make it reusable —
`registryPath` (a bundler makes `import.meta.dirname` meaningless), a `capabilities`
getter, a `query` getter and `snapshot()`. The CLI's 10 tests still pass.

**Two renderers, one engine.** `#read` in the CLI returns padded text; `lib/render.ts`
returns a headline, a caption and rows with bars. Both read `SqliteQueryEngine`, which
stays the only thing allowed to compute a number the user sees (Rule 2). The cost is
that an `execute` turn queries twice — once inside `turn()` for the trace's `dataRead`,
once for the view. It is microseconds against in-memory SQLite; the fix, if it ever
matters, is to hoist `#read` into a shared package.

**Ollama is probed, not assumed** (ADR-008). With it: a teal dot and `local`. Without
it: `hashing` embedder, stages 1–2 only, and an amber dot reading `no model`. A
degraded router is a real product; an error page is not.

**Verified end-to-end** against a live engine — all four decision types:

| Utterance | Decision | Result |
|---|---|---|
| "how much did I spend on food this month" | execute | €307.24, decided at `llm`, 1018ms |
| "how are my budgets doing" | execute | 1 over budget, decided at `embedding`, 26ms |
| "book me a flight to tokyo" | refuse | declared limit, `embedding`, 23ms |
| "add 12 euros for coffee today" | confirm | card with amount/category/date, all `deterministic` |

The confirm was then approved **with the amount edited** 12.00 → 18.50 and the
category changed: recorded −€18.50 against a month-to-date that moved €1,819.28 →
€1,837.78 across 25 → 26 transactions. The edit path is the one that matters, and it
is exercised.

**Navigation simplified — 2026-08-30.** The first cut carried a 232px domain rail
(Finance / Agenda / Health), a "will not do" list and a permanent strip of live-figure
tiles. All three are gone. Pre-built modules are weight on every turn, and the tiles
in particular made the assistant read as a dashboard with a chat box attached — the
inversion [ui-guidelines.md](.claude/docs/ui-guidelines.md) opens by rejecting. What replaced
them:

- **An off-canvas drawer**, one control in the status bar, listing every `navigate`
  capability read from the registry. Costs nothing in the layout until asked for,
  which is [ADR-005](.claude/decisions/ADR-005.md)'s "secondary in placement and visual
  weight" taken literally.
- **`FinanceApp.invoke(capabilityId)`** and `POST /api/navigate` — the drawer hands a
  capability id straight to the dispatcher. ⚠️ **This is deliberate, not an
  optimisation.** Routing a sentence the menu generated would put the model back on
  the one path built to be free of it and inherit the 20% top-1 misses. Menu
  selections resolve in ~1ms and cannot be misrouted. **Policy is untouched** — a
  `write` from the menu still raises a confirmation card, because policy attaches to
  the capability's kind, never to how the user arrived.
- **First-turn example prompts** instead of tiles: registry-sourced, gone after the
  first turn. Discoverability is a first-turn problem, so it gets a first-turn element.

Verified: `budget.view` / `transactions.list` / `accounts.list` execute at
`deterministic` in 0–10ms; `settings.currency` and `transaction.delete` both come back
as confirmations (the latter `destructive: true`); an unknown id 404s before reaching
the dispatcher. The CSS bundle dropped 22.2 KB → 20.8 KB.

**Still open:** no automated tests in `apps/web` (the API contract is a natural
integration-test target and there is none yet); routes are not yet *navigated* — the
registry's `route` is tracked in `app.route` and returned on every turn, but there are
no per-route screens under `/transactions`, `/budget` etc., so Rule 7's "every screen
reachable without the AI" holds over the drawer — which runs each capability and
renders its answer — rather than over a full screen set.

---

### WP-10 · `apps/mobile` — Expo + on-device inference

**Depends on:** WP-01, WP-09

⚠️ **Highest-risk app work.** Gate it: before building the app, prove `llama.rn` loads
a quantised 1B GGUF and completes 10 stage-3 calls on a **physical mid-range Android**.
Measure first-token latency, peak RSS, thermals. If that fails, fall back to
desktop/web-first and record an ADR.

Then: `op-sqlite` + SQLCipher, model download via Play Asset Delivery (**never
bundled** — 0.9–1.6 GB exceeds the 200 MB cap), app useful before download completes.

---

### WP-11 · Documentation cleanup

**Depends on:** WP-02

Convert Dart examples to TypeScript in `coding-standards.md`, `architecture.md`,
`ui-guidelines.md`, and the six agent briefs. Architecture unchanged — syntax only.
Remove the stack-note warning from [.claude/docs/project.md](.claude/docs/project.md) when done.

---

### WP-12 · CI/CD ✅ **COMPLETE — 2026-08-30**

Built by a concurrent session: [.github/workflows/ci.yml](.github/workflows/ci.yml)
(branch guard · typecheck · tests · registry · boundaries · golden-set floor · CVE
scan), [check-import-boundaries.mjs](tooling/scripts/check-import-boundaries.mjs) and
[check-scorecard.mjs](tooling/scripts/check-scorecard.mjs). Reasoning in
[ADR-011](.claude/decisions/ADR-011.md) and [ci-cd.md](.claude/sdlc/ci-cd.md).

⚠️ **Lint is deliberately absent**, not forgotten — `tooling/eslint-config` has no
`index.js` and no ESLint dependency, so a lint job would wrap a no-op and report
green. The root `lint` and `build` scripts were removed for the same reason.

⚠️ **The CVE gate went red when WP-09 landed**, exactly as `ci-cd.md` predicted:
Next 15 pins `postcss@8.4.31`, which carries two high advisories. Fixed with a
`postcss: ^8.5.26` override in `pnpm-workspace.yaml` — *not* in `package.json`,
where pnpm 11 silently ignores it.

Original scope, for the record:

**Depends on:** WP-02, WP-03

GitHub Actions per [.claude/docs/deployment.md](.claude/docs/deployment.md): typecheck · lint ·
**import-boundary check (Rule 1)** · unit · integration · **golden-set with committed
scorecard diff** · registry validation · CVE scan. Exit non-zero on any gate — the
evaluator already does this.

⚠️ **The scorecard diff must be tolerance-based, not exact** (WP-01 Finding 10). Two
identical 8B runs at temperature 0 flipped 7 of 200 entries; a bucket of 20 cannot
measure a 95% target to better than ±5%. Gate on thresholds with an explicit tolerance
and treat per-entry diffs as advisory, or the pipeline flaps on every run.

Also add a **staleness check**: a committed scorecard whose `config.thresholds` differ
from the current profile in `config.js` is asserting a configuration that no longer
exists. One was found in exactly that state during WP-01 — committed,
plausible, and describing a `tauFloor` the codebase had already abandoned. It went stale
within hours of being written, which is the point: this is not a slow drift you can catch
by eye.

---

### WP-13 · Voice (MVP 2)

**Depends on:** WP-06, WP-09

Whisper STT + Piper TTS behind `core-voice` interfaces. Barge-in cancels within 200ms.
Audio **never persisted** past transcription. Mic state unmistakable in the UI.

---

## 8. Suggested sequence

```
WP-01 (1B model)  ─── ✅ DONE 2026-08-29 — qwen2.5:1.5b selected
   │
WP-02 (TS port) ✅ ─ WP-03 (capability + dispatch) ✅ ┬─ WP-04 (data) ✅ ┬ WP-07 (domain)
   │                         │                     │                │
   └── WP-06 (inference) ────┘                     └─ WP-05 (trace) ┘
                                                            │
                              WP-08 (ui) ───────────────────┴──── WP-09 (apps/web)
                                                                       │
                          WP-11 (docs) · WP-12 (CI) ──────────────────┤
                                                                       │
                                              WP-10 (mobile) · WP-13 (voice)
```

**MVP 1 = WP-01 → WP-09.** MVP 2 adds WP-10 + WP-13. MVP 3 is the second domain —
the architecture's real exam.

---

## 9. Open risks

| Risk | Severity | State |
|---|---|---|
| 1B model cannot route reliably | ~~fatal~~ | ✅ **CLOSED** — `qwen2.5:1.5b` 84% top-1 on realistic buckets, 151ms p95 (WP-01) |
| No out-of-scope detection on target hardware | ~~high~~ | ✅ **CLOSED by [ADR-009](.claude/decisions/ADR-009.md)** — registry declares the app's limits; 0% → 40% on `gemma3:1b`, model-free. Residual: recall bounded by how well the boundary is written |
| **`tauAct` reads a signal small models don't produce** | medium | **OPEN — new.** Gate held 15.7% of calls on 8B, 0.7% on 1.5B. Replace self-report with margin or stage-2/3 agreement (Finding 8) |
| Golden-set gates are not run-to-run deterministic | medium | **OPEN — new.** 7/200 entries flipped between identical 8B runs at temp 0. WP-12 must gate on tolerances (Finding 10) |
| Mobile inference via `llama.rn` inadequate | high | Untested — WP-10 gate. **Mitigation now real:** the adapter interface exists and `core-intent` holds no transport code, so a failure changes one package. Desktop headroom is large (151ms p95 at 1.5B); that helps but does not settle it |
| Model assets (0.9–1.6 GB) vs 200 MB store cap | high | Planned — on-demand delivery from day one. Selected model is 986 MB, at the low end of that range |
| Model-free rate 30% vs 65% target | high | Partly measurement artefact; needs realistic corpus + `ScreenContext` slots |
| Registry growth erodes stage-2 margins | medium | `similarityAudit()` exists; quarterly review documented |
| Backend attracts features, offline erodes | medium | ADR-008 rules; FR-OFF-01 as release gate |
| Injection via stored memos | medium | **Not modelled** — harness tests utterances only |
| Non-English at 40% | medium | Decide: multilingual, or scope MVP to one language and say so. `qwen2.5:1.5b` matches the 8B here (44.4% both) — the ceiling is the English-only registry, not the model |
| Solo-developer capacity | high | Voice deferred to MVP 2, domain #2 to MVP 3 |

---

## 10. Commands

```bash
pnpm install

# the app
pnpm web                 # assistant surface at http://localhost:3000
pnpm app                 # the same stack as a CLI
pnpm app:offline         # stages 1-2 only, no model, no Ollama needed

# registry — one definition, four artefacts
pnpm registry:build      # regenerate registry.json, routes.json, golden fixtures
pnpm registry:check      # validate only; this is the CI gate

# router
pnpm router:inspect      # score distributions, recall@k — always look here first
pnpm router:calibrate    # threshold sweep — NEVER hand-tune thresholds
pnpm router:eval         # full cascade on qwen2.5:1.5b --topk=3 (the selected model)
pnpm router:baseline     # ditto on llama3.1:8b — the historical comparison point
pnpm router:floor        # stages 1+2 only; the ONLY deterministic run, so the regression net
pnpm router:compare      # side-by-side scorecards across models

cd packages/core-intent
node eval/evaluate.js --embedder=hashing --no-stage3       # model-free ceiling
node eval/inspect.js --embedder=ollama "how much on food"  # debug one utterance

# stage-3 model selection (WP-01). --topk is a MODEL knob, not an encoder one.
node eval/evaluate.js --embedder=ollama --model=qwen2.5:1.5b --topk=3
node eval/compare.js ollama-llama3.1_8b ollama-qwen2.5_1.5b ollama-gemma3_1b

# workspace
pnpm -r typecheck
pnpm -r test
```

**Requires:** Ollama serving on `127.0.0.1:11434` with `nomic-embed-text` and a chat
model. `--embedder=hashing` needs nothing. **Warm the model with one throwaway call
before a timed run** — a cold load shows up as a 22-second stage-3 outlier, and run
models sequentially or the latency numbers are meaningless.

---

## 11. Definition of done, per work package

Before marking anything complete:

- [ ] Rules in §2 respected — especially Rule 1 (no `core-*` → domain import)
- [ ] Types compile under `strict`
- [ ] Unit tests written; coverage not reduced
- [ ] New capabilities have ≥3 examples **and** golden-set entries
- [ ] `pnpm router:eval` not regressed; scorecard committed
- [ ] Failure paths implemented, not just the happy path
- [ ] Trace recording verified for any new turn path
- [ ] ADR written if an architectural choice was made
- [ ] Docs updated if behaviour changed

---

## 12. Where to look

| Question | File |
|---|---|
| What are we building, and what will we not build? | [.claude/docs/vision.md](.claude/docs/vision.md) |
| How do the layers fit together? | [.claude/docs/architecture.md](.claude/docs/architecture.md) |
| Why is the router three stages? | [ADR-003](.claude/decisions/ADR-003.md) |
| Why TypeScript and not Flutter? | [ADR-006](.claude/decisions/ADR-006.md) |
| How is a destructive action prevented? | [ADR-004](.claude/decisions/ADR-004.md) |
| What did the router actually score, and why? | [eval/FINDINGS.md](packages/core-intent/eval/FINDINGS.md) |
| Which stage-3 model, and why not the other one? | [FINDINGS.md Part II](packages/core-intent/eval/FINDINGS.md) · [ADR-003](.claude/decisions/ADR-003.md) |
| How is out-of-scope actually detected? | [ADR-009](.claude/decisions/ADR-009.md) · [FINDINGS Finding 11](packages/core-intent/eval/FINDINGS.md) |
| Where does policy get enforced? | [core-dispatch](packages/core-dispatch/README.md) · [ADR-004](.claude/decisions/ADR-004.md) |
| How do I add a capability? | [core-capability](packages/core-capability/README.md), then `pnpm registry:build` |
| What are the numbered requirements? | [.claude/sdlc/requirements.md](.claude/sdlc/requirements.md) |
| How do I test a non-deterministic router? | [.claude/docs/testing.md](.claude/docs/testing.md) |
| What does the entity model look like? | [.claude/sdlc/design.md](.claude/sdlc/design.md) |
