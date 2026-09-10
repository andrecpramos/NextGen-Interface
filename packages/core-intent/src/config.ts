import type { ExecutableKind } from './types.ts';

// Router thresholds.
//
// These are PER-ENCODER. TF-IDF cosine and a sentence encoder do not produce
// scores on the same scale, so a tauHigh tuned for one is meaningless for the
// other — carrying one set across encoders silently disables stage 2 (every
// score falls under an unreachable bar and everything escalates).
//
// Never hand-tune these. Run:  node eval/calibrate.js --embedder=<kind>
// which sweeps the operating space against the whole golden set under an
// explicit precision constraint and writes the recommended point.

export interface Thresholds {
  /** Stage-2 score at or above which a candidate may be accepted outright. */
  readonly tauHigh: number;
  /** Required gap to the runner-up. A top score means nothing without a margin. */
  readonly delta: number;
  /** Stage-2 out-of-scope floor. Pinned to 0 — see the note below. */
  readonly tauFloor: number;
  /** How many candidates stage 3 may choose between. A property of the MODEL. */
  readonly topK: number;
  /**
   * How decisively a declared limit must beat the best real capability before
   * the turn is refused (ADR-009).
   *
   * A boundary entry describes a whole class of requests ("moving real money"),
   * so it is broad by construction and will attract weak matches that belong
   * elsewhere. At 0 it catches 80% of out-of-scope input but wrongly refuses 10
   * in-domain turns; the calibrated point refuses none. Refusing a real request
   * is the expensive error — it tells the user the app cannot do something it
   * can — so this is constrained, not traded off.
   */
  readonly boundaryMargin: number;
  /**
   * `boundaryMargin`, but for an utterance that asks the assistant to *do*
   * something (ADR-015, accepted 2026-09-10).
   *
   * Always ≤ `boundaryMargin`: the verb is independent evidence of being
   * out-of-scope, so a boundary needs to win by less. Measured, it takes
   * model-free out-of-scope detection from 20.0% to 45.0% at **zero** in-domain
   * false refusals — the same constraint `boundaryMargin` is calibrated under,
   * because refusing a real request is the expensive error.
   *
   * Optional so a registry calibrated before this existed still loads; absent,
   * the engine falls back to `boundaryMargin` and behaves exactly as it did.
   */
  readonly actionBoundaryMargin?: number;
}

export type EmbedderKind = 'hashing' | 'ollama';

export const THRESHOLD_PROFILES: Readonly<Record<EmbedderKind, Thresholds>> = {
  // Recalibrated 2026-08-31 (WP-14) against golden-set.jsonl (80 entries), after
  // the registered domain pivoted from the 60-capability finance registry to
  // the 7-capability "remember this" one. The old finance-era values below are
  // meaningless against this registry — a threshold is a property of the
  // encoder AND the capability surface it is scoring, never a constant to
  // carry forward.
  //
  // tauFloor is still 0, for the same reason as before: a lexical/embedding
  // score alone cannot separate "vague but in-domain" from "off-domain" — see
  // ADR-009. Out-of-scope stays a registry-retrieval problem (boundaryMargin),
  // not a stage-2 threshold problem.
  //
  // Smaller registry, smaller golden set, smaller accept rate: stage 2 now
  // accepts only 10.3% of routable turns (hashing) / 27.6% (nomic-embed-text)
  // at 100% precision — down from 45.3% on the old 60-capability registry.
  // Expected, not a regression: seven capabilities give the embedder far fewer
  // near-miss paraphrases to build a safe margin against, so the calibrator
  // finds a smaller, more conservative accept region. Re-run
  // `node eval/calibrate.js --embedder=<kind> --defer-oos` whenever the
  // registry or the golden set changes — never hand-set these.
  //
  // boundaryMargin also picked up a real fix here, not just a re-run: the
  // sweep's "in-domain wrongly refused" check only looked at entries with an
  // `expect.capability`, which silently excluded the whole `ambiguous` bucket
  // (those assert an outcome, not a capability) from the "never refuse an
  // in-domain turn" constraint. A margin of 0 was passing only because nothing
  // was checking it — genuinely unrelated input ("something entirely
  // unrelated to anything this app does xyzzy") was being refused as a
  // declared limit instead of clarified. Fixed in calibrate.js; the value
  // below is what the corrected sweep recommends.
  hashing: { tauHigh: 0.436, delta: 0.01, tauFloor: 0, topK: 5, boundaryMargin: 0.055 },

  // nomic-embed-text, recalibrated 2026-08-31 (WP-14) with --defer-oos.
  // Accepts 27.6% of routable turns at 100% precision.
  ollama: { tauHigh: 0.715, delta: 0.01, tauFloor: 0, topK: 5, boundaryMargin: 0.1 },
};

/** Sentinel the model may return to mean "none of these capabilities". */
export const OUT_OF_SCOPE_ID = '__out_of_scope__';

/**
 * Kinds where the router requires independent corroboration before acting:
 * stage 3's selection must match stage 2's top-ranked candidate, or the turn
 * degrades to a clarify instead of executing.
 *
 * WP-17, replacing `TAU_ACT_BY_KIND`. That gate read the model's *self-
 * reported* confidence (FINDINGS Finding 8) — a signal close to constant at
 * 1B: it held back 15.7% of stage-3 calls on llama3.1:8b, 0.7% on
 * qwen2.5:1.5b, and gemma3:1b answers "what is the capital of France" at
 * 0.95. ADR-003's amendment asks for a signal the model cannot inflate —
 * stage-2 margin, or agreement between the stage-2 top candidate and the
 * stage-3 selection. This is the second: cheap to compute (no new
 * calibration sweep), and a real backstop against the model alone drifting
 * off the embedding-grounded shortlist.
 *
 * ⚠️ It is not a backstop against every threat this gate's name might
 * suggest. Re-measuring the modules registry (WP-17, 2026-09-09) surfaced
 * `gs-0174`: adversarial text embedded in an otherwise benign utterance made
 * stage 2 itself — not just stage 3 — rank `module.delete` first. Stage 2
 * and stage 3 agreed, so this gate would not have caught it; only the
 * unconditional confirm-before-destructive policy (Rule 5) did. Read as: this
 * closes the "model hallucinated past a weak signal" gap, not the "adversarial
 * text corrupted the embedding itself" gap. See FINDINGS.md.
 *
 * Only write and destructive are gated — navigate and read are cheap and
 * reversible enough that Finding 8's original reasoning (the bar scales with
 * what the action costs to get wrong) puts their bar at zero.
 */
export const REQUIRES_STAGE2_AGREEMENT: ReadonlySet<ExecutableKind> = new Set(['write', 'destructive']);

export const THRESHOLDS: Thresholds = THRESHOLD_PROFILES.hashing;

export function thresholdsFor(embedderKind: string): Thresholds {
  return THRESHOLD_PROFILES[embedderKind as EmbedderKind] ?? THRESHOLD_PROFILES.hashing;
}

export const OLLAMA = {
  host: process.env.OLLAMA_HOST || 'http://127.0.0.1:11434',
  chatModel: process.env.SPIKE_MODEL || 'llama3.1:8b',
  embedModel: process.env.SPIKE_EMBED_MODEL || 'nomic-embed-text',
  timeoutMs: 30000,
} as const;

export { STAGE, OUTCOME } from './types.ts';
export type { Stage, RouterDecision } from './types.ts';
