# @nextgen/core-inference

One interface, swappable runtimes.

**Boundary:** every model this system talks to goes through here. `core-intent` contains
no transport code at all — no `fetch`, no host, no `/api/chat`.

## Why this package exists

Not as an abstraction habit. [ADR-006](../../.ai/decisions/ADR-006.md) moved the stack to
TypeScript, which means on-device inference runs through `llama.rn` — and **nobody has
proved that works**. WP-10 gates the mobile app on loading a quantised 1B GGUF and
completing 10 stage-3 calls on a physical mid-range Android, measuring first-token
latency, peak RSS and thermals.

If that fails, only this package changes. That is the entire justification, and it is why
the interfaces are deliberately narrow: `complete` and `embed`. A runtime that cannot be
swapped cheaply is not a mitigation.

## The runtimes

| Runtime | State |
|---|---|
| `OllamaLlmRuntime` / `OllamaEmbeddingRuntime` | live — desktop and development |
| `FakeLlmRuntime` / `FakeEmbeddingRuntime` | live — tests |
| `LlamaRnRuntime` | **declared, throws.** Gated by WP-10 |
| `WebGpuRuntime` | **declared, throws.** Gated by WP-09 |

The placeholders throw on construction with what has to happen before they can exist. A
runtime that silently returned nothing would let the app appear to work on a platform
where inference has never run, and that discovery belongs in development rather than in a
store review.

## Failures are normal, so they do not throw

A missing model, a timeout, an unreachable server — these are ordinary conditions on a
device. `complete()` returns `unavailable` and the cascade degrades to stages 1–2 and
asks, which is the behaviour [sdlc/design.md](../../.ai/sdlc/design.md) specifies.
Throwing would turn a graceful clarify into a crash on a financial write path.

The encoder is deliberately asymmetric: embedding failures **do** throw. A missing chat
model degrades to a clarify built from stage-2 scores; a missing *encoder* leaves nothing
to build one from.

Constrained decoding is mandatory — `schema` is a required field with no overload that
omits it. It makes parse failure rare, not impossible (Finding 6 measured 1 in ~140 calls
on `llama3.1:8b`), so the fallback is required rather than defensive.

## The fakes are for determinism, not just speed

Finding 10 measured **7 of 200 entries flipping between two identical runs of the same
model at `temperature: 0`**. A suite built on real inference is flaky by construction, and
a flaky test on a financial path gets deleted rather than fixed.

So the integration tests run against `FakeLlmRuntime`: no network, no model, the same
answer every time. Routing *quality* is measured separately, by the golden set, against a
real encoder and a real model.

## Model lifecycle

A quantised 1B GGUF is 0.9–1.6 GB against a 200 MB store cap, so it arrives on demand and
the app has to be useful before it finishes.

**Verify before load, fail closed.** A model file is executable weight fetched over a
network; a truncated download and a substituted file look identical to a loader, and "the
model behaved strangely" is not a diagnosis anyone reaches quickly. Downloads land on a
`.part` file and are renamed into place only after the SHA-256 matches, so an interrupted
download cannot be mistaken for a complete one on the next launch. The hash is re-checked
on every load, not only after download.
