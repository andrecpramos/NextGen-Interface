import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { defineBoundary, defineCapability, defineRegistry, capabilityDocument } from '@nextgen/core-capability';

import { registryFromIndex, assertIndexMatches, IndexMismatchError, type ShippedIndex } from './registry-browser.ts';
import { HashingEmbedder } from './embedder.ts';
import { route } from './cascade.ts';
import { THRESHOLD_PROFILES } from './config.ts';
import { OUTCOME, STAGE } from './types.ts';
import type { RegistryFile } from './types.ts';

/**
 * WP-24 — stages 1+2 from a shipped index, with no I/O and no network.
 *
 * The acceptance says *"a test fails if any request is made"*, so the network
 * assertion here is not a comment: `fetch`, `XMLHttpRequest` and
 * `WebSocket` are replaced with throwing stubs for the duration, and the
 * assertion is that routing completes anyway.
 */

const ex = (n: number) => Array.from({ length: n }, (_, i) => `example ${i + 1}`);

const registryFile: RegistryFile = defineRegistry({
  domainDescription: 'A club application. It shows squads, training sessions and medical records.',
  capabilities: [
    defineCapability({
      id: 'squad.overview', kind: 'navigate', route: '/squad',
      title: 'Squad overview', description: 'See every player in the squad and their status',
      explanation: 'Everyone in the squad, with their current status.',
      triggers: ['squad overview'], examples: ex(3),
    }),
    defineCapability({
      id: 'training.sessions', kind: 'navigate', route: '/training',
      title: 'Training sessions', description: 'Browse scheduled training sessions for the squad',
      explanation: 'Every training session on the calendar.',
      examples: ex(3),
    }),
    defineBoundary({
      id: 'unsupported.payments', title: 'Paying anything',
      description: 'Paying an invoice, a fee or a salary',
      examples: ex(3),
      refusal: 'I can show you financial records, but I cannot pay anything.',
    }),
  ],
});

/** Build the index the way codegen does — same documents, same encoder. */
async function shippedIndex(file: RegistryFile = registryFile): Promise<ShippedIndex> {
  const docs = file.capabilities.map(capabilityDocument);
  const embedder = new HashingEmbedder();
  embedder.fit(docs);
  const vectors = await embedder.embedAll(docs);
  return {
    schemaVersion: file.schemaVersion,
    encoder: 'hashing',
    generatedAt: '2026-09-10T00:00:00.000Z',
    entries: file.capabilities.map((c, i) => ({ capabilityId: c.id, vector: vectors[i]! })),
  };
}

describe('registryFromIndex — a routable registry with no I/O', () => {
  it('builds synchronously, with no embedder and nothing to await', async () => {
    const registry = registryFromIndex(registryFile, await shippedIndex());
    expect(registry.capabilities).toHaveLength(3);
    expect(registry.vectors).toHaveLength(3);
    expect(registry.byId.get('squad.overview')?.route).toBe('/squad');
  });

  it('recomputes documents rather than shipping them', async () => {
    // They are a pure function of text the registry already carries, so shipping
    // them would be bytes that can disagree with themselves.
    const registry = registryFromIndex(registryFile, await shippedIndex());
    expect(registry.documents[0]).toBe(capabilityDocument(registryFile.capabilities[0]!));
  });

  it('carries the stage-1 index and ADR-015 vocabulary the server build would', async () => {
    const registry = registryFromIndex(registryFile, await shippedIndex());
    expect(registry.triggerIndex.get('squad overview')).toBe('squad.overview');
    expect(registry.boundaryIds.has('unsupported.payments')).toBe(true);
    expect(registry.actionVocabulary.has('pay')).toBe(false); // the boundary's verbs must not count
  });

  it('carries what the owner says about the app to stage 3, and nothing when they said nothing', async () => {
    const context = { rules: ['Medical status is per child.'], glossary: [{ term: 'squad', aliases: ['team'] }] };
    const withContext: RegistryFile = { ...registryFile, context };
    const carried = registryFromIndex(withContext, await shippedIndex(withContext));
    expect(carried.context).toEqual(context);
    // The document stage 2 embeds is unchanged by it, so the shipped vectors still describe it.
    expect(carried.documents).toEqual(registryFromIndex(registryFile, await shippedIndex()).documents);
    expect('context' in registryFromIndex(registryFile, await shippedIndex())).toBe(false);
  });
});

describe('assertIndexMatches — refusing an index that cannot belong here', () => {
  it('accepts the index built from this registry', async () => {
    expect(() => assertIndexMatches(registryFile, shippedIndexSync)).not.toThrow();
  });

  let shippedIndexSync: ShippedIndex;
  beforeEach(async () => {
    shippedIndexSync = await shippedIndex();
  });

  it('refuses a different number of vectors', () => {
    const short = { ...shippedIndexSync, entries: shippedIndexSync.entries.slice(0, 2) };
    expect(() => assertIndexMatches(registryFile, short)).toThrow(IndexMismatchError);
  });

  /**
   * The dangerous one. The runtime pairs `capabilities[i]` with `vectors[i]`
   * positionally, so an index with the right ids in the wrong order routes every
   * question to the wrong screen — confidently, and with no symptom at all.
   */
  it('refuses the right ids in the wrong order', () => {
    const swapped = {
      ...shippedIndexSync,
      entries: [shippedIndexSync.entries[1]!, shippedIndexSync.entries[0]!, shippedIndexSync.entries[2]!],
    };
    expect(() => assertIndexMatches(registryFile, swapped)).toThrow(/entry 0 is "training.sessions"/);
  });

  it('refuses a schema version it was not built for', () => {
    expect(() => assertIndexMatches(registryFile, { ...shippedIndexSync, schemaVersion: 99 })).toThrow(
      IndexMismatchError,
    );
  });

  it('refuses vectors of inconsistent width', () => {
    const ragged = {
      ...shippedIndexSync,
      entries: shippedIndexSync.entries.map((e, i) => (i === 1 ? { ...e, vector: [1, 2] } : e)),
    };
    expect(() => assertIndexMatches(registryFile, ragged)).toThrow(/same width/);
  });
});

/**
 * WP-24's load-bearing acceptance: *"stages 1+2 run in a browser with zero
 * network calls — a test fails if any request is made"*.
 */
describe('stages 1+2 make no network call', () => {
  const originals = {
    fetch: globalThis.fetch,
    XMLHttpRequest: (globalThis as Record<string, unknown>).XMLHttpRequest,
    WebSocket: (globalThis as Record<string, unknown>).WebSocket,
  };

  beforeEach(() => {
    const boom = (what: string) => () => {
      throw new Error(`WP-24: stages 1+2 attempted a ${what} call. The offline claim is the product.`);
    };
    globalThis.fetch = vi.fn(boom('fetch')) as unknown as typeof fetch;
    (globalThis as Record<string, unknown>).XMLHttpRequest = boom('XMLHttpRequest');
    (globalThis as Record<string, unknown>).WebSocket = boom('WebSocket');
  });

  afterEach(() => {
    globalThis.fetch = originals.fetch;
    (globalThis as Record<string, unknown>).XMLHttpRequest = originals.XMLHttpRequest;
    (globalThis as Record<string, unknown>).WebSocket = originals.WebSocket;
  });

  const deps = async () => ({
    registry: registryFromIndex(registryFile, await shippedIndex()),
    embedder: (() => {
      // The query encoder still has to be fitted to the same corpus the index
      // was built from — that is the whole of L10 — so it is constructed here
      // from the registry's own documents, not shared with anything.
      const e = new HashingEmbedder();
      e.fit(registryFile.capabilities.map(capabilityDocument));
      return e;
    })(),
    thresholds: { ...THRESHOLD_PROFILES.hashing, boundaryMargin: 1 },
    useStage3: false,
  });

  it('resolves a trigger at stage 1 with the network unavailable', async () => {
    const trace = await route('squad overview', { route: '/', today: '2026-09-10' }, await deps());
    expect(trace.decidedAt).toBe(STAGE.DETERMINISTIC);
    expect(trace.capabilityId).toBe('squad.overview');
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('runs stage 2 with the network unavailable', async () => {
    const trace = await route('what training is scheduled', { route: '/', today: '2026-09-10' }, await deps());
    expect(trace.decidedAt).not.toBe(STAGE.LLM);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  /**
   * The third acceptance item: *"absent stage-3 transport degrades to 'ask a
   * question', never to a guess"*. With no runtime injected the turn must end in
   * a clarify, not in a confident wrong destination.
   */
  it('degrades to a clarify when there is no stage-3 transport, never to a guess', async () => {
    const trace = await route('something entirely unrelated qqqq', { route: '/', today: '2026-09-10' }, await deps());
    expect(trace.outcome).toBe(OUTCOME.CLARIFY);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
