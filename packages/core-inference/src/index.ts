// @nextgen/core-inference
//
// One interface, swappable runtimes.
//
// This package exists because of a risk, not an abstraction habit: nobody has
// yet proved that llama.rn can load a quantised 1B GGUF and complete a stage-3
// call on a mid-range Android (WP-10 gates exactly that). If it cannot, only
// this package changes.

export {
  ModelIntegrityError,
  type CompletionRequest,
  type CompletionResult,
  type EmbeddingRuntime,
  type JsonSchema,
  type LlmRuntime,
  type ModelDescriptor,
  type ModelState,
  type ModelStatus,
  type Vector,
} from './types.ts';

export { OllamaLlmRuntime, OllamaEmbeddingRuntime, type OllamaOptions } from './ollama.ts';
export { FakeLlmRuntime, FakeEmbeddingRuntime, type FakeCompletion, type FakeLlmOptions } from './fake.ts';
export { LlamaRnRuntime, WebGpuRuntime, NotImplementedRuntimeError } from './platform.ts';
export { ModelStore, sha256File, type ModelStoreOptions } from './model-store.ts';

// Rule 15. Every site that interpolates attacker-reachable content into a prompt
// calls `fence`; `untrusted.ts` is explicit about which half of the guarantee is
// structural and which depends on the model.
export { fence, redact, redactTag, UNTRUSTED_NOTICE } from './untrusted.ts';
