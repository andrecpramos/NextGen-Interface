import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { FakeEmbeddingRuntime, FakeLlmRuntime } from './fake.ts';
import { LlamaRnRuntime, NotImplementedRuntimeError, WebGpuRuntime } from './platform.ts';
import { ModelStore, sha256File } from './model-store.ts';
import { ModelIntegrityError, type CompletionRequest, type JsonSchema } from './types.ts';

const SCHEMA: JsonSchema = {
  type: 'object',
  properties: { capabilityId: { type: 'string' }, confidence: { type: 'number' } },
  required: ['capabilityId', 'confidence'],
};

const request = (prompt: string): CompletionRequest => ({
  system: 'route the utterance',
  prompt,
  schema: SCHEMA,
});

describe('FakeLlmRuntime — deterministic, no network', () => {
  it('returns the configured completion for a matching prompt', async () => {
    const rt = new FakeLlmRuntime({
      completions: [{ whenPromptContains: 'food', value: { capabilityId: 'spending.by_category', confidence: 0.9 } }],
    });
    const r = await rt.complete(request('how much on food'));
    expect(r.value).toEqual({ capabilityId: 'spending.by_category', confidence: 0.9 });
    expect(r.parseFailed).toBe(false);
  });

  it('gives the same answer every time', async () => {
    // The reason these exist. Finding 10 measured 7 of 200 entries flipping
    // between two identical 8B runs at temperature 0 — a suite built on that
    // flakes, and a flaky test on a financial path gets deleted, not fixed.
    const rt = new FakeLlmRuntime({ fallback: { capabilityId: 'x', confidence: 0.5 } });
    const runs = await Promise.all([1, 2, 3, 4, 5].map(() => rt.complete(request('anything'))));
    for (const r of runs) expect(r.value).toEqual({ capabilityId: 'x', confidence: 0.5 });
  });

  it('simulates the runtime being unavailable without throwing', async () => {
    const rt = new FakeLlmRuntime({ unavailable: 'model not downloaded' });
    const r = await rt.complete(request('anything'));
    expect(r.unavailable).toBe('model not downloaded');
    expect(r.value).toBeNull();
    expect(await rt.isAvailable()).toBe(false);
  });

  it('simulates a constrained-decoding parse failure', async () => {
    // Finding 6: 1 in ~140 calls on llama3.1:8b. Rare, not impossible, and the
    // consequence of assuming zero is a crash on a financial write path.
    const rt = new FakeLlmRuntime({ parseFailsEvery: 2, fallback: { capabilityId: 'x', confidence: 1 } });
    expect((await rt.complete(request('a'))).parseFailed).toBe(false);
    expect((await rt.complete(request('b'))).parseFailed).toBe(true);
    expect((await rt.complete(request('c'))).parseFailed).toBe(false);
  });

  it('counts calls, so a test can assert the model was NOT used', async () => {
    const rt = new FakeLlmRuntime();
    expect(rt.callCount).toBe(0);
    await rt.complete(request('x'));
    expect(rt.callCount).toBe(1);
  });
});

describe('FakeEmbeddingRuntime', () => {
  it('is deterministic across calls and instances', async () => {
    const a = await new FakeEmbeddingRuntime().embed('how much on food');
    const b = await new FakeEmbeddingRuntime().embed('how much on food');
    expect(a).toEqual(b);
  });

  it('returns unit vectors, so cosine is a dot product', async () => {
    const v = await new FakeEmbeddingRuntime().embed('groceries and coffee');
    const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
    expect(norm).toBeCloseTo(1, 10);
  });

  it('handles empty input without producing NaN', async () => {
    const v = await new FakeEmbeddingRuntime().embed('');
    expect(v.every((x) => Number.isFinite(x))).toBe(true);
  });
});

describe('platform runtimes are declared, not faked', () => {
  it('refuses to construct llama.rn rather than silently doing nothing', () => {
    // A runtime that quietly returns nothing would let the app appear to work on
    // a platform where inference has never run. That discovery belongs in
    // development, not in a store review.
    expect(() => new LlamaRnRuntime()).toThrow(NotImplementedRuntimeError);
    expect(() => new LlamaRnRuntime()).toThrow(/WP-10/);
  });

  it('refuses to construct the WebGPU runtime', () => {
    expect(() => new WebGpuRuntime()).toThrow(NotImplementedRuntimeError);
  });
});

describe('ModelStore — verify before load, fail closed', () => {
  const bytes = Buffer.from('pretend this is a quantised GGUF');
  const digest = createHash('sha256').update(bytes).digest('hex');

  const descriptorFor = (sha: string) => ({
    id: 'qwen2.5-1.5b',
    url: 'https://example.invalid/model.gguf',
    sha256: sha,
    sizeBytes: bytes.length,
  });

  const fakeFetch = (body: Buffer) =>
    (async () =>
      new Response(
        new ReadableStream({
          start(c) {
            c.enqueue(new Uint8Array(body));
            c.close();
          },
        }),
        { status: 200 },
      )) as unknown as typeof fetch;

  it('downloads, verifies and makes the model available', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'models-'));
    const store = new ModelStore({ directory: dir, fetchImpl: fakeFetch(bytes) });
    const path = await store.ensure(descriptorFor(digest));
    expect(await readFile(path)).toEqual(bytes);
    expect(store.status('qwen2.5-1.5b').state).toBe('ready');
  });

  it('refuses a model whose hash does not match, and deletes it', async () => {
    // A model file is executable weight fetched over a network. A truncated
    // download and a substituted file look identical to a loader.
    const dir = await mkdtemp(join(tmpdir(), 'models-'));
    const store = new ModelStore({ directory: dir, fetchImpl: fakeFetch(bytes) });
    const wrong = descriptorFor('0'.repeat(64));
    await expect(store.ensure(wrong)).rejects.toThrow(ModelIntegrityError);
    expect(store.status('qwen2.5-1.5b').state).toBe('corrupt');
    await expect(readFile(store.pathFor(wrong))).rejects.toThrow();
  });

  it('never leaves a partial download looking like a complete one', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'models-'));
    const failing = (async () => {
      throw new Error('network dropped');
    }) as unknown as typeof fetch;
    const store = new ModelStore({ directory: dir, fetchImpl: failing });
    await expect(store.ensure(descriptorFor(digest))).rejects.toThrow('network dropped');
    await expect(readFile(store.pathFor(descriptorFor(digest)))).rejects.toThrow();
  });

  it('re-verifies a file already on disk, catching corruption after the fact', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'models-'));
    const store = new ModelStore({ directory: dir, fetchImpl: fakeFetch(bytes) });
    const d = descriptorFor(digest);
    const path = await store.ensure(d);
    expect(await store.verify(d)).toBe(true);

    await writeFile(path, Buffer.concat([bytes, Buffer.from('tampered')]));
    expect(await store.verify(d)).toBe(false);
    expect(store.status(d.id).state).toBe('corrupt');
  });

  it('does not re-download a model that is already verified', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'models-'));
    let calls = 0;
    const counting = (async (...args: unknown[]) => {
      calls++;
      return (fakeFetch(bytes) as (...a: unknown[]) => Promise<Response>)(...args);
    }) as unknown as typeof fetch;
    const store = new ModelStore({ directory: dir, fetchImpl: counting });
    await store.ensure(descriptorFor(digest));
    await store.ensure(descriptorFor(digest));
    expect(calls).toBe(1);
  });

  it('reports progress, so the app can stay useful during a 1 GB download', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'models-'));
    const store = new ModelStore({ directory: dir, fetchImpl: fakeFetch(bytes) });
    const seen: number[] = [];
    await store.ensure(descriptorFor(digest), (b) => seen.push(b));
    expect(seen.at(-1)).toBe(bytes.length);
  });

  it('unloads after the idle window, not before', () => {
    const store = new ModelStore({ directory: '/nowhere', idleUnloadMs: 1000 });
    store.touch('qwen2.5-1.5b');
    expect(store.residentModelId).toBe('qwen2.5-1.5b');
    expect(store.shouldUnload(Date.now() + 500)).toBe(false);
    expect(store.shouldUnload(Date.now() + 1500)).toBe(true);
    store.markUnloaded();
    expect(store.residentModelId).toBeNull();
    expect(store.shouldUnload(Date.now() + 10_000)).toBe(false);
  });

  it('hashes a file the same way the verifier does', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'models-'));
    const p = join(dir, 'f.bin');
    const payload = randomBytes(4096);
    await writeFile(p, payload);
    expect(await sha256File(p)).toBe(createHash('sha256').update(payload).digest('hex'));
  });
});
