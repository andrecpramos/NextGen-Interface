import { describe, expect, it } from 'vitest';

import { serverRecognition, speechDetector, type ServerVoiceEnv } from './server-voice.ts';
import type { Recognition } from './voice.ts';

/**
 * ADR-037, Rule 8: what a visitor says may go to the app's own server, and to no one else's — and only
 * once they have said something.
 */

describe('speechDetector — a microphone whose levels nobody knows', () => {
  /** Feed a level every 50 ms from `from` to `to` (ms). */
  const feed = (d: ReturnType<typeof speechDetector>, rms: number, from: number, to: number) => {
    let last: string = 'waiting';
    for (let t = from; t < to; t += 50) last = d.update(rms, t);
    return last;
  };

  it('hears quiet speech on a webcam microphone with noise suppression (room ≈ 0.0016, speech < 0.012)', () => {
    const d = speechDetector();
    feed(d, 0, 0, 100); // the suppressor settling: exact zeros
    feed(d, 0.0016, 100, 400);
    expect(feed(d, 0.009, 400, 1500)).toBe('speaking');
    expect(d.heard).toBe(true);
    expect(feed(d, 0.0016, 1500, 2600)).toBe('done');
  });

  it('is not fooled by the settling zeros into taking the room for silence', () => {
    const d = speechDetector();
    feed(d, 0, 0, 200);
    feed(d, 0.003, 200, 400);
    // 0.005 is room noise at this level (threshold 3 × 0.003), not speech.
    expect(feed(d, 0.005, 400, 1400)).toBe('waiting');
    expect(d.heard).toBe(false);
  });

  it('caps the room, so someone already talking cannot raise the bar above their own voice', () => {
    const d = speechDetector();
    feed(d, 0.05, 0, 400);
    expect(feed(d, 0.03, 400, 900)).toBe('speaking');
  });

  it('gives up after 7.5 s with nothing said', () => {
    const d = speechDetector();
    expect(feed(d, 0.001, 0, 8000)).toBe('nothing');
    expect(d.heard).toBe(false);
  });
});

// A page with a microphone whose level is whatever `levels` says at the moment, and a recorder.
function page(levels: () => number, send: ServerVoiceEnv['send'], href = 'https://club.example/app') {
  let now = 0;
  const timers: { at: number; fn: () => void; id: number }[] = [];
  let nextId = 1;
  const tracks: { stopped: boolean }[] = [];
  class FakeRecorder {
    state = 'inactive';
    mimeType = 'audio/webm;codecs=opus';
    ondataavailable: ((e: { data: Blob }) => void) | null = null;
    onstop: (() => void) | null = null;
    static isTypeSupported(type: string): boolean {
      return type === 'audio/webm;codecs=opus';
    }
    start(): void {
      this.state = 'recording';
    }
    stop(): void {
      if (this.state !== 'recording') return;
      this.state = 'inactive';
      this.ondataavailable?.({ data: new Blob(['opus-bytes']) });
      this.onstop?.();
    }
  }
  class FakeContext {
    createAnalyser() {
      return {
        fftSize: 1024,
        getFloatTimeDomainData(samples: Float32Array) {
          samples.fill(levels());
        },
      };
    }
    createMediaStreamSource() {
      return { connect() {} };
    }
    async close() {}
  }
  const url = new URL(href);
  const env: ServerVoiceEnv = {
    getUserMedia: async () => {
      const track = { stopped: false, stop() { this.stopped = true; } };
      tracks.push(track);
      return { getTracks: () => [track] } as unknown as MediaStream;
    },
    AudioContext: FakeContext as unknown as new () => AudioContext,
    MediaRecorder: FakeRecorder as unknown as ServerVoiceEnv['MediaRecorder'],
    timer: (fn, ms) => {
      const id = nextId++;
      timers.push({ at: now + ms, fn, id });
      return id;
    },
    clearTimer: (id) => {
      const i = timers.findIndex((t) => t.id === id);
      if (i >= 0) timers.splice(i, 1);
    },
    now: () => now,
    location: { href: url.href, origin: url.origin },
    send,
  };
  /** Advance the clock to `to`, running what falls due; let promises settle in between. */
  const run = async (to: number) => {
    for (;;) {
      await new Promise((r) => setTimeout(r, 0));
      timers.sort((a, b) => a.at - b.at);
      const next = timers[0];
      if (!next || next.at > to) break;
      timers.shift();
      now = next.at;
      next.fn();
    }
    now = to;
    await new Promise((r) => setTimeout(r, 0));
  };
  return { env, run, tracks, setNow: (t: number) => (now = t), get now() { return now; } };
}

function listen(rec: Recognition) {
  const heard: { text: string; final: boolean }[] = [];
  const errors: string[] = [];
  let ended = 0;
  rec.onresult = (event) => {
    const r = event.results[0]!;
    heard.push({ text: r[0]!.transcript, final: r.isFinal });
  };
  rec.onerror = (event) => void errors.push(event.error);
  rec.onend = () => void ended++;
  return { heard, errors, ended: () => ended };
}

describe('serverRecognition — the app’s own speech-to-text', () => {
  it('is unavailable, never a request, when the path is on another site', () => {
    const sent: string[] = [];
    const { env } = page(() => 0, async (u) => (sent.push(u), new Response('{}')));
    expect(serverRecognition({ path: 'https://speech-vendor.example/v1/audio/transcriptions' }, env)).toBeNull();
    expect(serverRecognition({ path: 'https://club.example.attacker.example/stt' }, env)).toBeNull();
    expect(sent).toEqual([]);
  });

  it('passes the check that audio stays where it belongs, as a browser recogniser must', () => {
    const { env } = page(() => 0, async () => new Response('{}'));
    const R = serverRecognition({ path: '/api/transcribe' }, env)!;
    expect('processLocally' in R.prototype).toBe(true);
    const rec = new R();
    rec.processLocally = false;
    expect(rec.processLocally).toBe(true);
  });

  it('records one utterance, sends it to this site with the language, and gives one final result', async () => {
    let level = 0.0016;
    const sent: { url: string; form: FormData; method?: string }[] = [];
    const p = page(() => level, async (url, init) => {
      sent.push({ url, form: init.body as FormData, ...(init.method ? { method: init.method } : {}) });
      return new Response(JSON.stringify({ text: ' quando é o próximo treino ' }));
    });
    const R = serverRecognition({ path: '/api/transcribe' }, p.env)!;
    const rec = new R();
    rec.lang = 'pt-PT';
    const got = listen(rec);
    rec.start();
    await p.run(400);
    level = 0.01;
    await p.run(1500);
    level = 0.0016;
    await p.run(3000);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.url).toBe('https://club.example/api/transcribe');
    expect(sent[0]!.method).toBe('POST');
    expect(sent[0]!.form.get('language')).toBe('pt');
    expect(sent[0]!.form.get('file')).toBeInstanceOf(Blob);
    expect(got.heard).toEqual([{ text: 'quando é o próximo treino', final: true }]);
    expect(got.ended()).toBe(1);
    expect(p.tracks.every((t) => t.stopped)).toBe(true);
  });

  it('sends nothing when nothing was said: listening hands-free never uploads the room', async () => {
    const sent: string[] = [];
    const p = page(() => 0.0016, async (u) => (sent.push(u), new Response('{"text":"x"}')));
    const rec = new (serverRecognition({ path: '/api/transcribe' }, p.env)!)();
    const got = listen(rec);
    rec.start();
    await p.run(9000);
    expect(sent).toEqual([]);
    expect(got.errors).toEqual(['no-speech']);
    expect(got.ended()).toBe(1);
  });

  it('uses the app’s authenticated client when given, and says why when the server refuses', async () => {
    let level = 0.0016;
    const signed: string[] = [];
    const p = page(() => level, async () => new Response('nope', { status: 500 }));
    const rec = new (serverRecognition(
      { path: '/api/transcribe', fetch: async (url) => (signed.push(url), new Response('no', { status: 401 })) },
      p.env,
    )!)();
    const got = listen(rec);
    rec.start();
    await p.run(400);
    level = 0.02;
    await p.run(1200);
    level = 0.001;
    await p.run(3000);
    expect(signed).toEqual(['https://club.example/api/transcribe']);
    expect(got.errors).toEqual(['service-not-allowed']);
  });
});
