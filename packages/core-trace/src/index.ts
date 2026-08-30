// @nextgen/core-trace
//
// TurnTrace: the explainability record (Rule 9).
//
// Explainability cannot be a prompt asking the model to explain itself — that
// produces plausible fiction, and plausible fiction about a financial action is
// worse than no explanation. It is a recorded structure, and "why did you do
// that?" is rendered from the record.
//
// The rule that shapes the package: a trace contains ZERO model-generated prose.

export {
  assertNoModelProse,
  ModelProseError,
  FORBIDDEN_PROSE_FIELDS,
  type DataRef,
  type ScoredCandidate,
  type Stage,
  type StageLatency,
  type TurnOutcome,
  type TurnTrace,
} from './types.ts';

export { explain, formatExplanation, type Explanation } from './explain.ts';

export {
  SqliteTraceStore,
  aesTraceCrypto,
  plaintextTraceCrypto,
  newTurnId,
  type TraceCrypto,
  type TraceStoreOptions,
} from './store.ts';

export {
  TraceRecorder,
  type RecordedTurn,
  type TurnInput,
  type TurnRecorder,
} from './recorder.ts';
