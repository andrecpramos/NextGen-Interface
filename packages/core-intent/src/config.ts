import type { CapabilityKind } from './types.ts';

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
  /** Fallback confidence bar, used only when the kind is unknown. */
  readonly tauAct?: number;
}

export type EmbedderKind = 'hashing' | 'ollama';

export const THRESHOLD_PROFILES: Readonly<Record<EmbedderKind, Thresholds>> = {
  // Calibrated 2026-08-29 against golden-set.jsonl (200 entries).
  //
  // tauFloor is deliberately 0 — stage-2 out-of-scope rejection is DISABLED.
  // Calibration showed no operating point where a lexical encoder separates
  // "vague but in-domain" from "off-domain": "more" scores 0.154 and "what
  // time is it" scores 0.127. The best joint point was 75% OOS / 60% clarify,
  // against 95%/95% gates. Domain membership is a semantic judgement, so it is
  // deferred to stage 3, which has an explicit __out_of_scope__ answer.
  //
  // WP-01 UPDATE: that deferral does not survive a smaller model. gemma3:1b
  // never emits the sentinel and qwen2.5:1.5b catches 30–40% of out-of-scope
  // input, against 85% on llama3.1:8b (FINDINGS Finding 7). So neither stage
  // detects out-of-scope on target hardware, and a replacement mechanism is
  // owed by WP-03. Do NOT raise tauFloor here to paper over it — calibration
  // showed there is no operating point, and a hand-set floor would only trade
  // the failure for a worse one.
  hashing: { tauHigh: 0.231, delta: 0.09, tauFloor: 0, topK: 5 },

  // nomic-embed-text, calibrated 2026-08-29 with --defer-oos.
  // Accepts 45.3% of routable turns at 95.6% precision.
  // Note how much lower tauHigh and delta sit than the values a reasonable
  // person would guess (0.62 / 0.08) — guessing them disabled stage 2 entirely
  // on the first run. Always calibrate.
  ollama: { tauHigh: 0.535, delta: 0.05, tauFloor: 0, topK: 5 },
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
export const TAU_ACT_BY_KIND: Readonly<Record<CapabilityKind, number>> = {
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
