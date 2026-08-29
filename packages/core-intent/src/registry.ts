import { readFileSync } from 'node:fs';
import { normalize } from './text.ts';
import { buildEnumIndex } from './slots.ts';
import type { Capability, Embedder, EnumIndex, Registry, RegistryFile, Vector } from './types.ts';

/**
 * Loads registry.json and prepares the derived structures each stage needs.
 *
 * In the real app this is generated from capability definitions by codegen
 * (architecture.md, WP-03). Here it is hand-written JSON with the same shape, so
 * the spike validates the schema as well as the router.
 *
 * Note what is deliberately NOT done here: `kind` is not narrowed to
 * `CapabilityKind`. The registry is data, and an unclassified kind has to reach
 * the dispatcher so it can refuse it (ADR-004). Validating it away at load time
 * would turn the "fail closed" path into unreachable code.
 */
export async function loadRegistry(path: string, embedder: Embedder): Promise<Registry> {
  const raw = JSON.parse(readFileSync(path, 'utf8')) as RegistryFile;

  const enums: Record<string, EnumIndex> = {};
  for (const [name, def] of Object.entries(raw.enums ?? {})) {
    enums[name] = buildEnumIndex(def);
  }

  const capabilities = raw.capabilities;

  // --- stage 1 index: exact surface forms -> capability id
  const triggerIndex = new Map<string, string>();
  for (const cap of capabilities) {
    for (const trigger of cap.triggers ?? []) {
      const key = normalize(trigger);
      // First registration wins; a collision means two capabilities claim the
      // same phrase, which is a registry defect worth surfacing loudly.
      if (triggerIndex.has(key) && triggerIndex.get(key) !== cap.id) {
        console.warn(`[registry] trigger collision on "${key}": ${triggerIndex.get(key)} vs ${cap.id}`);
      }
      triggerIndex.set(key, cap.id);
    }
  }

  // --- stage 2 documents.
  // Description carries the semantics; triggers and examples carry the phrasing
  // users actually produce. Examples are weighted in by inclusion, which is why
  // coding-standards.md requires at least three per capability.
  const documents = capabilities.map((cap) =>
    [cap.title, cap.description, ...(cap.triggers ?? []), ...(cap.examples ?? [])].join('. '),
  );

  embedder.fit?.(documents);
  const vectors = await embedder.embedAll(documents);

  return {
    schemaVersion: raw.schemaVersion,
    capabilities,
    byId: new Map<string, Capability>(capabilities.map((c) => [c.id, c])),
    triggerIndex,
    documents,
    vectors,
    enums,
  };
}

export interface SimilarPair {
  readonly a: string;
  readonly b: string;
  readonly score: number;
}

/**
 * Registry health: capability pairs whose documents sit close together in
 * embedding space. These are the pairs that will steal each other's stage-2
 * margin as the registry grows (maintenance.md). Run it whenever accuracy dips.
 */
export function similarityAudit(
  registry: Registry,
  cosine: (a: Vector, b: Vector) => number,
  threshold = 0.55,
): SimilarPair[] {
  const pairs: SimilarPair[] = [];
  const { capabilities, vectors } = registry;
  for (let i = 0; i < capabilities.length; i++) {
    for (let j = i + 1; j < capabilities.length; j++) {
      const score = cosine(vectors[i]!, vectors[j]!);
      if (score >= threshold) {
        pairs.push({ a: capabilities[i]!.id, b: capabilities[j]!.id, score });
      }
    }
  }
  return pairs.sort((x, y) => y.score - x.score);
}
