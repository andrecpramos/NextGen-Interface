import { exampleText, type Capability, type CapabilityExample, type RegistryFile } from './types.ts';
import { assertValidRegistry } from './validate.ts';

/**
 * Codegen: one definition, several artefacts.
 *
 * architecture.md: "Because both artefacts come from one annotation, a route
 * cannot exist that the AI doesn't know about, and the AI cannot know about a
 * route that doesn't exist." Everything below is derived, never hand-edited.
 */

// ------------------------------------------------------------- the document --

/**
 * The text stage 2 embeds for a capability.
 *
 * **This function is the reason the retrieval index and the router cannot
 * drift.** It used to live inside `core-intent`'s registry loader, which meant
 * any codegen that precomputed vectors had to reimplement it and hope. Both now
 * call this. Changing it invalidates every cached embedding and shifts every
 * stage-2 score, so treat it as a versioned artefact — see Finding 1.
 *
 * Description carries the semantics; triggers and examples carry the phrasing
 * users actually produce, which is why coding-standards.md requires ≥3 examples.
 */
export function capabilityDocument(cap: Capability): string {
  return [
    cap.title,
    cap.description,
    ...(cap.triggers ?? []),
    ...(cap.examples ?? []).map(exampleText),
  ].join('. ');
}

// ------------------------------------------------------------- route table --

export interface RouteEntry {
  readonly capabilityId: string;
  readonly route: string;
  readonly title: string;
  readonly kind: string;
  readonly params: readonly { readonly name: string; readonly type: string; readonly required: boolean }[];
}

/**
 * The route table for the app router.
 *
 * `unsupported` capabilities are excluded by construction: they have no route,
 * which is what makes "the app declares its own limits" safe to ship. A boundary
 * entry can never become navigable by accident.
 */
export function generateRouteTable(registry: RegistryFile): RouteEntry[] {
  return registry.capabilities
    .filter((c) => c.kind !== 'unsupported' && c.route)
    .map((c) => ({
      capabilityId: c.id,
      route: c.route!,
      title: c.title,
      kind: c.kind,
      params: Object.entries(c.params ?? {}).map(([name, spec]) => ({
        name,
        type: spec.type,
        required: spec.required === true,
      })),
    }))
    .sort((a, b) => a.route.localeCompare(b.route));
}

// ------------------------------------------------------- capabilities.json --

/**
 * The registry the intent engine reads. Validated before it is emitted — an
 * invalid registry should fail the build, not the app.
 */
export function generateCapabilitiesJson(registry: RegistryFile): string {
  assertValidRegistry(registry);
  return JSON.stringify(registry, null, 2) + '\n';
}

// ---------------------------------------------------------- embedding index --

export interface EmbeddingIndex {
  readonly schemaVersion: number;
  /** Identifies the encoder these vectors came from. Vectors from a different one are meaningless. */
  readonly encoder: string;
  readonly generatedAt: string;
  readonly entries: readonly { readonly capabilityId: string; readonly document: string; readonly vector: readonly number[] }[];
}

/**
 * Precompute the stage-2 vectors.
 *
 * Takes a plain function rather than an `Embedder`, so this package does not
 * depend on `core-intent`. The dependency runs the other way (Rule 1's spirit:
 * the contract does not import its consumers).
 */
export async function generateEmbeddingIndex(
  registry: RegistryFile,
  embedAll: (texts: readonly string[]) => Promise<number[][]>,
  encoderName: string,
): Promise<EmbeddingIndex> {
  const caps = registry.capabilities;
  const documents = caps.map(capabilityDocument);
  const vectors = await embedAll(documents);
  if (vectors.length !== caps.length) {
    throw new Error(`embedder returned ${vectors.length} vectors for ${caps.length} capabilities`);
  }
  return {
    schemaVersion: registry.schemaVersion,
    encoder: encoderName,
    generatedAt: new Date().toISOString(),
    entries: caps.map((c, i) => ({
      capabilityId: c.id,
      document: documents[i]!,
      vector: vectors[i]!,
    })),
  };
}

// ----------------------------------------------------------- golden entries --

export interface GoldenEntry {
  readonly id: string;
  readonly bucket: string;
  readonly utterance: string;
  readonly expect: Record<string, unknown>;
}

/**
 * The third use of `examples`: test fixtures.
 *
 * Only examples carrying an `expect` block become entries — a bare `say` is a
 * phrasing sample for retrieval, not an assertion. This is what stops the golden
 * set drifting away from the registry as capabilities change.
 *
 * These are *generated* entries and do not replace the hand-written corpus. The
 * hand-written one is deliberately adversarial (35% of it cannot resolve before
 * stage 3 by design); this one covers the happy path exhaustively, which is the
 * part that regresses silently.
 */
export function generateGoldenEntries(registry: RegistryFile, prefix = 'gen'): GoldenEntry[] {
  const out: GoldenEntry[] = [];
  let n = 0;
  for (const cap of registry.capabilities) {
    for (const ex of cap.examples ?? []) {
      if (typeof ex === 'string' || !ex.expect) continue;
      const e = ex as CapabilityExample;
      n++;
      out.push({
        id: `${prefix}-${String(n).padStart(4, '0')}`,
        bucket: 'generated',
        utterance: e.say,
        expect: {
          outcome: cap.kind === 'unsupported' ? 'out_of_scope' : 'execute',
          ...(cap.kind === 'unsupported' ? {} : { capability: cap.id }),
          ...(e.expect?.params ? { params: e.expect.params } : {}),
          ...(e.expect?.maxStage ? { maxStage: e.expect.maxStage } : {}),
          ...(cap.kind === 'write' || cap.kind === 'destructive'
            ? { requiresConfirmation: true }
            : {}),
        },
      });
    }
  }
  return out;
}
