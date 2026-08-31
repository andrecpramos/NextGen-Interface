import type { AnswerView, ConfirmView, NavItem, TraceView } from '@nextgen/ui';

/**
 * The wire format.
 *
 * Types only — this file is imported by both the route handlers and the
 * browser, so it must not pull in anything that touches `node:*`.
 *
 * Note what does *not* cross: the `Decision` object itself. The client is told
 * what to show and is given a `turnId`; the decision stays on the server. See
 * `engine.ts` — that asymmetry is the security model, and a JSON payload is
 * exactly the wrong place to relax it.
 */

export interface EngineStatus {
  readonly offline: boolean;
  readonly local: boolean;
  readonly model: string | null;
  readonly embedder: 'hashing' | 'ollama';
  readonly today: string;
}

export interface SessionResponse {
  readonly status: EngineStatus;
  /** The drawer's contents, read from the registry rather than hand-authored. */
  readonly nav: readonly NavItem[];
}

export interface TurnResponse {
  readonly turnId: string;
  readonly kind: 'execute' | 'confirm' | 'clarify' | 'refuse';
  readonly answer?: AnswerView;
  readonly confirm?: ConfirmView;
  readonly clarify?: { readonly question: string; readonly options: readonly string[] };
  readonly refuse?: { readonly reason: string; readonly declared: boolean };
  readonly trace: TraceView;
  readonly route: string;
}

export interface ConfirmResponse {
  readonly answer: AnswerView;
}

export interface ErrorResponse {
  readonly error: string;
}
