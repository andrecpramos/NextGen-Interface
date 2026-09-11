# NextGen Interface — Project Overview

## What this is

A **drop-in AI navigation layer for web apps that already exist.** Point a tool at
an app's source; it generates a capability registry; the app's users get an
assistant that takes them where they asked to go and tells them what to do when
they arrive.

**What it is *to us*, right now:** a portfolio project with a plausible commercial
thesis, built solo. That framing decides the whole plan — the first milestone is a
*measured result on a real app*, not a customer and not a platform. Pilot target:
`fut-app`.

Full statement: [PLAN.md](../../PLAN.md) §1. Commercial reasoning:
[business-case.md](./business-case.md). How it got here:
[history.md](./history.md).

> **Repositioned 2026-09-09.** This was previously framed as an "AI-Native
> Application Platform" with a finance tracker as its proof. The engine is the
> same; what changed is who it is for — an adopter's existing app rather than a
> greenfield one built on top of it. Two rules exist only because of that shift:
> Rule 16 (the installer never modifies the adopter's source) and Rule 17 (a
> capability the user cannot reach is absent from their registry, not filtered).

## The inversion

Traditional apps:

```
User → Menu → Page → Form → Action
```

With this layer installed:

```
User → Assistant → Intent → Action / Query / Navigation → UI → Feedback
```

The user should not need to know where a feature lives. The registry knows, and the
assistant reads the registry.

## Current state

"Complete" means it does its job under test, not that files exist.

| Area | Status |
|---|---|
| `.claude/` knowledge base | ✅ complete: 16 ADRs, the enforcement register, lessons L1 to L12, business case, history |
| Monorepo scaffold (pnpm workspace) | ✅ complete: 12 packages, 2 apps, 1 service |
| Generator (`packages/generator`) | ✅ built and measured on `fut-app` (WP-25) and on one external app (WP-28) |
| Browser delivery (`core-intent/browser`, `embed`) | ✅ stages 1+2 run from a shipped index with 210/210 parity (WP-24), plus a script tag at 9.3KB gzipped (WP-29) |
| The drop-in kit | ⬜ WP-41, next. The owner runs it in `fut-app` as its acceptance test |
| Intent router (`packages/core-intent`) | ✅ built, calibrated, measured |
| Capability registry + codegen | ✅ `registry:build` generates the registry, route table and golden fixtures from one declaration |
| Data layer (`packages/data`) | 🟡 schema, money, query engine, undo, migrations present; not exercised end-to-end |
| Inference adapters (`core-inference`) | 🟡 Ollama working. In the browser, stages 1+2 need no runtime at all (WP-24); mobile was closed (WP-10) |
| Voice (`core-voice`) | ✅ acceptance-tested end to end in English: 97.5% agreement between typed and spoken (WP-21). Portuguese is WP-44 |
| Apps (`apps/web`, `apps/cli`) | ✅ both run. `navigate` moves the browser (WP-35); the CLI has `undo` (WP-18) |
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

The largest *open* risk is now **the first run by someone who did not build it**
(2026-09-11). The drop-in kit (WP-41) has two jobs that have never been done:
- work on an app that nobody on this project has read;
- calibrate thresholds without the hand-written golden set that every calibration so far
  has used.

`apps/mobile` was closed as a different product (WP-10), so `llama.rn` is no longer a risk
this project carries.

Two smaller risks are worth knowing before touching the router:

- **A model's self-reported confidence is not a signal.** `TAU_ACT_BY_KIND` read it and
  held back 15.7% of calls on 8B but only 0.7% on 1.5B. It was replaced by
  `REQUIRES_STAGE2_AGREEMENT` (WP-17), which a model cannot inflate.
- **Golden-set runs are not deterministic.** 7 of 200 entries flipped between
  identical 8B runs at temperature 0, which is why the gate compares against a
  committed baseline with a tolerance rather than an absolute threshold.

Measurements: [FINDINGS.md](../../packages/core-intent/eval/FINDINGS.md).

## Document map

| File | Answers |
|---|---|
| [vision.md](./vision.md) | Why this exists, what it refuses to be |
| [../../PLAN.md](../../PLAN.md) | **The plan.** §0's queue, §7's work packages, §9's risks — replaced `roadmap.md`, deleted 2026-09-10 |
| [architecture.md](./architecture.md) | The five layers, and how they talk |
| [coding-standards.md](./coding-standards.md) | Clean Architecture, SOLID, folder rules |
| [ui-guidelines.md](./ui-guidelines.md) | The sphere, and the AI-first-not-AI-only rule |
| [security.md](./security.md) | Encryption, prompt injection, PII, LLM threat model |
| [testing.md](./testing.md) | Including how you test a non-deterministic router |
| [deployment.md](./deployment.md) | CI/CD, model distribution, store constraints |
| [business-case.md](./business-case.md) | Who this is for, and why it is worth building |
| [history.md](./history.md) | How the project got here — the decisions and their measurements |
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

The short version. All seventeen are [PLAN.md](../../PLAN.md) §2; where each is
actually enforced is [critical-infrastructure.md](./critical-infrastructure.md).

1. The registry is the single source of truth for routes. The router and the app
   read the *same* generated file, so they cannot drift.
2. Every screen reachable by AI is also reachable without it. AI-first, never
   AI-only — and now a promise to adopters: installing this must not make any part
   of their app AI-only.
3. Write actions require confirmation. Read actions do not.
   ([ADR-004](../decisions/ADR-004.md))
4. Every turn produces a trace record. No trace, no explainability.
5. The installer never modifies the adopter's source — additive artefacts only, so
   removing it leaves the app exactly as it was. (Rule 16)
6. A capability the current user cannot reach is **absent** from the registry they
   receive, not filtered at render. That is a security property, not a UX one.
   (Rule 17)
