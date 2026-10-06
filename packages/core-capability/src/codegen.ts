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
 * stage-2 score, so treat it as a versioned artefact (Rule 14).
 *
 * Description carries the semantics; triggers and examples carry the phrasing
 * users actually produce, which is why coding-standards.md requires ≥3 examples.
 */
export function capabilityDocument(cap: Capability): string {
  // A trigger that already appears in the title or description contributes
  // WEIGHT, not signal — and weight is exactly what must not be added here.
  //
  // Measured on a generated registry: the generator derives triggers from nav labels,
  // and a nav label is usually the title, so 141 of 245 generated triggers were
  // already in the document. Embedding them doubled the title's weight for every
  // real capability while declared boundaries — which have no triggers — got no
  // such boost. Measured: capability ranking improved (top-1 +5.1) and
  // out-of-scope refusal fell 32.4% → 26.5%, and it removed the separation
  // ADR-015's action margin needs, taking a measured 20% → 45% refusal gain down
  // to nothing on the same golden set.
  //
  // So the fix is not "stop embedding triggers" — a hand-written trigger like
  // "how much have I spent" is real phrasing a title does not carry. It is to
  // stop counting the same words twice.
  // Accent-insensitive, because a generated trigger is already normalised:
  // "horario escolar" must be recognised as a duplicate of the title
  // "Horário escolar". A plain lowercase compare misses every accented
  // Portuguese label, which in a Portuguese-first app is most of them.
  const flatten = (s: string) =>
    s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const seen = flatten(`${cap.title ?? ''} ${cap.description ?? ''}`);
  const novel = (cap.triggers ?? []).filter((t) => !seen.includes(flatten(t)));

  return [
    cap.title,
    cap.description,
    ...novel,
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
 * **Every example becomes an entry**. Declaring an utterance as an
 * example of a capability *is* the assertion that it resolves to that
 * capability — if it does not, either the example or the declaration is wrong,
 * and that is precisely what the fixture is for. Requiring a hand-written
 * `expect` block before an example counted produced the opposite: nobody wrote
 * one, both reference apps emitted a 0-byte file, and CI diffed an artefact
 * asserting nothing. An `expect` block now *refines* the derived expectation
 * (params, the stage it must resolve by) rather than gating its existence.
 *
 * This matters more for a generated registry than it ever did by hand: a generated
 * registry's examples are written by a model, so the entries derived from them
 * are the corpus that catches a generator that declares a capability nobody can
 * reach by asking for it.
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
      const refine: CapabilityExample['expect'] = typeof ex === 'string' ? undefined : ex.expect;
      n++;
      out.push({
        id: `${prefix}-${String(n).padStart(4, '0')}`,
        bucket: 'generated',
        utterance: exampleText(ex),
        expect: {
          outcome: cap.kind === 'unsupported' ? 'out_of_scope' : 'execute',
          ...(cap.kind === 'unsupported' ? {} : { capability: cap.id }),
          ...(refine?.params ? { params: refine.params } : {}),
          ...(refine?.maxStage ? { maxStage: refine.maxStage } : {}),
          ...(cap.kind === 'write' || cap.kind === 'destructive'
            ? { requiresConfirmation: true }
            : {}),
        },
      });
    }
  }
  return out;
}
