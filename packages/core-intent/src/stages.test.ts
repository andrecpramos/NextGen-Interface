import { describe, expect, it } from 'vitest';
import { capabilityDocument, defineCapability } from '@nextgen/core-capability';
import type { CompletionRequest, CompletionResult, LlmRuntime } from '@nextgen/core-inference';

import { stage3 } from './stages.ts';
import type { Registry } from './types.ts';

/**
 * WP-16 (Rule 1, D-2): `core-intent` must not know what application it is
 * routing for. Before this work package, `stages.ts` hardcoded "This is a
 * personal finance application" into every stage-3 prompt, which misrouted a
 * destructive capability on the modules registry (§6, PLAN.md). These tests
 * assert the fix by inspecting the generated prompt directly — `stage3` runs
 * unmodified against two unrelated registries, and only the registry's own
 * `domainDescription` changes what the model is told.
 */

const ex = (n: number) => Array.from({ length: n }, (_, i) => `example ${i + 1}`);

class RecordingRuntime implements LlmRuntime {
  readonly name = 'recording';
  lastRequest: CompletionRequest | null = null;

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async complete<T>(request: CompletionRequest): Promise<CompletionResult<T>> {
    this.lastRequest = request;
    // Content doesn't matter here — these tests inspect the outgoing prompt,
    // not the routing decision.
    return { value: null, latencyMs: 0, parseFailed: true };
  }
}

function registryWith(domainDescription: string): Registry {
  const capabilities = [
    defineCapability({
      id: 'thing.view', kind: 'navigate', route: '/thing',
      title: 'Thing', description: 'View the one thing this toy registry has',
      examples: ex(3),
    }),
  ];
  return {
    schemaVersion: 1,
    domainDescription,
    capabilities,
    byId: new Map(capabilities.map((c) => [c.id, c])),
    triggerIndex: new Map(),
    documents: capabilities.map(capabilityDocument),
    vectors: capabilities.map(() => []),
    enums: {},
    boundaryIds: new Set(),
  };
}

const ctx = { today: '2026-09-09' };

describe('stage3 — the application description travels with the registry', () => {
  it('carries a finance registry\'s own description, and not another app\'s', async () => {
    const registry = registryWith(
      'A personal finance tracker. It records transactions, budgets, categories and account balances.',
    );
    const runtime = new RecordingRuntime();
    await stage3('what did I spend on food', registry.capabilities.map((c) => ({ capabilityId: c.id, score: 1 })), registry, ctx, { runtime });

    expect(runtime.lastRequest?.system).toContain(
      'A personal finance tracker. It records transactions, budgets, categories and account balances.',
    );
  });

  it('carries a completely different app\'s description when swapped in — same function, no code change', async () => {
    const registry = registryWith(
      'A personal notes application. Users save arbitrary information as modules.',
    );
    const runtime = new RecordingRuntime();
    await stage3('what did I save about the wifi', registry.capabilities.map((c) => ({ capabilityId: c.id, score: 1 })), registry, ctx, { runtime });

    expect(runtime.lastRequest?.system).toContain(
      'A personal notes application. Users save arbitrary information as modules.',
    );
    expect(runtime.lastRequest?.system).not.toContain('finance');
    expect(runtime.lastRequest?.system).not.toContain('transaction');
  });

  it('never hardcodes any specific application\'s name or vocabulary', async () => {
    // A third, unrelated registry. If anything in stages.ts still assumed
    // finance or modules, this would be the case that catches it.
    const registry = registryWith(
      'A gym membership manager. It tracks class schedules, bookings and payments.',
    );
    const runtime = new RecordingRuntime();
    await stage3('book me into the 6pm class', registry.capabilities.map((c) => ({ capabilityId: c.id, score: 1 })), registry, ctx, { runtime });

    const system = runtime.lastRequest?.system.toLowerCase() ?? '';
    expect(system).not.toContain('finance');
    expect(system).not.toContain('personal notes');
    expect(system).not.toContain('budget');
    expect(system).toContain('gym membership manager');
  });
});
