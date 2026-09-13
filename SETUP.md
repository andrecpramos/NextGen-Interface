# SETUP — running this

**Last verified:** 2026-09-10 · Node 25.1.0 · pnpm 11.1.2 · Windows 11

⚠️ **This describes running the *reference* applications.** The product is a navigation
layer generated for someone else's app — see [README.md](README.md) and
[WRITEUP.md](WRITEUP.md). The two are the same engine; only the registry differs.

There is one working reference app: **`apps/cli`**, the whole stack as a terminal loop.
Its browser surface, `apps/web`, was removed on 2026-09-13; the product's browser UI is the
script tag in `packages/embed`. There is **not** a mobile app — see
[What is missing](#what-is-missing) at the end.

## The short version

```bash
pnpm install --ignore-scripts   # a fresh clone needs the flag; see CLAUDE.md
pnpm app                       # the reference app in a terminal — the fastest look
```

Everything else on this page is detail.

---

## 1. Prerequisites

| | Version | Check |
|---|---|---|
| Node | **≥ 22**, tested on 25.1.0 | `node --version` |
| pnpm | 11.x | `pnpm --version` |
| Ollama | any recent | `ollama --version` |

Node 22 or newer is not optional. The whole workspace runs TypeScript **directly**, via
Node's native type stripping — there is no build step anywhere, and on Node 20 nothing
will start.

## 2. Install

```bash
cd NextGen_Interface
pnpm install
```

No native compilation: SQLite is Node's built-in `node:sqlite`, and `better-sqlite3`
ships a prebuilt binary.

## 3. Models

```bash
ollama serve                      # if it is not already running
ollama pull qwen2.5:1.5b          # stage 3 — the model WP-01 selected
ollama pull nomic-embed-text      # stage 2 — the encoder
```

`qwen2.5:1.5b` is 986 MB, `nomic-embed-text` is 274 MB. Both are needed for the full
cascade; neither is needed for the offline mode below.

## 4. Check it works

```bash
pnpm check          # all three gates below, in order
```

or individually:

```bash
pnpm typecheck      # every package, strict
pnpm test           # 248 tests across 8 files
pnpm registry:check # the capability registry is valid
```

All three should pass. If `pnpm test` fails, stop here — nothing downstream will make
sense.

There is deliberately **no `lint` at the root.** The reference apps run TypeScript
directly via Node's native type stripping; `pnpm build` builds only the installable
packages (WP-26). ESLint is not wired up yet — see
[ci-cd.md](.claude/sdlc/ci-cd.md), which explains why a job wrapping a no-op is worse than
no job.

## 5b. Run the CLI

Same engine, same composition root, a terminal instead of a browser.

```bash
pnpm app
```

Then type at it:

```
  > budgets
  > how much did I spend on food last month
  > what's my balance
  > show my transactions
  > add 45 for groceries          # a write — it asks you to confirm
  > transfer 500 to my brother    # a declared limit — it refuses
  > why                           # explains the last turn, from the record
```

### Try the offline path

```bash
pnpm app:offline
```

Same app, **no language model at all** — stages 1 and 2 only. Notice what still works:
`budgets` still resolves, and "transfer 500 to my brother" is still refused, in about
0ms, because [ADR-009](.claude/decisions/ADR-009.md) made out-of-scope a matter of routing
rather than a judgement the model makes. Anything the first two stages cannot settle
becomes a *question* instead of a guess. That is the degradation path, and it is worth
seeing before trusting anything else.

### Useful commands inside the app

| | |
|---|---|
| `why` | how the last turn was decided, what else it considered, and where each value came from |
| `trace` | the raw record behind that explanation |
| `stats` | what share of turns never reached the model |
| `help` | example utterances |
| `exit` | quit |

## 6. Measure the router

```bash
pnpm router:eval      # full cascade vs the 200-entry golden set
pnpm router:floor     # stages 1+2 only — the only fully deterministic run
pnpm router:compare   # every model side by side
```

`router:eval` **exits non-zero**, and that is correct: several gates are genuinely not
met yet (top-1 is 80% against a 90% target). See
[FINDINGS.md](packages/core-intent/eval/FINDINGS.md) for what each number means before
reading anything into it.

Two warnings, both learned the hard way:

- **Warm the model first.** A cold load shows up as a 22-second stage-3 outlier and will
  quietly ruin any latency comparison.
- **Only `router:floor` is deterministic.** Two identical 8B runs at `temperature: 0`
  flipped 7 of 200 entries (Finding 10). Do not read a one-entry change as a regression.

## 7. Changing capabilities

`packages/domain-modules/src/capabilities.ts` is the source of truth — it is the
**registered** domain since WP-14, and it is what `pnpm registry:build` builds.
`domain-finance` is a second reference application. Since WP-47 each domain writes its
own `packages/domain-<name>/generated/registry.json`, so building either is safe and CI
checks both. (Until then they shared one path, building the wrong one silently replaced
the registry the router loads, and a hook blocked it.) After editing:

```bash
pnpm registry:build     # regenerates this domain's generated/: registry.json, routes.json, fixtures
pnpm registry:check     # the CI gate
pnpm router:calibrate   # RE-CALIBRATE — see below
```

That last step is not optional. Thresholds are an artefact of the encoder **and** of the
registry corpus, so adding or removing capabilities invalidates them exactly as changing
the encoder would. Skipping it is the single most repeated mistake in this project's
history — it has cost measurable accuracy three separate times (Findings 1 and 11).

---

## Command reference

Every root script, and what it is for. All run from the repo root.

### Running something

| | |
|---|---|
| `pnpm app` | the reference app as a terminal loop, with the model |
| `pnpm app:offline` | the same, stages 1–2 only — no model, no Ollama needed |

### Checking it

| | |
|---|---|
| `pnpm check` | `typecheck` + `test` + `registry:check`, in order — run this before a commit |
| `pnpm typecheck` | every package, strict |
| `pnpm test` | 248 tests across 8 files |
| `pnpm registry:check` | validate the capability registry; this is the CI gate |

### The registry

`packages/domain-modules/src/capabilities.ts` is the source of truth (see §7).

| | |
|---|---|
| `pnpm registry:build` | regenerate `registry.json`, `routes.json`, golden fixtures |
| `pnpm registry:check` | validate only, changing nothing |

⚠️ After `registry:build`, **run `pnpm router:calibrate`.** Thresholds are an artefact
of the encoder *and* of the registry corpus. See §7 above — this is the single most
repeated mistake in the project's history.

### Measuring the router

| | |
|---|---|
| `pnpm router:inspect` | score distributions, recall@k — **always look here first** |
| `pnpm router:calibrate` | threshold sweep; never hand-tune thresholds |
| `pnpm router:eval` | full cascade on `qwen2.5:1.5b` against the golden set |
| `pnpm router:floor` | stages 1+2 only — the **only** deterministic run, so the regression net |
| `pnpm router:baseline` | the same on `llama3.1:8b`, the historical comparison point |
| `pnpm router:compare` | scorecards side by side across models |

`router:eval` and `router:floor` **exit non-zero by design**. Read
[FINDINGS.md](packages/core-intent/eval/FINDINGS.md) before reading anything into a
number.

### Housekeeping

| | |
|---|---|
| `pnpm install` | workspace install; no native compilation |
| `pnpm clean` | drop `dist`, `node_modules`, `.turbo`, `.next` everywhere |

### Inside the CLI

`why` · `trace` · `stats` · `help` · `exit` — see §5b.

There is **no `pnpm lint`.** It was removed rather than left to fail: ESLint is not
wired up. (`pnpm build` exists since WP-26, and builds only the installable packages.) [ci-cd.md](.claude/sdlc/ci-cd.md) explains why a green job that certifies
nothing is worse than an absent one.

---

## What is missing

Honest status. The engine is complete; the product surface is not.

### Built and working

| | |
|---|---|
| `core-intent` | three-stage router, measured against a 200-entry golden set |
| `core-capability` | registry schema, validation, codegen |
| `core-dispatch` | ADR-004 policy, navigation, ports for query and undo |
| `core-inference` | runtime interfaces, Ollama and Fake adapters, model store |
| `core-trace` | the explainability record, encrypted, with `explain()` |
| `data` | schema, migrations, the fixed query set, undo journal, fixtures |
| `domain-modules` | **the registered reference app** — entities, use cases, 7 capabilities |
| `domain-finance` | a second reference app — 27 capabilities, proof the engine is domain-agnostic |
| `generator` | reads an application's source and emits one registry per role (WP-25). Also emits guided steps (WP-27) and reads data-router apps (WP-28) |
| `apps/cli` | **the composition root**: the whole stack in a terminal, with `undo` (WP-18) |
| `embed` | the script tag: one file defining `window.NextGen`, 9.3KB gzipped (WP-29), plus the guided-step anchor resolver (WP-27) |
| `core-voice` | Whisper and Piper. Acceptance-tested end to end in English (WP-21) |

### Not built

| | Work package | What it blocks |
|---|---|---|
| **The drop-in kit** | WP-41 | one command from an app's source to a mounted assistant. [INSTALL.md](INSTALL.md) has today's manual steps |
| **A live deployment** | WP-35 | the owner's run inside `fut-app` |
| **Charts** | WP-08 remainder | `Answer` renders bars; there is no chart component yet |
| **Voice in the browser** | — | voice runs in the CLI only. The runtimes are desktop binaries, and the web mic button renders disabled |
| **Lint** | WP-12 | No ESLint dependency anywhere — deliberately left out of CI rather than wrapped in a green no-op. The empty `tooling/eslint-config` stub was deleted in WP-37 |


### Gaps I found while wiring this up, which the plan did not name

1. **There was no composition root at all.** Seven packages, 238 passing tests, and
   nothing had ever run them together. Building `apps/cli` immediately surfaced two
   cross-package type defects that no isolated test could reach: a *loaded* registry did
   not satisfy the dispatcher's port, and `OllamaOptions` rejected an explicit
   `undefined` under `exactOptionalPropertyTypes`. Both are fixed. The lesson is that
   WP-09 should not have been the first time these packages met.

2. **The dispatcher asked for more than it used.** It took a whole `RegistryFile`, which
   carries enums in their *source* form, while a loaded registry carries them compiled.
   It now asks for `CapabilitySource` — the capabilities and nothing else.

3. **`pnpm install` stopped to ask about build scripts** on a fresh clone.
   `onlyBuiltDependencies` is now declared in `pnpm-workspace.yaml`.

4. **The CLI's confirm path has four capabilities wired**, not twenty. `transaction.create`,
   `transaction.delete`, `budget.set` and `budget.delete` execute; the rest report that
   they are confirmed but unwired. That is honest scaffolding, not a stub pretending to
   work — and it is the list WP-09 has to finish.

### Known behaviour that looks like a bug and is not

- **"how much did I spend on food last month" sometimes answers with total spending.**
  The router picks `spending.total` over `spending.by_category` — they are the closest
  pair in the registry (cosine 0.83) and top-1 is measured at 80%, not 100%. `why` shows
  exactly this happening, which is the system working: the trace makes the error visible
  rather than hiding it.
- **Data resets every run.** The CLI seeds an in-memory database. Persisting to a file is
  a one-line change (`openMemoryDatabase()` → a file path) and deliberately not the
  default while the schema is still moving.
