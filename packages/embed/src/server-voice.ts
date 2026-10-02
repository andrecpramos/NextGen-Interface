// Voice recognised by the app's own server — never a third party's (ADR-037, Rule 8).
//
// The browser's own recogniser is used only on the device (voice.ts): Chrome's and Edge's default ones
// send the audio to Google or Microsoft. For most languages other than English no browser has one on the
// device, so the first production integration found voice unavailable almost everywhere. This is the
// alternative it built and measured: record one utterance, send it to a path on the page's own origin,
// where the adopter runs speech-to-text (a self-hosted Whisper, or a hosted API behind their own server),
// and read back its text.
//
// It is shaped exactly like the browser's recogniser, so `converse()` drives it unchanged: each `start()`
// is one utterance, `onresult` carries one final result, `onend` lets the next one begin. It reports
// `processLocally` as true honestly in the sense the check exists for: the audio reaches no speech vendor
// the adopter has no agreement with. The origin check is structural, as in stage3.ts: a path that resolves
// off this page's origin makes the recogniser unavailable, never a request.

import type { Recognition, RecognitionCtor } from './voice.ts';

/** `transcribe`: where to send what was said, on this site, and how. */
export interface TranscribeOptions {
  /** A path on this site that takes an OpenAI-style `/v1/audio/transcriptions` form and answers `{ text }`. */
  readonly path: string;
  /** The app's own authenticated client, as `stage3Fetch`. It receives the checked URL and a full `RequestInit`. */
  readonly fetch?: (url: string, init: RequestInit) => Promise<Response>;
}

/** What the recogniser needs from the page. A seam for tests. */
export interface ServerVoiceEnv {
  readonly getUserMedia: ((constraints: MediaStreamConstraints) => Promise<MediaStream>) | null;
  readonly AudioContext: (new () => AudioContext) | null;
  readonly MediaRecorder: (new (stream: MediaStream, options?: MediaRecorderOptions) => MediaRecorder) & {
    isTypeSupported?(type: string): boolean;
  } | null;
  readonly timer: (callback: () => void, ms: number) => number;
  readonly clearTimer: (id: number) => void;
  readonly now: () => number;
  readonly location: { readonly href: string; readonly origin: string } | null;
  readonly send: (url: string, init: RequestInit) => Promise<Response>;
}

/** The page's own: its microphone, recorder, clock, address and `fetch`. */
export function serverVoiceEnv(view: Window): ServerVoiceEnv {
  const w = view as Window & typeof globalThis & { webkitAudioContext?: new () => AudioContext };
  const media = w.navigator?.mediaDevices;
  return {
    getUserMedia: typeof media?.getUserMedia === 'function' ? (c) => media.getUserMedia(c) : null,
    AudioContext: w.AudioContext ?? w.webkitAudioContext ?? null,
    MediaRecorder: typeof w.MediaRecorder === 'function' ? w.MediaRecorder : null,
    timer: (cb, ms) => w.setTimeout(cb, ms),
    clearTimer: (id) => w.clearTimeout(id),
    now: () => w.performance.now(),
    location: w.location ? { href: w.location.href, origin: w.location.origin } : null,
    send: (url, init) => w.fetch(url, init),
  };
}

// ------------------------------------------------------------------ detector --

export type Heard = 'waiting' | 'speaking' | 'done' | 'nothing';

export interface SpeechDetector {
  /** Feed one RMS reading of the raw signal. */
  update(rms: number, now: number): Heard;
  /** Whether speech was heard at all. */
  readonly heard: boolean;
}

/**
 * When someone is speaking, and when they have stopped, from a microphone whose levels are unknown.
 *
 * Measured on a real webcam microphone with the browser's noise suppression on (ADR-037): the room at RMS
 * ≈ 0.0016, speech from a metre away under 0.012 — so a fixed threshold of 0.012 never fired and nothing
 * was ever sent. The first samples are exact zeros while the suppressor settles, so the room is the median
 * of the **non-zero** samples in the first 300 ms, capped so someone already talking cannot raise the bar.
 * Between words the room is followed slowly. Speech is RMS ≥ max(0.004, 3 × room); a take ends after a
 * second of quiet once speech was heard, and gives up after 7.5 s with none.
 */
export function speechDetector({ settleMs = 300, roomCap = 0.006, floor = 0.004, factor = 3, quietMs = 1000, giveUpMs = 7500 } = {}): SpeechDetector {
  let began = -1;
  let room: number | null = null;
  const settling: number[] = [];
  let heard = false;
  let lastLoud = 0;
  return {
    get heard() {
      return heard;
    },
    update(rms, now) {
      if (began < 0) began = now;
      if (room === null) {
        if (rms > 0) settling.push(rms);
        if (now - began < settleMs) return 'waiting';
        const sorted = settling.sort((a, b) => a - b);
        const median = sorted.length > 0 ? sorted[Math.floor(sorted.length / 2)]! : floor / factor;
        room = Math.min(roomCap, median);
      }
      const threshold = Math.max(floor, factor * room);
      if (rms >= threshold) {
        heard = true;
        lastLoud = now;
        return 'speaking';
      }
      room = Math.min(roomCap, 0.98 * room + 0.02 * rms);
      if (heard) return now - lastLoud >= quietMs ? 'done' : 'speaking';
      return now - began >= giveUpMs ? 'nothing' : 'waiting';
    },
  };
}

// ---------------------------------------------------------------- recogniser --

/** How often the level is read while recording. A timer, not a frame: a hidden tab still hears the end. */
const SAMPLE_MS = 50;

function recordingType(Recorder: ServerVoiceEnv['MediaRecorder']): string | undefined {
  for (const type of ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']) {
    if (Recorder?.isTypeSupported?.(type)) return type;
  }
  return undefined;
}

/** The status of a failed upload, as the browser recogniser's own error codes. */
function errorFor(status: number): string {
  if (status === 401 || status === 403) return 'service-not-allowed';
  return 'network';
}

/**
 * A recogniser class backed by the app's own speech-to-text endpoint, or `null` when it cannot be: no
 * microphone, no recorder, or a path that is not on this site.
 */
export function serverRecognition(options: TranscribeOptions, env: ServerVoiceEnv): RecognitionCtor | null {
  if (!env.getUserMedia || !env.MediaRecorder || !env.AudioContext || !env.location) return null;
  let url: URL;
  try {
    url = new URL(options.path, env.location.href);
  } catch {
    return null;
  }
  // Rule 8: the visitor's voice goes to this site or nowhere.
  if (url.origin !== env.location.origin) return null;
  const target = url.href;
  const send = options.fetch ?? env.send;
  const getUserMedia = env.getUserMedia;
  const Recorder = env.MediaRecorder;
  const Context = env.AudioContext;

  class ServerRecognition implements Recognition {
    lang = 'en';
    interimResults = false;
    continuous = false;
    onresult: Recognition['onresult'] = null;
    onerror: Recognition['onerror'] = null;
    onend: Recognition['onend'] = null;
    onstart: (() => void) | null = null;
    onaudioend: (() => void) | null = null;
    #stream: MediaStream | null = null;
    #context: AudioContext | null = null;
    #recorder: MediaRecorder | null = null;
    #tick = 0;
    #over = false;
    #cancelled = false;

    static async available(): Promise<string> {
      return 'available';
    }

    static async install(): Promise<boolean> {
      return true;
    }

    // Read by `converse()`'s check that the audio stays where it belongs (on the prototype, as the browser's).
    get processLocally(): boolean {
      return true;
    }

    set processLocally(_value: boolean) {
      // Always true: the audio goes to this site's own server, never to a speech vendor.
    }

    start(): void {
      void this.#run();
    }

    stop(): void {
      // Ends the take early; what was recorded is still sent.
      if (this.#recorder?.state === 'recording') this.#recorder.stop();
    }

    abort(): void {
      this.#cancelled = true;
      if (this.#recorder?.state === 'recording') this.#recorder.stop();
      this.#finish();
    }

    #fail(code: string): void {
      if (!this.#cancelled) this.onerror?.({ error: code });
      this.#finish();
    }

    #finish(): void {
      if (this.#over) return;
      this.#over = true;
      env.clearTimer(this.#tick);
      for (const track of this.#stream?.getTracks() ?? []) track.stop();
      void this.#context?.close().catch(() => undefined);
      this.onend?.();
    }

    async #run(): Promise<void> {
      try {
        this.#stream = await getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
        });
      } catch (error) {
        return this.#fail(error instanceof DOMException && error.name === 'NotAllowedError' ? 'not-allowed' : 'audio-capture');
      }
      if (this.#cancelled) return this.#finish();
      const stream = this.#stream;
      const type = recordingType(Recorder);
      let recorder: MediaRecorder;
      try {
        recorder = new Recorder(stream, { ...(type ? { mimeType: type } : {}), audioBitsPerSecond: 32_000 });
      } catch {
        return this.#fail('audio-capture');
      }
      this.#recorder = recorder;
      const chunks: Blob[] = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data);
      };
      const detector = speechDetector();
      recorder.onstop = () => void this.#upload(chunks, detector.heard, recorder.mimeType || type || 'audio/webm');

      const context = new Context();
      this.#context = context;
      const analyser = context.createAnalyser();
      analyser.fftSize = 1024;
      context.createMediaStreamSource(stream).connect(analyser);
      const samples = new Float32Array(analyser.fftSize);
      recorder.start();
      this.onstart?.();
      const listen = (): void => {
        if (this.#over || recorder.state !== 'recording') return;
        analyser.getFloatTimeDomainData(samples);
        let sum = 0;
        for (const s of samples) sum += s * s;
        const state = detector.update(Math.sqrt(sum / samples.length), env.now());
        if (state === 'done' || state === 'nothing') recorder.stop();
        else this.#tick = env.timer(listen, SAMPLE_MS);
      };
      this.#tick = env.timer(listen, SAMPLE_MS);
    }

    async #upload(chunks: Blob[], heard: boolean, type: string): Promise<void> {
      // Nothing is sent without speech: listening hands-free must never upload the room.
      if (this.#cancelled || !heard || chunks.length === 0) return this.#fail('no-speech');
      this.onaudioend?.();
      const form = new FormData();
      form.append('file', new Blob(chunks, { type }), type.includes('mp4') ? 'speech.mp4' : 'speech.webm');
      form.append('language', this.lang.split('-')[0]!.toLowerCase());
      form.append('response_format', 'json');
      let text: string;
      try {
        const response = await send(target, { method: 'POST', body: form });
        if (!response.ok) return this.#fail(errorFor(response.status));
        const body = (await response.json()) as { text?: unknown };
        text = typeof body.text === 'string' ? body.text.trim() : '';
      } catch {
        return this.#fail('network');
      }
      if (this.#cancelled) return this.#finish();
      if (!text) return this.#fail('no-speech');
      const result = Object.assign([{ transcript: text }], { isFinal: true });
      this.onresult?.({ results: Object.assign([result], { length: 1 }) as never });
      this.#finish();
    }
  }

  return ServerRecognition as unknown as RecognitionCtor;
}
