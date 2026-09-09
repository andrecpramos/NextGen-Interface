import { describe, expect, it } from 'vitest';
import { capabilityDocument } from '@nextgen/core-capability';
import {
  buildEnumIndex, HashingEmbedder, route, STAGE, OUTCOME,
  type Registry, type RegistryFile,
} from '@nextgen/core-intent';
import type { CompletionRequest, CompletionResult, LlmRuntime } from '@nextgen/core-inference';
import { registry as financeRegistryFile } from '@nextgen/domain-finance';

/**
 * WP-16 / ADR-013's required follow-up: `domain-finance` was orphaned — no
 * workspace package depended on it, so the "swap the registered application
 * and prove the engine is domain-agnostic" claim (D-1's own justification)
 * was not exercised anywhere. `apps/cli`'s composition root (`NextGenApp`) is
 * still hard-wired to `domain-modules`'s use cases and is not itself generic —
 * that is a larger refactor than this work package. What this proves instead,
 * narrowly and honestly: the *router* (`core-intent`) needs no code change to
 * work against a real, independently-authored registry it has never seen.
 *
 * `domain-finance` is a `devDependency` of `apps/cli` for exactly this test.
 */

/** Mirrors `loadRegistry`'s derivation, for a `RegistryFile` already in memory
 * rather than on disk — `domain-finance`'s registry is not written to
 * `core-intent/eval/registry.json` (that path is `domain-modules`-only; see
 * `.claude/docs/critical-infrastructure.md`). */
async function toRegistry(file: RegistryFile, embedder: HashingEmbedder): Promise<Registry> {
  const capabilities = file.capabilities;
  const documents = capabilities.map(capabilityDocument);
  embedder.fit(documents);
  const vectors = await embedder.embedAll(documents);

  const triggerIndex = new Map<string, string>();
  for (const c of capabilities) for (const t of c.triggers ?? []) triggerIndex.set(t.toLowerCase(), c.id);

  const enums: Record<string, ReturnType<typeof buildEnumIndex>> = {};
  for (const [name, def] of Object.entries(file.enums ?? {})) enums[name] = buildEnumIndex(def);

  return {
    schemaVersion: file.schemaVersion,
    domainDescription: file.domainDescription,
    capabilities,
    byId: new Map(capabilities.map((c) => [c.id, c])),
    triggerIndex,
    documents,
    vectors,
    enums,
    boundaryIds: new Set(capabilities.filter((c) => c.kind === 'unsupported').map((c) => c.id)),
  };
}

class RecordingRuntime implements LlmRuntime {
  readonly name = 'recording';
  lastRequest: CompletionRequest | null = null;

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async complete<T>(request: CompletionRequest): Promise<CompletionResult<T>> {
    this.lastRequest = request;
    return { value: null, latencyMs: 0, parseFailed: true };
  }
}

const ctx = { route: '/', today: '2026-09-09' };

describe('domain-finance through the real router — no core-* code changes needed', () => {
  it('resolves a deterministic trigger with no model, exactly as domain-modules does', async () => {
    const registry = await toRegistry(financeRegistryFile, new HashingEmbedder());
    const trace = await route('dashboard', ctx, { registry, embedder: new HashingEmbedder() });
    expect(trace.decidedAt).toBe(STAGE.DETERMINISTIC);
    expect(trace.capabilityId).toBe('home.dashboard');
    expect(trace.outcome).toBe(OUTCOME.EXECUTE);
  });

  it("stage 3's prompt carries domain-finance's own description, not domain-modules'", async () => {
    const embedder = new HashingEmbedder();
    const registry = await toRegistry(financeRegistryFile, embedder);
    const runtime = new RecordingRuntime();
    // Vague enough to miss stage 1 and stage 2's accept threshold, forcing stage 3.
    await route('do the thing with the money', ctx, { registry, embedder, runtime });

    expect(runtime.lastRequest?.system).toContain(financeRegistryFile.domainDescription);
    expect(runtime.lastRequest?.system).not.toContain('modules');
  });
});
