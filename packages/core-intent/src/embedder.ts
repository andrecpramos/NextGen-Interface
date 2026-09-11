import { features } from './text.ts';
// The subpath, not the package root. The root re-exports `ModelStore`, which
// imports `node:crypto`, `node:fs` and `node:path` at module scope — so pulling
// the root into `@nextgen/core-intent/browser` made every browser bundle fail to
// resolve them (WP-29 found it; esbuild refuses at `platform: 'browser'`).
// `ollama.ts` itself is `fetch` only.
import { OllamaEmbeddingRuntime } from '@nextgen/core-inference/ollama';
import type { Embedder, Vector } from './types.ts';

/**
 * Two backends, deliberately.
 *
 *  - `hashing`  zero dependencies, offline, instant. This is the FLOOR: whatever
 *               stage-2 resolution rate it achieves, a real sentence encoder will
 *               beat. It lets the harness run with nothing installed.
 *  - `ollama`   a real embedding model over HTTP. This is the number to trust when
 *               deciding whether ADR-003's 65% gate is met.
 *
 * Report both. Shipping the decision on the hashing number alone understates the
 * design; shipping it on ollama alone hides how much of the win is the encoder.
 */

function dot(a: Vector, b: Vector): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i]! * b[i]!;
  return s;
}

function l2norm(v: readonly number[]): number[] {
  let s = 0;
  for (const x of v) s += x * x;
  const n = Math.sqrt(s);
  if (n === 0) return [...v];
  return v.map((x) => x / n);
}

export function cosine(a: Vector, b: Vector): number {
  // Vectors are stored pre-normalised, so cosine is just the dot product.
  return dot(a, b);
}

// ---------------------------------------------------------------- hashing ---

/**
 * TF-IDF over a vocabulary built from the registry corpus, cosine-compared.
 *
 * Building the vocabulary from the registry (rather than hashing into a fixed
 * space) has a useful property for this problem: a token that appears in no
 * capability contributes nothing. An utterance made entirely of unknown words —
 * "what's the weather tomorrow" — produces a near-zero vector and falls below
 * tauFloor, which is exactly the OutOfScope behaviour we want, for free.
 *
 * (Measured, that property is weaker than it sounds: "more" and "what time is
 * it" score 0.154 and 0.127, and no threshold separates them. See FINDINGS
 * Finding 2 — the free out-of-scope detection is not free after all.)
 */
export class HashingEmbedder implements Embedder {
  readonly name = 'hashing';
  private vocab = new Map<string, number>();
  private idf: number[] = [];
  private dim = 0;

  /** @param corpus one document per capability */
  fit(corpus: readonly string[]): string[][] {
    const df = new Map<string, number>();
    const docFeatures = corpus.map((doc) => {
      const f = features(doc);
      for (const t of new Set(f)) df.set(t, (df.get(t) || 0) + 1);
      return f;
    });

    let idx = 0;
    for (const term of df.keys()) this.vocab.set(term, idx++);
    this.dim = idx;

    const N = corpus.length;
    this.idf = new Array<number>(this.dim).fill(0);
    for (const [term, count] of df) {
      // Smoothed IDF. A feature present in every capability carries no signal.
      this.idf[this.vocab.get(term)!] = Math.log((N + 1) / (count + 1)) + 1;
    }
    return docFeatures;
  }

  embedSync(text: string): number[] {
    const v = new Array<number>(this.dim).fill(0);
    const f = features(text);
    if (f.length === 0) return v;

    const tf = new Map<number, number>();
    for (const t of f) {
      const i = this.vocab.get(t);
      if (i !== undefined) tf.set(i, (tf.get(i) || 0) + 1);
    }
    for (const [i, count] of tf) {
      // Sublinear TF: a term repeated five times is not five times as informative.
      v[i] = (1 + Math.log(count)) * this.idf[i]!;
    }
    return l2norm(v);
  }

  async embed(text: string): Promise<Vector> {
    return this.embedSync(text);
  }

  async embedAll(texts: readonly string[]): Promise<Vector[]> {
    return texts.map((t) => this.embedSync(t));
  }
}

// ----------------------------------------------------------------- ollama ---
//
// The Ollama encoder used to live here and call `fetch` directly. It moved to
// `@nextgen/core-inference` in WP-06 — this package no longer contains any
// transport code, which is what makes swapping the runtime a one-package change.
//
// `OllamaEmbeddingRuntime` is re-exported for callers that used to import it
// from here.

// Re-exported through the subpath for the same reason as the import at the top
// of this file: the package root drags `ModelStore` and its `node:*` imports
// into any browser bundle that touches this module.
export { OllamaEmbeddingRuntime } from '@nextgen/core-inference/ollama';

/**
 * Pick an encoder by name.
 *
 * Note the asymmetry with the LLM runtime, which is injected: the encoder is
 * selected here because stage 2 cannot degrade. A missing chat model becomes a
 * clarify built from stage-2 scores; a missing *encoder* leaves nothing to build
 * one from.
 */
export function makeEmbedder(kind: string): Embedder {
  if (kind === 'ollama') return new OllamaEmbeddingRuntime();
  return new HashingEmbedder();
}
