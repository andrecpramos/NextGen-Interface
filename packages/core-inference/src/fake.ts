import type {
  CompletionRequest,
  CompletionResult,
  EmbeddingRuntime,
  LlmRuntime,
  Vector,
} from './types.ts';

/**
 * Deterministic runtimes for tests.
 *
 * The point is not convenience. Integration tests that hit a real model are
 * slow, need a machine with the model installed, and — per Finding 10 — are not
 * even deterministic at `temperature: 0`, where two identical 8B runs flipped 7
 * of 200 entries. A test suite built on that flakes, and a flaky test on a
 * financial path gets deleted rather than fixed.
 *
 * So the integration tests run against these: no network, no model, same answer
 * every time.
 */

export interface FakeCompletion {
  /** Match on a substring of the prompt. First match wins. */
  readonly whenPromptContains: string;
  readonly value: unknown;
}

export interface FakeLlmOptions {
  readonly completions?: readonly FakeCompletion[];
  /** Returned when nothing matches. */
  readonly fallback?: unknown;
  /** Simulate the model being missing or the server being down. */
  readonly unavailable?: string;
  /** Simulate constrained decoding producing unparseable output (Finding 6). */
  readonly parseFailsEvery?: number;
  readonly latencyMs?: number;
}

export class FakeLlmRuntime implements LlmRuntime {
  readonly name = 'fake';
  readonly #options: FakeLlmOptions;
  #calls = 0;
  #lastRequest: CompletionRequest | null = null;

  constructor(options: FakeLlmOptions = {}) {
    this.#options = options;
  }

  get callCount(): number {
    return this.#calls;
  }

  /**
   * The last request this runtime was handed, or `null` before the first call.
   *
   * Exists so a test can assert on the **prompt text itself**, which Rule 15
   * needs and nothing could do before: a fence that is applied correctly and a
   * fence that is forgotten produce identical model output through a fake, so
   * the only way to tell them apart is to look at what was sent.
   */
  get lastRequest(): CompletionRequest | null {
    return this.#lastRequest;
  }

  async isAvailable(): Promise<boolean> {
    return this.#options.unavailable === undefined;
  }

  async complete<T>(request: CompletionRequest): Promise<CompletionResult<T>> {
    this.#calls++;
    this.#lastRequest = request;
    const latencyMs = this.#options.latencyMs ?? 0;

    if (this.#options.unavailable !== undefined) {
      return { value: null, latencyMs, parseFailed: false, unavailable: this.#options.unavailable };
    }

    const every = this.#options.parseFailsEvery;
    if (every && this.#calls % every === 0) {
      return { value: null, latencyMs, parseFailed: true };
    }

    for (const c of this.#options.completions ?? []) {
      if (request.prompt.includes(c.whenPromptContains)) {
        return { value: c.value as T, latencyMs, parseFailed: false };
      }
    }

    return { value: (this.#options.fallback ?? null) as T | null, latencyMs, parseFailed: false };
  }
}

/**
 * A deterministic encoder: a hash of the text's tokens into a fixed space.
 *
 * Not semantically meaningful and not meant to be. It exists so tests that need
 * *an* embedding — stable across runs and machines — do not need a model. Tests
 * about routing *quality* belong in the golden set, against a real encoder.
 */
export class FakeEmbeddingRuntime implements EmbeddingRuntime {
  readonly name = 'fake';
  readonly #dim: number;

  constructor(dim = 32) {
    this.#dim = dim;
  }

  fit(): void {
    /* nothing to fit */
  }

  async embed(text: string): Promise<Vector> {
    const v = new Array<number>(this.#dim).fill(0);
    for (const token of text.toLowerCase().split(/\s+/).filter(Boolean)) {
      let h = 2166136261;
      for (let i = 0; i < token.length; i++) {
        h ^= token.charCodeAt(i);
        h = Math.imul(h, 16777619);
      }
      const slot = Math.abs(h) % this.#dim;
      v[slot] = (v[slot] ?? 0) + 1;
    }
    let s = 0;
    for (const x of v) s += x * x;
    const n = Math.sqrt(s);
    return n === 0 ? v : v.map((x) => x / n);
  }

  async embedAll(texts: readonly string[]): Promise<Vector[]> {
    return Promise.all(texts.map((t) => this.embed(t)));
  }
}
