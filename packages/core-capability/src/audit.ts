import type { Capability, RegistryFile } from './types.ts';

/**
 * Registry health, promoted here from `core-intent`.
 *
 * It belongs to the registry, not to the router: it is a property of how the
 * capabilities are *written*, and it is a build-time check on the contract, not
 * a runtime concern of routing. Keeping it in the router meant it could only run
 * where an evaluator ran.
 */

export interface SimilarPair {
  readonly a: string;
  readonly b: string;
  readonly score: number;
}

/**
 * Capability pairs whose documents sit close together in embedding space.
 *
 * These are the pairs that steal each other's stage-2 margin as the registry
 * grows (maintenance.md). A top score of 0.71 means nothing if the runner-up is
 * at 0.70 — those are two capabilities the registry has failed to distinguish,
 * and guessing between them is how the wrong thing gets deleted.
 */
export function similarityAudit(
  ids: readonly string[],
  vectors: readonly (readonly number[])[],
  cosine: (a: readonly number[], b: readonly number[]) => number,
  threshold = 0.55,
): SimilarPair[] {
  const pairs: SimilarPair[] = [];
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const score = cosine(vectors[i]!, vectors[j]!);
      if (score >= threshold) pairs.push({ a: ids[i]!, b: ids[j]!, score });
    }
  }
  return pairs.sort((x, y) => y.score - x.score);
}

export interface BoundaryAudit {
  readonly boundaryCount: number;
  readonly crowding: readonly SimilarPair[];
}

/**
 * A boundary entry describes a whole class of requests, so it is broad by
 * construction and will sit closer to real capabilities than they sit to each
 * other. That is tolerable — the acceptance margin handles it — but it must be
 * *visible*, because a boundary entry that crowds a real capability is how an
 * in-domain request starts getting refused.
 */
export function boundaryAudit(
  registry: RegistryFile,
  ids: readonly string[],
  vectors: readonly (readonly number[])[],
  cosine: (a: readonly number[], b: readonly number[]) => number,
  threshold = 0.7,
): BoundaryAudit {
  const boundary = new Set(
    registry.capabilities.filter((c: Capability) => c.kind === 'unsupported').map((c) => c.id),
  );
  const crowding = similarityAudit(ids, vectors, cosine, threshold).filter(
    (p) => boundary.has(p.a) !== boundary.has(p.b),
  );
  return { boundaryCount: boundary.size, crowding };
}
