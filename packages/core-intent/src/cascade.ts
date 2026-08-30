import type { LlmRuntime } from '@nextgen/core-inference';
import { stage1, stage2, stage3 } from './stages.ts';
import { resolveSlots } from './slots.ts';
import {
  THRESHOLDS,
  TAU_ACT_BY_KIND,
  TAU_ACT_DEFAULT,
  OUT_OF_SCOPE_ID,
  type Thresholds,
} from './config.ts';
import {
  isCapabilityKind,
  isExecutableKind,
  mergeParams,
  modelParams,
  NO_MODEL_PARAMS,
  OUTCOME,
  STAGE,
  type Embedder,
  type ModelParams,
  type Registry,
  type RouterDecision,
  type ScreenContext,
  type SlotValue,
  type Stage,
  type TurnTrace,
  type Utterance,
} from './types.ts';

export interface RouteDeps {
  readonly registry: Registry;
  readonly embedder: Embedder;
  readonly thresholds?: Thresholds;
  readonly useStage3?: boolean;
  /**
   * The stage-3 runtime. Omit it and the cascade runs stages 1–2 only — the same
   * degraded path it takes when a runtime is present but unreachable.
   */
  readonly runtime?: LlmRuntime | undefined;
  readonly model?: string | undefined;
}

/**
 * The cascade. Produces a TurnTrace with the same shape as the one in
 * architecture.md, because the trace IS the explainability feature — not a log.
 *
 * Ordering is the whole design: never spend a stage you do not need.
 */
export async function route(
  utterance: Utterance,
  ctx: ScreenContext,
  deps: RouteDeps,
): Promise<TurnTrace> {
  const { registry, embedder, thresholds = THRESHOLDS, useStage3 = true, runtime, model } = deps;
  // No runtime is indistinguishable from an unreachable one, deliberately.
  const stage3Enabled = useStage3 && runtime !== undefined;
  const t0 = performance.now();

  const trace: TurnTrace = {
    utterance,
    context: ctx,
    decidedAt: STAGE.NONE,
    candidates: [],
    outcome: null,
    capabilityId: null,
    params: {},
    missing: [],
    requiresConfirmation: false,
    kind: null,
    route: null,
    latency: {},
    notes: [],
  };

  const finish = (outcome: RouterDecision): TurnTrace => {
    trace.outcome = outcome;
    trace.latency.total = performance.now() - t0;
    return trace;
  };

  /**
   * Applies dispatcher policy (ADR-004) and the required-slot check. A capability
   * whose required params are unresolved is not executable, however confident
   * the router is about which capability it is.
   *
   * `fromModel` is the only route by which model-extracted params enter, and it
   * can only ever lose to the deterministic ones — see `mergeParams`.
   */
  const settle = (capabilityId: string, stage: Stage, fromModel: ModelParams = NO_MODEL_PARAMS): TurnTrace => {
    const cap = registry.byId.get(capabilityId)!;
    trace.capabilityId = capabilityId;
    trace.decidedAt = stage;
    trace.kind = cap.kind;
    trace.route = cap.route;

    const { params: deterministic, missing } = resolveSlots(cap, utterance, ctx, registry.enums);

    // Deterministic resolution wins. This used to be a spread, and it was
    // backwards on the first run: the model answered "last month" with
    // 2026-07-29..2026-08-29 (it counted 30 days back) and overwrote the
    // correct 2026-07-01..2026-07-31 from the date grammar. One character of
    // spread order was worth 44 points of param exactness.
    //
    // It is now a type error to get this wrong: `mergeParams` takes the two
    // sides as distinct nominal types, so there is exactly one way to call it.
    trace.params = mergeParams(fromModel, deterministic).values;
    trace.missing = missing.filter((m) => trace.params[m] === undefined);

    if (trace.missing.length > 0) {
      trace.notes.push(`missing required: ${trace.missing.join(', ')}`);
      return finish(OUTCOME.CLARIFY);
    }

    // Unclassified fails closed — see ADR-004. Never default to read.
    if (!isCapabilityKind(cap.kind)) {
      trace.notes.push(`unclassified kind "${cap.kind}" — refusing`);
      return finish(OUTCOME.CLARIFY);
    }

    trace.requiresConfirmation = cap.kind === 'write' || cap.kind === 'destructive';
    return finish(OUTCOME.EXECUTE);
  };

  // ---- stage 1 -------------------------------------------------------------
  const s1Start = performance.now();
  const hit = stage1(utterance, registry);
  trace.latency.stage1 = performance.now() - s1Start;

  if (hit) {
    trace.candidates = [{ capabilityId: hit.capabilityId, score: hit.score }];
    trace.notes.push(`stage1 matched "${hit.matched}"`);

    // A trigger on a declared limit is as decisive as any other trigger, and
    // cheaper than every stage below it (ADR-009).
    if (registry.boundaryIds.has(hit.capabilityId)) {
      trace.capabilityId = hit.capabilityId;
      trace.decidedAt = STAGE.DETERMINISTIC;
      trace.kind = 'unsupported';
      trace.notes.push('declared limit — the application does not do this');
      return finish(OUTCOME.OUT_OF_SCOPE);
    }
    const result = settle(hit.capabilityId, STAGE.DETERMINISTIC);
    // A stage-1 phrase match that leaves required slots empty is not a failure
    // of stage 1 — it identified the capability correctly. Let stage 3 try to
    // fill the gap before giving up and asking.
    if (result.outcome === OUTCOME.EXECUTE || !stage3Enabled) return result;
    trace.notes.push('stage1 identified capability but slots incomplete — escalating');
  }

  // ---- stage 2 -------------------------------------------------------------
  const s2Start = performance.now();
  const s2 = await stage2(utterance, registry, embedder, thresholds);
  trace.latency.stage2 = performance.now() - s2Start;
  trace.candidates = s2.candidates;
  trace.margin = s2.margin;
  trace.topScore = s2.top.score;

  if (s2.decision === 'refuse' && s2.boundaryId) {
    // Retrieved, not judged: no model was consulted, so this behaves the same on
    // a 1B model as on an 8B one. That is the entire point of ADR-009.
    trace.capabilityId = s2.boundaryId;
    trace.decidedAt = STAGE.EMBEDDING;
    trace.kind = 'unsupported';
    trace.notes.push(
      `declared limit "${s2.boundaryId}" led the best capability by ` +
        `${(s2.boundaryMargin ?? 0).toFixed(3)} (>= ${thresholds.boundaryMargin})`,
    );
    return finish(OUTCOME.OUT_OF_SCOPE);
  }

  if (s2.decision === 'out_of_scope') {
    trace.decidedAt = STAGE.EMBEDDING;
    trace.notes.push(`top score ${s2.top.score.toFixed(3)} below floor ${thresholds.tauFloor}`);
    return finish(OUTCOME.OUT_OF_SCOPE);
  }

  if (s2.decision === 'accept' && !hit) {
    const result = settle(s2.top.capabilityId, STAGE.EMBEDDING);
    if (result.outcome === OUTCOME.EXECUTE || !stage3Enabled) return result;
    trace.notes.push('stage2 accepted but slots incomplete — escalating');
  }

  if (!stage3Enabled) {
    trace.decidedAt = STAGE.EMBEDDING;
    trace.notes.push('stage3 disabled');
    return finish(OUTCOME.CLARIFY);
  }

  // ---- stage 3 -------------------------------------------------------------
  let s3;
  try {
    s3 = await stage3(utterance, s2.candidates, registry, ctx, { runtime: runtime!, model });
  } catch (err) {
    // Model unavailable is a normal case, not an exception path. Degrade to a
    // clarify built from what stage 2 already knows (sdlc/design.md).
    trace.decidedAt = STAGE.EMBEDDING;
    trace.llmError = String(err instanceof Error ? err.message : err);
    trace.notes.push('stage3 unavailable — degraded to clarify');
    return finish(OUTCOME.CLARIFY);
  }

  trace.latency.stage3 = s3.latencyMs;
  trace.selfReportedConfidence = s3.selfReportedConfidence;

  if (s3.capabilityId === OUT_OF_SCOPE_ID) {
    trace.decidedAt = STAGE.LLM;
    trace.notes.push('stage3 judged this outside the application domain');
    return finish(OUTCOME.OUT_OF_SCOPE);
  }

  if (s3.hallucinatedId) trace.notes.push(`rejected unknown id "${s3.hallucinatedId}"`);
  if (s3.parseFailed) trace.notes.push('constrained decoding produced unparseable output');

  // The bar to act scales with what the action costs to get wrong.
  //
  // Caveat measured in WP-01: at 1B this gate almost never fires, because the
  // confidence it reads is self-reported and close to constant. Keep it — it is
  // correct policy and free — but it is no longer the thing standing between a
  // weak signal and a write. See FINDINGS Finding 8.
  // `isExecutableKind` rather than `isCapabilityKind`: a declared limit has no
  // confidence at which it would be allowed to run, and stage 3 is never offered
  // one anyway. tsc enforces the distinction — TAU_ACT_BY_KIND is keyed by
  // ExecutableKind, so indexing it with a possible 'unsupported' does not compile.
  const proposedKind = s3.capabilityId !== null ? registry.byId.get(s3.capabilityId)?.kind : undefined;
  const tauAct = proposedKind !== undefined && isExecutableKind(proposedKind)
    ? TAU_ACT_BY_KIND[proposedKind]
    : thresholds.tauAct ?? TAU_ACT_DEFAULT;

  if (!s3.capabilityId || s3.selfReportedConfidence < tauAct) {
    trace.decidedAt = STAGE.LLM;
    trace.notes.push(
      `confidence ${s3.selfReportedConfidence.toFixed(2)} below tauAct ${tauAct} for kind "${proposedKind}"`,
    );
    return finish(OUTCOME.CLARIFY);
  }

  // Keep only params the capability actually declares. A model-supplied key the
  // registry does not know about is dropped, not passed through (Rule 4).
  const cap = registry.byId.get(s3.capabilityId)!;
  const kept: Record<string, SlotValue> = {};
  for (const [k, v] of Object.entries(s3.rawParams)) {
    if (cap.params?.[k] && v !== null && v !== '') kept[k] = v;
  }

  return settle(s3.capabilityId, STAGE.LLM, modelParams(kept));
}
