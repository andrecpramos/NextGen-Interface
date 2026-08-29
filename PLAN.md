# PLAN.md — Implementation Plan & Agent Handoff

**Last verified:** 2026-08-29 · **Branch:** `main` · **Commits:** 4 · **Tracked files:** 99
**Progress:** WP-01 ✅ complete — see [§5](#5-measured-results--the-router). Next: **WP-02**.

> **If you are an agent picking this up cold, read this file top to bottom before
> touching anything.** It tells you the goal, the rules you must not break, exactly
> what exists, exactly what does not, and what to build next in what order.
>
> Then read [.ai/architecture.md](.ai/architecture.md) and the ADRs in
> [.ai/decisions/](.ai/decisions/). Those are binding. This file is the schedule;
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
| 1 | `packages/core-*` **never** imports `domain-finance`. Domains register into the engine. | [architecture.md](.ai/architecture.md), enforced by pnpm workspace deps |
| 2 | The model **never computes a number the user sees.** It phrases; code computes. | [ADR-003](.ai/decisions/ADR-003.md) — and a real bug caught by it, see §6 |
| 3 | The model **never emits SQL** and never a raw route. It selects an id + typed slots. | [ADR-007](.ai/decisions/ADR-007.md) |
| 4 | Every model-produced identifier is **validated against the registry** before use. | [ADR-003](.ai/decisions/ADR-003.md) |
| 5 | Policy is **code in the dispatcher**, never prompt text. read→execute, write→confirm, destructive→confirm+undo, unclassified→**refuse**. | [ADR-004](.ai/decisions/ADR-004.md) |
| 6 | Money is **integer minor units + currency code**. Never float. Not once. | [ADR-007](.ai/decisions/ADR-007.md) |
| 7 | Every screen reachable by AI is reachable **without** it. | [ADR-005](.ai/decisions/ADR-005.md) |
| 8 | **The device is the source of truth.** Nothing on the critical path requires network. | [ADR-008](.ai/decisions/ADR-008.md) |
| 9 | Every turn produces a **TurnTrace**. Explainability is a record, never model narration. | [architecture.md](.ai/architecture.md) |
| 10 | Every new capability ships with **≥3 examples** and golden-set entries. | [.ai/coding-standards.md](.ai/coding-standards.md) |
| 11 | Deterministic slot values **always win** over model-extracted ones. | §6, learned the hard way |
| 12 | A routing bug is not fixed until it is a **permanent golden-set entry**. | [.ai/sdlc/testing.md](.ai/sdlc/testing.md) |

---

## 3. Original blueprint → what actually happened

Traceability against the founding prompt. Nothing here is aspirational — "Done" means
verified on disk.

### Documentation & process

| Blueprint asked for | Status | Where |
|---|---|---|
| `.ai/` folder structure | ✅ Done | [.ai/](.ai/) — 27 files |
| `project.md`, `vision.md`, `roadmap.md`, `architecture.md` | ✅ Done | [.ai/](.ai/) |
| `coding-standards.md`, `ui-guidelines.md`, `security.md`, `testing.md`, `deployment.md` | ✅ Done | [.ai/](.ai/) |
| `sdlc/` × 7 phase docs | ✅ Done | [.ai/sdlc/](.ai/sdlc/) |
| `agents/` × 6 role briefs | ✅ Done | [.ai/agents/](.ai/agents/) |
| `decisions/` ADR-001…003 | ✅ Done — **8 ADRs**, not 3 | [.ai/decisions/](.ai/decisions/) |
| SDLC Phase 1 Planning (vision, roadmap, metrics, risks) | ✅ Done | [roadmap.md](.ai/roadmap.md) |
| SDLC Phase 2 Requirements (FR + NFR) | ✅ Done — IDs assigned, testable | [sdlc/requirements.md](.ai/sdlc/requirements.md) |
| SDLC Phase 3 Design (ERD, sequence diagrams, nav flow) | ✅ Done | [sdlc/design.md](.ai/sdlc/design.md) |
| SDLC Phase 4–7 (dev, test, deploy, maintain) | ✅ Documented, ⛔ not executed | [.ai/sdlc/](.ai/sdlc/) |

### Architecture — the five AI layers

| Layer | Blueprint | Status |
|---|---|---|
| 1 · Conversation (voice, text, history) | required | ⛔ **Not built** |
| 2 · Intent Recognition | required | ✅ **Built & measured at 1B** — `packages/core-intent` |
| 3 · Action (intent → execution) | required | ⛔ **Not built — no package exists yet** |
| 4 · Navigation (AI controls routing) | required | ⛔ **Not built — no package exists yet** |
| 5 · Knowledge (domain intelligence) | required | ⛔ Not built |

### Tech stack

| Blueprint proposed | Decision | Why |
|---|---|---|
| Flutter + Riverpod + GoRouter | ❌ **Rejected** | [ADR-006](.ai/decisions/ADR-006.md) — no Dart experience; TS monorepo instead |
| Drift / Isar | ❌ **Rejected** | [ADR-007](.ai/decisions/ADR-007.md) — Drizzle; SQLite reasoning kept |
| Local-first, no backend | ⚠️ **Amended** | [ADR-008](.ai/decisions/ADR-008.md) — backend exists, device stays source of truth |
| llama.cpp / ONNX inference | ✅ Accepted, ⛔ not built | via Ollama / llama.rn / WebGPU |
| Whisper STT + Piper TTS | ✅ Accepted, ⛔ not built | |
| Gemma 3 1B / Qwen 2.5 1.5B | ✅ **Tested — WP-01** | `qwen2.5:1.5b` selected; `gemma3:1b` rejected. [FINDINGS Part II](packages/core-intent/eval/FINDINGS.md) |
| Registry-based AI navigation | ✅ Accepted, ⚠️ partially built | schema exists; codegen does not |

### MVP roadmap

| | Blueprint scope | Status |
|---|---|---|
| **MVP 1** — prove AI navigation | chat, local LLM, intent, AI routing, finance CRUD | ~15% — router only, now validated at 1B |
| **MVP 2** — voice + analytics | Whisper, Piper, spending analytics | 0% |
| **MVP 3** — coaching + domain #2 | goals, predictions, second domain | 0% |

---

## 4. What exists right now (verified)

```
NextGen_Interface/
├── .ai/                       27 docs, 8 ADRs          ✅ COMPLETE
├── apps/
│   ├── web/                   EMPTY
│   ├── mobile/                EMPTY
│   └── desktop/               EMPTY
├── packages/
│   ├── core-intent/           863 lines                ✅ IMPLEMENTED
│   │   ├── src/               cascade · stages · embedder · slots · text · config · registry
│   │   └── eval/              200-entry golden set · evaluate · calibrate · inspect · compare · 9 scorecards
│   ├── core-capability/       5 lines                  ⬜ scaffold
│   ├── core-trace/            5 lines                  ⬜ scaffold
│   ├── core-inference/        5 lines                  ⬜ scaffold
│   ├── core-voice/            5 lines                  ⬜ scaffold
│   ├── domain-finance/        5 lines                  ⬜ scaffold
│   ├── data/                  5 lines                  ⬜ scaffold
│   └── ui/                    5 lines                  ⬜ scaffold
├── services/api/              4 lines                  ⬜ empty by design (ADR-008)
├── infrastructure/            dirs only
├── tooling/                   eslint-config · tsconfig
└── PLAN.md                    this file
```

**Toolchain:** Node 25.1.0 · pnpm 11.1.2 · git 2.51.2 · Ollama with `llama3.1:8b`,
`qwen2.5:1.5b`, `gemma3:1b` + `nomic-embed-text`. All 11 workspace packages resolve.

### Known gaps in the scaffold itself

1. **No package owns the dispatcher, action engine, navigation engine, or query
   engine.** [architecture.md](.ai/architecture.md) specifies all four; the scaffold
   has nowhere to put them. Fixed by **WP-03**.
2. **`core-intent` is JavaScript, not TypeScript.** It works and is fully measured,
   but it is the only untyped package. Fixed by **WP-02**.
3. **Several `.ai/` docs contain Dart examples** — `coding-standards.md`,
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
- [ADR-003](.ai/decisions/ADR-003.md) status: provisional → **Accepted**, with three
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

### WP-02 · Port `core-intent` to TypeScript

**Goal:** The engine is the one untyped package. Types are the enforcement mechanism
for Rules 2, 6, and 11.

**Depends on:** WP-01 ✅ — **unblocked, this is the next work package.**

**Steps**
1. Rename `src/*.js` → `.ts`, add types
2. Define the core types properly:
   - `Utterance`, `ScreenContext`, `Outcome` (discriminated union:
     `Navigate | Answer | Perform | Clarify | OutOfScope`)
   - `Capability`, `ParamSpec`, `CapabilityKind`
   - **`DeterministicParams` and `ModelParams` as distinct types** so they can only
     merge one way — this makes Rule 11 a compile error instead of a code review
3. **Stop typing stage-3 confidence as a usable score** (WP-01 Finding 8). Model
   self-report is near-constant at 1B. Either name the field for what it is
   (`selfReportedConfidence`) and gate on something else, or drop it from the gate
   entirely. Do not let `number` imply "calibrated".
4. Keep `eval/*.js` runnable throughout — the golden set is the regression net
5. Add `vitest` unit tests for `slots.ts` (dates, money, enums) — currently untested
   in isolation

**Acceptance**
- `pnpm --filter @nextgen/core-intent typecheck` passes with `strict`
- `pnpm router:eval` produces **identical** scorecard numbers to before the port
- Unit tests cover: month boundaries, leap years, DST, number words, currency
  mismatch, negative amounts

---

### WP-03 · `core-capability` — registry schema + codegen

**Goal:** The contract between engine and domains. **Everything else depends on this.**

**Depends on:** WP-02

**Also fixes scaffold gap #1** — this WP creates `packages/core-dispatch` for the
dispatcher, action, navigation, and query engines, which currently have no home.

**Build**
1. `defineCapability()` — typed builder replacing Dart's `@Capability` annotation
2. Registry loader + validator (fail loudly on: missing examples, unclassified kind,
   duplicate triggers, route/param mismatch)
3. **Codegen** producing, from one source:
   - route table for the app router
   - `capabilities.json` for the intent engine
   - precomputed embedding index
4. `similarityAudit()` promoted from `core-intent` — registry health check for CI
5. **New package `core-dispatch`:** dispatcher with the ADR-004 policy table,
   `NavigationEngine` (validates routes against registry), `QueryEngine` interface
   (id + typed slots, never SQL), undo journal interface
6. **Decide the out-of-scope mechanism and write the ADR** (WP-01 Finding 7). There is
   currently no working out-of-scope detection on target hardware. Candidates: a fitted
   stage-2 rejection classifier over (top score, margin, entropy) — Finding 2 only ever
   tested a single scalar cut; a dedicated binary in-domain classifier at stage 2.5; or
   accept misroutes and make recovery trivial in the UI. The 1.5B model's 151ms p95
   leaves ample budget for a second pass.

**Acceptance**
- A capability defined in one place produces both a working route and a routable
  intent — they cannot drift
- Unclassified `kind` → dispatcher **refuses** (test this explicitly)
- Out-of-scope ADR written, mechanism implemented, and measured on `qwen2.5:1.5b` —
  not on the 8B, which is the mistake WP-01 caught
- Registry validation runs in CI and fails on a capability with <3 examples
- `eval/registry.json` regenerated from real definitions, golden set still passes

---

### WP-04 · `data` — Drizzle schema + migrations

**Goal:** Persistence for the finance domain, per [ADR-007](.ai/decisions/ADR-007.md).

**Depends on:** WP-03

**Build** — entity model is already specified in
[.ai/sdlc/design.md](.ai/sdlc/design.md):
`Account`, `Transaction`, `Category` (tree, `parentId`), `Budget`, `TurnTrace`, `DataRef`

1. Drizzle schema targeting SQLite; same definitions must compile for Postgres
2. Migrations via Drizzle Kit + **a migration test from every prior schema**
3. Repository implementations behind interfaces the domain declares
4. `QueryEngine` implementation — the fixed parameterised query set
5. Recursive CTE for category roll-up (food ⊇ groceries + restaurants + coffee)
6. Seeded fixtures: ~500 synthetic transactions over 18 months, **fixed seed**

**Acceptance**
- `amountMinor` is `integer` everywhere; a `real`/`float` money column fails review
- All timestamps UTC
- Category roll-up returns correct aggregates against fixtures
- Migration from v1→v2 preserves all rows; failure restores backup
- **No real financial data in fixtures, including your own**

---

### WP-05 · `core-trace` — TurnTrace

**Goal:** Explainability from a record, not narration (Rule 9).

**Depends on:** WP-03, WP-04

**Build:** the `TurnTrace` type from [architecture.md](.ai/architecture.md) —
transcript, `decidedAt`, scored candidates, model+prompt versions, outcome, `dataRead`,
per-stage latency, `undoToken`. Encrypted store, ring buffer, export.

**Acceptance**
- 100% of turns produce a trace, including failures and out-of-scope
- Trace contains **zero** model-generated prose
- "Why did you do that?" renders entirely from the record
- `dataRead` lists tables, row counts, date ranges

---

### WP-06 · `core-inference` — runtime adapters

**Goal:** One interface, swappable runtimes. This is the mitigation for the ADR-006
mobile-inference risk — if `llama.rn` fails, only this package changes.

**Depends on:** WP-01, WP-02

**Build**
- `LlmRuntime` interface: `complete(prompt, schema, opts)` with constrained decoding
- `EmbeddingRuntime` interface
- Adapters: `OllamaRuntime` (extract from `core-intent/src/stages.js`),
  `LlamaRnRuntime` (mobile), `WebGpuRuntime` (web), **`FakeRuntime` (tests)**
- Model lifecycle: download, **SHA-256 verify before load, fail closed**, idle unload
- **Default model is `qwen2.5:1.5b` at `topK: 3`** (WP-01). `topK` is a property of
  the *model*, not the encoder — carry it in the runtime config next to the model id,
  the way thresholds travel with the encoder.

**Acceptance**
- `core-intent` no longer talks to Ollama directly — it takes a runtime
- Integration tests run against `FakeRuntime`, no network, deterministic
- Timeout + fallback on every call; model-missing degrades to stages 1–2
- Constrained decoding is mandatory — plus a parse-failure fallback, because it is
  **not** an absolute guarantee (measured 0.7% failure rate)

---

### WP-07 · `domain-finance`

**Goal:** The first domain. Proves the engine is domain-agnostic.

**Depends on:** WP-03, WP-04

**Build:** entities, use cases (one thing each; emit domain events rather than
reaching sideways), repository interfaces, and ~20 capability definitions matching
`eval/registry.json`.

**Acceptance**
- Zero imports from `domain-finance` into any `core-*` package
- Every capability: kind classified, params typed, ≥3 examples
- All MVP-1 CRUD reachable by intent **and** by conventional navigation

---

### WP-08 · `ui` — design system

**Depends on:** WP-05

**Build:** sphere state machine (8 states, visually distinct, `confirming` ≠
`thinking`), confirmation card showing **parsed params, editable in place**, trace
viewer, chart components, Tailwind theme with light/dark parity.

**Acceptance:** WCAG 2.2 AA · 48dp targets · 4.5:1 contrast · 200% text without
clipping · `prefers-reduced-motion` honoured · live regions announce state.

---

### WP-09 · `apps/web` — the assistant surface

**Goal:** First working app. Fastest path to a usable product.

**Depends on:** WP-03, WP-05, WP-06, WP-07, WP-08

**Build:** Next.js App Router, assistant as the landing surface, conventional nav
underneath (Rule 7), routes generated from the registry, Ollama for inference (local
dev), Zustand for turn state.

**Acceptance:** the MVP-1 scripted set completes end-to-end; every turn explainable
from its trace; every screen reachable without the AI.

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
Remove the stack-note warning from [.ai/project.md](.ai/project.md) when done.

---

### WP-12 · CI/CD

**Depends on:** WP-02, WP-03

GitHub Actions per [.ai/deployment.md](.ai/deployment.md): typecheck · lint ·
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
WP-02 (TS port) ─── WP-03 (capability + dispatch) ─┬─ WP-04 (data) ─┬─ WP-07 (domain)
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
| **No out-of-scope detection on target hardware** | **high** | **OPEN — new.** Stage 2 can't (either encoder); stage 3 can't at 1B. Mechanism + ADR owed by WP-03 (Finding 7) |
| **`tauAct` reads a signal small models don't produce** | medium | **OPEN — new.** Gate held 15.7% of calls on 8B, 0.7% on 1.5B. Replace self-report with margin or stage-2/3 agreement (Finding 8) |
| Golden-set gates are not run-to-run deterministic | medium | **OPEN — new.** 7/200 entries flipped between identical 8B runs at temp 0. WP-12 must gate on tolerances (Finding 10) |
| Mobile inference via `llama.rn` inadequate | high | Untested — WP-10 gate; mitigated by adapter interface. Desktop headroom is now large (151ms p95 at 1.5B), which helps but does not settle it |
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

# router
pnpm router:inspect      # score distributions, recall@k — always look here first
pnpm router:calibrate    # threshold sweep — NEVER hand-tune thresholds
pnpm router:eval         # full cascade vs golden set; exit 0 only if all gates pass

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
| What are we building, and what will we not build? | [.ai/vision.md](.ai/vision.md) |
| How do the layers fit together? | [.ai/architecture.md](.ai/architecture.md) |
| Why is the router three stages? | [ADR-003](.ai/decisions/ADR-003.md) |
| Why TypeScript and not Flutter? | [ADR-006](.ai/decisions/ADR-006.md) |
| How is a destructive action prevented? | [ADR-004](.ai/decisions/ADR-004.md) |
| What did the router actually score, and why? | [eval/FINDINGS.md](packages/core-intent/eval/FINDINGS.md) |
| Which stage-3 model, and why not the other one? | [FINDINGS.md Part II](packages/core-intent/eval/FINDINGS.md) · [ADR-003](.ai/decisions/ADR-003.md) |
| Why is there no out-of-scope detection? | [FINDINGS.md Finding 7](packages/core-intent/eval/FINDINGS.md) — unresolved, owed by WP-03 |
| What are the numbered requirements? | [.ai/sdlc/requirements.md](.ai/sdlc/requirements.md) |
| How do I test a non-deterministic router? | [.ai/testing.md](.ai/testing.md) |
| What does the entity model look like? | [.ai/sdlc/design.md](.ai/sdlc/design.md) |
