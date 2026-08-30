import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, rename, rm, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { ModelIntegrityError, type ModelDescriptor, type ModelStatus } from './types.ts';

/**
 * Model lifecycle: download, verify, load, unload.
 *
 * Two constraints drive the whole design:
 *
 *  1. **The asset cannot be bundled.** A quantised 1B GGUF is 0.9–1.6 GB against
 *     a 200 MB store cap, so it arrives on demand and the app has to be useful
 *     before it finishes (WP-10).
 *  2. **Verify before load, fail closed.** A model file is executable weight
 *     fetched over a network. A truncated download and a substituted file look
 *     identical to a loader, and "the model behaved strangely" is not a
 *     diagnosis anyone reaches quickly.
 */

export interface ModelStoreOptions {
  readonly directory: string;
  /** Unload after this long idle. Weights are the largest thing resident. */
  readonly idleUnloadMs?: number;
  readonly fetchImpl?: typeof fetch;
}

export class ModelStore {
  readonly #directory: string;
  readonly #idleUnloadMs: number;
  readonly #fetch: typeof fetch;
  readonly #status = new Map<string, ModelStatus>();
  #loaded: { id: string; at: number } | null = null;

  constructor(options: ModelStoreOptions) {
    this.#directory = options.directory;
    this.#idleUnloadMs = options.idleUnloadMs ?? 5 * 60_000;
    this.#fetch = options.fetchImpl ?? fetch;
  }

  pathFor(descriptor: ModelDescriptor): string {
    return join(this.#directory, `${descriptor.id.replace(/[^\w.-]/g, '_')}.gguf`);
  }

  status(id: string): ModelStatus {
    return this.#status.get(id) ?? { id, state: 'absent' };
  }

  /**
   * Make a model available, downloading it if necessary.
   *
   * The download lands on a `.part` file and is only renamed into place **after**
   * the hash matches. An interrupted download therefore cannot be mistaken for a
   * complete one on the next launch, which is the failure mode that a
   * download-in-place would produce and nothing would notice.
   */
  async ensure(
    descriptor: ModelDescriptor,
    onProgress?: (bytes: number, total: number) => void,
  ): Promise<string> {
    const target = this.pathFor(descriptor);

    if (await this.#verifiedOnDisk(descriptor, target)) {
      this.#status.set(descriptor.id, { id: descriptor.id, state: 'ready', path: target });
      return target;
    }

    await mkdir(dirname(target), { recursive: true });
    const partial = `${target}.part`;
    this.#status.set(descriptor.id, { id: descriptor.id, state: 'downloading', bytesDownloaded: 0 });

    try {
      const res = await this.#fetch(descriptor.url);
      if (!res.ok || !res.body) throw new Error(`download failed (${res.status})`);

      const { createWriteStream } = await import('node:fs');
      const { pipeline } = await import('node:stream/promises');
      const { Transform } = await import('node:stream');

      let received = 0;
      const count = new Transform({
        transform(chunk, _enc, cb) {
          received += chunk.length;
          onProgress?.(received, descriptor.sizeBytes);
          cb(null, chunk);
        },
      });

      await pipeline(res.body as unknown as NodeJS.ReadableStream, count, createWriteStream(partial));

      this.#status.set(descriptor.id, { id: descriptor.id, state: 'verifying', bytesDownloaded: received });
      const actual = await sha256File(partial);
      if (actual !== descriptor.sha256.toLowerCase()) {
        await rm(partial, { force: true });
        this.#status.set(descriptor.id, {
          id: descriptor.id,
          state: 'corrupt',
          error: `sha256 ${actual} != ${descriptor.sha256}`,
        });
        throw new ModelIntegrityError(descriptor.id, descriptor.sha256, actual);
      }

      await rename(partial, target);
      this.#status.set(descriptor.id, { id: descriptor.id, state: 'ready', path: target });
      return target;
    } catch (err) {
      await rm(partial, { force: true });
      if (err instanceof ModelIntegrityError) throw err;
      this.#status.set(descriptor.id, {
        id: descriptor.id,
        state: 'absent',
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }

  /**
   * Verify an already-present file.
   *
   * Runs on every load, not only after download. Bit rot, a partial restore from
   * a backup, and a deliberately swapped file all look the same, and the cost of
   * hashing is paid once per load against weights that take far longer to read.
   */
  async verify(descriptor: ModelDescriptor): Promise<boolean> {
    return this.#verifiedOnDisk(descriptor, this.pathFor(descriptor));
  }

  async #verifiedOnDisk(descriptor: ModelDescriptor, path: string): Promise<boolean> {
    try {
      await stat(path);
    } catch {
      return false;
    }
    const actual = await sha256File(path);
    if (actual === descriptor.sha256.toLowerCase()) return true;
    this.#status.set(descriptor.id, {
      id: descriptor.id,
      state: 'corrupt',
      error: `sha256 ${actual} != ${descriptor.sha256}`,
    });
    return false;
  }

  /** Note a use, for idle tracking. */
  touch(id: string): void {
    this.#loaded = { id, at: Date.now() };
  }

  /** Whether the resident model has been idle long enough to unload. */
  shouldUnload(now = Date.now()): boolean {
    return this.#loaded !== null && now - this.#loaded.at >= this.#idleUnloadMs;
  }

  markUnloaded(): void {
    this.#loaded = null;
  }

  get residentModelId(): string | null {
    return this.#loaded?.id ?? null;
  }
}

export async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}
