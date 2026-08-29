import { stage1, stage2, stage3 } from './stages.js';
import { resolveSlots } from './slots.js';
import { THRESHOLDS, STAGE, OUTCOME, OUT_OF_SCOPE_ID, TAU_ACT_BY_KIND, TAU_ACT_DEFAULT } from './config.js';

/**
 * The cascade. Produces a TurnTrace with the same shape as the one in
 * architecture.md, because the trace IS the explainability feature — not a log.
 *
 * Ordering is the whole design: never spend a stage you do not need.
 */
export async function route(utterance, ctx, deps) {
  const { registry, embedder, thresholds = THRESHOLDS, useStage3 = true, model } = deps;
  const t0 = performance.now();

  const trace = {
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

  const finish = (outcome) => {
    trace.outcome = outcome;
    trace.latency.total = performance.now() - t0;
    return trace;
  };

  // Applies dispatcher policy (ADR-004) and the required-slot check. A capability
  // whose required params are unresolved is not executable, however confident
  // the router is about which capability it is.
  const settle = (capabilityId, stage) => {
    const cap = registry.byId.get(capabilityId);
    trace.capabilityId = capabilityId;
    trace.decidedAt = stage;
    trace.kind = cap.kind;
    trace.route = cap.route;

    const { params, missing } = resolveSlots(cap, utterance, ctx, registry.enums);
    // Deterministic resolution wins. Spread order matters and this one was
    // backwards on the first run: the model answered "last month" with
    // 2026-07-29..2026-08-29 (it counted 30 days back) and overwrote the
    // correct 2026-07-01..2026-07-31 from the date grammar. That is the
    // "model never computes a number the user sees" rule earning its place —
    // as a spread order, not a slogan.
    trace.params = { ...trace.params, ...params };
    trace.missing = missing.filter((m) => trace.params[m] === undefined);

    if (trace.missing.length > 0) {
      trace.notes.push(`missing required: ${trace.missing.join(', ')}`);
      return finish(OUTCOME.CLARIFY);
    }

    // Unclassified fails closed — see ADR-004. Never default to read.
    if (!['read', 'navigate', 'write', 'destructive'].includes(cap.kind)) {
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
    const result = settle(hit.capabilityId, STAGE.DETERMINISTIC);
    // A stage-1 phrase match that leaves required slots empty is not a failure
    // of stage 1 — it identified the capability correctly. Let stage 3 try to
    // fill the gap before giving up and asking.
    if (result.outcome === OUTCOME.EXECUTE || !useStage3) return result;
    trace.notes.push('stage1 identified capability but slots incomplete — escalating');
  }

  // ---- stage 2 -------------------------------------------------------------
  const s2Start = performance.now();
  const s2 = await stage2(utterance, registry, embedder, thresholds);
  trace.latency.stage2 = performance.now() - s2Start;
  trace.candidates = s2.candidates;
  trace.margin = s2.margin;
  trace.topScore = s2.top.score;

  if (s2.decision === 'out_of_scope') {
    trace.decidedAt = STAGE.EMBEDDING;
    trace.notes.push(`top score ${s2.top.score.toFixed(3)} below floor ${thresholds.tauFloor}`);
    return finish(OUTCOME.OUT_OF_SCOPE);
  }

  if (s2.decision === 'accept' && !hit) {
    const result = settle(s2.top.capabilityId, STAGE.EMBEDDING);
    if (result.outcome === OUTCOME.EXECUTE || !useStage3) return result;
    trace.notes.push('stage2 accepted but slots incomplete — escalating');
  }

  if (!useStage3) {
    trace.decidedAt = STAGE.EMBEDDING;
    trace.notes.push('stage3 disabled');
    return finish(OUTCOME.CLARIFY);
  }

  // ---- stage 3 -------------------------------------------------------------
  let s3;
  try {
    s3 = await stage3(utterance, s2.candidates, registry, ctx, { model });
  } catch (err) {
    // Model unavailable is a normal case, not an exception path. Degrade to a
    // clarify built from what stage 2 already knows (sdlc/design.md).
    trace.decidedAt = STAGE.EMBEDDING;
    trace.llmError = String(err.message || err);
    trace.notes.push('stage3 unavailable — degraded to clarify');
    return finish(OUTCOME.CLARIFY);
  }

  trace.latency.stage3 = s3.latencyMs;
  trace.confidence = s3.confidence;

  if (s3.capabilityId === OUT_OF_SCOPE_ID) {
    trace.decidedAt = STAGE.LLM;
    trace.notes.push('stage3 judged this outside the application domain');
    return finish(OUTCOME.OUT_OF_SCOPE);
  }

  if (s3.hallucinatedId) trace.notes.push(`rejected unknown id "${s3.hallucinatedId}"`);
  if (s3.parseFailed) trace.notes.push('constrained decoding produced unparseable output');

  // The bar to act scales with what the action costs to get wrong.
  const proposedKind = registry.byId.get(s3.capabilityId)?.kind;
  const tauAct = TAU_ACT_BY_KIND[proposedKind] ?? thresholds.tauAct ?? TAU_ACT_DEFAULT;

  if (!s3.capabilityId || s3.confidence < tauAct) {
    trace.decidedAt = STAGE.LLM;
    trace.notes.push(
      `confidence ${(s3.confidence ?? 0).toFixed(2)} below tauAct ${tauAct} for kind "${proposedKind}"`,
    );
    return finish(OUTCOME.CLARIFY);
  }

  // Deterministic slots win over model-extracted ones, always. The model is a
  // fallback for what the resolvers could not read, never an override.
  const cap = registry.byId.get(s3.capabilityId);
  const modelParams = {};
  for (const [k, v] of Object.entries(s3.params || {})) {
    if (cap.params?.[k] && v !== null && v !== '') modelParams[k] = v;
  }
  trace.params = modelParams;

  return settle(s3.capabilityId, STAGE.LLM);
}
