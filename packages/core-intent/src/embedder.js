import { features } from './text.js';
import { OLLAMA } from './config.js';

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

function dot(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

function l2norm(v) {
  let s = 0;
  for (const x of v) s += x * x;
  const n = Math.sqrt(s);
  if (n === 0) return v;
  return v.map((x) => x / n);
}

export function cosine(a, b) {
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
 */
export class HashingEmbedder {
  constructor() {
    this.vocab = new Map(); // feature -> index
    this.idf = [];
    this.name = 'hashing';
    this.dim = 0;
  }

  /** @param {string[]} corpus one document per capability */
  fit(corpus) {
    const df = new Map();
    const docFeatures = corpus.map((doc) => {
      const f = features(doc);
      for (const t of new Set(f)) df.set(t, (df.get(t) || 0) + 1);
      return f;
    });

    let idx = 0;
    for (const term of df.keys()) this.vocab.set(term, idx++);
    this.dim = idx;

    const N = corpus.length;
    this.idf = new Array(this.dim).fill(0);
    for (const [term, count] of df) {
      // Smoothed IDF. A feature present in every capability carries no signal.
      this.idf[this.vocab.get(term)] = Math.log((N + 1) / (count + 1)) + 1;
    }
    return docFeatures;
  }

  embedSync(text) {
    const v = new Array(this.dim).fill(0);
    const f = features(text);
    if (f.length === 0) return v;

    const tf = new Map();
    for (const t of f) {
      const i = this.vocab.get(t);
      if (i !== undefined) tf.set(i, (tf.get(i) || 0) + 1);
    }
    for (const [i, count] of tf) {
      // Sublinear TF: a term repeated five times is not five times as informative.
      v[i] = (1 + Math.log(count)) * this.idf[i];
    }
    return l2norm(v);
  }

  async embed(text) {
    return this.embedSync(text);
  }

  async embedAll(texts) {
    return texts.map((t) => this.embedSync(t));
  }
}

// ----------------------------------------------------------------- ollama ---

export class OllamaEmbedder {
  constructor(model = OLLAMA.embedModel) {
    this.model = model;
    this.name = `ollama:${model}`;
    this.cache = new Map();
  }

  fit() {
    /* nothing to fit — the encoder is pretrained */
  }

  async embed(text) {
    if (this.cache.has(text)) return this.cache.get(text);

    const res = await fetch(`${OLLAMA.host}/api/embed`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: this.model, input: text }),
      signal: AbortSignal.timeout(OLLAMA.timeoutMs),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(
        `embed failed (${res.status}): ${body}\n` +
          `Is the model pulled?  ollama pull ${this.model}`,
      );
    }

    const json = await res.json();
    const vec = l2norm(json.embeddings?.[0] ?? json.embedding ?? []);
    if (vec.length === 0) throw new Error('embed returned an empty vector');
    this.cache.set(text, vec);
    return vec;
  }

  async embedAll(texts) {
    const out = [];
    for (const t of texts) out.push(await this.embed(t));
    return out;
  }
}

export function makeEmbedder(kind) {
  if (kind === 'ollama') return new OllamaEmbedder();
  return new HashingEmbedder();
}
