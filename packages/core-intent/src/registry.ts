import { readFileSync } from 'node:fs';
import { capabilityDocument } from '@nextgen/core-capability';
import { buildTriggerIndex } from './triggers.ts';
import { buildEnumIndex } from './slots.ts';
import { actionVocabularyOf } from './action.ts';
import { similarityAudit as audit } from '@nextgen/core-capability';
import type { StoredVector } from './sparse.ts';
import type { Capability, Embedder, EnumIndex, Registry, RegistryFile } from './types.ts';

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
  // A phrase two capabilities claim names neither: stage 2 decides between them (triggers.ts).
  const { index: triggerIndex } = buildTriggerIndex(capabilities);

  // --- stage 2 documents.
  // Built by core-capability, not here. Codegen precomputes the embedding index
  // from the same function, so the vectors shipped with a build and the vectors
  // computed at runtime cannot describe different text.
  const documents = capabilities.map(capabilityDocument);

  embedder.fit?.(documents);
  const vectors = await embedder.embedAll(documents);

  return {
    schemaVersion: raw.schemaVersion,
    domainDescription: raw.domainDescription,
    ...(raw.context ? { context: raw.context } : {}),
    capabilities,
    byId: new Map<string, Capability>(capabilities.map((c) => [c.id, c])),
    triggerIndex,
    documents,
    vectors,
    enums,
    boundaryIds: new Set(capabilities.filter((c) => c.kind === 'unsupported').map((c) => c.id)),
    // ADR-015's guard, built from the REAL capabilities only — a declared limit
    // says the application does *not* do the thing, so its verbs must not count
    // as evidence that it does.
    actionVocabulary: actionVocabularyOf(capabilities.filter((c) => c.kind !== 'unsupported')),
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
  cosine: (a: StoredVector, b: StoredVector) => number,
  threshold = 0.55,
) {
  return audit(registry.capabilities.map((c) => c.id), registry.vectors, cosine, threshold);
}
