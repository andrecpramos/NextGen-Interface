/**
 * View models.
 *
 * These deliberately do NOT re-export `@nextgen/core-trace` or
 * `@nextgen/core-dispatch` types. The design system is a rendering layer and
 * must stay installable in a browser bundle; those packages reach for
 * `node:sqlite`. The app maps engine types onto these at the server boundary,
 * which also means a widget can never accidentally acquire an opinion about
 * policy — it only knows what it was handed.
 *
 * Widgets render; they do not decide.
 */

/**
 * The eight states of the sphere.
 *
 * `confirming` is not a busy state. It is the system standing still because it
 * is waiting on a human, and it must never be rendered as one — see ui.css.
 */
export type SphereState =
  | 'idle'
  | 'listening'
  | 'transcribing'
  | 'thinking'
  | 'confirming'
  | 'acting'
  | 'speaking'
  | 'error';

/** Every state carries a label; none is conveyed by motion or colour alone. */
export const SPHERE_LABELS: Readonly<Record<SphereState, string>> = {
  idle: 'Ready',
  listening: 'Listening',
  transcribing: 'Transcribing',
  thinking: 'Thinking',
  confirming: 'Waiting for you',
  acting: 'Working',
  speaking: 'Speaking',
  error: 'Something went wrong',
};

export type Tone = 'neutral' | 'accent' | 'attention' | 'danger';

/** A row in a rendered answer. `bar` drives the comparison, `value` the truth. */
export interface AnswerRow {
  readonly label: string;
  readonly value: string;
  /** 0..1, or over 1 when a limit is exceeded. Optional — not every row compares. */
  readonly bar?: number;
  readonly tone?: Tone;
}

/**
 * A rendered answer.
 *
 * "If the answer is a number, show the number large." `headline` is that
 * number, already formatted by code — the model never computes a figure the
 * user sees (Rule 2), and it never formats one either.
 */
export interface AnswerView {
  readonly headline?: string;
  readonly caption?: string;
  readonly rows?: readonly AnswerRow[];
  readonly tone?: Tone;
}

/** One parsed parameter on the confirmation card. */
export interface ParamView {
  readonly name: string;
  /** Display form — money already formatted, dates already localised. */
  readonly display: string;
  /** The value the server round-trips if the user does not edit it. */
  readonly raw: string;
  /** Which resolver filled it. Shown, because it is what makes it checkable. */
  readonly source: 'deterministic' | 'model' | 'context';
  readonly editable: boolean;
}

export interface ConfirmView {
  readonly capabilityId: string;
  readonly title: string;
  readonly destructive: boolean;
  readonly params: readonly ParamView[];
}

/** Structured explanation, rendered from the record. Never model prose. */
export interface TraceView {
  readonly turnId: string;
  readonly headline: string;
  readonly steps: readonly string[];
  readonly alternatives: readonly string[];
  readonly dataUsed: readonly string[];
  readonly values: readonly string[];
  readonly timing: string;
  readonly candidates: readonly { readonly capabilityId: string; readonly score: number }[];
  readonly chosen: string | null;
  readonly decidedAt: string;
  readonly local: boolean;
  readonly notes: readonly string[];
}

/**
 * One destination in the drawer.
 *
 * Read from the registry, never hand-authored — so a capability added tomorrow
 * appears here without anyone editing a menu, and a menu entry can never point
 * at something the router cannot reach.
 *
 * This is the whole of the conventional navigation ADR-005 requires. It is
 * hidden until asked for, which is what "secondary in placement and visual
 * weight" means in practice — not absent, just not in the way.
 */
export interface NavItem {
  readonly capabilityId: string;
  readonly label: string;
  readonly route: string | null;
}
