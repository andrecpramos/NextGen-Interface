import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  converse,
  installTranscription,
  pickLocalVoice,
  speak,
  speechLang,
  transcriptionFor,
  voiceActivity,
  type ConverseOptions,
  type Recognition,
  type RecognitionCtor,
  type VoiceEnv,
} from './voice.ts';

/**
 * Rule 8, for voice. Every test here is a way audio or speech could leave the
 * device, and each one must not: a recogniser with no on-device promise, one
 * that silently drops `processLocally`, a network voice that happens to be the
 * default. The rest is the hands-free loop keeping itself honest.
 */

interface FakeRecognition extends Recognition {
  started: boolean;
  aborted: boolean;
}

function recogniser(o: { status?: string; keepsLocal?: boolean; property?: boolean; checks?: boolean; throws?: boolean } = {}) {
  const { status = 'available', keepsLocal = true, property = true, checks = true, throws = false } = o;
  const made: FakeRecognition[] = [];
  const asked: unknown[] = [];

  class Fake {
    lang = '';
    interimResults = false;
    continuous = false;
    onresult: Recognition['onresult'] = null;
    onerror: Recognition['onerror'] = null;
    onend: Recognition['onend'] = null;
    started = false;
    aborted = false;
    constructor() {
      made.push(this as unknown as FakeRecognition);
    }
    start(): void {
      this.started = true;
    }
    stop(): void {
      this.onend?.();
    }
    abort(): void {
      this.aborted = true;
      this.onend?.();
    }
  }

  if (property) {
    const values = new WeakMap<object, boolean>();
    Object.defineProperty(Fake.prototype, 'processLocally', {
      get(this: object) {
        return values.get(this);
      },
      set(this: object, value: boolean) {
        // A recogniser that does not support local processing ignores the setting.
        if (keepsLocal) values.set(this, value);
      },
    });
  }
  if (checks) {
    Object.assign(Fake, {
      available: async (options: unknown) => {
        asked.push(options);
        if (throws) throw new Error('not supported');
        return status;
      },
      install: async (options: unknown) => {
        asked.push(options);
        return true;
      },
    });
  }
  return { R: Fake as unknown as RecognitionCtor, made, asked };
}

function environment(over: Partial<VoiceEnv> = {}) {
  const tracks = [
    {
      stopped: 0,
      stop() {
        this.stopped++;
      },
    },
  ];
  const env: VoiceEnv = {
    getUserMedia: async () => ({ getTracks: () => tracks }) as unknown as MediaStream,
    AudioContext: null,
    Recognition: null,
    synth: null,
    Utterance: null,
    frame: () => 1,
    cancelFrame: () => undefined,
    timer: (fn, ms) => setTimeout(fn, ms) as unknown as number,
    clearTimer: (id) => clearTimeout(id),
    now: () => Date.now(),
    ...over,
  };
  return { env, tracks };
}

function recorder() {
  const texts: [string, boolean][] = [];
  let lost = 0;
  return {
    texts,
    lost: () => lost,
    options: (over: Partial<ConverseOptions> = {}): ConverseOptions => ({
      lang: 'en-US',
      transcribe: true,
      onLevel: () => undefined,
      onSpeech: () => undefined,
      onText: (text, final) => void texts.push([text, final]),
      onTranscriptionLost: () => void lost++,
      ...over,
    }),
  };
}

const said = (text: string, isFinal: boolean) => ({ results: [{ isFinal, 0: { transcript: text } }] });

describe('speechLang', () => {
  it('gives a recogniser the region it needs', () => {
    expect(speechLang('pt')).toBe('pt-PT');
    expect(speechLang('pt-BR')).toBe('pt-BR');
    expect(speechLang('en')).toBe('en-US');
    expect(speechLang(null)).toBe('en-US');
  });
});

describe('transcriptionFor — on the device, or not at all', () => {
  it('is unavailable with no recogniser', async () => {
    expect(await transcriptionFor(environment().env, 'en-US')).toBe('unavailable');
  });

  it('is unavailable for a recogniser that cannot promise to stay local — the cloud-backed kind', async () => {
    const { R } = recogniser({ checks: false });
    expect(await transcriptionFor(environment({ Recognition: R }).env, 'en-US')).toBe('unavailable');
  });

  it('is unavailable when processLocally is not part of the recogniser', async () => {
    const { R } = recogniser({ property: false });
    expect(await transcriptionFor(environment({ Recognition: R }).env, 'en-US')).toBe('unavailable');
  });

  it('asks only about the local path, and reports what the browser says', async () => {
    const cases: [string, string][] = [
      ['available', 'available'],
      ['downloadable', 'downloadable'],
      ['downloading', 'downloadable'],
      ['unavailable', 'unavailable'],
    ];
    for (const [status, expected] of cases) {
      const { R, asked } = recogniser({ status });
      expect(await transcriptionFor(environment({ Recognition: R }).env, 'pt-PT')).toBe(expected);
      expect(asked).toEqual([{ langs: ['pt-PT'], processLocally: true }]);
    }
  });

  it('treats a failing check as unavailable', async () => {
    const { R } = recogniser({ throws: true });
    expect(await transcriptionFor(environment({ Recognition: R }).env, 'en-US')).toBe('unavailable');
  });

  it('installs a language pack only through the local path', async () => {
    const { R, asked } = recogniser();
    expect(await installTranscription(environment({ Recognition: R }).env, 'en-US')).toBe(true);
    expect(asked).toEqual([{ langs: ['en-US'], processLocally: true }]);
    expect(await installTranscription(environment().env, 'en-US')).toBe(false);
  });
});

describe('voiceActivity — hearing that someone is speaking', () => {
  const detector = () => voiceActivity({ start: 0.2, stop: 0.1, riseMs: 100, fallMs: 500 });

  it('starts only after a sustained rise, and stops only after a sustained quiet', () => {
    const va = detector();
    expect(va.update(0.5, 0)).toBeNull();
    expect(va.update(0.5, 99)).toBeNull();
    expect(va.update(0.5, 100)).toBe(true);
    expect(va.speaking).toBe(true);
    expect(va.update(0.05, 200)).toBeNull();
    expect(va.update(0.05, 699)).toBeNull();
    expect(va.update(0.05, 700)).toBe(false);
  });

  it('does not end on a breath, and does not start on a cough', () => {
    const va = detector();
    va.update(0.5, 0);
    va.update(0.5, 100);
    va.update(0.05, 200);
    expect(va.update(0.5, 450)).toBeNull(); // talking again before the quiet was long enough
    expect(va.update(0.05, 500)).toBeNull();
    expect(va.update(0.05, 900)).toBeNull();
    expect(va.speaking).toBe(true);

    const cough = detector();
    cough.update(0.5, 0);
    cough.update(0.05, 60);
    expect(cough.update(0.5, 120)).toBeNull();
    expect(cough.speaking).toBe(false);
  });
});

describe('converse — hands-free, on the device', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('starts an on-device recogniser and passes on interim and final text', async () => {
    const { R, made } = recogniser();
    const rec = recorder();
    await converse(environment({ Recognition: R }).env, rec.options());
    const r = made[0]!;
    expect(r.processLocally).toBe(true);
    expect(r.started).toBe(true);
    expect(r.lang).toBe('en-US');
    r.onresult!(said('where is ', false));
    r.onresult!(said('where is the calendar', true));
    expect(rec.texts).toEqual([
      ['where is', false],
      ['where is the calendar', true],
    ]);
  });

  it('keeps listening: when one recognition ends, the next one starts', async () => {
    const { R, made } = recogniser();
    await converse(environment({ Recognition: R }).env, recorder().options());
    made[0]!.stop();
    vi.advanceTimersByTime(50);
    expect(made).toHaveLength(2);
    expect(made[1]!.started).toBe(true);
  });

  it('never starts a recogniser that drops processLocally — that would be the cloud', async () => {
    const { R, made } = recogniser({ keepsLocal: false });
    const rec = recorder();
    await converse(environment({ Recognition: R }).env, rec.options());
    expect(made).toHaveLength(1);
    expect(made[0]!.started).toBe(false);
    expect(rec.lost()).toBe(1);
  });

  it('builds no recogniser at all when not asked to transcribe', async () => {
    const { R, made } = recogniser();
    await converse(environment({ Recognition: R }).env, recorder().options({ transcribe: false }));
    expect(made).toHaveLength(0);
  });

  it('pauses without restarting, and resumes with a fresh recognition', async () => {
    const { R, made } = recogniser();
    const session = await converse(environment({ Recognition: R }).env, recorder().options());
    session.pause();
    expect(made[0]!.aborted).toBe(true);
    vi.advanceTimersByTime(5000);
    expect(made).toHaveLength(1);
    session.resume();
    expect(made).toHaveLength(2);
    expect(made[1]!.started).toBe(true);
  });

  it('treats silence as normal, not as a failure', async () => {
    const { R, made } = recogniser();
    const rec = recorder();
    await converse(environment({ Recognition: R }).env, rec.options());
    for (let i = 0; i < 10; i++) {
      const r = made.at(-1)!;
      r.onerror!({ error: 'no-speech' });
      r.onend!();
      vi.advanceTimersByTime(50);
    }
    expect(made).toHaveLength(11);
    expect(rec.lost()).toBe(0);
  });

  it('gives up on transcription after a fatal error, and says so once', async () => {
    const { R, made } = recogniser();
    const rec = recorder();
    await converse(environment({ Recognition: R }).env, rec.options());
    made[0]!.onerror!({ error: 'not-allowed' });
    made[0]!.onend!();
    vi.advanceTimersByTime(5000);
    expect(made).toHaveLength(1);
    expect(rec.lost()).toBe(1);
  });

  it('stopping closes the microphone once', async () => {
    const { env, tracks } = environment();
    const session = await converse(env, recorder().options({ transcribe: false }));
    session.stop();
    session.stop();
    expect(tracks[0]!.stopped).toBe(1);
  });

  it('rejects when the microphone is refused', async () => {
    const { env } = environment({ getUserMedia: () => Promise.reject(new Error('NotAllowedError')) });
    await expect(converse(env, recorder().options())).rejects.toThrow();
  });
});

const voice = (name: string, lang: string, localService: boolean, isDefault = false): SpeechSynthesisVoice =>
  ({ name, lang, localService, default: isDefault, voiceURI: name }) as SpeechSynthesisVoice;

describe('pickLocalVoice', () => {
  it('never picks a network voice, even the default one', () => {
    expect(pickLocalVoice([voice('Cloud', 'en-US', false, true)], 'en-US')).toBeNull();
  });

  it('prefers the exact language, then the default, then any local voice in the language', () => {
    const gb = voice('GB', 'en-GB', true);
    const us = voice('US', 'en-US', true);
    const au = voice('AU', 'en-AU', true, true);
    expect(pickLocalVoice([gb, au, us], 'en-US')).toBe(us);
    expect(pickLocalVoice([gb, au], 'en-US')).toBe(au);
    expect(pickLocalVoice([gb], 'en-US')).toBe(gb);
    expect(pickLocalVoice([voice('PT', 'pt-PT', true)], 'en-US')).toBeNull();
  });
});

describe('speak', () => {
  class Utterance {
    text: string;
    voice: SpeechSynthesisVoice | null = null;
    lang = '';
    onboundary: (() => void) | null = null;
    onend: (() => void) | null = null;
    onerror: (() => void) | null = null;
    constructor(text: string) {
      this.text = text;
    }
  }

  function synth(voices: SpeechSynthesisVoice[]) {
    const spoken: Utterance[] = [];
    return {
      spoken,
      synth: { getVoices: () => voices, speak: (u: Utterance) => void spoken.push(u), cancel: () => undefined } as unknown as SpeechSynthesis,
    };
  }
  const U = Utterance as unknown as VoiceEnv['Utterance'];

  it('says nothing without a local voice', () => {
    const s = synth([voice('Cloud', 'en-US', false, true)]);
    const handle = speak(environment({ synth: s.synth, Utterance: U }).env, 'Opening Calendar', 'en-US', {
      onBoundary: () => undefined,
      onEnd: () => undefined,
    });
    expect(handle).toBeNull();
    expect(s.spoken).toHaveLength(0);
  });

  it('speaks in the local voice, and reports boundaries and one end', () => {
    const us = voice('US', 'en-US', true);
    const s = synth([us]);
    let boundaries = 0;
    let ends = 0;
    const handle = speak(environment({ synth: s.synth, Utterance: U }).env, 'Opening Calendar', 'en-US', {
      onBoundary: () => void boundaries++,
      onEnd: () => void ends++,
    });
    expect(handle).not.toBeNull();
    const u = s.spoken[0]!;
    expect(u.voice).toBe(us);
    expect(u.text).toBe('Opening Calendar');
    u.onboundary!();
    u.onend!();
    handle!.cancel();
    expect(boundaries).toBe(1);
    expect(ends).toBe(1);
  });
});
