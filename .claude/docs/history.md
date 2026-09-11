# Build history — what was built, and what it cost to learn

**Moved out of PLAN.md on 2026-09-08.** PLAN.md had grown to 1,205 lines, ~640 of
which were retrospectives of finished work. That made the ~40 lines of *open* work
hard to find, which is the opposite of what a plan is for. The retrospectives are
here, unabridged, because the reasoning in them is still load-bearing — several of
these sections explain why a mechanism is shaped the way it is, and an agent that
changes that mechanism without reading them will re-make a decision that was already
paid for.

**This file is history. It is not a schedule and it is not binding.**

- For what to build next: [PLAN.md](../../PLAN.md) §0 and §7.
- For the rules you must not break: [PLAN.md](../../PLAN.md) §2.
- For the findings you must not reintroduce: [PLAN.md](../../PLAN.md) §6 — those stayed
  in PLAN.md deliberately, because they are consulted while writing new code.
- For the decisions that produced this architecture: [decisions/](../decisions/).

Statements of present-tense fact in these sections were true **when the work package
closed**, and some have since been superseded — WP-07's "the first domain, the
product" most of all. Where a later work package changed something, the section says
so inline. Do not read a "✅ Built" here as a claim about the tree today; check
[PLAN.md](../../PLAN.md) §3 and §4 for that.

**Contents**

| | Work package | Closed |
|---|---|---|
| WP-01 | Validate a 1B model | 2026-08-29 |
| WP-02 | Port `core-intent` to TypeScript | 2026-08-29 |
| WP-03 | `core-capability` + `core-dispatch` | 2026-08-29 |
| WP-04 | `data` — schema, migrations, query engine | 2026-08-29 |
| WP-05 | `core-trace` — TurnTrace | 2026-08-30 |
| WP-06 | `core-inference` — runtime adapters | 2026-08-30 |
| WP-07 | `domain-finance` | 2026-08-30 |
| WP-08 | `ui` — design system | 2026-08-30 |
| WP-09 | `apps/web` — the assistant surface | 2026-08-30 |
| WP-12 | CI/CD | 2026-08-30 |
| WP-13 | Voice (folded into WP-14) | 2026-08-31 |
| WP-14 | Pivot the registered domain to modules | 2026-08-31 |
| Appendix | Original blueprint → what actually happened | — |

---

## Completed work packages

### WP-01 · Validate a 1B model ✅ **COMPLETE — 2026-08-29**

**Goal:** Determine whether a phone-class model can do stage-3 work at all.

**Outcome: it can.** `qwen2.5:1.5b` at `topK: 3` reaches **84–86% top-1** on
direct+paraphrase against the 8B's 90%, runs **6× faster** (151ms p95 vs 941ms), and
records zero safety violations. The stop-criterion (<~70% ⇒ redesign) was not triggered.
`gemma3:1b` was tested and **rejected**: 73%, and it never emits the out-of-scope
sentinel.

**Delivered**
- Scorecards for both 1B models, plus a same-session 8B baseline, in
  [eval/scorecards/](../../packages/core-intent/eval/scorecards/)
- [FINDINGS.md Part II](../../packages/core-intent/eval/FINDINGS.md) — Findings 7–10
- [ADR-003](../decisions/ADR-003.md) status: provisional → **Accepted**, with three
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

**One definition, three artefacts** — four were intended; see the correction below.
`capabilityDocument()` is the piece that matters:
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
[ADR-004](../decisions/ADR-004.md) rule 3 already stated, in prose, where no code could
read it.

**So the registry declares it.** A new kind, `unsupported`, describes a class the app
deliberately does not serve, with an authored refusal, no route and no params. It is
retrieved by the same machinery as everything else, gated by a calibrated
`boundaryMargin`. Out-of-scope becomes routing. **This is the mechanism `domain-modules`
also uses (§ WP-14) — it carries over unchanged to a domain neither WP-03 nor ADR-009
had in mind, which is itself evidence the mechanism is domain-agnostic.**

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

**Goal:** Persistence for the finance domain, per [ADR-007](../decisions/ADR-007.md).

**Built:** `Account`, `Transaction`, `Category` (tree), `Budget`, `TurnTrace`,
`DataRef` and `undo_journal`; repositories behind the interfaces the domain declares;
the fixed query set; the undo journal; and seeded fixtures. 51 tests.

**[ADR-010](../decisions/ADR-010.md) — money, finally decided.** WP-02 left three
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
million in a two-decimal currency. **Extended in WP-14** with the `Module` /
`ModuleEntry` / `ModuleCategory` tables, built from the same `spec.ts` → dialect
pattern.

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

**Built:** the `TurnTrace` type from [architecture.md](architecture.md); a recorder
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
17 cascade integration tests. **Extended in WP-14**: `LlmRuntime.complete()` accepts an
optional `images` array (base64, no data-URI prefix) so a capture with a photo can go
straight to a vision-capable model — no separate OCR step.

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
on *every* load, not only after download. **`core-voice`'s `assets.ts` (WP-14) reuses this
same download/verify/rename-into-place discipline for whisper.cpp and Piper's binaries and
voice models, rather than reinventing it.**

**A found bug, in the tests rather than the code.** The cascade integration fixture
inherited the production `boundaryMargin` of 0.105 and produced a false refusal: on a
five-capability toy registry every real capability scores exactly 0.000, so any nonzero
boundary score wins. `boundaryMargin` is an artefact of the **registry** as well as the
encoder — [ADR-009](../decisions/ADR-009.md) now says so, and a domain that adds
capabilities must re-calibrate. **This is exactly what WP-14 hit for real**, not in a
test fixture: moving from finance's 27-capability registry to modules' 7-capability one
required a fresh calibration pass, done in the 0719ca5 follow-up commit.

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
reproduces 80.0% top-1 / 98.2% param exactness / 60.0% out-of-scope / 0 safety violations
— **against the finance registry this was measured on.** See §5 for why the modules-registry
numbers are still an open item.

---

### WP-07 · `domain-finance` ✅ **COMPLETE — 2026-08-30** (now the reference domain)

**Goal:** The first domain. Proves the engine is domain-agnostic.

**Built:** entities and repository **ports**; domain events with an `EventBus`; use
cases (`createTransaction`, `updateTransaction`, `deleteTransaction`, `setBudget`,
`deleteBudget`, `createAccount`, `watchBudgets`); and the capability definitions from
WP-03. 34 tests.

⚠️ **Status update, WP-14:** the composition root no longer registers this domain by
default — `domain-modules` is registered instead (§1). This package is unchanged in
itself and still fully tested; its job changed from "the product" to "the proof that a
second domain doesn't require touching `core-*`."

> ⚠️ **Corrected 2026-09-09.** This section used to say `apps/cli` can still run it
> directly. **It cannot.** No workspace package depends on `@nextgen/domain-finance`, and
> `apps/cli` neither imports nor registers it — so the regression check this package
> exists for is **not currently executable**. See PLAN.md §4's dead-weight register.

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

**The sign lives here**, which is what [ADR-010](../decisions/ADR-010.md) §2 said the
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
[ADR-012](../decisions/ADR-012.md); [ui-guidelines.md](ui-guidelines.md) carries
the pointer. Every *structural* rule in that document survived and is implemented.
Tailwind, suggested above, was rejected in the same ADR — the tokens are the design
system and a utility layer over them adds a build dependency and no expressiveness.

**The sphere** is 8 states distinguished by **form first**: a body in orbit
(`thinking`), four still corner brackets (`confirming`), amplitude rings
(`listening`), an inward ripple (`transcribing`), an outward pulse (`acting`), synced
bands (`speaking`), a broken rim with a strike (`error`), slow breathing (`idle`).
Colour is the second channel, never the first — which is what makes the
`prefers-reduced-motion` fallback carry the same information with the animation off.

✅ `listening` / `transcribing` / `speaking` were **implemented but unreachable** until
voice was wired. **WP-14 wired voice — these states are live now**, not still gated.

**Acceptance:** 48px targets enforced in `.ngx-btn`/`.ngx-nav`; both
themes' text pairs checked ≥ 4.5:1 at the point the token is defined; type scale in
`rem` and no fixed-height text boxes, so 200% does not clip; `prefers-reduced-motion`
kills every animation and transition; `SphereStatus` is an `aria-live` region and the
sphere carries `role="img"` with its state in the label. **Not yet verified with a
real screen reader or an automated axe pass** — that is the honest gap.

---

### WP-09 · `apps/web` — the assistant surface ✅ **COMPLETE — 2026-08-30**, extended WP-14

**Built:** Next.js 15 App Router + React 19 + Zustand. `apps/web` is a second surface
over the *same* composition root (`NextGenApp`, renamed from `FinanceApp` in WP-14) as
the CLI — it does not reimplement the assembly, which was the whole premise.

```
app/            layout · page · Assistant (client) · modules/{page,[id]/page} · globals.css
app/api/        session · turn · confirm · navigate
                modules/capture · voice/{transcribe,speak}      — Node runtime, the engine lives here
lib/            engine · render · store · wire · voice · extract
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
getter, a `query` getter and `snapshot()`. The CLI's tests still pass.

**Two renderers, one engine.** `#read` in the CLI returns padded text; `lib/render.ts`
returns a headline, a caption and rows with bars. Both read `SqliteQueryEngine`, which
stays the only thing allowed to compute a number the user sees (Rule 2). The cost is
that an `execute` turn queries twice — once inside `turn()` for the trace's `dataRead`,
once for the view. It is microseconds against in-memory SQLite; the fix, if it ever
matters, is to hoist `#read` into a shared package.

**Ollama is probed, not assumed** (ADR-008). With it: a teal dot and `local`. Without
it: `hashing` embedder, stages 1–2 only, and an amber dot reading `no model`. A
degraded router is a real product; an error page is not.

**Navigation simplified — 2026-08-30.** The first cut carried a 232px domain rail
(Finance / Agenda / Health), a "will not do" list and a permanent strip of live-figure
tiles. All three are gone. Pre-built modules are weight on every turn, and the tiles
in particular made the assistant read as a dashboard with a chat box attached — the
inversion [ui-guidelines.md](ui-guidelines.md) opens by rejecting. What replaced
them:

- **An off-canvas drawer**, one control in the status bar, listing every `navigate`
  capability read from the registry. Costs nothing in the layout until asked for,
  which is [ADR-005](../decisions/ADR-005.md)'s "secondary in placement and visual
  weight" taken literally.
- **`invoke(capabilityId)`** and `POST /api/navigate` — the drawer hands a
  capability id straight to the dispatcher. ⚠️ **This is deliberate, not an
  optimisation.** Routing a sentence the menu generated would put the model back on
  the one path built to be free of it and inherit the top-1 misses. Menu
  selections resolve in ~1ms and cannot be misrouted. **Policy is untouched** — a
  `write` from the menu still raises a confirmation card, because policy attaches to
  the capability's kind, never to how the user arrived.
- **First-turn example prompts** instead of tiles: registry-sourced, gone after the
  first turn. Discoverability is a first-turn problem, so it gets a first-turn element.

**Still open (some inherited unchanged from before WP-14, one new):** no automated tests
in `apps/web` covering the API contract; `module.capture` and `module.search` still
lack dedicated screens under `/modules/new` and `/modules/search` (§4 gap 5) — capture
in particular currently only runs through the assistant surface's turn flow, not a
form; routes generally are tracked (`app.route`, returned on every turn) rather than
fully screened.

---

### WP-12 · CI/CD ✅ **COMPLETE — 2026-08-30**

Built by a concurrent session: [.github/workflows/ci.yml](../../.github/workflows/ci.yml)
(branch guard · typecheck · tests · registry · boundaries · golden-set floor · CVE
scan), [check-import-boundaries.mjs](../../tooling/scripts/check-import-boundaries.mjs) and
[check-scorecard.mjs](../../tooling/scripts/check-scorecard.mjs). Reasoning in
[ADR-011](../decisions/ADR-011.md) and [ci-cd.md](../sdlc/ci-cd.md).

⚠️ **Lint is deliberately absent**, not forgotten — there is no ESLint dependency
anywhere, so a lint job would wrap a no-op and report green. The root `lint` and
`build` scripts were removed for the same reason. The `tooling/eslint-config` stub
that used to hold the place was deleted in WP-37.

⚠️ **The CVE gate has gone red twice**, both fixed with `pnpm-workspace.yaml`
overrides (not `package.json`, where pnpm 11 silently ignores them): `postcss` when
WP-09 landed Next 15 — that one genuinely via the workspace override — and `adm-zip` in
the WP-14 follow-up commit (0719ca5), which was actually fixed by bumping the direct
dependency in `core-voice/package.json`: the `package.json` route this paragraph claims
does not work. Corrected 2026-09-07.

Original scope, for the record:

**Depends on:** WP-02, WP-03

GitHub Actions per [.claude/docs/deployment.md](deployment.md): typecheck · lint ·
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

### WP-13 · Voice ✅ **COMPLETE — folded into WP-14, 2026-08-31**

Originally scoped as its own MVP-2 work package (whisper.cpp STT + Piper TTS behind
`core-voice` interfaces, barge-in within 200ms, audio never persisted past
transcription, mic state unmistakable in the UI). It shipped as part of WP-14 instead
of separately — see WP-14 below for what was actually built. The acceptance criteria
below are carried forward from the original scope and **have not been individually
re-verified against the shipped code** the way, say, WP-09's confirm-flow security
boundary was — that verification is still owed, distinct from WP-11's doc-only debt:

- [ ] Barge-in cancels playback within 200ms — not measured
- [ ] Audio is never persisted past transcription — not audited
- [ ] Mic state is unmistakable in the UI — `Sphere`'s `listening`/`transcribing`/
      `speaking` states exist and are wired (WP-08, WP-14), not separately reviewed
      for this criterion

---

### WP-14 · Pivot the registered domain to modules; wire voice ✅ **COMPLETE — 2026-08-31**

**Goal (as executed, not as separately planned — there was no ADR or PLAN entry ahead
of this work):** replace the fixed, developer-defined finance capability surface with
one where the user tells the AI what to remember and it organizes arbitrary content
into modules at runtime — and, in the same pass, wire the voice interfaces WP-13 had
left as a scaffold.

**Built**

- **`packages/domain-modules`** — entities (`Module`, `ModuleEntry`, `ModuleCategory`),
  repository ports, an `EventBus`, and **7 capabilities**: `module.capture` (write),
  `module.list` / `module.search` (read/navigate), `module.delete` / `module.revert`
  (destructive), plus 2 `unsupported` boundary entries (`live_data`, `automation`) per
  ADR-009's mechanism. Deliberately small, matching WP-03's warning that a growing
  registry erodes stage-2 margins.
- **The capture pipeline** (`use-cases.ts`) — split into `proposeCapture` (async, calls
  a *second*, larger local model — `llama3.1:8b` by default, distinct from the
  router's `qwen2.5:1.5b` — to read/summarize/judge, writes nothing) and
  `commitCapture` (sync, deterministic, runs only after the user approves the
  resulting confirmation card). Same "model phrases, never computes" discipline as
  `domain-finance`, applied to a harder job: deciding *what something means* and
  *whether it belongs with something already saved*, not just extracting a date.
- **Vision input** — a capture with images routes to a vision-capable model via the
  new `images` param on `LlmRuntime.complete()` (WP-06 extension); no separate OCR
  step.
- **`packages/core-voice`**, actually implemented — whisper.cpp STT, Piper TTS,
  on-demand binary/model download with SHA verification (`assets.ts`, reusing WP-06's
  `ModelStore` discipline), **4 tests** — all on the asset store; `whisper.ts` and
  `piper.ts` have none. (Corrected 2026-09-07: "108" was the test file's line count.)
- **`apps/web`**: `/modules` and `/modules/[id]` pages; `/api/modules/capture`,
  `/api/voice/transcribe`, `/api/voice/speak`; voice and capture wiring in
  `Assistant.tsx`, `Composer.tsx`, `ConfirmationCard.tsx`.
- **The composition root renamed** `FinanceApp` → `NextGenApp` and registers
  `@nextgen/domain-modules` by default. `domain-finance`'s 34 tests still pass in
  isolation. **Corrected 2026-09-09:** it was described here as "stays registrable" — it
  is not wired into any composition root, so the swap is asserted rather than exercised.

**Findings from building the capture pipeline** — logged in §6: schema field order
(`body` must come before `title`/`summary` or a small model shortchanges it),
system-prompt instruction stacking (one instruction alone beats several competing for
attention), and a token budget sized for routing being wrong for writing content.

**Gates passed at merge:** import boundaries, typecheck (15/15 packages), tests
(295/295 at merge; **301/301 across 11 files**, measured 2026-09-07), `registry:check`.

**What it left open**

- ~~**No ADR.**~~ **Closed 2026-09-09** — [ADR-013](../decisions/ADR-013.md) retroactively
  records this pivot alongside the repositioning it was itself superseded by.
- **The golden set had to be rebuilt from scratch** (follow-up commit 0719ca5): the
  registry regenerated against modules capabilities but the golden set still asserted
  finance capability ids, so the regression gate failed hard (top-1 0.408 → 0.000)
  until an 81-entry modules-specific golden set was written and both encoders'
  thresholds recalibrated. **A real `calibrate.js` bug was found in the process** — the
  boundary-margin sweep's "never refuse in-domain" check filtered on `expect.capability`
  and silently skipped the entire `ambiguous` bucket (those entries assert an outcome,
  not a capability), so a margin of 0 was passing only because nothing was checking it.
- ~~**The full qwen2.5:1.5b cascade hasn't been re-measured against the new
  registry**~~ **Closed 2026-09-09 (WP-17)** — re-measured warm, both `qwen2.5:1.5b`
  and `llama3.1:8b`; see PLAN.md §5 and FINDINGS.md Finding 12.
- **No screens for `module.capture`/`module.search`** (§4 gap 5).
- **Docs left behind**: `.claude/docs/vision.md`, `.claude/docs/project.md`, `apps/web/README.md`,
  `core-voice/README.md` (§4 gap 4, WP-11). `README.md` was rewritten and `SETUP.md`
  deleted on 2026-09-07.

---


---

## Appendix — original blueprint → what actually happened

Traceability against the founding prompt, as recorded when the pivot landed.

Traceability against the founding prompt. Nothing here is aspirational — "Done" means
verified on disk.

### Documentation & process

| Blueprint asked for | Status | Where |
|---|---|---|
| `.claude/docs/` folder structure | ✅ Done | [.claude/docs/]() — 36 files (24 docs + 12 ADRs) |
| `project.md`, `vision.md`, `architecture.md` | ✅ Done, and **re-verified against the repositioning 2026-09-10** (WP-11). `roadmap.md` deleted 2026-09-10, its two surviving parts moved to [§ Sprint 0](#sprint-0-and-the-original-success-metrics) below | [.claude/docs/]() |
| `coding-standards.md`, `ui-guidelines.md`, `security.md`, `testing.md`, `deployment.md` | ✅ Done | [.claude/docs/]() |
| `sdlc/` × 7 phase docs | ✅ Done | [.claude/sdlc/](../sdlc/) |
| `agents/` × 6 role briefs | ✅ Done | [.claude/roles/](../agents/) |
| `decisions/` ADR-001…003 | ✅ Done — **12 ADRs**, not 3. **A 13th is owed** for the WP-14 pivot | [.claude/decisions/](../decisions/) |
| SDLC Phase 1 Planning (vision, roadmap, metrics, risks) | ⚠️ Superseded — `roadmap.md` deleted 2026-09-10 (it planned a Flutter build and a `git init`). PLAN.md §0/§7 is the roadmap and §9 the risk register; the **metrics** and Sprint 0's gate are kept [below](#sprint-0-and-the-original-success-metrics) | PLAN.md · §Sprint 0 |
| SDLC Phase 2 Requirements (FR + NFR) | ✅ Done — IDs assigned, testable | [sdlc/requirements.md](../sdlc/requirements.md) |
| SDLC Phase 3 Design (ERD, sequence diagrams, nav flow) | ✅ Done | [sdlc/design.md](../sdlc/design.md) |
| SDLC Phase 4–7 (dev, test, deploy, maintain) | ✅ Documented, ⛔ not executed | [.claude/sdlc/](../sdlc/) |

### Architecture — the five AI layers

| Layer | Blueprint | Status |
|---|---|---|
| 1 · Conversation (voice, text, history) | required | ✅ **Built** — text WP-08/09, voice WP-14 (whisper.cpp STT + Piper TTS, `packages/core-voice`) |
| 2 · Intent Recognition | required | ✅ **Built & measured at 1B** — `packages/core-intent`. Re-pointed at the modules registry in WP-14; the full qwen2.5:1.5b cascade against that registry isn't re-measured yet (§5) |
| 3 · Action (intent → execution) | required | ✅ **Built** — `core-dispatch` policy + `data`'s `QueryEngine`/`UndoJournal`, exercised by both domains |
| 4 · Navigation (AI controls routing) | required | ◐ **Engine built, surface missing.** `NavigationEngine` resolves a route from the registry and refuses rather than emitting a broken URL — that part is real and tested. But **no browser navigation exists in the turn path**: `NextGenApp` assigns the result to `this.route`, the API echoes it, and no client code reads it. A `navigate` turn renders the chat message "Opened Modules." and the URL never changes. Corrected 2026-09-07; this row previously read ✅ Built |
| 5 · Knowledge (domain intelligence) | required | ◐ **Started — WP-15 (this branch).** `relatedModules()`: embedding-similarity links between saved modules, surfaced passively on the module detail page. Narrower than the blueprint's "budgeting heuristics" framing (written for finance) — for modules, Layer 5 means connecting what the user has saved, not computing a heuristic over it |

**Persistence** (not an AI layer, but everything above needs it): ✅ `packages/data` — schema, migrations, the fixed query set, undo journal, seeded fixtures; extended in WP-14 with `Module`/`ModuleEntry`/`ModuleCategory` tables alongside the finance ones.

### Tech stack

| Blueprint proposed | Decision | Why |
|---|---|---|
| Flutter + Riverpod + GoRouter | ❌ **Rejected** | [ADR-006](../decisions/ADR-006.md) — no Dart experience; TS monorepo instead |
| Drift / Isar | ❌ **Rejected** | [ADR-007](../decisions/ADR-007.md) — Drizzle; SQLite reasoning kept. **Built in WP-04**, on `node:sqlite` |
| Local-first, no backend | ⚠️ **Amended** | [ADR-008](../decisions/ADR-008.md) — backend exists, device stays source of truth |
| llama.cpp / ONNX inference | ✅ **Interface built — WP-06** | Ollama live; `llama.rn` / WebGPU declared, gated by WP-10 / WP-09 |
| Whisper STT + Piper TTS | ✅ **Built — WP-14** | whisper.cpp + Piper behind `core-voice`, with on-demand model/binary download and SHA verification (`assets.ts`) |
| Gemma 3 1B / Qwen 2.5 1.5B | ✅ **Tested — WP-01** | `qwen2.5:1.5b` selected for the *router*; `gemma3:1b` rejected. [FINDINGS Part II](../../packages/core-intent/eval/FINDINGS.md). WP-14 adds a second, larger model (`llama3.1:8b` by default) for module-capture judgment — a different job from routing, see WP-14 below |
| Registry-based AI navigation | ✅ **Built — WP-03** | `defineCapability()` + codegen; route and intent generated together |

### The pivot itself — traced

| What the blueprint assumed | What actually happened |
|---|---|
| One domain (finance), a second domain later as an architecture exam (MVP 3) | The "architecture exam" domain (modules) shipped in WP-14 and *replaced* finance as the default — not an addition, a swap |
| Domain #2 proves the engine without changing the product | Domain #2 **is** the product now; finance was kept specifically to keep proving the engine, inverting the original relationship |
| An architectural pivot this size gets an ADR before or during the change | It didn't. Owed as ADR-013 (§1, §9) |

### MVP roadmap

| | Blueprint scope | Status |
|---|---|---|
| **MVP 1** — prove AI navigation | chat, local LLM, intent, AI routing, finance CRUD | ✅ **Complete — 2026-08-30** |
| **MVP 2** — voice + analytics | Whisper, Piper, spending analytics | ◐ Voice done (WP-14, folding in WP-13). "Spending analytics" was written for finance and has no modules equivalent as specified |
| **MVP 3** — coaching + domain #2 | goals, predictions, second domain | ◐ Domain #2, in spirit — modules — shipped early and became the primary domain (WP-14), not through the finance-coaching path this row assumed |

**These three MVPs were sequenced for a finance-only roadmap, and the sequencing no
longer matches what shipped** — voice and "domain #2" both landed together via WP-14,
for a different reason (the product pivot) than either row anticipated. Read this
table as a record of the original plan, not the current one. The current one is §7's
work-package list and §8's sequence.

---

### Sprint 0 and the original success metrics

`.claude/docs/roadmap.md` was deleted 2026-09-10 (WP-11): it planned a Flutter build
[ADR-006](../decisions/ADR-006.md) rejected, and a `git init` that had already happened.
Two things in it were not dead, and are preserved here because **numbers still being
cited today are scored against them**.

#### Sprint 0 exit criteria, and WP-01's result

Written before any code, as the gate on the whole architecture — *"if these fail, the
architecture changes before code is written, not after."* Measured 2026-08-29 in
[FINDINGS Part II](../../packages/core-intent/eval/FINDINGS.md):

| Exit criterion | Result | |
|---|---|---|
| ≥65% of the golden set resolved at stages 1+2 | 30% | ❌ — a corpus artefact, see FINDINGS Part I |
| Stage-3 top-1 ≥85% on the remainder, 1–1.5B model | 86% on direct+paraphrase, 80% overall | ⚠️ met on the realistic buckets only |
| p95 < 2s end to end on desktop | 151ms | ✅ by an order of magnitude |

The architecture did not change, and the reasoning is in FINDINGS' WP-01 verdict:
ADR-003's *cascade* held at 1B, and what failed was narrower — the two places the design
delegated a judgement to the model's own competence (*is this in scope?*, *how sure am
I?*). Both were later replaced with something structural.

#### The success metrics, with their measurement definitions

The blueprint's targets. The definitions are the reason these were ever checkable:

| Metric | Target | How it was to be measured |
|---|---|---|
| Actions completed via AI | 90% | trace: outcomes reached without the user touching conventional nav |
| Intent recognition latency | p95 < 2s | trace `latency`, per stage, on the reference device |
| Navigation depth | < 3 steps | trace: screens between utterance and outcome |
| Manual navigation reduction | 80% | conventional-nav taps per session vs. a control build |
| Router top-1 accuracy | ≥ 90% | golden set, run in CI on every commit |
| Wrong-action rate (write ops) | < 0.5% | golden set + confirmation-rejection rate in traces |
| **Model-free resolution rate** | **≥ 65%** | share of turns decided at stage 1 or 2 |

⚠️ **The last row is the ancestor of the kill criterion that triggered.** PLAN.md's D-4
asks what the product is now that model-free resolution measured **2.4%** on a real
146-page application — against a threshold this table set at 65% before a line of the
router existed, and which PLAN.md later relaxed to 60%. It has never been met: 30% at
WP-01, 2.4% at WP-33. That is the single most consistent negative result in the project,
and it is worth knowing it was pre-committed rather than invented afterwards.

The original risk register that sat beside these is superseded by PLAN.md §9, which
carries the live risks with their current status.

---

