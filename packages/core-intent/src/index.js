/**
 * @nextgen/core-intent — public API.
 *
 * Domain-agnostic. Nothing in here knows what a transaction is. Domains supply
 * a capability registry; this package turns an utterance into an Outcome plus a
 * trace explaining how it got there.
 *
 * See ../README.md for the run commands and eval/FINDINGS.md for the measured
 * behaviour of the cascade.
 */

export { route } from './cascade.js';
export { loadRegistry, similarityAudit } from './registry.js';
export { stage1, stage2, stage3 } from './stages.js';
export { makeEmbedder, HashingEmbedder, OllamaEmbedder, cosine } from './embedder.js';
export {
  resolveDateRange,
  resolveMoney,
  resolveEnum,
  resolveSlots,
  buildEnumIndex,
} from './slots.js';
export { normalize, tokens, features } from './text.js';
export {
  THRESHOLD_PROFILES,
  thresholdsFor,
  TAU_ACT_BY_KIND,
  TAU_ACT_DEFAULT,
  OUT_OF_SCOPE_ID,
  STAGE,
  OUTCOME,
  OLLAMA,
} from './config.js';
