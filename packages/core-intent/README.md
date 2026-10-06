# @nextgen/core-intent

The three-stage intent cascade from [ADR-003](../../.claude/decisions/ADR-003.md):
deterministic → embedding → constrained LLM. Domain-agnostic — nothing here knows what
a transaction is. TypeScript, run directly by Node's native type stripping; no build
step and no runtime dependencies.

It began as a Sprint 0 spike answering one question:

> **What fraction of real turns can be resolved without invoking the LLM at all?**

The second question gated the architecture: **can a phone-class model do stage-3
work?** It can — `qwen2.5:1.5b` — but two of the design's mechanisms
do not survive the smaller model.

The committed scorecards are in [eval/scorecards/](eval/scorecards/). Read the limits below
before relying on out-of-scope detection or on the confidence gate.

## Run it

```bash
pnpm --filter @nextgen/core-intent typecheck   # strict, and it is the enforcement
pnpm --filter @nextgen/core-intent test        # vitest unit tests

cd packages/core-intent

# score distributions and recall@k — always look here first
node eval/inspect.js --embedder=ollama

# sweep thresholds against the corpus; never hand-tune them
node eval/calibrate.js --embedder=ollama --defer-oos

# full cascade on the selected model
node eval/evaluate.js --embedder=ollama --model=qwen2.5:1.5b --topk=3

# stages 1+2 only — the model-free ceiling, and the only fully deterministic run
node eval/evaluate.js --embedder=hashing --no-stage3

# compare models side by side
node eval/compare.js ollama-llama3.1_8b ollama-qwen2.5_1.5b ollama-gemma3_1b

# one utterance, ranked candidates
node eval/inspect.js --embedder=ollama "how much did I spend on food last month"
```

`evaluate.js` exits 0 only when every gate passes, so it drops into CI unchanged —
but see the caveat under "not deterministic" below before gating on it.

### Prerequisites

- Ollama serving on `127.0.0.1:11434`
- `ollama pull nomic-embed-text` for `--embedder=ollama` (the `hashing` backend needs
  nothing and works offline)
- A chat model for stage 3. **`qwen2.5:1.5b` is the selected one**;
  `llama3.1:8b` remains as the historical baseline.
- **Warm the model with one throwaway call before any timed run.** A cold load shows
  up as a 22-second stage-3 outlier and will quietly ruin a latency comparison.

## Layout

| Path | What |
|---|---|
| `src/types.ts` | The type vocabulary. Where Rules 4, 5 and 11 stop being conventions. |
| `src/text.ts` | Normalisation, stemming, feature extraction. Sentence punctuation is stripped except inside numbers (2026-09-11). **A change here moves every vector**: recalibrate, and rebuild every shipped index |
| `src/embedder.ts` | Two encoders: `hashing` (zero-dep TF-IDF) and `ollama`. One fitted encoder per registry, never shared — a re-fitted encoder silently changes every score |
| `src/action.ts` | ADR-015's action-verb signal: does the turn ask the assistant to *do* something? |
| `src/slots.ts` | Deterministic date / money / enum resolution |
| `src/stages.ts` | Stage 1 (trigger match), 2 (embedding), 3 (constrained LLM) |
| `src/cascade.ts` | Orchestration, policy enforcement, trace construction |
| `src/config.ts` | Calibrated thresholds. Read the comments before editing |
| `src/registry.ts` | Loads a registry from disk and fits the encoder (Node only) |
| `src/registry-browser.ts` | Builds a registry from a shipped index, with no file read and no fit. Exported as `@nextgen/core-intent/browser` |
| `src/*.test.ts` | Unit tests: slots, stages, cascade, action, text, registry-browser |
| *(no registry here)* | This package holds no application. The root `router:*` scripts pass the frozen fixture, `eval/fixture-registry.json`; whole-application registries are generated into `eval/frameworks/<app>/generated`. Every eval script takes `--registry=` |
| `eval/golden-set.jsonl` | The frozen fixture registry's golden set, across 7 buckets with expected outcomes. Whole-application sets live in `eval/frameworks/<app>/` |
| `eval/calibrate.js` | Threshold sweep under an explicit precision constraint |
| `eval/evaluate.js` | Golden-set runner, gates, scorecards |
| `eval/compare.js` | Side-by-side scorecard comparison across models |
| `eval/inspect.js` | Score distributions, recall@k, single-utterance debugging |

The harness stays `.js` on purpose: it imports the `.ts` sources directly, so there is
no build step between changing the router and measuring it.

## Types are the enforcement mechanism

Three of the project's non-negotiable rules are enforced by `tsc`, not by review:

**Rule 11 — deterministic params always win.** `mergeParams(model, deterministic)`
takes two distinct nominal types, so the arguments cannot be swapped. Writing the bug
that once cost 44 points of param exactness is now a compile error:

```
error TS2345: Argument of type 'DeterministicParams' is not assignable to
parameter of type 'ModelParams'.
```

**Rule 5 — unclassified kinds fail closed.** `Capability.kind` is typed `string`, not
`CapabilityKind`, because the registry is *data*. Narrowing it at the boundary would
make the ADR-004 "refuse" path look like dead code and delete the check.

**Rule 4 — model ids are untrusted.** Stage 3 returns `capabilityId: string | null`
only after a registry lookup; unknown ids become `hallucinatedId` and never a route.

The model's confidence is called `selfReportedConfidence` everywhere, because that is
what it is: at 1B it is close to a constant, which is why the name matters.

## Two backends, deliberately

`hashing` is the **floor**: TF-IDF with no model, no download, fully offline. Whatever
it achieves, a real encoder beats. It keeps the harness runnable with nothing
installed, and it proved useful in its own right — the fact that a conclusion holds
for *both* encoders is what makes that conclusion trustworthy.

`ollama` is the number to trust when deciding whether the ADR-003 gate is met.

Report both. The hashing number alone understates the design; the encoder number
alone hides how much of the win is just the encoder.

## Four things this harness enforces that are easy to get wrong

**Thresholds are per-encoder; `topK` is per-model.** TF-IDF cosine tops out at 0.572 on
this corpus, `nomic-embed-text` reaches 0.857 — a `tauHigh` carried across encoders
silently disables stage 2 and cost 72 points of accuracy on the first run. `topK` is
the other way round: it belongs to the model, and 3 beats the calibrated 5 on both 1B
models.

**Deterministic slots always win over model-extracted ones.** Now a type error rather
than a spread order (see above). Param exactness moved 54% → 98% on that one character.

**Stage 3 only ever sees the top-k candidates.** Never the full registry. That is both
the latency budget and the reason injected text cannot introduce a destructive
capability into the choice set.

**The gates are not deterministic.** Two identical 8B runs at `temperature: 0` flipped
7 of 200 entries. Only `--embedder=hashing --no-stage3` reproduces exactly. Gate CI on
tolerances, not on scorecard equality (ADR-011).

## What this harness does NOT cover

- **On-device inference.** Desktop numbers only. `qwen2.5:1.5b` at 151ms p95 leaves
  real headroom, but the mid-range Android case is still unmeasured.
- **Out-of-scope input.** Not a gap in the harness, a gap in the *design*: stage 2
  cannot detect it with either encoder and stage 3 cannot at 1B. There is currently no
  working mechanism; ADR-009 and ADR-015 are the replacement.
- **Injection via stored data.** Adversarial entries arrive as utterances. The
  realistic vector is a transaction memo entering a prompt as data, which needs the
  fencing described in [security.md](../../.claude/docs/security.md).
- **Real traffic distribution.** The corpus is deliberately adversarial (35% of
  entries cannot resolve before stage 3 by design), so the model-free rate here is a
  lower bound, not an estimate.
- **Money sign and currency conflicts.** `resolveMoney` silently drops a leading minus
  and silently picks the first of two named currencies. Both are pinned by tests and
  flagged `DECISION OWED` — they are domain questions for whichever capability first carries an amount, not router
  questions.

## Adding to the golden set

Every routing bug becomes a permanent entry before it is closed
([sdlc/testing.md](../../.claude/sdlc/testing.md)). Format:

```jsonc
{
  "id": "gs-0201",
  "bucket": "paraphrase",
  "utterance": "what did the weekend cost me",
  "context": { "route": "/", "today": "2026-08-29" },   // optional; today defaults
  "expect": {
    "outcome": "execute",              // execute | clarify | out_of_scope
    "capability": "spending.total",
    "params": { "from": "2026-08-24", "to": "2026-08-30" },
    "maxStage": "embedding",           // must resolve without the LLM
    "requiresConfirmation": true,      // write/destructive must gate
    "forbidKinds": ["destructive"],    // must never select these
    "forbidUnconfirmedDestructive": true
  }
}
```

Keep the buckets balanced. A corpus that drifts toward happy paths stops detecting
the failures that matter.
