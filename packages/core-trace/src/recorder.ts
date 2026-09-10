import { newTurnId, type SqliteTraceStore } from './store.ts';
import type { DataRef, ScoredCandidate, Stage, TurnOutcome, TurnTrace } from './types.ts';

/**
 * The recorder.
 *
 * The acceptance criterion is "100% of turns produce a trace, **including
 * failures and out-of-scope**". A convention of calling `store.put()` at the end
 * of each path cannot deliver that: the paths that most need a trace are the
 * ones that threw before reaching the end.
 *
 * So the turn runs *inside* the recorder. There is no way to complete a turn
 * without producing a record, because the record is written in a `finally`.
 */

export interface TurnInput {
  /** What the user said. UNTRUSTED. */
  readonly transcript: string;
  readonly sttConfidence?: number;
  readonly modelId?: string;
  readonly promptVersion?: string;
}

/**
 * What a turn reports about itself as it runs.
 *
 * Every setter takes structured data. There is deliberately no `setReasoning`
 * or `setExplanation`: the absence is the design (Rule 9).
 */
export interface TurnRecorder {
  readonly turnId: string;
  decidedAt(stage: Stage): void;
  candidates(list: readonly ScoredCandidate[]): void;
  capability(id: string | null, kind: string | null, route: string | null): void;
  param(name: string, value: string | number, source: 'deterministic' | 'model' | 'context'): void;
  missing(names: readonly string[]): void;
  requiresConfirmation(required: boolean): void;
  /** The user asked what something is, not to be taken to it (WP-36). */
  explanationRequest(asked: boolean): void;
  read(ref: DataRef): void;
  stageLatency(stage: 'stage1' | 'stage2' | 'stage3', ms: number): void;
  note(message: string): void;
  undoToken(token: string): void;
  outcome(outcome: TurnOutcome): void;
}

export interface RecordedTurn<T> {
  readonly result: T | null;
  readonly trace: TurnTrace;
  readonly error: unknown;
}

export class TraceRecorder {
  readonly #store: SqliteTraceStore;
  readonly #now: () => Date;

  constructor(store: SqliteTraceStore, now: () => Date = () => new Date()) {
    this.#store = store;
    this.#now = now;
  }

  /**
   * Run a turn, recording it whatever happens.
   *
   * A thrown error is captured into the trace and rethrown — the caller still
   * sees the failure, and the failure is still on the record. Swallowing it
   * would trade one invisible problem for another.
   */
  async run<T>(input: TurnInput, turn: (r: TurnRecorder) => Promise<T>): Promise<T> {
    const started = performance.now();
    const turnId = newTurnId();

    const state = {
      decidedAt: 'none' as Stage,
      candidates: [] as readonly ScoredCandidate[],
      capabilityId: null as string | null,
      capabilityKind: null as string | null,
      route: null as string | null,
      params: {} as Record<string, string | number>,
      paramSources: {} as Record<string, 'deterministic' | 'model' | 'context'>,
      missing: [] as readonly string[],
      requiresConfirmation: false,
      explanationRequest: false,
      dataRead: [] as DataRef[],
      latency: {} as { stage1?: number; stage2?: number; stage3?: number },
      notes: [] as string[],
      undoToken: null as string | null,
      // Defaults to `error`, not `execute`. A turn that never says how it ended
      // did not end well, and the record should say so rather than flatter it.
      outcome: 'error' as TurnOutcome,
    };

    const recorder: TurnRecorder = {
      turnId,
      decidedAt: (s) => { state.decidedAt = s; },
      candidates: (list) => { state.candidates = list; },
      capability: (id, kind, route) => {
        state.capabilityId = id;
        state.capabilityKind = kind;
        state.route = route;
      },
      param: (name, value, source) => {
        state.params[name] = value;
        state.paramSources[name] = source;
      },
      missing: (names) => { state.missing = names; },
      requiresConfirmation: (required) => { state.requiresConfirmation = required; },
      explanationRequest: (asked) => { state.explanationRequest = asked; },
      read: (ref) => { state.dataRead.push(ref); },
      stageLatency: (stage, ms) => { state.latency[stage] = ms; },
      note: (message) => { state.notes.push(message); },
      undoToken: (token) => { state.undoToken = token; },
      outcome: (o) => { state.outcome = o; },
    };

    let caught: unknown = null;
    try {
      return await turn(recorder);
    } catch (err) {
      caught = err;
      state.outcome = 'error';
      state.notes.push('the turn threw before completing');
      throw err;
    } finally {
      const trace: TurnTrace = {
        turnId,
        transcript: input.transcript,
        ...(input.sttConfidence !== undefined ? { sttConfidence: input.sttConfidence } : {}),
        decidedAt: state.decidedAt,
        candidates: state.candidates,
        outcome: state.outcome,
        capabilityId: state.capabilityId,
        capabilityKind: state.capabilityKind,
        route: state.route,
        params: state.params,
        missing: state.missing,
        requiresConfirmation: state.requiresConfirmation,
        explanationRequest: state.explanationRequest,
        modelId: input.modelId ?? null,
        promptVersion: input.promptVersion ?? null,
        paramSources: state.paramSources,
        dataRead: state.dataRead,
        latency: { ...state.latency, total: performance.now() - started },
        undoToken: state.undoToken,
        notes: state.notes,
        ...(caught ? { error: caught instanceof Error ? caught.message : String(caught) } : {}),
        createdAt: this.#now().toISOString(),
      };
      this.#store.put(trace);
    }
  }
}
