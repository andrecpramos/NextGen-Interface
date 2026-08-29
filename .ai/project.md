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

| Area | Status |
|---|---|
| `.ai/` documentation foundation | ✅ complete — 8 ADRs |
| Monorepo scaffold (pnpm workspace) | ✅ complete |
| Intent router (`packages/core-intent`) | ✅ built, calibrated, measured |
| Capability registry | schema defined, codegen not started |
| Data layer | scaffold only |
| Inference adapters | Ollama working; mobile/web runtimes not started |
| Voice (STT/TTS) | not started |
| Apps (web / mobile) | scaffold only |
| Backend | intentionally empty through MVP 2 ([ADR-008](decisions/ADR-008.md)) |

## Environment facts (verified 2026-08-29)

- Working dir: `c:\Users\andre\Desktop\NextGen_Interface` — git repo on `main`
- `node` 25.1.0, `pnpm` 11.1.2, `git` 2.51.2 — available
- `ollama`: `llama3.1:8b` (chat) + `nomic-embed-text` (embeddings)
- `flutter` / `dart`: not installed — **no longer relevant**, see
  [ADR-006](decisions/ADR-006.md)

## Open risk

**No 1B-class model has been tested.** Every measurement so far ran against
`llama3.1:8b` on a desktop. Nothing about it predicts phone-class inference, and the
ADR-003 go/no-go gate stays open until that runs. See
[FINDINGS.md](../packages/core-intent/eval/FINDINGS.md).

## Document map

| File | Answers |
|---|---|
| [vision.md](vision.md) | Why this exists, what it refuses to be |
| [roadmap.md](roadmap.md) | MVP 1 / 2 / 3, sprint-level |
| [architecture.md](architecture.md) | The five layers, and how they talk |
| [coding-standards.md](coding-standards.md) | Clean Architecture, SOLID, folder rules |
| [ui-guidelines.md](ui-guidelines.md) | The sphere, and the AI-first-not-AI-only rule |
| [security.md](security.md) | Encryption, prompt injection, PII, LLM threat model |
| [testing.md](testing.md) | Including how you test a non-deterministic router |
| [deployment.md](deployment.md) | CI/CD, model distribution, store constraints |
| [sdlc/](sdlc/) | Per-phase process definitions |
| [agents/](agents/) | Role briefs for AI coding agents working this repo |
| [decisions/](decisions/) | ADRs — the binding technical choices |

> **Stack note:** ADR-001 (Flutter) and ADR-002 (Drift) are **superseded** by
> [ADR-006](decisions/ADR-006.md) and [ADR-007](decisions/ADR-007.md). Several
> documents below still carry Dart/Flutter examples — `coding-standards.md`,
> `architecture.md`, `ui-guidelines.md`, and the agent briefs. The *architecture*
> they describe is unchanged and language-neutral; only the syntax in the examples
> is stale. Rewriting them is tracked as a follow-up.

## Non-negotiables

1. The registry is the single source of truth for routes. GoRouter and the intent
   engine read the *same* generated file. They cannot drift.
2. Every screen reachable by AI is also reachable without it. AI-first, never AI-only.
3. Write actions require confirmation. Read actions do not. See
   [decisions/ADR-004.md](decisions/ADR-004.md).
4. Every turn produces a trace record. No trace, no explainability.
