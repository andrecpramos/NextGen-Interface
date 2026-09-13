/**
 * Core types for the intent engine.
 *
 * These exist to make three of the project's non-negotiable rules *unstateable*
 * rather than merely documented:
 *
 *   Rule 2  the model never computes a number the user sees
 *   Rule 4  every model-produced identifier is validated against the registry
 *   Rule 11 deterministic slot values always win over model-extracted ones
 *
 * Rule 11 in particular was a real bug (FINDINGS Finding 3): one reversed spread
 * cost 44 points of param exactness and was invisible in review. It is now a
 * compile error — see `DeterministicParams` / `ModelParams` below.
 *
 * Nothing here knows what a transaction is. This package is domain-agnostic.
 */

// ---------------------------------------------------------------- registry --

/**
 * The registry vocabulary has ONE definition, and it lives in
 * `@nextgen/core-capability`. It is re-exported here so that consumers of the
 * router get a complete type surface, but this package does not own it — a
 * router that defines its own idea of what a capability is, is a router that
 * will one day disagree with the thing generating the routes.
 */
export {
  isCapabilityKind,
  isExecutableKind,
  type Capability,
  type CapabilityExample,
  type CapabilityKind,
  type EnumDefinition,
  type ExecutableKind,
  type ParamSpec,
  type ParamType,
  type RegistryFile,
} from '@nextgen/core-capability';

import { isCapabilityKind } from '@nextgen/core-capability';
import type { Vector } from '@nextgen/core-inference';
import type { Capability } from '@nextgen/core-capability';

/** Surface form → canonical value, plus leaf → parent for category roll-up. */
export interface EnumIndex {
  readonly index: Map<string, string>;
  readonly rollup: Map<string, string>;
}

/** A loaded registry: the file plus everything the stages precompute from it. */
export interface Registry {
  readonly schemaVersion: number;
  /** What application stage 3 is routing for (WP-16, D-2). See `RegistryFile`. */
  readonly domainDescription: string;
  readonly capabilities: readonly Capability[];
  readonly byId: ReadonlyMap<string, Capability>;
  readonly triggerIndex: ReadonlyMap<string, string>;
  readonly documents: readonly string[];
  readonly vectors: readonly Vector[];
  readonly enums: Readonly<Record<string, EnumIndex>>;
  /** Ids of the declared limits (ADR-009). Precomputed; consulted on every turn. */
  readonly boundaryIds: ReadonlySet<string>;
  /**
   * Every action verb that appears anywhere in this registry's real
   * capabilities (ADR-015's guard). Precomputed; consulted on every turn.
   *
   * **Registry-wide on purpose, not top-candidate.** The guard answers "does
   * this application do this?", and that is a property of the registry — not of
   * whatever retrieval happened to rank first. WP-40 measured the difference:
   * asking the top candidate silenced *none* of the five in-domain false flags,
   * because for all five the top candidate was the wrong screen. Basing a safety
   * guard on the ranking makes it fail exactly when retrieval fails, which is
   * when it is most needed.
   */
  readonly actionVocabulary: ReadonlySet<string>;
}

// --------------------------------------------------------------- embedding --

/**
 * The encoder contract lives in `core-inference` alongside the LLM runtime —
 * both are "a model this package talks to", and defining one of them here and
 * the other there is how the two drift apart.
 */
export type { Vector, EmbeddingRuntime as Embedder } from '@nextgen/core-inference';

// ------------------------------------------------------------------- input --

/** What the user said. A branded string, so a route can never be passed as one. */
export type Utterance = string & { readonly __brand?: 'Utterance' };

/**
 * Where the user is when they say it.
 *
 * `selection` is not decorative: FINDINGS Part I identified resolving a target
 * from the current selection as the single largest available reduction in
 * stage-3 escalation. A free-text `target` param can never be resolved
 * deterministically, but "delete that one" on a screen with a row selected can.
 */
export interface ScreenContext {
  readonly route: string;
  /** ISO date (YYYY-MM-DD). Every date resolver is relative to this, never to the clock. */
  readonly today: string;
  readonly selection?: string;
}

// ------------------------------------------------------------------- slots --

/** Slot values are scalars. Anything richer belongs in the domain, not the router. */
export type SlotValue = string | number;

declare const DETERMINISTIC_BRAND: unique symbol;
declare const MODEL_BRAND: unique symbol;
declare const RESOLVED_BRAND: unique symbol;

/**
 * Params produced by code — the date grammar, the money parser, the enum matcher.
 * These are correct by construction and always win.
 */
export interface DeterministicParams {
  readonly [DETERMINISTIC_BRAND]: true;
  readonly values: Readonly<Record<string, SlotValue>>;
}

/**
 * Params extracted by the model. Untrusted, and specifically untrusted about
 * *numbers*: asked for "last month" the model answered with thirty days back
 * (FINDINGS Finding 3). Never let these overwrite a deterministic value.
 */
export interface ModelParams {
  readonly [MODEL_BRAND]: true;
  readonly values: Readonly<Record<string, SlotValue>>;
}

/** The merged result. Branded so it cannot be fed back in as either input. */
export interface ResolvedParams {
  readonly [RESOLVED_BRAND]: true;
  readonly values: Readonly<Record<string, SlotValue>>;
}

export function deterministicParams(values: Record<string, SlotValue>): DeterministicParams {
  return { values } as DeterministicParams;
}

export function modelParams(values: Record<string, SlotValue>): ModelParams {
  return { values } as ModelParams;
}

export const NO_MODEL_PARAMS: ModelParams = modelParams({});

/**
 * **Rule 11, as a function signature.**
 *
 * The parameters are distinct nominal types, so `mergeParams(deterministic, model)`
 * does not compile. There is exactly one way to call this, and it is the correct
 * one. The precedence is not a convention a reviewer has to notice in a spread —
 * it is the only program that type-checks.
 */
export function mergeParams(model: ModelParams, deterministic: DeterministicParams): ResolvedParams {
  return { values: { ...model.values, ...deterministic.values } } as ResolvedParams;
}

// ---------------------------------------------------------------- outcomes --

/**
 * What the router decided. These three strings are the wire format the golden
 * set asserts against — do not rename them without regenerating every scorecard.
 */
export const OUTCOME = {
  EXECUTE: 'execute',
  CLARIFY: 'clarify',
  OUT_OF_SCOPE: 'out_of_scope',
} as const;

export type RouterDecision = (typeof OUTCOME)[keyof typeof OUTCOME];

export const STAGE = {
  DETERMINISTIC: 'deterministic',
  EMBEDDING: 'embedding',
  LLM: 'llm',
  NONE: 'none',
} as const;

export type Stage = (typeof STAGE)[keyof typeof STAGE];

/**
 * The dispatch-level outcome from architecture.md.
 *
 * The router does not produce these — it produces a `RouterDecision` plus a
 * capability, and the dispatcher (WP-03) turns that pair into one of these.
 * The type lives here because it is the contract between the two, and because
 * `toOutcome` below is the only place the kind → outcome mapping is written
 * down. An outcome may combine: a typical turn is Perform, then Navigate, then
 * Answer.
 */
export type Outcome =
  | { readonly type: 'navigate'; readonly route: string; readonly params: Readonly<Record<string, SlotValue>> }
  | { readonly type: 'answer'; readonly capabilityId: string; readonly params: Readonly<Record<string, SlotValue>> }
  | { readonly type: 'perform'; readonly actionId: string; readonly args: Readonly<Record<string, SlotValue>>; readonly requiresConfirmation: true }
  | { readonly type: 'clarify'; readonly question: string; readonly options: readonly string[] }
  | { readonly type: 'out_of_scope'; readonly reason: string };

// ------------------------------------------------------------------- trace --

export interface Candidate {
  readonly capabilityId: string;
  readonly score: number;
}

export interface StageLatency {
  stage1?: number;
  stage2?: number;
  stage3?: number;
  total?: number;
}

/**
 * The record of one turn. Rule 9: explainability is this record, never model
 * narration — which is why there is no field here for the model's prose, and
 * why `reasoning` from stage 3 is deliberately not carried through.
 */
export interface TurnTrace {
  readonly utterance: Utterance;
  readonly context: ScreenContext;
  decidedAt: Stage;
  candidates: readonly Candidate[];
  outcome: RouterDecision | 'error' | null;
  capabilityId: string | null;
  params: Readonly<Record<string, SlotValue>>;
  missing: readonly string[];
  requiresConfirmation: boolean;
  kind: string | null;
  route: string | null;
  /**
   * The resolved capability's declared explanation, copied verbatim (WP-36).
   *
   * This is what closes the second half of §1.1's promise — *"it takes them to
   * the right place, and tells them what to do once they are there"*. The
   * surface renders it alongside the navigation; nothing generates it, and no
   * model is involved in producing it at run time, because it was written when
   * the registry was built.
   *
   * `null` when the capability declares none, which the validator only permits
   * for a declared limit — a limit answers the same question with its refusal.
   */
  explanation: string | null;
  /**
   * Did the user ask what something *is*, rather than to be taken to it?
   * (WP-36's detection half, reusing ADR-015's frame layer.)
   *
   * Model-free, and it changes **no** routing decision — the capability and the
   * route resolve identically either way. It tells a surface which half of the
   * promise to lead with: the destination, or the declared explanation of what
   * is there. A false negative is cheap, because the explanation is served as a
   * caption regardless.
   */
  explanationRequest: boolean;
  latency: StageLatency;
  notes: string[];
  margin?: number;
  topScore?: number;
  /**
   * The model's *self-reported* confidence. Named for what it is, because it is
   * not calibrated and at 1B it is very nearly a constant: the gate held back
   * 15.7% of stage-3 calls on llama3.1:8b and 0.7% on qwen2.5:1.5b
   * (FINDINGS Finding 8). Do not read this as a probability, and do not add a
   * gate that depends on it being one without measuring on the smallest model
   * you intend to ship.
   */
  selfReportedConfidence?: number;
  llmError?: string;
  error?: string;
}

/**
 * The kind → outcome mapping, in one place.
 *
 * Confirmation is driven by kind and nothing else (ADR-004): write and
 * destructive always confirm, and no confidence score can waive it.
 */
export function toOutcome(trace: TurnTrace, registry: Registry): Outcome {
  if (trace.outcome === OUTCOME.OUT_OF_SCOPE) {
    return { type: 'out_of_scope', reason: trace.notes.at(-1) ?? 'outside the application domain' };
  }

  if (trace.outcome !== OUTCOME.EXECUTE || trace.capabilityId === null) {
    return {
      type: 'clarify',
      question: trace.missing.length
        ? `Which ${trace.missing.join(' and ')}?`
        : 'Which of these did you mean?',
      options: trace.candidates.map((c) => c.capabilityId),
    };
  }

  const cap = registry.byId.get(trace.capabilityId);
  const kind = cap?.kind ?? '';

  if (!isCapabilityKind(kind)) {
    // Unreachable if the cascade did its job; kept because "unclassified fails
    // closed" must hold at every layer that reads a kind, not just the first.
    return { type: 'out_of_scope', reason: `unclassified capability kind "${kind}"` };
  }

  switch (kind) {
    case 'unsupported':
      // A declared limit, not a failure to understand. The refusal is authored
      // in the registry alongside the thing being refused, so the user is told
      // what the app *does* do rather than just being turned away (ADR-009).
      return {
        type: 'out_of_scope',
        reason: cap!.refusal ?? 'That is outside what this application does.',
      };
    case 'navigate':
      return { type: 'navigate', route: cap!.route!, params: trace.params };
    case 'read':
      return { type: 'answer', capabilityId: trace.capabilityId, params: trace.params };
    case 'write':
    case 'destructive':
      return {
        type: 'perform',
        actionId: trace.capabilityId,
        args: trace.params,
        requiresConfirmation: true,
      };
  }
}
