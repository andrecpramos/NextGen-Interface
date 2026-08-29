# Router Spike (Sprint 0)

Validation harness for the three-stage intent cascade in
[ADR-003](../.ai/decisions/ADR-003.md). Zero dependencies — Node 18+ and nothing else.

It exists to answer one question before any Flutter code gets written:

> **What fraction of real turns can be resolved without invoking the LLM at all?**

**Results and their interpretation: [FINDINGS.md](FINDINGS.md).**

## Run it

```bash
cd spike

# score distributions and recall@k — always look here first
node inspect.js --embedder=ollama

# sweep thresholds against the corpus; never hand-tune them
node calibrate.js --embedder=ollama --defer-oos

# full cascade
node evaluate.js --embedder=ollama --model=llama3.1:8b

# stages 1+2 only — the model-free ceiling
node evaluate.js --embedder=hashing --no-stage3

# one utterance, ranked candidates
node inspect.js --embedder=ollama "how much did I spend on food last month"
```

Exit code is 0 only when every gate passes, so this drops into CI unchanged.

### Prerequisites

- Ollama serving on `127.0.0.1:11434`
- `ollama pull nomic-embed-text` for `--embedder=ollama` (the `hashing` backend
  needs nothing and works offline)
- Any chat model for stage 3; `llama3.1:8b` is the current default

## Layout

| Path | What |
|---|---|
| `registry.json` | 20 finance capabilities in the ADR-003 schema. Hand-written here; generated from `@Capability` annotations in the real app. |
| `golden-set.jsonl` | 200 utterances across 7 buckets with expected outcomes |
| `src/text.js` | Normalisation, stemming, feature extraction |
| `src/embedder.js` | Two encoders: `hashing` (zero-dep TF-IDF) and `ollama` |
| `src/slots.js` | Deterministic date / money / enum resolution |
| `src/stages.js` | Stage 1 (trigger match), 2 (embedding), 3 (constrained LLM) |
| `src/cascade.js` | Orchestration, policy enforcement, trace construction |
| `src/config.js` | Calibrated thresholds — read the comments before editing |
| `calibrate.js` | Threshold sweep under an explicit precision constraint |
| `evaluate.js` | Golden-set runner, gates, scorecards |
| `inspect.js` | Score distributions, recall@k, single-utterance debugging |

## Two backends, deliberately

`hashing` is the **floor**: TF-IDF with no model, no download, fully offline. Whatever
it achieves, a real encoder beats. It keeps the harness runnable with nothing
installed, and it proved useful in its own right — the fact that a conclusion holds
for *both* encoders is what makes that conclusion trustworthy.

`ollama` is the number to trust when deciding whether the ADR-003 gate is met.

Report both. The hashing number alone understates the design; the encoder number
alone hides how much of the win is just the encoder.

## Three things this harness enforces that are easy to get wrong

**Thresholds are per-encoder.** TF-IDF cosine tops out at 0.572 on this corpus;
`nomic-embed-text` reaches 0.857. A `tauHigh` carried across encoders silently
disables stage 2 — every score falls under an unreachable bar and everything
escalates. This actually happened on the first run and cost 70 points of accuracy.

**Deterministic slots always win over model-extracted ones.** The merge order in
`cascade.js` is load-bearing: the model answered "last month" as *thirty days back*
and, merged the wrong way round, overwrote a correct calendar-month range. Param
exactness moved 54% → 98% on the spread order alone.

**Stage 3 only ever sees the top-k candidates.** Never the full registry. That is both
the latency budget and the reason injected text cannot introduce a destructive
capability into the choice set.

## What this harness does NOT cover

- **1B-class models.** Everything here ran against 8B. Nothing measured predicts
  phone-class inference — this is the largest open risk.
- **Injection via stored data.** Adversarial entries arrive as utterances. The
  realistic vector is a transaction memo entering a prompt as data, which needs the
  fencing described in [security.md](../.ai/security.md).
- **On-device latency.** Desktop numbers only.
- **Real traffic distribution.** The corpus is deliberately adversarial (35% of
  entries cannot resolve before stage 3 by design), so the model-free rate here is a
  lower bound, not an estimate.

## Adding to the golden set

Every routing bug becomes a permanent entry before it is closed
([sdlc/testing.md](../.ai/sdlc/testing.md)). Format:

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
