# Architecture

## System view

```
┌───────────────────────────────────────────────────────────┐
│ PRESENTATION                                              │
│  Assistant surface (sphere, chat, voice)  ·  Domain screens│
└───────────────┬───────────────────────────────────────────┘
                │ Utterance { text, locale, context }
┌───────────────▼───────────────────────────────────────────┐
│ ORCHESTRATION  (domain-agnostic — the actual product)      │
│                                                            │
│  ┌──────────────┐   ┌──────────────┐   ┌───────────────┐  │
│  │ Intent Engine│──▶│ Resolver     │──▶│ Dispatcher    │  │
│  │ retrieve+rank│   │ slot filling │   │ policy + exec │  │
│  └──────┬───────┘   └──────────────┘   └───┬───────────┘  │
│         │ reads                             │ emits        │
│  ┌──────▼───────────────────────┐   ┌───────▼──────────┐  │
│  │ CAPABILITY REGISTRY (generated)│  │ Trace Recorder   │  │
│  │ routes · actions · queries    │   └──────────────────┘  │
│  └───────────────────────────────┘                         │
└───────┬──────────────┬──────────────┬─────────────────────┘
        │              │              │
   ┌────▼────┐   ┌─────▼────┐   ┌─────▼──────┐
   │ Action  │   │ Query    │   │ Navigation │
   │ Engine  │   │ Engine   │   │ Engine     │
   └────┬────┘   └─────┬────┘   └─────┬──────┘
        │              │              │
┌───────▼──────────────▼──────────────▼─────────────────────┐
│ DOMAIN  (finance today; swappable)                         │
│  Entities · Use cases · Repository interfaces               │
└───────────────────────┬───────────────────────────────────┘
┌───────────────────────▼───────────────────────────────────┐
│ INFRASTRUCTURE                                             │
│  Drift/SQLite (SQLCipher) · LLM runtime · STT · TTS         │
└───────────────────────────────────────────────────────────┘
```

**Dependency rule:** arrows point down and inward only. Orchestration never imports
`features/finance`. Domains register themselves into orchestration at startup.

---

## The five layers

### Layer 1 — Conversation

Owns: microphone, transcription, chat transcript, TTS playback, turn state machine.

Turn states: `idle → listening → transcribing → thinking → confirming? → acting →
speaking → idle`. Every state is cancellable. The UI reflects the state; the sphere
is a state visualisation, not decoration.

Emits an `Utterance`:

```dart
class Utterance {
  final String text;
  final InputMode mode;        // voice | text
  final String locale;
  final ScreenContext context; // current route + visible entity ids
  final List<Turn> history;    // last N turns, bounded
}
```

`ScreenContext` is what makes "delete that one" resolvable. Never drop it.

### Layer 2 — Intent Recognition

**This is the highest-risk component in the system.** It gets its own section below.

### Layer 3 — Action

Maps a resolved intent to a use case. Actions are declared, typed, and classified:

```dart
@Capability(
  id: 'transaction.create',
  kind: CapabilityKind.write,          // read | write | destructive
  description: 'Record a new expense or income transaction',
  examples: ['I spent 12 euros on coffee', 'add 50 income from freelance'],
)
class CreateTransaction implements Action<CreateTransactionParams, Transaction> { ... }
```

`kind` drives policy (see ADR-004): `read` executes immediately, `write` requires
confirmation, `destructive` requires confirmation and produces an undo token.

### Layer 4 — Navigation

The AI does not call `context.go()`. It returns a `NavigationDecision`, which a
single `NavigationEngine` validates against the registry and executes.

Why the indirection: it gives one place to enforce route existence, required
parameters, auth guards, and back-stack sanity. A hallucinated route `/expensez`
fails a registry lookup and becomes a clarifying question, not a crash.

```dart
sealed class Outcome {
  const Outcome();
}
class Navigate    extends Outcome { final String route; final Map<String,Object?> params; }
class Answer      extends Outcome { final String speech; final Widget? render; }
class Perform     extends Outcome { final String actionId; final Map<String,Object?> args; }
class Clarify     extends Outcome { final String question; final List<String> options; }
class OutOfScope  extends Outcome { final String reason; }
```

An outcome may combine — a typical turn is `Perform` then `Navigate` then `Answer`.

### Layer 5 — Knowledge

Domain intelligence that isn't a database query: budgeting heuristics, savings-rate
guidance, debt strategies, category taxonomies. Shipped as versioned prompt packs +
deterministic rule functions.

**Rule:** anything numeric is computed in Dart, never by the LLM. The model may
*phrase* "you're 12% over budget"; it may not *compute* the 12%. Small models cannot
do arithmetic reliably and there is no reason to ask them to.

---

## Intent recognition: the hybrid router

The blueprint's implied design — send the utterance to a 1B model, get JSON back — is
the single most likely thing to sink this project. A 1B-parameter model asked to emit
free-form structured output over a 60-capability surface, in under 2 seconds, on a
mid-range phone, will be wrong often enough to destroy trust.

The adopted design is a **three-stage cascade**, cheapest first:

```
Utterance
   │
   ├─ Stage 1: DETERMINISTIC  (<5ms)
   │     Exact/alias/regex match against registry triggers.
   │     Covers the top ~40% of real traffic ("open budget", "settings").
   │     Hit with high confidence → done. No model invoked.
   │
   ├─ Stage 2: EMBEDDING RETRIEVAL  (~30-60ms)
   │     Embed utterance, cosine-match against precomputed capability
   │     embeddings. Returns top-k candidates with scores.
   │     score > τ_high and clear margin over #2 → done.
   │     Covers most paraphrase traffic. Still no LLM.
   │
   └─ Stage 3: LLM DISAMBIGUATION + SLOT FILLING  (~300-1500ms)
         Prompt contains ONLY the top-k candidates from stage 2 — never the
         full registry. Constrained decoding (GBNF grammar) forces a valid
         schema. The model picks among k and extracts parameters.
         Low confidence → Clarify, never guess.
```

Why this ordering matters:

- **Latency budget is met by not calling the model most of the time.** The <2s NFR is
  unachievable if every turn hits an LLM on a phone; it is easy if 70% of turns never
  do.
- **The model's job shrinks to something a 1B model can actually do.** Choosing among
  5 labelled options and extracting a date range is tractable. Recalling 60
  capabilities from a long prompt is not.
- **Constrained decoding guarantees valid JSON, not correct JSON.** Grammar-constrained
  output removes parse failures entirely; it does nothing for semantic errors. Hence
  the confidence gate and `Clarify` outcome.
- **Registry growth stops hurting.** Adding capability #61 grows an embedding index,
  not a prompt.

### Confidence and the clarify gate

Every stage returns a calibrated score. Thresholds are config, tuned against the
golden set (see [testing.md](testing.md)):

| Condition | Outcome |
|---|---|
| stage-1 hit | execute |
| stage-2 top score ≥ τ_high **and** margin ≥ δ | execute |
| stage-2 ambiguous | stage 3 |
| stage-3 confidence ≥ τ_act | execute (write → confirm) |
| stage-3 confidence < τ_act | `Clarify` with top 2–3 options |
| no candidate ≥ τ_floor | `OutOfScope` — say so plainly |

**Refusing to answer is a correct outcome.** A system that guesses wrong on financial
data is worse than one that asks.

---

## The capability registry

The registry is the contract between screens, actions, and the AI. It is
**generated**, not hand-maintained — hand-maintained registries drift within weeks.

Source of truth: annotations on routes and actions. A `build_runner` step emits:

- `app_routes.g.dart` — consumed by GoRouter
- `capabilities.g.json` — consumed by the intent engine
- `capabilities.embeddings.bin` — precomputed vectors, built at compile time

Because both artefacts come from one annotation, a route cannot exist that the AI
doesn't know about, and the AI cannot know about a route that doesn't exist.

Entry shape:

```json
{
  "id": "transactions.list",
  "kind": "navigate",
  "route": "/transactions",
  "title": "Transactions",
  "description": "Browse, filter and search all recorded transactions",
  "triggers": ["transactions", "my spending", "what did I buy"],
  "params": {
    "from": { "type": "date", "required": false },
    "to":   { "type": "date", "required": false },
    "category": { "type": "enum:Category", "required": false }
  },
  "examples": [
    { "say": "show last month's expenses",
      "expect": { "route": "/transactions", "params": { "from": "$lastMonthStart", "to": "$lastMonthEnd" } } }
  ]
}
```

The `examples` block is not documentation. It is the test fixture *and* the
few-shot pool. One source, three uses.

---

## Trace: how explainability is actually built

Explainability cannot be a prompt asking the model to explain itself — that produces
plausible fiction. It is a recorded structure:

```dart
class TurnTrace {
  final String turnId;
  final String rawTranscript;
  final double? sttConfidence;
  final RouterStage decidedAt;             // deterministic | embedding | llm
  final List<ScoredCandidate> candidates;  // what else it considered, and why not
  final String? modelId, promptVersion;
  final Outcome outcome;
  final List<DataRef> dataRead;            // table + row ids + date range
  final Duration latency;                  // per stage
  final String? undoToken;
}
```

"Why did you do that?" is rendered from this record. "What data did you use?" reads
`dataRead`. Traces are local, encrypted, capped by ring buffer, and exportable by the
user — they are also the debugging log and the source of the offline eval set.

---

## Offline and model strategy

| Target | Model | Runtime |
|---|---|---|
| Android / iOS | Gemma 3 1B or Qwen 2.5 1.5B (int4) | llama.cpp via FFI |
| Desktop | Qwen 3 4B / Gemma 3 4B | llama.cpp |
| Dev machine (today) | `llama3.1:8b` | Ollama — **already installed** |
| Embeddings | small sentence encoder, int8 | on-device, ~20 MB |
| STT | whisper.cpp `tiny`/`base` quantised | FFI |
| TTS | Piper | FFI |

Cloud models are a *quality* toggle, off by default, never on the critical path. If
the user enables cloud, the trace records that the turn left the device.

**Sizing warning:** a quantised 1B model plus embeddings plus Whisper plus Piper is
roughly 1.0–1.6 GB of assets. That exceeds Play Store's 200 MB base cap — models ship
via on-demand asset delivery, downloaded on first run, not bundled. See
[deployment.md](deployment.md).

---

## Data

Drift over SQLite (see [ADR-002](decisions/ADR-002.md)), SQLCipher for at-rest
encryption, key in platform keystore.

The Query Engine exposes a **fixed set of parameterised queries**, selected by
capability id. The LLM never emits SQL. It selects a query and fills typed slots.
This is the difference between an intent engine and an SQL-injection generator.

---

## Sequence — a representative turn

```
User: "how much did I spend on food last month"

Conversation   → Utterance{text, route:/home, history:[]}
Intent stage 1 → no exact trigger
Intent stage 2 → [spending.by_category 0.83, transactions.list 0.61, budget.view 0.44]
                 top ≥ τ_high, margin 0.22 ≥ δ → accept, but params unresolved
Resolver       → needs {category, from, to}
                 "food"        → Category.food        (enum match, deterministic)
                 "last month"  → 2026-07-01..07-31    (date grammar, deterministic)
                 → no LLM call needed
Dispatcher     → kind=read → execute without confirmation
Query Engine   → SUM(amount) WHERE category=food AND date BETWEEN ?  → 412.90
Knowledge      → compare vs budget(food)=350 → over by 62.90 (17.97%) [computed in Dart]
Navigation     → /analytics/category?category=food&from=…&to=…
Answer         → "You spent €412.90 on food last month — €62.90 over your €350 budget."
Trace          → recorded: stage=embedding, 0 LLM calls, 31 rows read, 340ms
```

Note what did not happen: no model inference at all. That is the design working.
