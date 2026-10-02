import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SameOriginLlmRuntime } from './stage3.ts';

/**
 * WP-52 (ADR-017). The one property that matters more than any other here: **this
 * transport POSTs to no origin other than the page's.** Every test that fetches proves it
 * either fetched the resolved same-origin URL, or never called fetch at all.
 */

const originals = { fetch: globalThis.fetch, location: (globalThis as Record<string, unknown>).location };

function setPage(href: string): void {
  const url = new URL(href);
  (globalThis as Record<string, unknown>).location = { href: url.href, origin: url.origin };
}

beforeEach(() => {
  setPage('https://adopter.example/app/settings');
});

afterEach(() => {
  globalThis.fetch = originals.fetch;
  (globalThis as Record<string, unknown>).location = originals.location;
  vi.restoreAllMocks();
});

const request = { system: 'sys', prompt: 'prompt', schema: { type: 'object' as const, properties: {} } };

describe('SameOriginLlmRuntime — the same-origin guarantee', () => {
  it('never fetches when the configured path resolves off-origin', async () => {
    globalThis.fetch = vi.fn() as unknown as typeof fetch;
    const runtime = new SameOriginLlmRuntime({ path: 'https://attacker.example/steal' });

    const result = await runtime.complete(request);

    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(result.value).toBeNull();
    expect(result.unavailable).toMatch(/off-origin|refused/);
  });

  it('refuses off-origin even when the host merely looks similar', async () => {
    // adopter.example.attacker.example is a different origin entirely — a classic
    // same-origin-check mistake is a substring match instead of an exact one.
    globalThis.fetch = vi.fn() as unknown as typeof fetch;
    const runtime = new SameOriginLlmRuntime({ path: 'https://adopter.example.attacker.example/stage3' });

    await runtime.complete(request);

    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('accepts a relative path and resolves it against the page', async () => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ capabilityId: 'x' }), { status: 200 })) as unknown as typeof fetch;
    const runtime = new SameOriginLlmRuntime({ path: 'stage3' });

    await runtime.complete(request);

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    const [calledUrl] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(String(calledUrl)).toBe('https://adopter.example/app/stage3');
  });

  it('accepts an absolute-path override on the same origin', async () => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ capabilityId: 'x' }), { status: 200 })) as unknown as typeof fetch;
    const runtime = new SameOriginLlmRuntime({ path: '/api/nextgen-stage3' });

    await runtime.complete(request);

    const [calledUrl] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(String(calledUrl)).toBe('https://adopter.example/api/nextgen-stage3');
  });

  it('is unavailable, not throwing, when there is no page to resolve against', async () => {
    (globalThis as Record<string, unknown>).location = undefined;
    globalThis.fetch = vi.fn() as unknown as typeof fetch;

    const runtime = new SameOriginLlmRuntime({ path: 'stage3' });
    const result = await runtime.complete(request);

    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(result.value).toBeNull();
    expect(result.unavailable).toBeDefined();
  });
});

describe('SameOriginLlmRuntime — degradation (LlmRuntime must never throw)', () => {
  it('degrades when the endpoint is unreachable', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;
    const runtime = new SameOriginLlmRuntime({ path: 'stage3' });

    const result = await runtime.complete(request);

    expect(result.value).toBeNull();
    expect(result.parseFailed).toBe(false);
    expect(result.unavailable).toContain('ECONNREFUSED');
  });

  it('degrades on a non-2xx response', async () => {
    globalThis.fetch = vi.fn(async () => new Response('proxy misconfigured', { status: 500 })) as unknown as typeof fetch;
    const runtime = new SameOriginLlmRuntime({ path: 'stage3' });

    const result = await runtime.complete(request);

    expect(result.value).toBeNull();
    expect(result.unavailable).toContain('500');
  });

  it('degrades on a body that is not valid JSON, and reports parseFailed', async () => {
    globalThis.fetch = vi.fn(async () => new Response('<html>not json</html>', { status: 200 })) as unknown as typeof fetch;
    const runtime = new SameOriginLlmRuntime({ path: 'stage3' });

    const result = await runtime.complete(request);

    expect(result.value).toBeNull();
    expect(result.parseFailed).toBe(true);
  });

  it('times out rather than hanging, and degrades', async () => {
    globalThis.fetch = vi.fn((_url, init) => {
      const signal = (init as { signal?: AbortSignal } | undefined)?.signal;
      return new Promise((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      });
    }) as unknown as typeof fetch;
    const runtime = new SameOriginLlmRuntime({ path: 'stage3', timeoutMs: 5 });

    const result = await runtime.complete(request);

    expect(result.value).toBeNull();
    expect(result.unavailable).toBeDefined();
  });

  it('does not construct isAvailable() as load-bearing: false is a normal answer, never a throw', async () => {
    globalThis.fetch = vi.fn(async () => new Response(null, { status: 503 })) as unknown as typeof fetch;
    const runtime = new SameOriginLlmRuntime({ path: 'stage3' });

    await expect(runtime.isAvailable()).resolves.toBe(false);
  });
});

/**
 * A single-page app with a bearer token in memory cannot authenticate the page's bare `fetch`, so
 * it hands in its own client. That client signs the request; it never decides where it goes.
 */
describe('SameOriginLlmRuntime — the adopter\'s own fetch', () => {
  const answer = async (): Promise<Response> => new Response(JSON.stringify({ capabilityId: 'x' }), { status: 200 });

  it('sends the POST and the HEAD through it, to the URL already resolved same-origin, and not through the page\'s', async () => {
    globalThis.fetch = vi.fn() as unknown as typeof fetch;
    const send = vi.fn((_url: string, _init: RequestInit) => answer());
    const runtime = new SameOriginLlmRuntime({ path: '/api/stage3' }, send);

    await runtime.complete(request);
    await runtime.isAvailable();

    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(send.mock.calls.map(([url, init]) => [url, init.method])).toEqual([
      ['https://adopter.example/api/stage3', 'POST'],
      ['https://adopter.example/api/stage3', 'HEAD'],
    ]);
  });

  it('is never called when the path resolves off-origin', async () => {
    const send = vi.fn(answer);
    const runtime = new SameOriginLlmRuntime({ path: 'https://attacker.example/steal' }, send);

    const result = await runtime.complete(request);

    expect(send).not.toHaveBeenCalled();
    expect(result.unavailable).toMatch(/off-origin|refused/);
  });

  it('degrades like an unreachable server when it throws — a refused refresh is not a crash', async () => {
    const runtime = new SameOriginLlmRuntime({ path: 'stage3' }, async () => {
      throw new Error('session expired');
    });

    const result = await runtime.complete(request);

    expect(result.value).toBeNull();
    expect(result.unavailable).toBe('session expired');
  });
});

describe('SameOriginLlmRuntime — the wire contract', () => {
  it('sends system, prompt, schema and model as the POST body, and the request as JSON', async () => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ capabilityId: 'x' }), { status: 200 })) as unknown as typeof fetch;
    const runtime = new SameOriginLlmRuntime({ path: 'stage3', model: 'house-model' });

    await runtime.complete(request);

    const [, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toEqual({ system: 'sys', prompt: 'prompt', schema: request.schema, model: 'house-model' });
    expect((init as RequestInit).method).toBe('POST');
  });

  it('passes on whether a reasoning model may reason first, and sends nothing when the request does not say', async () => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ capabilityId: 'x' }), { status: 200 })) as unknown as typeof fetch;
    const runtime = new SameOriginLlmRuntime({ path: 'stage3' });

    await runtime.complete({ ...request, think: false });
    await runtime.complete(request);

    const bodies = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.map(([, init]) => JSON.parse((init as RequestInit).body as string));
    expect(bodies[0].think).toBe(false);
    expect('think' in bodies[1]).toBe(false);
  });

  it('a per-request model wins over the configured default', async () => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ capabilityId: 'x' }), { status: 200 })) as unknown as typeof fetch;
    const runtime = new SameOriginLlmRuntime({ path: 'stage3', model: 'default-model' });

    await runtime.complete({ ...request, model: 'override-model' });

    const [, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.model).toBe('override-model');
  });

  it('returns the response body as the completion value on 2xx', async () => {
    globalThis.fetch = vi.fn(
      async () => new Response(JSON.stringify({ capabilityId: 'squad.overview', confidence: 0.9 }), { status: 200 }),
    ) as unknown as typeof fetch;
    const runtime = new SameOriginLlmRuntime({ path: 'stage3' });

    const result = await runtime.complete<{ capabilityId: string }>(request);

    expect(result.value).toEqual({ capabilityId: 'squad.overview', confidence: 0.9 });
    expect(result.parseFailed).toBe(false);
    expect(result.unavailable).toBeUndefined();
  });
});

describe('stage 3 end to end, through create() with a real bundle', () => {
  const GEN = new URL('../../../eval/frameworks/family/generated/', import.meta.url);

  async function bundleFor(role: string) {
    const { readFile } = await import('node:fs/promises');
    const { fileURLToPath } = await import('node:url');
    const read = async (file: string) => JSON.parse(await readFile(fileURLToPath(new URL(file, GEN)), 'utf8'));
    return {
      registry: await read(`registry.${role}.json`),
      index: await read(`index.${role}.json`),
      thresholds: (await read('thresholds.hashing.json')).thresholds,
    };
  }

  it('still clarifies, and never fetches, when stage3 is absent from the bundle', async () => {
    const { create } = await import('./index.ts');
    globalThis.fetch = vi.fn() as unknown as typeof fetch;
    const bundle = await bundleFor('PARENT');

    const trace = await create(bundle).route('quero saber uma coisa qualquer muito vaga');

    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(trace.decidedAt).not.toBe('llm');
  });

  it('resolves a turn stages 1-2 could not settle, through the same-origin proxy', async () => {
    const { create } = await import('./index.ts');
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ capabilityId: 'guardian.my_children_medical', confidence: 0.92 }), { status: 200 }),
    ) as unknown as typeof fetch;
    const bundle = await bundleFor('PARENT');

    const trace = await create({ ...bundle, stage3: { path: 'stage3' } }).route(
      'como está a saúde do meu educando ultimamente, ando preocupado',
    );

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    const [calledUrl] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(String(calledUrl)).toBe('https://adopter.example/app/stage3');
    expect(trace.decidedAt).toBe('llm');
    expect(trace.capabilityId).toBe('guardian.my_children_medical');
  });

  it('degrades to a clarify, not a crash, when the configured proxy is unreachable', async () => {
    const { create } = await import('./index.ts');
    globalThis.fetch = vi.fn(async () => {
      throw new Error('connection refused');
    }) as unknown as typeof fetch;
    const bundle = await bundleFor('PARENT');

    const trace = await create({ ...bundle, stage3: { path: 'stage3' } }).route(
      'como está a saúde do meu educando ultimamente, ando preocupado',
    );

    expect(trace.outcome).not.toBe('error');
    expect(trace.decidedAt).not.toBe('llm');
  });

  it('never sends a turn off-origin even with stage3 configured, if the path is malicious', async () => {
    const { create } = await import('./index.ts');
    globalThis.fetch = vi.fn() as unknown as typeof fetch;
    const bundle = await bundleFor('PARENT');

    await create({ ...bundle, stage3: { path: 'https://attacker.example/steal' } }).route(
      'como está a saúde do meu educando ultimamente, ando preocupado',
    );

    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
