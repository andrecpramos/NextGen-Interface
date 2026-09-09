# NextGen Interface

An AI-native application platform: conversation is the primary interface, screens are
a rendering layer the AI drives. The first domain built on it is personal finance —
but finance is the proof, not the product.

## Stack

TypeScript everywhere, pnpm workspace monorepo. See
[ADR-006](.claude/decisions/ADR-006.md) for why this supersedes the original Flutter
decision.

| Layer | Choice |
|---|---|
| Web | Next.js (App Router) + React 19 + Zustand |
| Design system | Bespoke CSS design tokens — no UI framework ([ADR-012](.claude/decisions/ADR-012.md)) |
| Mobile | Expo / React Native |
| Local DB | SQLite + Drizzle ([ADR-007](.claude/decisions/ADR-007.md)) |
| Backend | Supabase — optional, off the critical path ([ADR-008](.claude/decisions/ADR-008.md)) |
| Inference | Ollama (desktop) · llama.rn (mobile) · WebGPU (web) |
| Testing | Vitest + the golden-set harness |

## Structure

```
apps/           cli (composition root) · web (assistant surface) · mobile · desktop
packages/       the product — domain-agnostic engine + finance domain
services/       optional backend (empty through MVP 2, deliberately)
infrastructure/ supabase · docker · ci
tooling/        shared eslint + tsconfig
.claude/            architecture, ADRs, SDLC process
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
| `ui` | Sphere states, confirmation cards, trace viewer. **Built.** |

## Status

MVP 1 is functionally complete — WP-01 through WP-09.

| | |
|---|---|
| Documentation foundation | ✅ complete — 12 ADRs |
| Monorepo scaffold | ✅ complete — 15 workspace projects |
| Intent router | ✅ built, calibrated, measured on a 1.5B model |
| Engine, data, trace, inference, domain | ✅ complete |
| `apps/cli` · `apps/web` | ✅ both run the whole stack |
| CI/CD | ✅ complete — gates on every push (WP-12) |
| Voice · mobile | not built — WP-10, WP-13 |

**Open risk:** top-1 routing accuracy is 80% against a 90% target, and the closest
capability pair (`spending.total` / `spending.by_category`, cosine 0.83) is where it
fails. The trace makes each failure visible rather than hiding it — see
[FINDINGS.md](packages/core-intent/eval/FINDINGS.md).

## Run it

```bash
pnpm install
pnpm web          # the assistant surface — http://localhost:3000
```

That is the product. Ollama is probed, not required: without it the router drops to
its deterministic stages and the status bar says so, rather than failing.

```bash
pnpm app          # the same stack in a terminal
pnpm app:offline  # stages 1-2 only, no model at all
pnpm check        # typecheck + 248 tests + registry validation
```

Full command list in [SETUP.md](SETUP.md#command-reference), which is also where the
prerequisites and the `ollama pull` lines live.

### Measuring the router

```bash
pnpm router:inspect     # score distributions, recall@k — always look here first
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
   ([ADR-003](.claude/decisions/ADR-003.md))
3. **The dispatcher enforces action policy, not the prompt.** Read executes, write
   confirms, destructive confirms and journals, unclassified refuses.
   ([ADR-004](.claude/decisions/ADR-004.md))
4. **AI-first, not AI-only.** Every screen reachable without the AI.
   ([ADR-005](.claude/decisions/ADR-005.md))
5. **The device is the source of truth.** A backend exists; nothing on the critical
   path requires it. ([ADR-008](.claude/decisions/ADR-008.md))
6. **The model never computes a number the user sees, never emits SQL, and never
   produces an identifier that isn't validated against the registry.**

## Next

1. **WP-11 — docs cleanup.** The last Dart examples in `coding-standards.md` and the
   agent briefs still describe a stack that ADR-006 replaced.
2. **Per-route screens.** The registry's `route` is tracked and returned on every turn
   but there is nothing to navigate *to*. The drawer runs each capability and renders
   its answer inline; Rule 7 holds over that rather than over a real screen set.
3. **WP-13 — voice.** Whisper in, Piper out. Three sphere states are already built and
   waiting on it.
4. **Domain #2.** The real test: if adding it means touching `packages/core-*`, the
   architecture has failed.
