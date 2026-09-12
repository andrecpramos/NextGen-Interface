import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AssetIntegrityError, PIPER_VOICES, VoiceAssetStore, WHISPER_MODELS, type AssetDescriptor } from './assets.ts';

/**
 * No real network here — same discipline `core-inference`'s `ModelStore`
 * tests would apply: a `fetchImpl` stands in for the network, so these are
 * fast and deterministic. The actual binaries and models were verified by
 * hand against this exact machine (downloaded, extracted, and round-tripped
 * a real sentence through both whisper.cpp and Piper) rather than in CI,
 * which is the honest place for "does a Windows binary actually run" to be
 * checked — a unit test cannot answer that question.
 */

function fakeFetch(body: Uint8Array, ok = true): typeof fetch {
  return (async () =>
    ({
      ok,
      status: ok ? 200 : 500,
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(body);
          controller.close();
        },
      }),
    }) as unknown as Response) as typeof fetch;
}

function throwingFetch(): typeof fetch {
  return (async () => {
    throw new Error('no network calls expected');
  }) as unknown as typeof fetch;
}

describe('VoiceAssetStore', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'nextgen-voice-test-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const bytes = new TextEncoder().encode('a fake asset, just for the hash to match');
  const sha256 = createHash('sha256').update(bytes).digest('hex');

  const descriptor: AssetDescriptor = {
    id: 'fake-asset',
    url: 'https://example.invalid/fake-asset.bin',
    sha256,
    sizeBytes: bytes.length,
    filename: 'fake-asset.bin',
  };

  it('downloads, verifies, and places the file at pathFor()', async () => {
    const store = new VoiceAssetStore({ directory: dir, fetchImpl: fakeFetch(bytes) });
    const path = await store.ensure(descriptor);
    expect(path).toBe(store.pathFor(descriptor));
    expect(await readFile(path)).toEqual(Buffer.from(bytes));
  });

  it('refuses a hash mismatch rather than using a corrupt or substituted file', async () => {
    const wrongBytes = new TextEncoder().encode('not the expected content at all');
    const store = new VoiceAssetStore({ directory: dir, fetchImpl: fakeFetch(wrongBytes) });
    await expect(store.ensure(descriptor)).rejects.toThrow(AssetIntegrityError);
  });

  it('does not re-download an asset already verified on a prior run', async () => {
    const store = new VoiceAssetStore({ directory: dir, fetchImpl: fakeFetch(bytes) });
    await store.ensure(descriptor);

    // A second store instance, wired to a fetch that throws if it is ever
    // called — proving the marker-file cache hit skips the network entirely.
    const second = new VoiceAssetStore({ directory: dir, fetchImpl: throwingFetch() });
    const path = await second.ensure(descriptor);
    expect(await readFile(path)).toEqual(Buffer.from(bytes));
  });

  it('extracts a zip archive into filename/ and records a marker so it is not re-extracted', async () => {
    const AdmZip = (await import('adm-zip')).default;
    const zip = new AdmZip();
    zip.addFile('inner/hello.txt', Buffer.from('hello from inside the zip'));
    const zipBytes = zip.toBuffer();
    const zipSha = createHash('sha256').update(zipBytes).digest('hex');

    const zipDescriptor: AssetDescriptor = {
      id: 'fake-archive',
      url: 'https://example.invalid/fake-archive.zip',
      sha256: zipSha,
      sizeBytes: zipBytes.length,
      filename: 'fake-archive-extracted',
      extract: true,
    };

    const store = new VoiceAssetStore({ directory: dir, fetchImpl: fakeFetch(zipBytes) });
    const extractedDir = await store.ensure(zipDescriptor);
    expect(await readFile(join(extractedDir, 'inner', 'hello.txt'), 'utf8')).toBe('hello from inside the zip');

    const second = new VoiceAssetStore({ directory: dir, fetchImpl: throwingFetch() });
    await second.ensure(zipDescriptor);
  });
});

/**
 * WP-44 added a second language, and the way to get that wrong silently is to
 * point two entries at one file — a "Portuguese" run that quietly uses the
 * English voice would produce a plausible word error rate and mean nothing.
 * These assert the manifest is actually distinct.
 */
describe('the manifest — one asset per language, and no accidental aliases', () => {
  it('gives every declared asset its own url, hash and filename', () => {
    const assets = [
      ...Object.values(PIPER_VOICES).flatMap((v) => [v.onnx, v.config]),
      ...Object.values(WHISPER_MODELS),
    ];
    for (const field of ['id', 'url', 'sha256', 'filename'] as const) {
      const seen = assets.map((a) => a[field]);
      expect(new Set(seen).size, `two assets share a ${field}`).toBe(assets.length);
    }
  });

  it('keeps English-only and multilingual whisper as separate models', () => {
    // base.en cannot transcribe Portuguese at all, and is better at English than
    // the multilingual one. Replacing rather than adding would have silently
    // invalidated WP-21's English numbers.
    expect(WHISPER_MODELS['base.en'].filename).toContain('.en');
    expect(WHISPER_MODELS.base.filename).not.toContain('.en');
    expect(Object.keys(WHISPER_MODELS)).toContain('small');
  });

  it('ships European Portuguese, not Brazilian', () => {
    // pt-BR against a pt-PT golden set would measure the wrong accent against
    // the wrong words, and still produce a number.
    expect(PIPER_VOICES.pt_PT.onnx.filename).toMatch(/^pt_PT-/);
    expect(PIPER_VOICES.pt_PT.onnx.url).toContain('/pt_PT/');
  });
});
