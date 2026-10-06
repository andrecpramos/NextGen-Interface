import type { CompletionRequest, CompletionResult, LlmRuntime } from './types.ts';

/**
 * Platform runtimes that are **declared but not implemented**.
 *
 * These are honest placeholders, not stubs pretending to work. Each throws on
 * construction with what has to happen before it can exist, because a runtime
 * that silently returns nothing would let the app appear to work on a platform
 * where inference has never actually run — and that discovery belongs in
 * development, not in a store review.
 *
 * The interface is the deliverable here: if `llama.rn` turns out to be
 * inadequate, only this file changes.
 */

export class NotImplementedRuntimeError extends Error {
  readonly runtime: string;

  constructor(runtime: string, blockedBy: string) {
    super(`${runtime} is not implemented yet — ${blockedBy}`);
    this.name = 'NotImplementedRuntimeError';
    this.runtime = runtime;
  }
}

/**
 * On-device inference for iOS and Android via `llama.rn`.
 *
 * **Unproven.** Before it is relied on, it has to be shown that this loads a quantised 1B GGUF and completes 10 stage-3 calls on a
 * physical mid-range Android, measuring first-token latency, peak RSS and
 * thermals. Desktop numbers say nothing about it: `qwen2.5:1.5b` at 151ms p95
 * leaves real headroom, but that is desktop silicon with no thermal envelope.
 *
 * To implement: hold an `llama.rn` context, map `schema` onto a GBNF grammar
 * (the equivalent of Ollama's `format`), and keep the same contract — return
 * `unavailable` rather than throwing when the model is missing.
 */
export class LlamaRnRuntime implements LlmRuntime {
  readonly name = 'llama.rn';

  constructor() {
    throw new NotImplementedRuntimeError(
      'LlamaRnRuntime',
      'it needs a React Native host and a physical device. It first has to be proven that ' +
        'llama.rn loads a quantised 1B GGUF and completes 10 stage-3 calls on a ' +
        'mid-range Android, with first-token latency, peak RSS and thermals measured.',
    );
  }

  async isAvailable(): Promise<boolean> {
    return false;
  }

  async complete<T>(_request: CompletionRequest): Promise<CompletionResult<T>> {
    throw new NotImplementedRuntimeError('LlamaRnRuntime', 'it needs a React Native host and a physical device');
  }
}

/**
 * Browser inference via WebGPU.
 *
 * Lower risk than the mobile case and lower priority: the shipped script tag routes
 * with stages 1 and 2 and needs no model at all.
 */
export class WebGpuRuntime implements LlmRuntime {
  readonly name = 'webgpu';

  constructor() {
    throw new NotImplementedRuntimeError(
      'WebGpuRuntime',
      'it needs a browser with WebGPU. Local development uses Ollama, so this is ' +
        'only required to run a model in the browser without a local server.',
    );
  }

  async isAvailable(): Promise<boolean> {
    return false;
  }

  async complete<T>(_request: CompletionRequest): Promise<CompletionResult<T>> {
    throw new NotImplementedRuntimeError('WebGpuRuntime', 'it needs a browser with WebGPU');
  }
}
