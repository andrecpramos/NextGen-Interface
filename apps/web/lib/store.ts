'use client';

import { create } from 'zustand';

import type { AnswerView, ConfirmView, SphereState } from '@nextgen/ui';

import type { ConfirmResponse, SessionResponse, TurnResponse } from './wire';

/**
 * Turn state.
 *
 * The sphere reads its state from here, which means this store is the state
 * machine — so the transitions are written out rather than implied. The one
 * that matters: a `confirm` decision moves to `confirming` and *stays* there.
 * It is not a step on the way to `acting`; it is a stop, and the next
 * transition is caused by a person, not by the system.
 */

export interface Turn {
  readonly id: string;
  /** What the user said. Rendered as their words, never re-interpreted. */
  readonly said: string;
  /** True when this turn came from the drawer rather than the composer. */
  readonly picked?: boolean;
  response?: TurnResponse;
  /** The outcome of a confirmed write, once it has run. */
  outcome?: AnswerView;
  error?: string;
}

interface AssistantState {
  session: SessionResponse | null;
  turns: Turn[];
  state: SphereState;
  /** The "what is happening" line. Empty under a second; see below. */
  detail: string | null;
  cancellable: boolean;
  input: string;
  pending: { turnId: string; confirm: ConfirmView } | null;
  traceOpen: string | null;
  drawerOpen: boolean;
  error: string | null;

  bootstrap: () => Promise<void>;
  setInput: (value: string) => void;
  send: (utterance: string) => Promise<void>;
  navigate: (capabilityId: string, label: string) => Promise<void>;
  approve: (params: Record<string, string>) => Promise<void>;
  cancelConfirmation: () => void;
  abort: () => void;
  openTrace: (turnId: string) => void;
  closeTrace: () => void;
  setDrawer: (open: boolean) => void;
  setTheme: (dark: boolean) => void;
}

let inFlight: AbortController | null = null;
let timers: ReturnType<typeof setTimeout>[] = [];

function clearTimers(): void {
  for (const t of timers) clearTimeout(t);
  timers = [];
}

/**
 * Latency perception, per the guidelines.
 *
 *   < 100ms  no indicator
 *   100ms–1s sphere state only
 *   > 1s     say what is happening — a labelled wait feels far shorter
 *   > 3s     offer cancel
 *
 * The labels are honest about the cascade rather than generic: stages 1 and 2
 * are deterministic and fast, and if the turn is still going after a couple of
 * seconds it is because the local model is loading or generating.
 */
function scheduleDetail(set: (partial: Partial<AssistantState>) => void): void {
  clearTimers();
  timers.push(
    setTimeout(() => set({ detail: 'Matching against what I can do…' }), 1000),
    setTimeout(() => set({ detail: 'Asking the on-device model…', cancellable: true }), 3000),
    setTimeout(() => set({ detail: 'Still working — the model may be loading.' }), 12000),
  );
}

async function readJson<T>(response: Response): Promise<T> {
  const text = await response.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`Unexpected reply from the server (${response.status}).`);
  }
}

export const useAssistant = create<AssistantState>((set, get) => ({
  session: null,
  turns: [],
  state: 'idle',
  detail: null,
  cancellable: false,
  input: '',
  pending: null,
  traceOpen: null,
  drawerOpen: false,
  error: null,

  async bootstrap() {
    try {
      const response = await fetch('/api/session');
      const data = await readJson<SessionResponse & { error?: string }>(response);
      if (!response.ok) throw new Error(data.error ?? 'Could not start the engine.');
      set({ session: data, error: null });
    } catch (error) {
      set({
        state: 'error',
        error: error instanceof Error ? error.message : 'Could not start the engine.',
      });
    }
  },

  setInput(value) {
    set({ input: value });
  },

  async send(utterance) {
    const trimmed = utterance.trim();
    if (!trimmed || get().state === 'thinking') return;
    await run(set, get, { said: trimmed, endpoint: '/api/turn', body: { utterance: trimmed } });
  },

  /**
   * The drawer path.
   *
   * Deliberately *not* `send(label)`. Turning a menu tap into a sentence and
   * feeding it to the router would reintroduce the 20% the router gets wrong,
   * on the one path that exists precisely so the model cannot be in the way.
   */
  async navigate(capabilityId, label) {
    set({ drawerOpen: false });
    await run(set, get, {
      said: label,
      picked: true,
      endpoint: '/api/navigate',
      body: { capabilityId },
    });
  },

  async approve(params) {
    const pending = get().pending;
    if (!pending) return;

    set({ state: 'acting', detail: null });

    try {
      const response = await fetch('/api/confirm', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ turnId: pending.turnId, params }),
      });
      const data = await readJson<ConfirmResponse & { error?: string }>(response);
      if (!response.ok) throw new Error(data.error ?? 'The write failed.');

      set({
        turns: get().turns.map((t) =>
          t.response?.turnId === pending.turnId ? { ...t, outcome: data.answer } : t,
        ),
        pending: null,
        state: 'idle',
      });
    } catch (error) {
      set({
        state: 'error',
        pending: null,
        error: error instanceof Error ? error.message : 'The write failed.',
      });
    }
  },

  cancelConfirmation() {
    const pending = get().pending;
    set({
      pending: null,
      state: 'idle',
      turns: pending
        ? get().turns.map((t) =>
            t.response?.turnId === pending.turnId
              ? { ...t, outcome: { caption: 'Cancelled. Nothing was written.' } }
              : t,
          )
        : get().turns,
    });
  },

  abort() {
    inFlight?.abort();
    clearTimers();
  },

  openTrace(turnId) {
    set({ traceOpen: turnId });
  },

  closeTrace() {
    set({ traceOpen: null });
  },

  setDrawer(open) {
    set({ drawerOpen: open });
  },

  setTheme(dark) {
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
    try {
      localStorage.setItem('nextgen-theme', dark ? 'dark' : 'light');
    } catch {
      // A blocked localStorage is not a reason to refuse to change the theme.
    }
  },
}));

/**
 * One turn, whichever door it came through.
 *
 * `/api/turn` and `/api/navigate` return the same envelope on purpose — the
 * two paths differ in how the capability was *chosen*, and in nothing after
 * that. Sharing the handling here is what keeps that true.
 */
async function run(
  set: (partial: Partial<AssistantState>) => void,
  get: () => AssistantState,
  opts: {
    said: string;
    picked?: boolean;
    endpoint: string;
    body: Record<string, string>;
  },
): Promise<void> {
  // A new turn supersedes an unanswered confirmation. Leaving the old card up
  // would let the user approve a write while looking at a newer answer.
  const id = `local_${Date.now()}`;
  set({
    turns: [...get().turns, { id, said: opts.said, ...(opts.picked ? { picked: true } : {}) }],
    input: '',
    state: 'thinking',
    detail: null,
    cancellable: false,
    pending: null,
    error: null,
  });
  scheduleDetail(set);

  inFlight = new AbortController();

  try {
    const response = await fetch(opts.endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(opts.body),
      signal: inFlight.signal,
    });
    const data = await readJson<TurnResponse & { error?: string }>(response);
    if (!response.ok) throw new Error(data.error ?? 'The turn failed.');

    set({
      turns: get().turns.map((t) => (t.id === id ? { ...t, response: data } : t)),
      state: data.kind === 'confirm' ? 'confirming' : 'idle',
      detail: null,
      cancellable: false,
      pending: data.kind === 'confirm' && data.confirm
        ? { turnId: data.turnId, confirm: data.confirm }
        : null,
    });
  } catch (error) {
    const aborted = error instanceof DOMException && error.name === 'AbortError';
    set({
      turns: aborted
        ? get().turns.filter((t) => t.id !== id)
        : get().turns.map((t) =>
            t.id === id
              ? { ...t, error: error instanceof Error ? error.message : 'The turn failed.' }
              : t,
          ),
      state: aborted ? 'idle' : 'error',
      detail: null,
      cancellable: false,
    });
  } finally {
    clearTimers();
    inFlight = null;
  }
}
