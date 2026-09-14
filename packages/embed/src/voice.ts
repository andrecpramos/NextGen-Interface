// Voice, on the device or not at all (Rule 8).
//
// Three browser capabilities, each used only in its local form:
//
// - The microphone level, through an AnalyserNode. Numbers, never audio, and
//   they never leave the page. This is what makes the liquid listen, and what
//   detects that someone has started speaking.
// - Speech to text through the Web Speech API — but ONLY with
//   `processLocally = true`. Chrome's default recogniser streams audio to a
//   Google server, which would falsify "no network call per turn" for every
//   adopter's visitors. So a browser that cannot recognise on the device gets
//   the level meter and a sentence asking them to type, never the cloud path.
// - Text to speech through a voice whose `localService` is true. A network
//   voice is skipped even if it is the default.
//
// Everything reaches the browser through `VoiceEnv`, so every rule above is
// tested against fakes, including the one that matters most: a recogniser
// that ignores `processLocally` is never started.

export type Transcription = 'available' | 'downloadable' | 'unavailable';

interface RecognitionOptions {
  readonly langs: readonly string[];
  readonly processLocally: boolean;
}

interface RecognitionResultList {
  readonly length: number;
  readonly [index: number]: { readonly isFinal: boolean; readonly 0?: { readonly transcript: string } };
}

export interface Recognition {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  processLocally?: boolean;
  onresult: ((event: { readonly results: RecognitionResultList }) => void) | null;
  onerror: ((event: { readonly error: string }) => void) | null;
  onend: (() => void) | null;
  onstart?: (() => void) | null;
  start(): void;
  stop(): void;
  abort?(): void;
}

export interface RecognitionCtor {
  new (): Recognition;
  readonly prototype: object;
  available?(options: RecognitionOptions): Promise<string>;
  install?(options: RecognitionOptions): Promise<boolean>;
}

export interface VoiceEnv {
  readonly getUserMedia: ((constraints: MediaStreamConstraints) => Promise<MediaStream>) | null;
  readonly AudioContext: (new () => AudioContext) | null;
  readonly Recognition: RecognitionCtor | null;
  readonly synth: SpeechSynthesis | null;
  readonly Utterance: (new (text: string) => SpeechSynthesisUtterance) | null;
  readonly frame: (callback: () => void) => number;
  readonly cancelFrame: (id: number) => void;
  readonly timer: (callback: () => void, ms: number) => number;
  readonly clearTimer: (id: number) => void;
  readonly now: () => number;
}

export function voiceEnv(view: Window): VoiceEnv {
  const w = view as Window &
    typeof globalThis & {
      SpeechRecognition?: RecognitionCtor;
      webkitSpeechRecognition?: RecognitionCtor;
      webkitAudioContext?: new () => AudioContext;
    };
  const media = w.navigator?.mediaDevices;
  return {
    getUserMedia: typeof media?.getUserMedia === 'function' ? (c) => media.getUserMedia(c) : null,
    AudioContext: w.AudioContext ?? w.webkitAudioContext ?? null,
    Recognition: w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null,
    synth: w.speechSynthesis ?? null,
    Utterance: w.SpeechSynthesisUtterance ?? null,
    frame: (cb) => w.requestAnimationFrame(cb),
    cancelFrame: (id) => w.cancelAnimationFrame(id),
    timer: (cb, ms) => w.setTimeout(cb, ms),
    clearTimer: (id) => w.clearTimeout(id),
    now: () => w.performance.now(),
  };
}

/** A recogniser wants a region: `pt` alone is not a language pack. */
export function speechLang(lang: string | null | undefined): string {
  const l = (lang ?? '').trim();
  if (l.includes('-')) return l;
  if (l.toLowerCase().startsWith('pt')) return 'pt-PT';
  return 'en-US';
}

function localOnly(env: VoiceEnv): RecognitionCtor | null {
  const R = env.Recognition;
  if (!R || typeof R.available !== 'function' || !('processLocally' in R.prototype)) return null;
  return R;
}

/** Can this browser turn speech into text without sending audio anywhere? */
export async function transcriptionFor(env: VoiceEnv, lang: string): Promise<Transcription> {
  const R = localOnly(env);
  if (!R) return 'unavailable';
  try {
    const status = await R.available!({ langs: [lang], processLocally: true });
    if (status === 'available') return 'available';
    if (status === 'downloadable' || status === 'downloading') return 'downloadable';
    return 'unavailable';
  } catch {
    return 'unavailable';
  }
}

/** Ask the browser to fetch its own on-device language pack. Needs a user gesture. */
export async function installTranscription(env: VoiceEnv, lang: string): Promise<boolean> {
  const R = localOnly(env);
  if (!R || typeof R.install !== 'function') return false;
  try {
    return (await R.install({ langs: [lang], processLocally: true })) === true;
  } catch {
    return false;
  }
}

export interface VoiceActivity {
  /** Feed one level reading. `true` when speech has just started, `false` when it has just ended. */
  update(level: number, now: number): boolean | null;
  readonly speaking: boolean;
}

/**
 * Speech onset and offset from a level meter. Pure, so the thresholds are
 * tested without a microphone. Hysteresis both ways: a sustained rise to start,
 * a longer quiet to stop — a cough is not a question and a breath is not an end.
 */
export function voiceActivity({ start = 0.12, stop = 0.05, riseMs = 120, fallMs = 700 } = {}): VoiceActivity {
  let speaking = false;
  let since = -1;
  return {
    get speaking() {
      return speaking;
    },
    update(level, now) {
      const crossing = speaking ? level < stop : level > start;
      if (!crossing) {
        since = -1;
        return null;
      }
      if (since < 0) since = now;
      if (now - since < (speaking ? fallMs : riseMs)) return null;
      speaking = !speaking;
      since = -1;
      return speaking;
    },
  };
}

export interface ConverseOptions {
  readonly lang: string;
  /** Recognise speech too. Only honoured on a recogniser that runs on the device. */
  readonly transcribe: boolean;
  onLevel(level: number): void;
  onSpeech(speaking: boolean): void;
  onText(text: string, final: boolean): void;
  /** Speech-to-text has stopped for good — permission, language, or no local recogniser. The meter keeps running. */
  onTranscriptionLost(): void;
}

export interface Conversation {
  /** Stop recognising and reporting, keeping the microphone — while the assistant thinks and speaks. */
  pause(): void;
  resume(): void;
  /** Browsers keep audio suspended until the page is touched. Call from a user gesture. */
  wake(): void;
  stop(): void;
}

const FATAL_RECOGNITION_ERRORS = new Set(['not-allowed', 'service-not-allowed', 'language-not-supported', 'audio-capture']);
const MAX_RECOGNITION_FAILURES = 5;
/** How long a recogniser may take to say it has started before it is taken to be silent. */
const SILENT_START_MS = 4000;

/**
 * Listen hands-free: one microphone stream for as long as the conversation lasts,
 * speech detected from its level, and an on-device recogniser started again after
 * each utterance. Rejects if the user refuses the microphone.
 */
export async function converse(env: VoiceEnv, options: ConverseOptions): Promise<Conversation> {
  if (!env.getUserMedia) throw new Error('This browser cannot capture audio.');
  const stream = await env.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });

  let stopped = false;
  let paused = false;
  let lost = false;
  let failures = 0;
  let frame = 0;
  let retry = 0;
  let watchdog = 0;
  let activity = voiceActivity();
  let context: AudioContext | null = null;
  let recognition: Recognition | null = null;
  const R = options.transcribe ? localOnly(env) : null;

  const loseTranscription = (): void => {
    if (lost) return;
    lost = true;
    options.onTranscriptionLost();
  };

  const endRecognition = (): void => {
    const rec = recognition;
    recognition = null;
    try {
      if (rec?.abort) rec.abort();
      else rec?.stop();
    } catch {
      // already ended
    }
  };

  const again = (ms: number): void => {
    env.clearTimer(retry);
    retry = env.timer(startRecognition, ms);
  };

  function startRecognition(): void {
    if (!options.transcribe || stopped || paused || lost || recognition) return;
    if (!R) return loseTranscription();
    const rec = new R();
    rec.processLocally = true;
    // The line that keeps audio on the device. A recogniser that does not keep
    // the setting would fall back to its default service; it is not started.
    if (rec.processLocally !== true) return loseTranscription();
    rec.lang = options.lang;
    rec.interimResults = true;
    rec.continuous = false;
    rec.onresult = (event) => {
      failures = 0;
      let text = '';
      let final = false;
      for (let i = 0; i < event.results.length; i++) {
        const result = event.results[i]!;
        text += result[0]?.transcript ?? '';
        if (result.isFinal) final = true;
      }
      options.onText(text.trim(), final);
    };
    rec.onerror = (event) => {
      // Silence, and our own abort, are how a hands-free session normally goes.
      if (event.error === 'no-speech' || event.error === 'aborted') return;
      failures = FATAL_RECOGNITION_ERRORS.has(event.error) ? MAX_RECOGNITION_FAILURES : failures + 1;
    };
    rec.onend = () => {
      if (recognition === rec) recognition = null;
      if (stopped || paused) return;
      if (failures >= MAX_RECOGNITION_FAILURES) return loseTranscription();
      // One recognition ends after one utterance or a stretch of silence.
      // Listening hands-free means starting the next.
      again(failures > 0 ? 400 * failures : 50);
    };
    let began = false;
    rec.onstart = () => {
      began = true;
    };
    recognition = rec;
    // A recogniser whose language pack is not on the device yet starts and then says nothing
    // at all — no error, no end. Listening to it forever is what "voice does not work" is.
    env.clearTimer(watchdog);
    watchdog = env.timer(() => {
      if (began || recognition !== rec || stopped || paused) return;
      loseTranscription();
      endRecognition();
    }, SILENT_START_MS);
    try {
      rec.start();
    } catch {
      recognition = null;
      failures++;
      if (failures >= MAX_RECOGNITION_FAILURES) return loseTranscription();
      again(400 * failures);
    }
  }

  if (env.AudioContext) {
    const ctx = new env.AudioContext();
    context = ctx;
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    ctx.createMediaStreamSource(stream).connect(analyser);
    const samples = new Float32Array(analyser.fftSize);
    const measure = (): void => {
      if (stopped) return;
      frame = env.frame(measure);
      if (paused) return;
      analyser.getFloatTimeDomainData(samples);
      let sum = 0;
      for (const s of samples) sum += s * s;
      const level = Math.min(1, Math.sqrt(sum / samples.length) * 6);
      options.onLevel(level);
      const change = activity.update(level, env.now());
      if (change !== null) options.onSpeech(change);
    };
    frame = env.frame(measure);
    if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined);
  }

  startRecognition();

  return {
    pause() {
      if (paused || stopped) return;
      paused = true;
      env.clearTimer(retry);
      env.clearTimer(watchdog);
      endRecognition();
      if (activity.speaking) options.onSpeech(false);
      options.onLevel(0);
    },
    resume() {
      if (!paused || stopped) return;
      paused = false;
      activity = voiceActivity();
      startRecognition();
    },
    wake() {
      if (context?.state === 'suspended') void context.resume().catch(() => undefined);
    },
    stop() {
      if (stopped) return;
      stopped = true;
      if (frame) env.cancelFrame(frame);
      env.clearTimer(retry);
      env.clearTimer(watchdog);
      endRecognition();
      for (const track of stream.getTracks()) track.stop();
      void context?.close().catch(() => undefined);
      options.onLevel(0);
    },
  };
}

/** A voice that synthesises on this device, in this language — or none. */
export function pickLocalVoice(voices: readonly SpeechSynthesisVoice[], lang: string): SpeechSynthesisVoice | null {
  const want = lang.toLowerCase();
  const base = want.split('-')[0]!;
  const local = voices.filter((v) => v.localService && v.lang.toLowerCase().split(/[-_]/)[0] === base);
  return (
    local.find((v) => v.lang.toLowerCase().replace('_', '-') === want) ??
    local.find((v) => v.default) ??
    local[0] ??
    null
  );
}

export interface SpeakHandlers {
  onBoundary(): void;
  onEnd(): void;
}

export interface Speaking {
  cancel(): void;
}

/** Say `text` in a local voice. `null` when there is no local voice to say it with. */
export function speak(env: VoiceEnv, text: string, lang: string, handlers: SpeakHandlers): Speaking | null {
  if (!env.synth || !env.Utterance || !text.trim()) return null;
  const voice = pickLocalVoice(env.synth.getVoices(), lang);
  if (!voice) return null;

  const synth = env.synth;
  let ended = false;
  const end = (): void => {
    if (ended) return;
    ended = true;
    handlers.onEnd();
  };

  synth.cancel();
  const utterance = new env.Utterance(text);
  utterance.voice = voice;
  utterance.lang = voice.lang;
  utterance.onboundary = () => handlers.onBoundary();
  utterance.onend = end;
  utterance.onerror = end;
  synth.speak(utterance);
  return {
    cancel() {
      synth.cancel();
      end();
    },
  };
}
