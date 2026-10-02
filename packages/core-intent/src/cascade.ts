import type { LlmRuntime } from '@nextgen/core-inference';
import { isChangeRequest, isExplanationRequest } from './action.ts';
import { isMashing } from './mashing.ts';
import { stage1, stage2, stage3 } from './stages.ts';
import { resolveSlots } from './slots.ts';
import { validateClaims } from './validate-claims.ts';
import {
  THRESHOLDS,
  REQUIRES_STAGE2_AGREEMENT,
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
    explanation: null,
    // Read once, from the utterance alone — it depends on nothing the cascade
    // decides, so it is set here rather than in `settle` and is available even
    // when the turn ends in a clarify or a refusal.
    explanationRequest: isExplanationRequest(utterance),
    changeRequest: isChangeRequest(utterance),
    mashing: false,
    latency: {},
    notes: [],
    prose: null,
    proseRemoved: [],
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
    // Declared at build time, served verbatim (WP-36). This is the second half
    // of the promise — take them there, and tell them what they will find.
    trace.explanation = cap.explanation ?? null;

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

    // Rule 20 (ADR-041). The assistant does not act, so "cancel tomorrow's session" is not a request to
    // be taken to the sessions screen as if the cancelling were done: the screen is offered, never opened.
    // Policy in code, on every stage's way out (Rule 5's shape), not a line in a prompt. A capability that
    // acts itself (`write`, `destructive`) keeps its own confirmation path (ADR-004).
    if (trace.changeRequest && (cap.kind === 'navigate' || cap.kind === 'read')) {
      trace.notes.push('a request to change something — its screen is offered, not opened (Rule 20)');
      return finish(OUTCOME.OUT_OF_SCOPE);
    }

    trace.requiresConfirmation = cap.kind === 'write' || cap.kind === 'destructive';
    return finish(OUTCOME.EXECUTE);
  };

  // ---- before stage 1: keyboard mashing (ADR-039, Rule 18) -----------------
  // Not a question, so not a routing decision: answered at once, with no candidate and no model call.
  if (isMashing(utterance, registry)) {
    trace.mashing = true;
    trace.decidedAt = STAGE.DETERMINISTIC;
    trace.notes.push('keyboard mashing — most of its letter pairs are ones this app never uses (ADR-039)');
    return finish(OUTCOME.CLARIFY);
  }

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
    // Only an incomplete settle (a clarify) escalates; an execute or a Rule-20 offer is final.
    if (result.outcome !== OUTCOME.CLARIFY || !stage3Enabled) return result;
    trace.notes.push('stage1 identified capability but slots incomplete — escalating');
  }

  // ---- stage 2 -------------------------------------------------------------
  const s2Start = performance.now();
  const s2 = await stage2(utterance, registry, embedder, thresholds);
  trace.latency.stage2 = performance.now() - s2Start;
  trace.candidates = s2.candidates;
  trace.margin = s2.margin;
  trace.topScore = s2.top.score;
  if (s2.sharedWords) {
    trace.notes.push(`not moved: "${s2.sharedWords.join('", "')}" belong to the runner-up too (Rule 19)`);
  }

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
    // Only an incomplete settle (a clarify) escalates; an execute or a Rule-20 offer is final.
    if (result.outcome !== OUTCOME.CLARIFY || !stage3Enabled) return result;
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
    // A written answer only when one was asked for: "what is X", "how do I Y". Anything else is
    // answered by the destination, and prose would only be waited for (see `Stage3Options.prose`).
    s3 = await stage3(utterance, s2.candidates, registry, ctx, { runtime: runtime!, model, prose: trace.explanationRequest });
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

  // ADR-019, WP-53. Runs regardless of which branch below decides the turn — a written
  // answer can accompany an execute, an explain-via-out-of-scope, or even a degrade to
  // clarify, and every one of those still deserves the same check before anything from
  // the model reaches a visitor. `registry` here is the same one `route()` was called
  // with — the caller's own role's registry — so "not in this role's registry" is Rule
  // 17's own test, run against prose instead of against a served file.
  if (s3.rawProse !== undefined) {
    const validated = validateClaims(s3.rawProse, registry);
    trace.prose = validated.text;
    trace.proseRemoved = validated.removed;
    for (const removal of validated.removed) {
      trace.notes.push(`prose dropped a sentence (${removal.reason}): "${removal.sentence.slice(0, 80)}"`);
    }
  }

  if (s3.capabilityId === OUT_OF_SCOPE_ID) {
    trace.decidedAt = STAGE.LLM;
    trace.notes.push('stage3 judged this outside the application domain');
    return finish(OUTCOME.OUT_OF_SCOPE);
  }

  if (s3.hallucinatedId) trace.notes.push(`rejected unknown id "${s3.hallucinatedId}"`);
  if (s3.parseFailed) trace.notes.push('constrained decoding produced unparseable output');

  if (!s3.capabilityId) {
    trace.decidedAt = STAGE.LLM;
    trace.notes.push('stage3 selected nothing');
    return finish(OUTCOME.CLARIFY);
  }

  // The bar to act scales with what the action costs to get wrong (WP-01).
  // WP-17 replaced the signal: self-reported confidence was close to constant
  // at 1B (Finding 8) and did not stand between a weak signal and a write.
  // Stage-2/stage-3 agreement is a signal the model cannot inflate — see
  // REQUIRES_STAGE2_AGREEMENT's doc comment for what it does and does not
  // cover (`isExecutableKind` narrows past 'unsupported', which never
  // executes and is never offered to stage 3 anyway).
  const proposedKind = registry.byId.get(s3.capabilityId)?.kind;
  if (
    proposedKind !== undefined && isExecutableKind(proposedKind)
    && REQUIRES_STAGE2_AGREEMENT.has(proposedKind)
    && s3.capabilityId !== s2.top.capabilityId
  ) {
    trace.decidedAt = STAGE.LLM;
    trace.notes.push(
      `stage3 selected "${s3.capabilityId}" (kind "${proposedKind}") but stage2's independent ` +
        `top candidate was "${s2.top.capabilityId}" — no corroboration, refusing to act`,
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
