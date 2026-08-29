// @nextgen/core-dispatch
//
// The dispatcher and the engines it drives: ADR-004 policy, navigation, query
// and undo.
//
// This is where enforcement lives. Everything the model influences arrives as
// data; everything that happens next is decided by code. Nothing here reads a
// confidence score — policy is a function of capability kind alone, which is why
// it held on every model tested, including the one that refuses nothing.

export { policyFor, requiresConfirmation, type Policy } from './policy.ts';

export {
  NavigationEngine,
  type DataRef,
  type NavigationResult,
  type QueryEngine,
  type QueryRequest,
  type QueryResult,
  type SlotValue,
  type UndoEntry,
  type UndoJournal,
  type UndoOutcome,
} from './engines.ts';

export {
  Dispatcher,
  type Decision,
  type DispatchRequest,
  type DispatcherDeps,
} from './dispatcher.ts';
