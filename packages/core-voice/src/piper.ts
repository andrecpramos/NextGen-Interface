import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PIPER_ASSET, PIPER_VOICE_CONFIG_ASSET, PIPER_VOICE_ONNX_ASSET, VoiceAssetStore } from './assets.ts';
import type { TtsEngine } from './types.ts';

export interface PiperOptions {
  readonly store: VoiceAssetStore;
  readonly timeoutMs?: number;
}

/**
 * TTS via Piper's prebuilt Windows binary (`piper.exe`).
 *
 * Verified against this exact binary and voice: synthesised "Hello, this is
 * a test of Piper text to speech." — real-time factor 0.048, i.e. roughly
 * 20x faster than playback, which is what makes a same-turn voice reply
 * practical on CPU.
 *
 * Text goes in on stdin (Piper's default input mode — `--json-input` is not
 * used, so no per-line JSON framing is needed), a WAV path goes out via
 * `-f`. `execFile` cannot pipe stdin without losing the promise-based
 * ergonomics, so this uses `spawn` directly.
 */
export class PiperTtsEngine implements TtsEngine {
  readonly name = 'piper';
  readonly #store: VoiceAssetStore;
  readonly #timeoutMs: number;

  constructor(options: PiperOptions) {
    this.#store = options.store;
    this.#timeoutMs = options.timeoutMs ?? 30_000;
  }

  async isAvailable(): Promise<boolean> {
    try {
      await this.#paths();
      return true;
    } catch {
      return false;
    }
  }

  async synthesize(text: string): Promise<Buffer> {
    const { exe, model, config, espeakData } = await this.#paths();
    const workDir = await mkdtemp(join(tmpdir(), 'nextgen-piper-'));
    const outputWav = join(workDir, 'out.wav');

    try {
      await new Promise<void>((resolve, reject) => {
        const child = spawn(
          exe,
          ['-m', model, '-c', config, '-f', outputWav, '--espeak_data', espeakData, '-q'],
          { stdio: ['pipe', 'ignore', 'pipe'], timeout: this.#timeoutMs },
        );

        let stderr = '';
        child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
        child.on('error', reject);
        child.on('close', (code) => {
          if (code === 0) resolve();
          else reject(new Error(`piper exited with code ${code}: ${stderr.slice(-500)}`));
        });

        child.stdin.write(text);
        child.stdin.end();
      });

      return await readFile(outputWav);
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  }

  async #paths(): Promise<{ exe: string; model: string; config: string; espeakData: string }> {
    const piperDir = await this.#store.ensure(PIPER_ASSET);
    const model = await this.#store.ensure(PIPER_VOICE_ONNX_ASSET);
    const config = await this.#store.ensure(PIPER_VOICE_CONFIG_ASSET);
    return {
      exe: join(piperDir, 'piper', 'piper.exe'),
      model,
      config,
      espeakData: join(piperDir, 'piper', 'espeak-ng-data'),
    };
  }
}
