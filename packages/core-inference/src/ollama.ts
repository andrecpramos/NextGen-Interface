import type {
  CompletionRequest,
  CompletionResult,
  EmbeddingRuntime,
  LlmRuntime,
  Vector,
} from './types.ts';

/**
 * Ollama — the desktop and development runtime.
 *
 * Extracted from `core-intent/src/stages.ts`, which used to call `fetch`
 * directly. That coupling is what this package exists to remove: the router now
 * takes a runtime, so swapping in `llama.rn` on a phone touches nothing in the
 * cascade.
 */

export interface OllamaOptions {
  readonly host?: string;
  readonly model?: string;
  readonly timeoutMs?: number;
}

const DEFAULTS = {
  host: process.env.OLLAMA_HOST || 'http://127.0.0.1:11434',
  model: process.env.SPIKE_MODEL || 'qwen2.5:1.5b',
  embedModel: process.env.SPIKE_EMBED_MODEL || 'nomic-embed-text',
  timeoutMs: 30000,
};

export class OllamaLlmRuntime implements LlmRuntime {
  readonly name: string;
  readonly #host: string;
  readonly #model: string;
  readonly #timeoutMs: number;

  constructor(options: OllamaOptions = {}) {
    this.#host = options.host ?? DEFAULTS.host;
    this.#model = options.model ?? DEFAULTS.model;
    this.#timeoutMs = options.timeoutMs ?? DEFAULTS.timeoutMs;
    this.name = `ollama:${this.#model}`;
  }

  async isAvailable(): Promise<boolean> {
    try {
      const res = await fetch(`${this.#host}/api/tags`, { signal: AbortSignal.timeout(2000) });
      return res.ok;
    } catch {
      return false;
    }
  }

  /**
   * One constrained completion.
   *
   * Returns `unavailable` rather than throwing when the runtime cannot be
   * reached. A missing model is a normal condition on a device, not an
   * exception — the cascade degrades to stages 1–2 and asks, which is the
   * behaviour sdlc/design.md specifies.
   */
  async complete<T>(request: CompletionRequest): Promise<CompletionResult<T>> {
    const started = performance.now();
    const model = request.model ?? this.#model;

    let res: Response;
    try {
      res = await fetch(`${this.#host}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model,
          stream: false,
          // Ollama's `format` is the equivalent of llama.cpp's GBNF grammar.
          format: request.schema,
          options: { temperature: 0, num_predict: request.maxTokens ?? 200 },
          messages: [
            { role: 'system', content: request.system },
            { role: 'user', content: request.prompt },
          ],
        }),
        signal: AbortSignal.timeout(request.timeoutMs ?? this.#timeoutMs),
      });
    } catch (err) {
      return {
        value: null,
        latencyMs: performance.now() - started,
        parseFailed: false,
        unavailable: err instanceof Error ? err.message : String(err),
      };
    }

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return {
        value: null,
        latencyMs: performance.now() - started,
        parseFailed: false,
        unavailable: `chat failed (${res.status}): ${body}`,
      };
    }

    const json = (await res.json()) as { message?: { content?: string } };
    const latencyMs = performance.now() - started;

    try {
      return { value: JSON.parse(json.message?.content ?? '') as T, latencyMs, parseFailed: false };
    } catch {
      // Rare, not impossible — 1 in ~140 calls on llama3.1:8b (Finding 6). If
      // this rate ever climbs, the runtime has stopped honouring the constraint
      // and that is a finding in itself.
      return { value: null, latencyMs, parseFailed: true };
    }
  }
}

export class OllamaEmbeddingRuntime implements EmbeddingRuntime {
  readonly name: string;
  readonly #host: string;
  readonly #model: string;
  readonly #timeoutMs: number;
  readonly #cache = new Map<string, Vector>();

  constructor(options: OllamaOptions = {}) {
    this.#host = options.host ?? DEFAULTS.host;
    this.#model = options.model ?? DEFAULTS.embedModel;
    this.#timeoutMs = options.timeoutMs ?? DEFAULTS.timeoutMs;
    this.name = `ollama:${this.#model}`;
  }

  fit(): void {
    /* pretrained — nothing to fit */
  }

  async embed(text: string): Promise<Vector> {
    const cached = this.#cache.get(text);
    if (cached) return cached;

    const res = await fetch(`${this.#host}/api/embed`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: this.#model, input: text }),
      signal: AbortSignal.timeout(this.#timeoutMs),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(
        `embed failed (${res.status}): ${body}\nIs the model pulled?  ollama pull ${this.#model}`,
      );
    }

    const json = (await res.json()) as { embeddings?: number[][]; embedding?: number[] };
    const vec = normalise(json.embeddings?.[0] ?? json.embedding ?? []);
    if (vec.length === 0) throw new Error('embed returned an empty vector');
    this.#cache.set(text, vec);
    return vec;
  }

  async embedAll(texts: readonly string[]): Promise<Vector[]> {
    const out: Vector[] = [];
    for (const t of texts) out.push(await this.embed(t));
    return out;
  }
}

/**
 * Unlike the LLM runtime, embedding failures DO throw.
 *
 * The asymmetry is deliberate. A missing chat model degrades to a clarify built
 * from stage 2. A missing *encoder* means stage 2 cannot run at all, so there is
 * nothing to degrade to and pretending otherwise would route on stage 1 alone.
 */
function normalise(v: readonly number[]): number[] {
  let s = 0;
  for (const x of v) s += x * x;
  const n = Math.sqrt(s);
  return n === 0 ? [...v] : v.map((x) => x / n);
}
