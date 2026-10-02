import { describe, expect, it } from 'vitest';

import { capabilityDocument } from '@nextgen/core-capability';

import { cosine, HashingEmbedder } from './embedder.ts';
import { assertIndexMatches, indexFor, IndexMismatchError, registryFromIndex, type ShippedIndex } from './registry-browser.ts';
import { dotStored, toSparse } from './sparse.ts';
import type { RegistryFile } from './types.ts';

/**
 * ADR-028. The hashing encoder's vectors are as wide as the whole vocabulary; stored dense, a 2,000-screen
 * app was a 150 MB index and 72 ms a question. Stored sparse they are the same numbers — so every score,
 * and every decision, must be exactly what it was.
 */

const WORDS = Array.from({ length: 3000 }, (_, i) => `w${i.toString(36)}x`);
function synthetic(n: number, seed = 11): RegistryFile {
  let s = seed;
  const rnd = (): number => ((s = (s * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  const pick = (k: number): string => Array.from({ length: k }, () => WORDS[Math.floor(rnd() ** 2 * WORDS.length)]).join(' ');
  return {
    schemaVersion: 1,
    domainDescription: 'A large application.',
    capabilities: Array.from({ length: n }, (_, i) => ({
      id: `area${i % 30}.screen${i}`, kind: 'navigate', route: `/area${i % 30}/screen${i}`,
      title: `${pick(2)} ${i}`, description: pick(18), explanation: pick(12), examples: [pick(5), pick(5), pick(5)],
    })),
  } as unknown as RegistryFile;
}

describe('sparse vectors — the same numbers, without the zeros', () => {
  const registry = synthetic(80);
  const documents = registry.capabilities.map(capabilityDocument);
  const embedder = new HashingEmbedder();
  embedder.fit(documents);

  it('embeds a document to exactly the non-zero entries of its dense vector', () => {
    for (const d of documents.slice(0, 20)) expect(embedder.embedSparse(d)).toEqual(toSparse(embedder.embedSync(d)));
  });

  it('scores dense against sparse, and sparse against sparse, exactly as dense against dense', () => {
    const query = embedder.embedSync(`${documents[3]!.slice(0, 60)} ${documents[9]!.slice(0, 40)}`);
    for (const d of documents) {
      const dense = embedder.embedSync(d);
      const sparse = embedder.embedSparse(d);
      expect(cosine(query, sparse)).toBe(cosine(query, dense));
      expect(cosine(sparse, query)).toBe(cosine(query, dense));
      expect(dotStored(sparse, embedder.embedSparse(documents[0]!))).toBeCloseTo(cosine(dense, embedder.embedSync(documents[0]!)), 12);
    }
  });

  it('keeps every decision: a dense index and the sparse one rank every question the same', async () => {
    const sparse = indexFor(registry);
    const dense: ShippedIndex = {
      schemaVersion: 1,
      encoder: 'hashing',
      generatedAt: sparse.generatedAt,
      entries: documents.map((d, i) => ({ capabilityId: registry.capabilities[i]!.id, vector: embedder.embedSync(d).map((w) => Number(w.toFixed(4))) })),
    };
    const a = registryFromIndex(registry, sparse);
    const b = registryFromIndex(registry, dense);
    for (const d of documents.slice(0, 30)) {
      const q = embedder.embedSync(d.slice(0, 50));
      expect(a.vectors.map((v) => cosine(q, v))).toEqual(b.vectors.map((v) => cosine(q, v)));
    }
  });
});

describe('the sparse index file', () => {
  it('stays small as an app grows: kilobytes per screen, not megabytes', () => {
    const bytes = JSON.stringify(indexFor(synthetic(600))).length;
    // Dense, this registry measured 35 MB. Sparse, it is under 2 MB; the bound leaves room, not slack.
    expect(bytes / 600).toBeLessThan(5000);
  });

  it('says it is sparse and how wide its space is, and is refused when it lies about either', () => {
    const registry = synthetic(10);
    const index = indexFor(registry);
    expect(index.format).toBe('sparse');
    expect(index.dimension).toBeGreaterThan(0);
    const broken = (over: Partial<ShippedIndex>): ShippedIndex => ({ ...index, ...over });
    const without = (key: 'dimension' | 'format'): ShippedIndex => {
      const copy: Record<string, unknown> = { ...index };
      delete copy[key];
      return copy as unknown as ShippedIndex;
    };
    expect(() => assertIndexMatches(registry, without('dimension'))).toThrow(IndexMismatchError);
    const [first, ...rest] = index.entries as { capabilityId: string; terms: number[]; weights: number[] }[];
    expect(() => assertIndexMatches(registry, broken({ entries: [{ ...first!, terms: [index.dimension! + 1], weights: [1] }, ...rest] }))).toThrow(/outside/);
    expect(() => assertIndexMatches(registry, broken({ entries: [{ ...first!, terms: [5, 2], weights: [1, 1] }, ...rest] }))).toThrow(/out of order/);
    expect(() => assertIndexMatches(registry, without('format'))).toThrow(/does not say it is sparse/);
  });

  it('still reads a dense index — every one built before 2026-09-23', () => {
    const registry = synthetic(5);
    const documents = registry.capabilities.map(capabilityDocument);
    const embedder = new HashingEmbedder();
    embedder.fit(documents);
    const dense: ShippedIndex = {
      schemaVersion: 1,
      encoder: 'hashing',
      generatedAt: 'x',
      entries: documents.map((d, i) => ({ capabilityId: registry.capabilities[i]!.id, vector: embedder.embedSync(d) })),
    };
    expect(registryFromIndex(registry, dense).vectors).toHaveLength(5);
  });
});
