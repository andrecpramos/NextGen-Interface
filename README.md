# NextGen Interface

An AI-native application platform: conversation is the primary interface, screens are
a rendering layer the AI drives. The first domain built on it is personal finance —
but finance is the proof, not the product.

## Stack

TypeScript everywhere, pnpm workspace monorepo. See
[ADR-006](.ai/decisions/ADR-006.md) for why this supersedes the original Flutter
decision.

| Layer | Choice |
|---|---|
| Web | Next.js (App Router) + Tailwind |
| Mobile | Expo / React Native |
| Local DB | SQLite + Drizzle ([ADR-007](.ai/decisions/ADR-007.md)) |
| Backend | Supabase — optional, off the critical path ([ADR-008](.ai/decisions/ADR-008.md)) |
| Inference | Ollama (desktop) · llama.rn (mobile) · WebGPU (web) |
| Testing | Vitest + the golden-set harness |

## Structure

```
apps/           web · mobile · desktop
packages/       the product — domain-agnostic engine + finance domain
services/       optional backend (empty through MVP 2, deliberately)
infrastructure/ supabase · docker · ci
tooling/        shared eslint + tsconfig
.ai/            architecture, ADRs, SDLC process
```

The boundary that matters: **`packages/core-*` never imports `domain-finance`.**
Domains register into the engine. Workspace package boundaries enforce this — an
unlisted dependency will not resolve, which is stronger than a lint rule.

| Package | Does |
|---|---|
| `core-intent` | Three-stage router. **Built and measured.** |
| `core-capability` | Registry schema + codegen — the engine↔domain contract |
| `core-trace` | TurnTrace records; explainability from a record, not narration |
| `core-inference` | Swappable LLM runtime adapters |
| `core-voice` | Whisper STT + Piper TTS adapters |
| `domain-finance` | Entities, use cases, capability registrations |
| `data` | Drizzle schema, migrations, repositories |
| `ui` | Sphere states, confirmation cards, trace viewer |

## Status

| | |
|---|---|
| Documentation foundation | ✅ complete — 8 ADRs |
| Monorepo scaffold | ✅ complete |
| Intent router | ✅ built, calibrated, measured |
| Everything else | scaffold only |

**Open risk:** no 1B model has been tested. Everything measured ran against
`llama3.1:8b` on a desktop, which predicts nothing about phone-class inference. This
is the one result that can still invalidate the architecture — see
[FINDINGS.md](packages/core-intent/eval/FINDINGS.md).

## Run the router

```bash
pnpm install
pnpm router:inspect     # score distributions, recall@k
pnpm router:calibrate   # sweep thresholds — never hand-tune them
pnpm router:eval        # full cascade against the golden set
```

Requires Ollama with `nomic-embed-text` and a chat model. `--embedder=hashing` runs
with no model at all.

## The load-bearing ideas

1. **The capability registry is the contract.** Generated from one source, feeding both
   routing and the intent engine, so they cannot drift.
2. **The router is a cascade** — deterministic, then embedding, then a
   grammar-constrained LLM over only the top candidates. Most turns should never reach
   the model; that is how the offline latency budget is met.
   ([ADR-003](.ai/decisions/ADR-003.md))
3. **The dispatcher enforces action policy, not the prompt.** Read executes, write
   confirms, destructive confirms and journals, unclassified refuses.
   ([ADR-004](.ai/decisions/ADR-004.md))
4. **AI-first, not AI-only.** Every screen reachable without the AI.
   ([ADR-005](.ai/decisions/ADR-005.md))
5. **The device is the source of truth.** A backend exists; nothing on the critical
   path requires it. ([ADR-008](.ai/decisions/ADR-008.md))
6. **The model never computes a number the user sees, never emits SQL, and never
   produces an identifier that isn't validated against the registry.**

## Next

1. Test a 1B model — closes the ADR-003 gate either way
2. `core-capability` — registry schema and codegen; everything else depends on it
3. `data` — Drizzle schema for the finance entities
4. `apps/web` — fastest path to a working assistant surface
