import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { VoiceAssetStore, WHISPER_CLI_ASSET, WHISPER_MODELS, type WhisperModelId } from './assets.ts';
import type { SttEngine, SttResult } from './types.ts';

const run = promisify(execFile);

interface WhisperJsonOutput {
  readonly transcription?: readonly { readonly text?: string }[];
}

export interface WhisperCppOptions {
  readonly store: VoiceAssetStore;
  readonly timeoutMs?: number;
  /** `base.en` (default, English-only, WP-21's) or `base` (multilingual, WP-44's). */
  readonly model?: WhisperModelId;
  /**
   * The language being spoken, as an ISO code — `pt` for Portuguese.
   *
   * Only meaningful with the multilingual model, and worth being explicit about:
   * left to auto-detect, whisper decides per clip, and a short utterance it
   * mis-detects comes back translated into English rather than transcribed. A
   * measurement cannot afford that ambiguity.
   */
  readonly language?: string;
}

/**
 * STT via whisper.cpp's prebuilt Windows CLI (`whisper-cli.exe`).
 *
 * Verified against this exact binary and model: synthesised a sentence with
 * Piper, fed the WAV back through `whisper-cli.exe -m ggml-base.en-q5_1.bin
 * -f <wav> -np -nt -oj`, and it round-tripped the sentence exactly.
 *
 * Not the npm wrapper that compiles from source on install — `--ignore-scripts`
 * (CLAUDE.md) would break that. This spawns the official prebuilt binary via
 * `execFile` with an argument array, never a shell string, which is what
 * keeps a Windows path with spaces from being misparsed.
 */
export class WhisperCppSttEngine implements SttEngine {
  readonly name = 'whisper.cpp';
  readonly #store: VoiceAssetStore;
  readonly #timeoutMs: number;
  readonly #model: WhisperModelId;
  readonly #language: string | undefined;

  constructor(options: WhisperCppOptions) {
    this.#store = options.store;
    this.#timeoutMs = options.timeoutMs ?? 60_000;
    this.#model = options.model ?? 'base.en';
    this.#language = options.language;
  }

  /** Which model this engine hears with — a word error rate means nothing without it. */
  get model(): WhisperModelId {
    return this.#model;
  }

  async isAvailable(): Promise<boolean> {
    try {
      await this.#binaryPath();
      await this.#modelPath();
      return true;
    } catch {
      return false;
    }
  }

  async transcribe(wavPath: string): Promise<SttResult> {
    const exe = await this.#binaryPath();
    const model = await this.#modelPath();

    const workDir = await mkdtemp(join(tmpdir(), 'nextgen-whisper-'));
    const outputBase = join(workDir, 'result');
    try {
      const language = this.#language ? ['-l', this.#language] : [];
      await run(exe, ['-m', model, '-f', wavPath, '-np', '-nt', '-oj', '-of', outputBase, ...language], {
        timeout: this.#timeoutMs,
      });

      const raw = await readFile(`${outputBase}.json`, 'utf8');
      const parsed = JSON.parse(raw) as WhisperJsonOutput;
      const text = (parsed.transcription ?? []).map((t) => t.text ?? '').join('').trim();
      if (!text) throw new Error('whisper.cpp produced no transcript');
      return { text };
    } finally {
      // Audio and intermediate output never persisted past transcription.
      await rm(workDir, { recursive: true, force: true });
    }
  }

  async #binaryPath(): Promise<string> {
    const dir = await this.#store.ensure(WHISPER_CLI_ASSET);
    return join(dir, 'Release', 'whisper-cli.exe');
  }

  async #modelPath(): Promise<string> {
    return this.#store.ensure(WHISPER_MODELS[this.#model]);
  }
}
