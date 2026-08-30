/**
 * TurnTrace — the explainability record (Rule 9).
 *
 * Explainability cannot be a prompt asking the model to explain itself: that
 * produces plausible fiction, and plausible fiction about a financial action is
 * worse than no explanation at all. It is a *recorded structure*, and "why did
 * you do that?" is rendered from the record.
 *
 * The constraint that shapes this whole file: **a trace contains zero
 * model-generated prose.** Stage 3 does return a `reasoning` string; the router
 * deliberately drops it, and the types here give it nowhere to land. Every field
 * below is an id, an enum, a number, or text the *user* said.
 */

export type Stage = 'deterministic' | 'embedding' | 'llm' | 'none';

export type TurnOutcome = 'execute' | 'clarify' | 'out_of_scope' | 'error';

export interface ScoredCandidate {
  readonly capabilityId: string;
  readonly score: number;
}

/** What a turn read. Answers "what data did you use?" from the record. */
export interface DataRef {
  readonly table: string;
  readonly rowCount: number;
  readonly from?: string;
  readonly to?: string;
}

export interface StageLatency {
  readonly stage1?: number;
  readonly stage2?: number;
  readonly stage3?: number;
  readonly total: number;
}

/**
 * One turn, recorded.
 *
 * `transcript` is the only free text, and it is the user's own words — it is
 * what they said, not what the model thought about it. It is marked untrusted
 * everywhere it is stored, because a transcript can contain anything.
 */
export interface TurnTrace {
  readonly turnId: string;
  /** What the user said. UNTRUSTED. Never re-interpreted as an instruction. */
  readonly transcript: string;
  readonly sttConfidence?: number;
  readonly decidedAt: Stage;
  /** What else it considered, and how close. The heart of the explanation. */
  readonly candidates: readonly ScoredCandidate[];
  readonly outcome: TurnOutcome;
  readonly capabilityId: string | null;
  readonly capabilityKind: string | null;
  readonly route: string | null;
  /** Resolved slots. Values the user can see and check, not model narration. */
  readonly params: Readonly<Record<string, string | number>>;
  readonly missing: readonly string[];
  readonly requiresConfirmation: boolean;
  readonly modelId: string | null;
  readonly promptVersion: string | null;
  /** Which resolver filled each param. This is what makes a number defensible. */
  readonly paramSources: Readonly<Record<string, 'deterministic' | 'model' | 'context'>>;
  readonly dataRead: readonly DataRef[];
  readonly latency: StageLatency;
  readonly undoToken: string | null;
  /** Machine notes from the cascade. Enumerated reasons, never model prose. */
  readonly notes: readonly string[];
  readonly error?: string;
  readonly createdAt: string;
}

/**
 * Fields a trace must never carry.
 *
 * Listed as a type so the guard below and the recorder cannot disagree about
 * what counts as prose. If stage 3 ever grows another free-text field, adding it
 * here is what stops it reaching storage.
 */
export const FORBIDDEN_PROSE_FIELDS = [
  'reasoning',
  'explanation',
  'rationale',
  'modelResponse',
  'narration',
  'summary',
  'thought',
  'analysis',
] as const;

export class ModelProseError extends Error {
  readonly field: string;

  constructor(field: string) {
    super(
      `trace field "${field}" looks like model-generated prose. ` +
        'Explainability is a record, not narration (Rule 9): store the ids, scores ' +
        'and resolved values the explanation is rendered FROM, never the model\'s ' +
        'account of itself.',
    );
    this.name = 'ModelProseError';
    this.field = field;
  }
}

/**
 * Reject a trace carrying model prose.
 *
 * The type system already gives `reasoning` nowhere to go, but a trace crosses a
 * storage boundary as a plain object and types stop at that boundary. This is
 * the runtime half of the same rule.
 */
export function assertNoModelProse(candidate: Record<string, unknown>): void {
  for (const field of FORBIDDEN_PROSE_FIELDS) {
    if (field in candidate && candidate[field] !== undefined && candidate[field] !== null) {
      throw new ModelProseError(field);
    }
  }
}
