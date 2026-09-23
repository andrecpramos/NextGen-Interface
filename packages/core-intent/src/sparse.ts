import type { Vector } from './types.ts';

/**
 * A vector as the words it has, not the thousands it does not.
 *
 * The hashing encoder's vectors are as wide as the registry's whole vocabulary, and a screen uses a few
 * dozen of those words. Stored dense, measured 2026-09-23 on synthetic registries: 500 screens was a
 * 29 MB index and 15 ms a question; 2,000 screens was 150 MB, 10 s to index and 72 ms a question — an
 * app of real complexity could not load it. Stored as `idx`/`val` of the non-zero entries, the same
 * numbers take a few kilobytes per hundred screens (ADR-028).
 *
 * `idx` is ascending and `val` holds the same weights a dense vector would, so every score — and so
 * every decision — is identical to the dense form: zeros add nothing to a dot product.
 */
export interface SparseVector {
  /** The width of the space it lives in: the encoder's vocabulary size. */
  readonly dim: number;
  readonly idx: readonly number[];
  readonly val: readonly number[];
}

/** A stored document vector: dense (a real embedding model) or sparse (the hashing encoder). */
export type StoredVector = Vector | SparseVector;

export const isSparse = (v: StoredVector): v is SparseVector => !Array.isArray(v);

/** The non-zero entries of a dense vector. */
export function toSparse(v: Vector): SparseVector {
  const idx: number[] = [];
  const val: number[] = [];
  for (let i = 0; i < v.length; i++) {
    if (v[i] !== 0) {
      idx.push(i);
      val.push(v[i]!);
    }
  }
  return { dim: v.length, idx, val };
}

/** The width of a stored vector, dense or sparse. */
export const widthOf = (v: StoredVector): number => (isSparse(v) ? v.dim : v.length);

/** Dot product of any two stored vectors. Pre-normalised vectors make this the cosine. */
export function dotStored(a: StoredVector, b: StoredVector): number {
  if (!isSparse(a) && !isSparse(b)) {
    let s = 0;
    for (let i = 0; i < a.length; i++) s += a[i]! * b[i]!;
    return s;
  }
  if (isSparse(a) && isSparse(b)) {
    let s = 0;
    let i = 0;
    let j = 0;
    while (i < a.idx.length && j < b.idx.length) {
      const ai = a.idx[i]!;
      const bj = b.idx[j]!;
      if (ai === bj) s += a.val[i++]! * b.val[j++]!;
      else if (ai < bj) i++;
      else j++;
    }
    return s;
  }
  // One of each: walk the sparse one's entries, in ascending order, as the dense loop would meet them.
  const [dense, sparse] = isSparse(a) ? [b as Vector, a] : [a as Vector, b as SparseVector];
  let s = 0;
  for (let k = 0; k < sparse.idx.length; k++) s += (dense[sparse.idx[k]!] ?? 0) * sparse.val[k]!;
  return s;
}
