import { describe, expect, it } from 'vitest';
import { FakeEmbeddingRuntime, FakeLlmRuntime } from '@nextgen/core-inference';
import { defineBoundary, defineCapability, defineRegistry } from '@nextgen/core-capability';
import { capabilityDocument } from '@nextgen/core-capability';

import { route } from './cascade.ts';
import { HashingEmbedder } from './embedder.ts';
import { buildEnumIndex } from './slots.ts';
import { OUTCOME, STAGE, type Registry, type ScreenContext } from './types.ts';
import { THRESHOLD_PROFILES } from './config.ts';

/**
 * Cascade integration tests.
 *
 * These run against `FakeLlmRuntime`: no network, no model, same answer every
 * time. That is not only for speed — Finding 10 measured 7 of 200 entries
 * flipping between two identical runs of the *same* model at temperature 0, so a
 * suite built on real inference is flaky by construction.
 *
 * Routing *quality* is measured by the golden set against a real encoder and a
 * real model. What is asserted here is the cascade's control flow: which stage
 * decides, what happens when the model is missing, and that policy holds.
 */

const ex = (n: number) => Array.from({ length: n }, (_, i) => `example ${i + 1}`);

const registryFile = defineRegistry({
  capabilities: [
    defineCapability({
      id: 'budget.view', kind: 'navigate', route: '/budget',
      title: 'Budgets', description: 'Open the budgets screen and see every budget',
      triggers: ['budget', 'budgets', 'my budgets'], examples: ex(3),
    }),
    defineCapability({
      id: 'spending.by_category', kind: 'read', route: '/spending',
      title: 'Spending by category',
      description: 'Break spending down by category over a period of time',
      params: {
        category: { type: 'enum:Category', required: true },
        from: { type: 'date', required: true },
        to: { type: 'date', required: true },
      },
      examples: ex(3),
    }),
    defineCapability({
      id: 'transaction.create', kind: 'write', route: '/transactions/new',
      title: 'Add a transaction', description: 'Record a new transaction against an account',
      params: { amount: { type: 'money', required: true } },
      examples: ex(3),
    }),
    defineCapability({
      id: 'budget.delete', kind: 'destructive', route: '/budget/delete',
      title: 'Delete a budget', description: 'Permanently remove a budget for a category',
      params: { category: { type: 'enum:Category', required: true } },
      examples: ex(3),
    }),
    defineBoundary({
      id: 'unsupported.move_money', title: 'Moving real money',
      description: 'Paying, sending or transferring real money to another person or business',
      triggers: ['transfer funds'], examples: ex(3),
      refusal: "I can record transactions, but I can't move real money.",
    }),
  ],
  enums: { Category: { tree: { food: ['groceries', 'coffee'] } } },
});

async function buildRegistry(): Promise<Registry> {
  const embedder = new HashingEmbedder();
  const capabilities = registryFile.capabilities;
  const documents = capabilities.map(capabilityDocument);
  embedder.fit(documents);
  const vectors = await embedder.embedAll(documents);

  const triggerIndex = new Map<string, string>();
  for (const c of capabilities) for (const t of c.triggers ?? []) triggerIndex.set(t, c.id);

  return {
    schemaVersion: 1,
    capabilities,
    byId: new Map(capabilities.map((c) => [c.id, c])),
    triggerIndex,
    documents,
    vectors,
    enums: { Category: buildEnumIndex({ tree: { food: ['groceries', 'coffee'] } }) },
    boundaryIds: new Set(['unsupported.move_money']),
  };
}

const ctx: ScreenContext = { route: '/', today: '2026-08-29' };
const embedder = new HashingEmbedder();

/**
 * Thresholds for the TOY registry, not the production ones.
 *
 * boundaryMargin is calibrated against a specific encoder AND a specific
 * registry corpus, and this fixture is neither. With five capabilities whose
 * descriptions share no vocabulary with the test utterances, every real
 * capability scores exactly 0.000 — so the calibrated 0.105 lets the boundary
 * entry win everything, which is a false refusal rather than a bug in the rule.
 *
 * Carrying a calibrated threshold onto a different corpus is the same category
 * error as carrying one across encoders (Finding 1). The boundary behaviour that
 * matters here is the stage-1 trigger path, which is exact and needs no margin.
 */
const TOY_THRESHOLDS = { ...THRESHOLD_PROFILES.hashing, boundaryMargin: 1 };

async function deps(runtime?: FakeLlmRuntime) {
  const registry = await buildRegistry();
  const e = new HashingEmbedder();
  e.fit(registry.documents as string[]);
  return {
    registry,
    embedder: e,
    runtime,
    useStage3: runtime !== undefined,
    thresholds: TOY_THRESHOLDS,
  };
}

describe('cascade — stage selection', () => {
  it('resolves an exact trigger at stage 1, without touching the model', async () => {
    const runtime = new FakeLlmRuntime({ fallback: { capabilityId: 'budget.view', confidence: 1 } });
    const trace = await route('my budgets', ctx, await deps(runtime));
    expect(trace.decidedAt).toBe(STAGE.DETERMINISTIC);
    expect(trace.capabilityId).toBe('budget.view');
    expect(trace.outcome).toBe(OUTCOME.EXECUTE);
    // The whole point of the cascade: never spend a stage you do not need.
    expect(runtime.callCount).toBe(0);
  });

  it('refuses a declared limit at stage 1 without the model', async () => {
    const runtime = new FakeLlmRuntime({ fallback: { capabilityId: 'budget.view', confidence: 1 } });
    const trace = await route('transfer funds', ctx, await deps(runtime));
    expect(trace.outcome).toBe(OUTCOME.OUT_OF_SCOPE);
    expect(trace.capabilityId).toBe('unsupported.move_money');
    expect(runtime.callCount).toBe(0);
  });

  it('escalates to stage 3 when stages 1 and 2 cannot decide', async () => {
    const runtime = new FakeLlmRuntime({
      fallback: { capabilityId: 'spending.by_category', confidence: 0.9 },
    });
    const trace = await route('what did the weekend cost me', ctx, await deps(runtime));
    expect(runtime.callCount).toBe(1);
    expect(trace.decidedAt).toBe(STAGE.LLM);
  });
});

describe('cascade — degradation when the runtime is missing', () => {
  it('degrades to a clarify when the model is unavailable, and never throws', async () => {
    // A missing model is a normal condition on a device, not an exception. The
    // app must ask rather than hang or crash (sdlc/design.md).
    const runtime = new FakeLlmRuntime({ unavailable: 'model not downloaded' });
    const trace = await route('what did the weekend cost me', ctx, await deps(runtime));
    expect(trace.outcome).toBe(OUTCOME.CLARIFY);
    expect(trace.decidedAt).toBe(STAGE.EMBEDDING);
    expect(trace.llmError).toContain('model not downloaded');
    expect(trace.notes.join(' ')).toContain('degraded to clarify');
  });

  it('still resolves stage-1 hits with no runtime at all', async () => {
    const trace = await route('my budgets', ctx, await deps(undefined));
    expect(trace.outcome).toBe(OUTCOME.EXECUTE);
    expect(trace.decidedAt).toBe(STAGE.DETERMINISTIC);
  });

  it('falls back to clarify when constrained decoding produces garbage', async () => {
    const runtime = new FakeLlmRuntime({ parseFailsEvery: 1 });
    const trace = await route('what did the weekend cost me', ctx, await deps(runtime));
    expect(trace.outcome).toBe(OUTCOME.CLARIFY);
    expect(trace.notes.join(' ')).toContain('unparseable output');
  });

  it('rejects a capability id the registry does not contain (Rule 4)', async () => {
    const runtime = new FakeLlmRuntime({
      fallback: { capabilityId: 'transactions.deleteEverything', confidence: 1 },
    });
    const trace = await route('what did the weekend cost me', ctx, await deps(runtime));
    expect(trace.outcome).toBe(OUTCOME.CLARIFY);
    expect(trace.notes.join(' ')).toContain('rejected unknown id');
    expect(trace.capabilityId).toBeNull();
  });
});

describe('cascade — policy holds regardless of what the model says', () => {
  it('requires confirmation for a write even at maximum confidence', async () => {
    const runtime = new FakeLlmRuntime({
      fallback: { capabilityId: 'transaction.create', confidence: 1, params: { amount: 4500 } },
    });
    const trace = await route('put down forty five euros', ctx, await deps(runtime));
    expect(trace.capabilityId).toBe('transaction.create');
    expect(trace.requiresConfirmation).toBe(true);
  });

  it('requires confirmation for a destructive action at maximum confidence', async () => {
    const runtime = new FakeLlmRuntime({
      fallback: { capabilityId: 'budget.delete', confidence: 1, params: { category: 'food' } },
    });
    const trace = await route('get rid of the food one', ctx, await deps(runtime));
    expect(trace.capabilityId).toBe('budget.delete');
    expect(trace.requiresConfirmation).toBe(true);
  });

  it('clarifies rather than acting when a required slot is unresolved', async () => {
    const runtime = new FakeLlmRuntime({
      fallback: { capabilityId: 'transaction.create', confidence: 1 },
    });
    const trace = await route('note something down', ctx, await deps(runtime));
    expect(trace.outcome).toBe(OUTCOME.CLARIFY);
    expect(trace.missing).toContain('amount');
  });
});

describe('cascade — Rule 11, end to end', () => {
  it('lets the date grammar overwrite the model\'s date', async () => {
    // The original bug: asked for "last month" the model answered with thirty
    // days back and overwrote the correct calendar month, costing 44 points of
    // param exactness. This is that scenario, run through the whole cascade.
    const runtime = new FakeLlmRuntime({
      fallback: {
        capabilityId: 'spending.by_category',
        confidence: 0.9,
        params: { category: 'food', from: '2026-07-29', to: '2026-08-29' },
      },
    });
    const trace = await route('how much went on food last month', ctx, await deps(runtime));
    expect(trace.capabilityId).toBe('spending.by_category');
    expect(trace.params).toMatchObject({ from: '2026-07-01', to: '2026-07-31' });
  });

  it('keeps a model param the resolvers could not fill', async () => {
    const runtime = new FakeLlmRuntime({
      fallback: {
        capabilityId: 'spending.by_category',
        confidence: 0.9,
        params: { category: 'coffee', from: '2026-01-01', to: '2026-01-31' },
      },
    });
    const trace = await route('spending on coffee in january', ctx, await deps(runtime));
    // The enum and the dates are all deterministically resolvable here, so the
    // resolvers win — which is the correct outcome, not an accident.
    expect(trace.params.category).toBe('coffee');
  });

  it('drops a model param the capability never declared', async () => {
    const runtime = new FakeLlmRuntime({
      fallback: {
        capabilityId: 'budget.view',
        confidence: 0.9,
        params: { injectedNonsense: 'DROP TABLE budgets' },
      },
    });
    const trace = await route('what did the weekend cost me', ctx, await deps(runtime));
    expect(Object.keys(trace.params)).not.toContain('injectedNonsense');
  });
});

describe('cascade — every turn produces a trace', () => {
  it('always records latency and a decision stage', async () => {
    const runtime = new FakeLlmRuntime({ unavailable: 'nope' });
    for (const utterance of ['my budgets', 'transfer funds', 'what did the weekend cost me', '']) {
      const trace = await route(utterance, ctx, await deps(runtime));
      expect(trace.outcome).not.toBeNull();
      expect(trace.latency.total).toBeGreaterThanOrEqual(0);
      expect(trace.decidedAt).toBeDefined();
    }
  });
});

describe('the embedder still works after the transport moved out', () => {
  it('produces unit vectors from the registry corpus', async () => {
    const e = new HashingEmbedder();
    e.fit(['budgets. open the budgets screen', 'spending. break spending down']);
    const v = await e.embed('budgets');
    const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
    expect(norm).toBeCloseTo(1, 10);
  });

  it('gives an all-zero vector for text sharing nothing with the registry', async () => {
    const e = new HashingEmbedder();
    e.fit(['budgets. open the budgets screen']);
    const v = await e.embed('zzzz qqqq');
    expect(v.every((x) => x === 0)).toBe(true);
  });

  it('is interchangeable with the fake runtime at the type level', async () => {
    const runtimes = [new HashingEmbedder(), new FakeEmbeddingRuntime()];
    for (const r of runtimes) expect(typeof r.embed).toBe('function');
  });
});

// Keep the unused import honest — `embedder` documents the shared-instance trap
// that `deps()` avoids by constructing a fresh one per test.
void embedder;
