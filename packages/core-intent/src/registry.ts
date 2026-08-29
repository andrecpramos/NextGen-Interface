import { readFileSync } from 'node:fs';
import { capabilityDocument } from '@nextgen/core-capability';
import { normalize } from './text.ts';
import { buildEnumIndex } from './slots.ts';
import { similarityAudit as audit } from '@nextgen/core-capability';
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
  // Built by core-capability, not here. Codegen precomputes the embedding index
  // from the same function, so the vectors shipped with a build and the vectors
  // computed at runtime cannot describe different text.
  const documents = capabilities.map(capabilityDocument);

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
    boundaryIds: new Set(capabilities.filter((c) => c.kind === 'unsupported').map((c) => c.id)),
  };
}

/**
 * Registry health, re-exported from `core-capability`, which owns it now: it is
 * a property of how capabilities are *written*, so it belongs to the contract
 * and must be runnable at build time, not only where an evaluator runs.
 */
export type { SimilarPair } from '@nextgen/core-capability';

export function similarityAudit(
  registry: Registry,
  cosine: (a: Vector, b: Vector) => number,
  threshold = 0.55,
) {
  return audit(registry.capabilities.map((c) => c.id), registry.vectors, cosine, threshold);
}
