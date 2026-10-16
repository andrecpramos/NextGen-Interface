import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { defineBoundary, defineCapability, defineRegistry, capabilityDocument } from '@nextgen/core-capability';

import { readFileSync } from 'node:fs';

import { registryFromIndex, assertIndexMatches, IndexMismatchError, indexFor, mergeRegistryFiles, RegistryMergeError, type ShippedIndex } from './registry-browser.ts';
import { buildTriggerIndex } from './triggers.ts';
import { HashingEmbedder } from './embedder.ts';
import { route } from './cascade.ts';
import { THRESHOLD_PROFILES } from './config.ts';
import { OUTCOME, STAGE } from './types.ts';
import type { RegistryFile } from './types.ts';

/**
 * Stages 1+2 from a shipped index, with no I/O and no network.
 *
 * The requirement says *"a test fails if any request is made"*, so the network
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

  it('says which is a string when the versions only look alike', () => {
    const stringly = { ...shippedIndexSync, schemaVersion: String(registryFile.schemaVersion) } as unknown as typeof shippedIndexSync;
    expect(() => assertIndexMatches(registryFile, stringly)).toThrow(
      `schema "${registryFile.schemaVersion}" (string) against registry schema ${registryFile.schemaVersion} (number)`,
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
 * The load-bearing requirement: *"stages 1+2 run in a browser with zero
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
      throw new Error(`stages 1+2 attempted a ${what} call. The offline claim is the product.`);
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
      // was built from — a re-fitted encoder silently changes every score — so it is constructed here
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

/**
 * A user who holds several roles needs one registry, and a
 * registry needs its own index: each role's is its own vector space. So the index must be computable
 * from the registry alone, identically to the file the build ships — and a phrase two roles' screens
 * both claim must name neither.
 */
describe('indexFor — the shipped index is a cache of a pure function', () => {
  const GENERATED = new URL('../../../eval/frameworks/school/generated/', import.meta.url);
  const read = (file: string): unknown => JSON.parse(readFileSync(new URL(file, GENERATED), 'utf8'));

  it('reproduces every committed index of the reference app, byte for byte but the timestamp', () => {
    for (const role of ['PARENT', 'STUDENT', 'TEACHER']) {
      const shipped = read(`index.${role}.json`) as ShippedIndex;
      const computed = indexFor(read(`registry.${role}.json`) as RegistryFile, shipped.generatedAt);
      expect(computed, role).toEqual(shipped);
    }
  });

  it('is what registryFromIndex accepts, and routes the same as a shipped one', async () => {
    const trace = (index: ShippedIndex) =>
      route('squad overview', { route: '/', today: '2026-09-10' }, {
        registry: registryFromIndex(registryFile, index),
        embedder: (() => {
          const e = new HashingEmbedder();
          e.fit(registryFile.capabilities.map(capabilityDocument));
          return e;
        })(),
        thresholds: THRESHOLD_PROFILES.hashing,
        useStage3: false,
      });
    expect((await trace(indexFor(registryFile))).capabilityId).toBe((await trace(await shippedIndex())).capabilityId);
  });
});

describe('mergeRegistryFiles — one registry for a user with several roles', () => {
  const other: RegistryFile = defineRegistry({
    domainDescription: 'A club application.',
    capabilities: [
      defineCapability({
        id: 'squad.overview', kind: 'navigate', route: '/squad',
        title: 'Squad overview', description: 'See every player in the squad and their status',
        explanation: 'Everyone in the squad, with their current status.',
        triggers: ['squad overview'], examples: ex(3),
      }),
      defineCapability({
        id: 'guardian.meals', kind: 'navigate', route: '/my/children/meals',
        title: 'My children’s meals', description: 'Meal plans for your children',
        explanation: 'What your children eat, week by week.',
        triggers: ['meals'], examples: ex(3),
      }),
    ],
  });

  it('keeps every capability once, in the first registry’s order, then the new ones', () => {
    const merged = mergeRegistryFiles([registryFile, other]);
    expect(merged.capabilities.map((c) => c.id)).toEqual(['squad.overview', 'training.sessions', 'unsupported.payments', 'guardian.meals']);
    expect(merged.domainDescription).toBe(registryFile.domainDescription);
    expect(mergeRegistryFiles([registryFile])).toBe(registryFile);
  });

  it('keeps a "__proto__" enum a key — it changes no prototype (ADR-029)', () => {
    const hostile = JSON.parse('{"__proto__": {"values": [{"value": "x", "synonyms": ["y"]}]}}') as NonNullable<RegistryFile['enums']>;
    const merged = mergeRegistryFiles([{ ...registryFile, enums: hostile }, other]);
    expect(Object.getPrototypeOf(merged.enums)).toBeNull();
    expect(Object.keys(merged.enums!)).toEqual(['__proto__']);
    expect(({} as Record<string, unknown>).values).toBeUndefined();
  });

  it('refuses registries of different schemas, and an empty list', () => {
    expect(() => mergeRegistryFiles([])).toThrow(RegistryMergeError);
    expect(() => mergeRegistryFiles([registryFile, { ...other, schemaVersion: 99 }])).toThrow(/schema 99/);
  });

  it('routes the merged registry against its own computed index', async () => {
    const merged = mergeRegistryFiles([registryFile, other]);
    const embedder = new HashingEmbedder();
    embedder.fit(merged.capabilities.map(capabilityDocument));
    const trace = await route('meal plans for my children', { route: '/', today: '2026-09-10' }, {
      registry: registryFromIndex(merged, indexFor(merged)),
      embedder,
      thresholds: THRESHOLD_PROFILES.hashing,
      useStage3: false,
    });
    expect(trace.candidates[0]?.capabilityId).toBe('guardian.meals');
  });
});

describe('buildTriggerIndex — a contested phrase names neither screen', () => {
  it('drops a phrase two capabilities claim, and keeps the rest', () => {
    const caps = [
      { id: 'meals.overview', triggers: ['Refeições', 'plano semanal'] },
      { id: 'guardian.meals', triggers: ['refeicoes'] },
    ] as unknown as RegistryFile['capabilities'];
    const { index, contested } = buildTriggerIndex(caps);
    expect(index.has('refeicoes')).toBe(false);
    expect([...contested.values()]).toEqual([['meals.overview', 'guardian.meals']]);
    expect(index.get('plano semanal')).toBe('meals.overview');
  });

  it('is not contested by the same capability claiming a phrase twice', () => {
    const caps = [{ id: 'a', triggers: ['calendar', 'Calendar'] }] as unknown as RegistryFile['capabilities'];
    expect(buildTriggerIndex(caps).index.get('calendar')).toBe('a');
  });
});
