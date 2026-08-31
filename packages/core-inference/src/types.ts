/**
 * Runtime interfaces.
 *
 * This package exists because of a risk, not because of an abstraction habit.
 * [ADR-006](../../../.ai/decisions/ADR-006.md) moved the stack to TypeScript, which
 * means on-device inference goes through `llama.rn` — and nobody has yet proved
 * that `llama.rn` can load a quantised 1B GGUF and complete a stage-3 call on a
 * mid-range Android (WP-10 gates exactly that).
 *
 * If it cannot, **only this package changes.** That is the entire justification
 * for the indirection, and it is why the interfaces below are deliberately
 * narrow: `complete` and `embed`. A runtime that cannot be swapped cheaply is
 * not a mitigation.
 */

export type Vector = readonly number[];

/**
 * A JSON Schema constraining the model's output.
 *
 * Constrained decoding is **mandatory** (ADR-003). Never parse free-form model
 * output. Note what it does and does not buy you: measured 0 parse failures on
 * both 1B-class models and 1 in ~140 on `llama3.1:8b`, so it makes parse failure
 * rare rather than impossible — the fallback is required, not defensive.
 */
export interface JsonSchema {
  readonly type: 'object';
  readonly properties: Readonly<Record<string, unknown>>;
  readonly required?: readonly string[];
}

export interface CompletionRequest {
  readonly system: string;
  readonly prompt: string;
  /** Required. There is no overload that omits it. */
  readonly schema: JsonSchema;
  readonly model?: string | undefined;
  readonly timeoutMs?: number;
  readonly maxTokens?: number;
  /**
   * Base64-encoded image bytes (no data-URI prefix), for a vision-capable
   * model. Additive and optional — a runtime or model that doesn't support
   * vision simply ignores it rather than failing; degrade, don't throw, is
   * the same rule `LlmRuntime` already states for a missing model.
   */
  readonly images?: readonly string[];
}

export interface CompletionResult<T> {
  /** `null` when the runtime was unavailable or the output would not parse. */
  readonly value: T | null;
  readonly latencyMs: number;
  /** Constrained decoding is not an absolute guarantee — Finding 6. */
  readonly parseFailed: boolean;
  /** Set when the runtime could not be reached at all. Degrade, do not throw. */
  readonly unavailable?: string;
}

/**
 * A language-model runtime.
 *
 * Implementations must never throw for the ordinary failures — a missing model,
 * a timeout, an unreachable server. Those are normal on a device and the cascade
 * degrades to stages 1–2 (sdlc/design.md). Throwing turns a graceful clarify
 * into a crash on a financial write path.
 */
export interface LlmRuntime {
  readonly name: string;
  complete<T>(request: CompletionRequest): Promise<CompletionResult<T>>;
  /** Cheap check. Used to decide whether to offer model-dependent affordances. */
  isAvailable(): Promise<boolean>;
}

export interface EmbeddingRuntime {
  readonly name: string;
  /** Lexical encoders build a vocabulary from the registry corpus; neural ones do not. */
  fit?(corpus: readonly string[]): unknown;
  embed(text: string): Promise<Vector>;
  embedAll(texts: readonly string[]): Promise<Vector[]>;
}

// ---------------------------------------------------------- model lifecycle --

export interface ModelDescriptor {
  readonly id: string;
  readonly url: string;
  /** Lowercase hex. Verified before the file is ever loaded. */
  readonly sha256: string;
  readonly sizeBytes: number;
  /** For the store listing and the download prompt. */
  readonly displayName?: string;
}

export type ModelState = 'absent' | 'downloading' | 'verifying' | 'ready' | 'corrupt';

export interface ModelStatus {
  readonly id: string;
  readonly state: ModelState;
  readonly bytesDownloaded?: number;
  readonly path?: string;
  readonly error?: string;
}

export class ModelIntegrityError extends Error {
  readonly modelId: string;
  readonly expected: string;
  readonly actual: string;

  constructor(modelId: string, expected: string, actual: string) {
    super(
      `model "${modelId}" failed integrity check: expected sha256 ${expected}, got ${actual}. ` +
        'Refusing to load it.',
    );
    this.name = 'ModelIntegrityError';
    this.modelId = modelId;
    this.expected = expected;
    this.actual = actual;
  }
}
