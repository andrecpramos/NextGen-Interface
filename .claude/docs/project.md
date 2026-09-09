# NextGen Interface — Project Overview

## What this is

An **AI-Native Application Platform**: conversation is the primary interface, and
screens are a rendering layer the AI drives. The first domain implemented on top of
it is a personal finance tracker, but finance is a *proof*, not the product.

The product is the layer underneath: **Intent Engine + Action Engine + Navigation
Engine + Knowledge Layer**, reusable across domains.

## The inversion

Traditional apps:

```
User → Menu → Page → Form → Action
```

This platform:

```
User → AI Assistant → Intent → Action / Query / Navigation → UI → Feedback
```

The user should not need to know where a feature lives. The registry knows, and the
AI reads the registry.

## Current state

"Complete" means it does its job under test, not that files exist.

| Area | Status |
|---|---|
| `.claude/` knowledge base | ✅ complete — 12 ADRs, rules + enforcement register, lessons |
| Monorepo scaffold (pnpm workspace) | ✅ complete — 10 packages, 2 apps, 1 service |
| Intent router (`packages/core-intent`) | ✅ built, calibrated, measured |
| Capability registry + codegen | ✅ `registry:build` generates the registry, route table and golden fixtures from one declaration |
| Data layer (`packages/data`) | 🟡 schema, money, query engine, undo, migrations present; not exercised end-to-end |
| Inference adapters (`core-inference`) | 🟡 Ollama working; mobile/web runtimes not started |
| Voice (`core-voice`) | 🟡 package exists; STT/TTS not wired |
| Apps (`apps/web`, `apps/cli`) | 🟡 both run; the assistant surface landed in WP-08/09 |
| Backend (`services/api`) | ⛔ intentionally empty through MVP 2 ([ADR-008](../decisions/ADR-008.md)) |

## Environment facts (verified 2026-09-09)

- Working dir: `C:\Users\andre\Desktop\NextGen_Interface`
- Default branch is `develop`; `main` is production and moves only on request
- `node` v25.1.0, `pnpm` 11.1.2, `git` 2.51.2 — available.
  **Node 23.6+ is required** despite `engines` saying `>=20`: the repo runs
  TypeScript through `node` directly and uses `node:sqlite`. On Node 20 install
  succeeds and everything fails at run time.
- `ollama`: `qwen2.5:1.5b` (the selected stage-3 model), `gemma3:1b`,
  `qwen2.5vl:7b`, `nomic-embed-text` (embeddings)
- A fresh clone needs `pnpm install --ignore-scripts` — see [../../CLAUDE.md](../../CLAUDE.md)
- `flutter` / `dart`: not installed — **no longer relevant**, see
  [ADR-006](../decisions/ADR-006.md)

## Open risk

The 1B question is **closed**: WP-01 measured `qwen2.5:1.5b` at 84–86% top-1 and
151ms p95, and it is the selected stage-3 model. `gemma3:1b` was rejected. Full
register: [PLAN.md](../../PLAN.md) §9.

The largest *open* risk is now **mobile inference via `llama.rn` is untested**
(WP-10). Desktop headroom is large, which helps and does not settle it. The
mitigation is real rather than aspirational: the adapter interface exists and
`core-intent` holds no transport code, so a failure changes one package.

Two smaller risks are worth knowing before touching the router:

- **`tauAct` reads a signal small models do not produce.** The gate held 15.7% of
  calls on 8B and 0.7% on 1.5B — small models report high confidence
  unconditionally.
- **Golden-set runs are not deterministic.** 7 of 200 entries flipped between
  identical 8B runs at temperature 0, which is why the gate compares against a
  committed baseline with a tolerance rather than an absolute threshold.

Measurements: [FINDINGS.md](../../packages/core-intent/eval/FINDINGS.md).

## Document map

| File | Answers |
|---|---|
| [vision.md](./vision.md) | Why this exists, what it refuses to be |
| [roadmap.md](./roadmap.md) | MVP 1 / 2 / 3, sprint-level |
| [architecture.md](./architecture.md) | The five layers, and how they talk |
| [coding-standards.md](./coding-standards.md) | Clean Architecture, SOLID, folder rules |
| [ui-guidelines.md](./ui-guidelines.md) | The sphere, and the AI-first-not-AI-only rule |
| [security.md](./security.md) | Encryption, prompt injection, PII, LLM threat model |
| [testing.md](./testing.md) | Including how you test a non-deterministic router |
| [deployment.md](./deployment.md) | CI/CD, model distribution, store constraints |
| [rules.md](./rules.md) | The fourteen invariants — and what actually enforces each |
| [lessons.md](./lessons.md) | Mistakes already made. Read before repeating one |
| [critical-infrastructure.md](./critical-infrastructure.md) | What is protected, what only looks protected |
| [../sdlc/](../sdlc/) | Per-phase process definitions |
| [../roles/](../roles/) | Role briefs for agents working this repo |
| [../decisions/](../decisions/) | ADRs — the binding technical choices |
| [../README.md](../README.md) | The map of `.claude/` itself: hooks, skills, agents, commands |

> **Stack note:** ADR-001 (Flutter) and ADR-002 (Drift) are **superseded** by
> [ADR-006](../decisions/ADR-006.md) and [ADR-007](../decisions/ADR-007.md).
> `coding-standards.md`, `../sdlc/development.md` and the role briefs in
> `../roles/` were rewritten against the real TypeScript stack.
>
> **Still stale:** `architecture.md` (Dart examples, `build_runner`, GoRouter),
> `security.md` (SQLCipher via Drift, `flutter_secure_storage`), and
> `../sdlc/requirements.md` NFR-SEC-01. The *architecture* those documents
> describe is unchanged and language-neutral — only the syntax and the named
> libraries are stale. They are deliberately left for a human call rather than
> rewritten by an agent, because what replaces SQLCipher here has not actually
> been decided, and an agent's plausible guess would become a cited decision
> nobody made.

## Non-negotiables

1. The registry is the single source of truth for routes. GoRouter and the intent
   engine read the *same* generated file. They cannot drift.
2. Every screen reachable by AI is also reachable without it. AI-first, never AI-only.
3. Write actions require confirmation. Read actions do not. See
   [decisions/ADR-004.md](../decisions/ADR-004.md).
4. Every turn produces a trace record. No trace, no explainability.
