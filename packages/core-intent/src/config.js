// Router thresholds.
//
// These are PER-ENCODER. TF-IDF cosine and a sentence encoder do not produce
// scores on the same scale, so a tauHigh tuned for one is meaningless for the
// other — carrying one set across encoders silently disables stage 2 (every
// score falls under an unreachable bar and everything escalates).
//
// Never hand-tune these. Run:  node calibrate.js --embedder=<kind>
// which sweeps the operating space against the whole golden set under an
// explicit precision constraint and writes the recommended point.

export const THRESHOLD_PROFILES = {
  // Calibrated 2026-08-29 against golden-set.jsonl (200 entries).
  //
  // tauFloor is deliberately 0 — stage-2 out-of-scope rejection is DISABLED.
  // Calibration showed no operating point where a lexical encoder separates
  // "vague but in-domain" from "off-domain": "more" scores 0.154 and "what
  // time is it" scores 0.127. The best joint point was 75% OOS / 60% clarify,
  // against 95%/95% gates. Domain membership is a semantic judgement, so it is
  // deferred to stage 3, which has an explicit __out_of_scope__ answer.
  //
  // Revisit this once a real sentence encoder is available: it may separate
  // them, which would buy back the latency of not calling the model on
  // off-domain input.
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
 */
export const TAU_ACT_BY_KIND = {
  navigate: 0.35,
  read: 0.45,
  write: 0.70,
  destructive: 0.80,
};

export const TAU_ACT_DEFAULT = 0.55;

export const THRESHOLDS = THRESHOLD_PROFILES.hashing;

export function thresholdsFor(embedderKind) {
  return THRESHOLD_PROFILES[embedderKind] ?? THRESHOLD_PROFILES.hashing;
}

export const OLLAMA = {
  host: process.env.OLLAMA_HOST || 'http://127.0.0.1:11434',
  chatModel: process.env.SPIKE_MODEL || 'llama3.1:8b',
  embedModel: process.env.SPIKE_EMBED_MODEL || 'nomic-embed-text',
  timeoutMs: 30000,
};

export const STAGE = {
  DETERMINISTIC: 'deterministic',
  EMBEDDING: 'embedding',
  LLM: 'llm',
  NONE: 'none',
};

export const OUTCOME = {
  EXECUTE: 'execute',
  CLARIFY: 'clarify',
  OUT_OF_SCOPE: 'out_of_scope',
};
