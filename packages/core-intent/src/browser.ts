// @nextgen/core-intent/browser
//
// The browser-safe surface (WP-24, WP-26).
//
// ## Why this file exists rather than a note in the README
//
// The root export re-exports `loadRegistry`, and `registry.ts` opens with
// `import { readFileSync } from 'node:fs'`. That is correct for a build step and
// fatal for a bundle: an adopter running Vite or Next against
// `@nextgen/core-intent` pulls `node:fs` into a browser target, and depending on
// their config that is either a build failure or a polyfill shipped to every
// user. Neither is acceptable in a package sold on "it installs into your app".
//
// An entry point is the only thing that fixes it. Tree-shaking does not: the
// import is at module scope, so the specifier is resolved whether or not
// `loadRegistry` is ever called.
//
// Everything here is reachable from the root export too. This entry adds no
// capability — it **removes** the one import an adopter's bundler cannot take.
//
// The paired build-time entry is the root, which a generator step runs under
// Node and where `node:fs` is exactly what you want.

export { route } from './cascade.ts';
export { stage1, stage2, stage3, RuntimeUnavailableError } from './stages.ts';
export {
  registryFromIndex,
  assertIndexMatches,
  IndexMismatchError,
  type ShippedIndex,
} from './registry-browser.ts';
export { HashingEmbedder, makeEmbedder, cosine } from './embedder.ts';
export { resolveSlots, buildEnumIndex } from './slots.ts';
export { normalize, tokens, features, contentTokens } from './text.ts';
export { isActionRequest, isExplanationRequest, actionSignalApplies, actionVocabularyOf } from './action.ts';
export { THRESHOLDS, THRESHOLD_PROFILES, thresholdsFor, OUT_OF_SCOPE_ID } from './config.ts';
export { OUTCOME, STAGE } from './types.ts';
export type {
  Capability,
  Embedder,
  EnumIndex,
  Registry,
  RegistryFile,
  RouterDecision,
  ScreenContext,
  SlotValue,
  Stage,
  TurnTrace,
  Vector,
} from './types.ts';
export type { Thresholds } from './config.ts';
// WP-52 (ADR-017): a browser build now needs the shape of the stage-3 transport
// to implement one. Type-only, same as the `LlmRuntime` import `cascade.ts`
// already makes directly from `@nextgen/core-inference` — this adds no runtime
// import, only a name the compiler erases (`verbatimModuleSyntax`).
export type { CompletionRequest, CompletionResult, JsonSchema, LlmRuntime } from '@nextgen/core-inference';
