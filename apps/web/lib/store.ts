'use client';

import { create } from 'zustand';

import type { AnswerView, ConfirmView, SphereState } from '@nextgen/ui';

import type { ConfirmResponse, SessionResponse, TurnResponse } from './wire';
import { startVoiceRecording, type VoiceRecorderHandle } from './voice';

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
  drawerOpen: boolean;
  error: string | null;
  /** True while the mic is open. Drives the Composer's mic button and the sphere's `listening` state. */
  listening: boolean;
  /** 0..1 mic level, read only while `listening`. */
  amplitude: number;
  /** When true, every answer is read aloud — not only ones that arrived by voice. User-controlled, persisted. */
  voiceReply: boolean;

  bootstrap: () => Promise<void>;
  setInput: (value: string) => void;
  send: (utterance: string) => Promise<void>;
  navigate: (capabilityId: string, label: string) => Promise<void>;
  upload: (file: File) => Promise<void>;
  /** Start listening, or — called again while listening — stop, transcribe, and send. */
  toggleVoice: () => Promise<void>;
  setVoiceReply: (enabled: boolean) => void;
  approve: (params: Record<string, string>) => Promise<void>;
  cancelConfirmation: () => void;
  abort: () => void;
  setDrawer: (open: boolean) => void;
  setTheme: (dark: boolean) => void;
}

/**
 * Read only from inside an action (`bootstrap`), never at module scope —
 * this file is 'use client' but Next still evaluates client modules once on
 * the server for the initial render, where `localStorage` does not exist.
 */
function loadVoiceReplyPreference(): boolean {
  try {
    // Speaking back is the feature being turned on here — default to on, so
    // it is discoverable rather than a setting nobody finds.
    const stored = localStorage.getItem('nextgen-voice-reply');
    return stored === null ? true : stored === 'on';
  } catch {
    return true;
  }
}

let inFlight: AbortController | null = null;
let timers: ReturnType<typeof setTimeout>[] = [];
let voiceHandle: VoiceRecorderHandle | null = null;
let playingReply: HTMLAudioElement | null = null;

/** A new turn — of any kind — interrupts anything still being read aloud. */
function bargeIn(): void {
  playingReply?.pause();
  playingReply = null;
}

/**
 * Speak an answer aloud. Best-effort: a broken TTS call must not surface as a
 * turn failure, since the turn itself already succeeded — the user still has
 * the written answer on screen either way.
 */
async function speak(
  set: (partial: Partial<AssistantState>) => void,
  get: () => AssistantState,
  text: string,
): Promise<void> {
  const trimmed = text.trim();
  if (!trimmed) return;
  try {
    const response = await fetch('/api/voice/speak', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: trimmed }),
    });
    if (!response.ok) return;
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    playingReply = audio;
    set({ state: 'speaking' });
    await new Promise<void>((resolve) => {
      audio.onended = () => resolve();
      audio.onerror = () => resolve();
      void audio.play().catch(() => resolve());
    });
    URL.revokeObjectURL(url);
    if (playingReply === audio) {
      playingReply = null;
      if (get().state === 'speaking') set({ state: 'idle' });
    }
  } catch {
    // Silence is an acceptable failure mode for a reply that already rendered as text.
  }
}

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
  drawerOpen: false,
  error: null,
  listening: false,
  amplitude: 0,
  voiceReply: true,

  async bootstrap() {
    set({ voiceReply: loadVoiceReplyPreference() });
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

  setVoiceReply(enabled) {
    set({ voiceReply: enabled });
    if (!enabled) bargeIn();
    try {
      localStorage.setItem('nextgen-voice-reply', enabled ? 'on' : 'off');
    } catch {
      // A blocked localStorage is not a reason to refuse the toggle.
    }
  },

  setInput(value) {
    set({ input: value });
  },

  async send(utterance) {
    const trimmed = utterance.trim();
    if (!trimmed || get().state === 'thinking') return;
    await run(set, get, {
      said: trimmed,
      fetchTurn: (signal) =>
        fetch('/api/turn', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ utterance: trimmed }),
          signal,
        }),
    });
  },

  /**
   * The mic. Text is never the fallback path (ui-guidelines), so this is a
   * peer to `send`, not a replacement for it — same turn machinery, a
   * different door in, and the one difference that matters: a turn that
   * arrived by voice gets its answer read back, not just printed.
   */
  async toggleVoice() {
    if (get().listening) {
      const handle = voiceHandle;
      voiceHandle = null;
      set({ listening: false, amplitude: 0, state: 'transcribing', detail: null });
      if (!handle) return;

      try {
        const wav = await handle.stop();
        const form = new FormData();
        form.set('audio', wav, 'input.wav');
        const response = await fetch('/api/voice/transcribe', { method: 'POST', body: form });
        const data = await readJson<{ transcript?: string; confidence?: number; error?: string }>(response);
        if (!response.ok) throw new Error(data.error ?? 'Could not transcribe that.');

        const transcript = (data.transcript ?? '').trim();
        if (!transcript) {
          set({ state: 'idle' });
          return;
        }

        await run(set, get, {
          said: transcript,
          fetchTurn: (signal) =>
            fetch('/api/turn', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                utterance: transcript,
                ...(data.confidence !== undefined ? { sttConfidence: data.confidence } : {}),
              }),
              signal,
            }),
        });
      } catch (error) {
        set({ state: 'error', error: error instanceof Error ? error.message : 'Could not transcribe that.' });
      }
      return;
    }

    bargeIn();
    try {
      voiceHandle = await startVoiceRecording((level) => set({ amplitude: level }));
      set({ listening: true, state: 'listening', detail: null, error: null });
    } catch (error) {
      set({
        state: 'error',
        error: error instanceof Error ? error.message : "Could not use the microphone — check the browser's permission.",
      });
    }
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
      fetchTurn: (signal) =>
        fetch('/api/navigate', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ capabilityId }),
          signal,
        }),
    });
  },

  /**
   * A file/image upload. Same reasoning as `navigate`: there is no sentence
   * for the router to get wrong here either, so this goes straight to
   * `/api/modules/capture`, which bypasses the router itself.
   */
  async upload(file) {
    if (get().state === 'thinking') return;
    const form = new FormData();
    form.set('file', file);
    await run(set, get, {
      said: `📎 ${file.name}`,
      fetchTurn: (signal) => fetch('/api/modules/capture', { method: 'POST', body: form, signal }),
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

      const toSay = data.answer.caption ?? data.answer.headline ?? '';
      if (get().voiceReply && toSay) void speak(set, get, toSay);
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
 * `/api/turn`, `/api/navigate` and `/api/modules/capture` all return the same
 * envelope on purpose — the three paths differ in how the capability was
 * *chosen* (a routed sentence, a menu tap, an upload) and in nothing after
 * that. Sharing the handling here is what keeps that true; `fetchTurn` is the
 * one thing that varies, since a file upload needs `FormData` rather than JSON.
 */
async function run(
  set: (partial: Partial<AssistantState>) => void,
  get: () => AssistantState,
  opts: {
    said: string;
    picked?: boolean;
    fetchTurn: (signal: AbortSignal) => Promise<Response>;
  },
): Promise<void> {
  bargeIn();

  // A new turn supersedes an unanswered confirmation. Leaving the old card up
  // would let the user approve a write while looking at a newer answer — but
  // dropping it silently is its own bug: it reads as "I uploaded a document
  // and nothing happened" when what actually happened is the confirmation
  // was still waiting and got abandoned. Mark the abandoned turn so that is
  // visible instead of vanishing without a trace.
  const priorPending = get().pending;
  const id = `local_${Date.now()}`;
  set({
    turns: [
      ...get().turns.map((t) =>
        priorPending && t.response?.turnId === priorPending.turnId && !t.outcome
          ? { ...t, outcome: { caption: 'Not saved — a new message came in before you confirmed.', tone: 'attention' as const } }
          : t,
      ),
      { id, said: opts.said, ...(opts.picked ? { picked: true } : {}) },
    ],
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
    const response = await opts.fetchTurn(inFlight.signal);
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

    // "Talk back" applies to every turn, not only ones that arrived by
    // voice — a typed question and an uploaded document both get an answer
    // worth hearing, gated only by the user's own toggle.
    if (get().voiceReply) {
      if (data.kind === 'execute' && data.answer) {
        const toSay = data.answer.caption ?? data.answer.headline ?? '';
        if (toSay) void speak(set, get, toSay);
      } else if (data.kind === 'refuse' && data.refuse) {
        void speak(set, get, data.refuse.reason);
      } else if (data.kind === 'clarify' && data.clarify) {
        void speak(set, get, data.clarify.question);
      } else if (data.kind === 'confirm' && data.confirm) {
        void speak(set, get, `${data.confirm.title}. Review it, then confirm or cancel.`);
      }
    }
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
