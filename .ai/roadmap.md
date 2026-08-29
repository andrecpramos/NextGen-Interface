# Roadmap

## Sprint 0 — Unblock and de-risk (before any Flutter code)

Flutter is not installed on this machine, and the riskiest assumption in the whole
project is unvalidated. Do both in parallel.

**0.1 Toolchain**
- Install Flutter SDK (stable), Android Studio + SDK, accept licences
- `flutter doctor` clean
- `git init` in `NextGen_Interface` — currently not a repo

**0.2 Router spike — Python/Node against Ollama, no Flutter required**

This can start *today* with the installed `llama3.1:8b`. Build a throwaway harness:

1. Hand-write a 20-capability registry JSON in the schema from
   [architecture.md](architecture.md)
2. Write 150–200 real utterances with expected outcomes (the golden set)
3. Implement all three router stages; measure **accuracy and latency per stage**
4. Answer the go/no-go question: *what fraction of turns can be resolved without
   invoking the LLM at all?*
5. Then re-run stage 3 against a **1B model** (`gemma3:1b` or `qwen2.5:1.5b` via
   Ollama) — 8B success proves nothing about phone-class inference

**Exit criteria:** ≥65% of the golden set resolved at stage 1+2; stage-3 top-1
accuracy ≥85% on the remainder with a 1–1.5B model; p95 end-to-end < 2s on desktop.

If these fail, the architecture changes *before* code is written, not after.

### Measured — 2026-08-29 (WP-01 complete)

| Exit criterion | Result | |
|---|---|---|
| ≥65% resolved at stage 1+2 | 30% | ❌ — corpus artefact, see FINDINGS Part I |
| Stage-3 top-1 ≥85%, 1–1.5B model | 86% on direct+paraphrase; 80% overall | ⚠️ met on realistic buckets only |
| p95 < 2s on desktop | 151ms | ✅ |

**Stage-3 model selected: `qwen2.5:1.5b` at `topK: 3`** — 84–86% top-1 on
direct+paraphrase against the 8B's 90%, 6× faster end to end, 986 MB. `gemma3:1b`
rejected: 73%, and it never emits the out-of-scope sentinel.

[ADR-003](decisions/ADR-003.md) moves from provisional to **Accepted**. Two of its
mechanisms do not survive the smaller model and are now open work:

- **Out-of-scope detection has no working mechanism on target hardware** — stage 2 cannot
  do it with either encoder, and stage 3 cannot at 1B. New ADR owed by WP-03.
- **`TAU_ACT_BY_KIND` reads self-reported confidence**, which is near-constant at 1B: it
  held back 15.7% of stage-3 calls on the 8B and 0.7% on the 1.5B.

Evidence: [FINDINGS Part II](../packages/core-intent/eval/FINDINGS.md); scorecards in
`packages/core-intent/eval/scorecards/`.

**Note on 0.1:** the Flutter toolchain item is superseded by
[ADR-006](decisions/ADR-006.md) — the stack is a TypeScript monorepo. `git init` is done.

---

## MVP 1 — Prove AI navigation

**Goal:** speak or type an intent, land on the right screen with the right data.

- Flutter shell: Riverpod + GoRouter + Drift
- `@Capability` annotations + `build_runner` registry generation
- Deterministic + embedding router stages (Dart)
- llama.cpp FFI binding, int4 1B model, on-demand download
- Constrained-decoding stage 3
- Assistant surface: sphere, transcript, text input
- Finance domain slice: Transaction + Category + Budget CRUD, ~15 capabilities
- Conventional navigation shell underneath (per [ADR-005](decisions/ADR-005.md))
- Trace recorder + "why did you do that?" viewer
- Confirmation flow for write actions

**Done when:** a cold-installed app, airplane mode on, handles 20 scripted intents
end-to-end, and every one is explainable from its trace.

---

## MVP 2 — Voice and analytics

- whisper.cpp STT, push-to-talk then VAD-driven hands-free
- Piper TTS with barge-in (user can interrupt playback)
- Full turn state machine wired to the sphere
- Spending analytics: by category, by period, trends
- Chart rendering as an `Answer` payload — the AI returns a widget, not prose
- Multi-turn context: pronouns, "and last month?", "no, the other one"
- Undo for destructive actions

**Done when:** the entire MVP 1 scripted set is completable hands-free, and STT WER
is acceptable on accented English + Portuguese.

---

## MVP 3 — Coaching and the second domain

Two tracks. The second is the more important one.

**Coaching (depth):** goals, savings recommendations, predictive cashflow, proactive
insights. All numerics deterministic; the model phrases, never computes.

**Domain #2 (breadth):** implement a small second domain — a CRM or task tracker —
*without modifying orchestration code*. This is the architecture's exam.

**Done when:** domain #2 ships and the diff touching `lib/core/**` is zero. Any
non-zero diff is a leak in the abstraction and must be recorded as an ADR.

---

## Success metrics

The blueprint's targets, with measurement definitions attached — an unmeasurable
target is decoration.

| Metric | Target | How it's measured |
|---|---|---|
| Actions completed via AI | 90% | trace: outcomes reached without user touching conventional nav |
| Intent recognition latency | p95 < 2s | trace `latency`, per stage, on reference device |
| Navigation depth | < 3 steps | trace: screens between utterance and outcome |
| Manual navigation reduction | 80% | conventional-nav taps per session vs. control build |
| Router top-1 accuracy | ≥ 90% | golden set, run in CI on every commit |
| Wrong-action rate (write ops) | < 0.5% | golden set + confirmation-rejection rate in traces |
| Model-free resolution rate | ≥ 65% | share of turns decided at stage 1 or 2 |

The last two are the ones that matter. Everything else is downstream of them.

---

## Risk register

| Risk | Impact | Response |
|---|---|---|
| Small model can't route reliably | **fatal** | Sprint 0 spike gates all other work; cascade minimises exposure; clarify-not-guess |
| Latency on mid-range phones | high | most turns never reach the LLM; per-stage budgets; measure on real hardware not emulator |
| Model asset size vs store limits | high | on-demand asset delivery, not bundled — planned from day one |
| Hallucinated routes / actions | high | registry validation on every decision; unknown id → clarify |
| Financial arithmetic errors | **fatal** | LLM never computes numbers; Dart does; ADR-003 |
| Discoverability collapse | med | conventional nav retained (ADR-005); capability surfacing on home |
| Battery / thermal from on-device inference | med | measure in perf tests; idle model unload; cap context |
| Prompt injection via transaction memos | med | untrusted-data fencing; see [security.md](security.md) |
| Abstraction leak — domain #2 needs core changes | med | MVP 3 exam; any core diff requires an ADR |
| Solo-developer scope | high | domain #2 deferred to MVP 3; voice deferred to MVP 2 |
