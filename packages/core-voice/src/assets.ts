import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';

/**
 * Voice asset lifecycle: download, verify, extract.
 *
 * Same discipline as `@nextgen/core-inference`'s `ModelStore` (WP-06), applied
 * to a different shape of asset: whisper.cpp and Piper ship as prebuilt
 * Windows binaries in a zip, not a single weights file, and this repo's
 * install (`--ignore-scripts`) rules out an npm wrapper that would compile
 * one from source on install — see CLAUDE.md. A download lands on a `.part`
 * file and is renamed into place only after the hash matches, exactly as the
 * LLM weights are; an interrupted download therefore cannot be mistaken for a
 * complete one on the next launch.
 *
 * Every URL and hash below was independently verified against the file
 * actually downloaded before being hardcoded here — never trust a hash you
 * did not compute yourself against the bytes you received.
 */

export interface AssetDescriptor {
  readonly id: string;
  readonly url: string;
  readonly sha256: string;
  readonly sizeBytes: number;
  /** File or directory name under the store root. */
  readonly filename: string;
  /** True for a zip archive that gets extracted into `filename/` after verification. */
  readonly extract?: boolean;
}

export const WHISPER_CLI_ASSET: AssetDescriptor = {
  id: 'whisper-cli-win-x64',
  url: 'https://github.com/ggml-org/whisper.cpp/releases/download/b4938/whisper-bin-x64.zip',
  sha256: 'c2a4b60edb11f7e11a9191ffb50929535527d4d91c9903dbe3e554583bbbc63d',
  sizeBytes: 8361840,
  filename: 'whisper-bin-x64',
  extract: true,
};

export const WHISPER_MODEL_ASSET: AssetDescriptor = {
  id: 'whisper-model-base-en-q5_1',
  url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en-q5_1.bin',
  sha256: '4baf70dd0d7c4247ba2b81fafd9c01005ac77c2f9ef064e00dcf195d0e2fdd2f',
  sizeBytes: 59721011,
  filename: 'ggml-base.en-q5_1.bin',
};

/**
 * The multilingual base model (WP-44).
 *
 * `base.en` above is English-only: it cannot transcribe Portuguese at all, which
 * is the limit WP-21 stated before its result and could not test around. This is
 * the same size and quantisation, trained on 99 languages. It is a *separate*
 * asset rather than a replacement, because English-only is measurably better at
 * English and WP-21's numbers were measured with it — swapping it out would
 * silently invalidate them.
 */
export const WHISPER_MODEL_MULTILINGUAL_ASSET: AssetDescriptor = {
  id: 'whisper-model-base-q5_1',
  url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base-q5_1.bin',
  sha256: '422f1ae452ade6f30a004d7e5c6a43195e4433bc370bf23fac9cc591f01a8898',
  sizeBytes: 59707625,
  filename: 'ggml-base-q5_1.bin',
};

/**
 * The small multilingual model (WP-44).
 *
 * Three times the size of `base` and the difference is not cosmetic: on this
 * repository's own pt-PT measurement `base` returns 63.3% word error and `small`
 * returns far less (eval/fut-app/VOICE-PT.md). Kept as a third option rather than
 * the default because it is 190MB and slower, and because English-only `base.en`
 * remains the right choice for English.
 */
export const WHISPER_MODEL_SMALL_ASSET: AssetDescriptor = {
  id: 'whisper-model-small-q5_1',
  url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small-q5_1.bin',
  sha256: 'ae85e4a935d7a567bd102fe55afc16bb595bdb618e11b2fc7591bc08120411bb',
  sizeBytes: 190085487,
  filename: 'ggml-small-q5_1.bin',
};

export const PIPER_ASSET: AssetDescriptor = {
  id: 'piper-win-amd64',
  url: 'https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_windows_amd64.zip',
  sha256: 'f3c58906402b24f3a96d92145f58acba6d86c9b5db896d207f78dc80811efcea',
  sizeBytes: 22477236,
  filename: 'piper-windows-amd64',
  extract: true,
};

export const PIPER_VOICE_ONNX_ASSET: AssetDescriptor = {
  id: 'piper-voice-en_US-lessac-medium-onnx',
  url: 'https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium/en_US-lessac-medium.onnx',
  sha256: '5efe09e69902187827af646e1a6e9d269dee769f9877d17b16b1b46eeaaf019f',
  sizeBytes: 63201294,
  filename: 'en_US-lessac-medium.onnx',
};

export const PIPER_VOICE_CONFIG_ASSET: AssetDescriptor = {
  id: 'piper-voice-en_US-lessac-medium-config',
  url: 'https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium/en_US-lessac-medium.onnx.json',
  sha256: 'efe19c417bed055f2d69908248c6ba650fa135bc868b0e6abb3da181dab690a0',
  sizeBytes: 4885,
  filename: 'en_US-lessac-medium.onnx.json',
};

/**
 * European Portuguese, not Brazilian (WP-44).
 *
 * `fut-app` is a Portuguese club application and its golden set is pt-PT, so a
 * pt-BR voice would measure the wrong accent against the wrong words. The config
 * below declares `language.code: "pt_PT"`, `region: "PT"`.
 */
export const PIPER_VOICE_PT_ONNX_ASSET: AssetDescriptor = {
  id: 'piper-voice-pt_PT-tugao-medium-onnx',
  url: 'https://huggingface.co/rhasspy/piper-voices/resolve/main/pt/pt_PT/tug%C3%A3o/medium/pt_PT-tug%C3%A3o-medium.onnx',
  sha256: '223a7aaca69a155c61897e8ada7c3b13bc306e16c72dbb9c2fed733e2b0927d4',
  sizeBytes: 63201294,
  filename: 'pt_PT-tugao-medium.onnx',
};

export const PIPER_VOICE_PT_CONFIG_ASSET: AssetDescriptor = {
  id: 'piper-voice-pt_PT-tugao-medium-config',
  url: 'https://huggingface.co/rhasspy/piper-voices/resolve/main/pt/pt_PT/tug%C3%A3o/medium/pt_PT-tug%C3%A3o-medium.onnx.json',
  sha256: 'fe0918dfc0f1a89264a6eea4afe8e95d8e9fed3cc6c81b5c2f87fcb2b50c7320',
  sizeBytes: 5026,
  filename: 'pt_PT-tugao-medium.onnx.json',
};

/** The voices this repository has assets for. A voice is a pair: weights and config. */
export const PIPER_VOICES = {
  en_US: { onnx: PIPER_VOICE_ONNX_ASSET, config: PIPER_VOICE_CONFIG_ASSET },
  pt_PT: { onnx: PIPER_VOICE_PT_ONNX_ASSET, config: PIPER_VOICE_PT_CONFIG_ASSET },
} as const;

export type PiperVoiceId = keyof typeof PIPER_VOICES;

/**
 * The whisper models this repository has assets for.
 *
 * `base.en` is English-only and better at English; `base` is multilingual and the
 * only one that can hear Portuguese. Which one a run used belongs in its report:
 * a word error rate means nothing without it.
 */
export const WHISPER_MODELS = {
  'base.en': WHISPER_MODEL_ASSET,
  base: WHISPER_MODEL_MULTILINGUAL_ASSET,
  small: WHISPER_MODEL_SMALL_ASSET,
} as const;

export type WhisperModelId = keyof typeof WHISPER_MODELS;

export class AssetIntegrityError extends Error {
  readonly assetId: string;
  readonly expected: string;
  readonly actual: string;

  constructor(assetId: string, expected: string, actual: string) {
    super(`asset "${assetId}" failed integrity check: expected sha256 ${expected}, got ${actual}. Refusing to use it.`);
    this.name = 'AssetIntegrityError';
    this.assetId = assetId;
    this.expected = expected;
    this.actual = actual;
  }
}

export interface AssetStoreOptions {
  readonly directory: string;
  readonly fetchImpl?: typeof fetch;
}

export class VoiceAssetStore {
  readonly #directory: string;
  readonly #fetch: typeof fetch;

  constructor(options: AssetStoreOptions) {
    this.#directory = options.directory;
    this.#fetch = options.fetchImpl ?? fetch;
  }

  /** The file (or, for an extracted archive, the directory) this asset lives at once ready. */
  pathFor(descriptor: AssetDescriptor): string {
    return join(this.#directory, descriptor.filename);
  }

  /**
   * Make an asset available, downloading (and extracting) it if necessary.
   *
   * A `.done` marker records the verified hash of what was extracted, so a
   * re-run does not re-download or re-unzip a directory that is already
   * correct — checking a directory's contents against a hash is not
   * meaningful the way checking a file's bytes is, so the marker is the
   * thing trusted for archives.
   */
  async ensure(descriptor: AssetDescriptor, onProgress?: (bytes: number, total: number) => void): Promise<string> {
    const target = this.pathFor(descriptor);
    const marker = `${target}.done`;

    if (await this.#alreadyDone(marker, descriptor)) return target;

    await mkdir(this.#directory, { recursive: true });
    const downloadPath = descriptor.extract ? `${target}.zip` : target;
    const partial = `${downloadPath}.part`;

    try {
      const res = await this.#fetch(descriptor.url);
      if (!res.ok || !res.body) throw new Error(`download failed (${res.status}) for ${descriptor.url}`);

      let received = 0;
      const count = new Transform({
        transform(chunk, _enc, cb) {
          received += chunk.length;
          onProgress?.(received, descriptor.sizeBytes);
          cb(null, chunk);
        },
      });
      await pipeline(res.body as unknown as NodeJS.ReadableStream, count, createWriteStream(partial));

      const actual = await sha256File(partial);
      if (actual !== descriptor.sha256.toLowerCase()) {
        await rm(partial, { force: true });
        throw new AssetIntegrityError(descriptor.id, descriptor.sha256, actual);
      }

      if (descriptor.extract) {
        const { default: AdmZip } = await import('adm-zip');
        await rm(target, { recursive: true, force: true });
        new AdmZip(partial).extractAllTo(target, true);
        await rm(partial, { force: true });
      } else {
        await rename(partial, target);
      }

      await writeFile(marker, actual, 'utf8');
      return target;
    } catch (err) {
      await rm(partial, { force: true }).catch(() => {});
      throw err;
    }
  }

  async #alreadyDone(marker: string, descriptor: AssetDescriptor): Promise<boolean> {
    try {
      const recorded = (await readFile(marker, 'utf8')).trim();
      if (recorded !== descriptor.sha256.toLowerCase()) return false;
      await stat(this.pathFor(descriptor));
      return true;
    } catch {
      return false;
    }
  }
}

export async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}
