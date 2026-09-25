/**
 * @nextgen/core-intent — public API.
 *
 * Domain-agnostic. Nothing in here knows what a transaction is. Domains supply
 * a capability registry; this package turns an utterance into an Outcome plus a
 * trace explaining how it got there.
 *
 * See ../README.md for the run commands and eval/FINDINGS.md for the measured
 * behaviour of the cascade — including the two mechanisms that stop working on
 * a phone-class model (Findings 7 and 8). Read those before relying on
 * out-of-scope detection or on the confidence gate.
 */

export { route, type RouteDeps } from './cascade.ts';
export { loadRegistry, similarityAudit, type SimilarPair } from './registry.ts';

// WP-24. `loadRegistry` reads a file and fits an embedder — neither is available
// in a browser. This is the same construction from data already in memory: no
// I/O, no embedder, no network.
export {
  registryFromIndex,
  assertIndexMatches,
  IndexMismatchError,
  indexFor,
  mergeRegistryFiles,
  RegistryMergeError,
  type ShippedIndex,
} from './registry-browser.ts';
export { buildTriggerIndex } from './triggers.ts';
export { toSparse, isSparse, dotStored, type SparseVector, type StoredVector } from './sparse.ts';
export {
  stage1,
  stage2,
  stage3,
  type Stage1Hit,
  type Stage2Result,
  type Stage2Decision,
  type Stage3Result,
} from './stages.ts';
export { makeEmbedder, HashingEmbedder, OllamaEmbeddingRuntime, cosine } from './embedder.ts';
export {
  resolveDateRange,
  resolveMoney,
  resolveEnum,
  resolveSlots,
  buildEnumIndex,
  type DateRange,
  type Money,
  type SlotResolution,
} from './slots.ts';
export { normalize, tokens, features } from './text.ts';

// ADR-015. `actionVocabularyOf` is exported because anything constructing a
// Registry by hand has to build it — the field is not optional, deliberately: a
// registry that forgot it would silently lose the guard and start refusing
// things the application does.
export { isActionRequest, isChangeRequest, actionSignalApplies, actionVocabularyOf } from './action.ts';
export { isMashing } from './mashing.ts';
export {
  THRESHOLD_PROFILES,
  thresholdsFor,
  REQUIRES_STAGE2_AGREEMENT,
  OUT_OF_SCOPE_ID,
  OLLAMA,
  type Thresholds,
  type EmbedderKind,
} from './config.ts';

// The type vocabulary. `mergeParams` in particular is not an implementation
// detail — it is where Rule 11 stops being a convention and starts being a
// compile error.
export {
  STAGE,
  OUTCOME,
  isCapabilityKind,
  deterministicParams,
  modelParams,
  mergeParams,
  toOutcome,
  NO_MODEL_PARAMS,
  type Capability,
  type CapabilityKind,
  type Candidate,
  type DeterministicParams,
  type Embedder,
  type EnumDefinition,
  type EnumIndex,
  type ModelParams,
  type Outcome,
  type ParamSpec,
  type ParamType,
  type Registry,
  type RegistryFile,
  type ResolvedParams,
  type RouterDecision,
  type ScreenContext,
  type SlotValue,
  type Stage,
  type StageLatency,
  type TurnTrace,
  type Utterance,
  type Vector,
} from './types.ts';
