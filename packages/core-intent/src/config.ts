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
  /** Fallback confidence bar, used only when the kind is unknown. */
  readonly tauAct?: number;
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
 * Confidence required to act, BY CAPABILITY KIND.
 *
 * A single global tauAct is the wrong shape, and the golden set showed why.
 * Given the bare utterance "budget", the model answers budget.view at ~0.6
 * confidence. Punishing that is wrong: navigating to a screen is cheap,
 * instantly visible, and reversible with the back gesture. Given "add 50" it
 * answers transaction.create — same confidence, but now it has guessed a
 * category and is about to write a financial record.
 *
 * The cost of being wrong differs by two orders of magnitude, so the evidence
 * required to proceed should differ too. Asking is cheap; a wrong write is not.
 *
 * ⚠️ WP-01 UPDATE (FINDINGS Finding 8): this gate reads the model's *self-
 * reported* confidence, and that signal is close to constant at 1B. It held
 * back 15.7% of stage-3 calls on llama3.1:8b, 0.7% on qwen2.5:1.5b, and
 * gemma3:1b answers "what is the capital of France" at 0.95. The policy below
 * is still right; the signal it reads has stopped carrying information. The
 * replacement should be something the model cannot inflate — stage-2 margin,
 * or agreement between the stage-2 top candidate and the stage-3 selection.
 * Until then, treat this as defence in depth, not as the safety mechanism.
 */
// Keyed by ExecutableKind, not CapabilityKind: `unsupported` never executes, so
// there is no confidence at which it would be allowed to. Making that a type
// error is cheaper than remembering it.
export const TAU_ACT_BY_KIND: Readonly<Record<ExecutableKind, number>> = {
  navigate: 0.35,
  read: 0.45,
  write: 0.70,
  destructive: 0.80,
};

export const TAU_ACT_DEFAULT = 0.55;

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
