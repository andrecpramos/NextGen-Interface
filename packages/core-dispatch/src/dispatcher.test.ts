import { describe, expect, it, vi } from 'vitest';
import { defineBoundary, defineCapability, defineRegistry, type RegistryFile } from '@nextgen/core-capability';

import { Dispatcher } from './dispatcher.ts';
import { NavigationEngine } from './engines.ts';
import { policyFor, requiresConfirmation } from './policy.ts';

const ex = (n: number) => Array.from({ length: n }, (_, i) => `example ${i + 1}`);

const registry: RegistryFile = defineRegistry({
  domainDescription: 'A personal finance tracker, for these tests.',
  capabilities: [
    defineCapability({
      id: 'transactions.list', kind: 'navigate', route: '/transactions',
      title: 'Transactions', description: 'Browse recorded transactions over a period',
      explanation: 'What this screen is for, written once at build time and served verbatim.',
      params: { category: { type: 'enum:Category' } }, examples: ex(3),
    }),
    defineCapability({
      id: 'budget.detail', kind: 'navigate', route: '/budget/:id',
      title: 'Budget detail', description: 'Open one budget by its identifier',
      explanation: 'What this screen is for, written once at build time and served verbatim.',
      params: { id: { type: 'string', required: true } }, examples: ex(3),
    }),
    defineCapability({
      id: 'spending.total', kind: 'read', route: '/spending',
      title: 'Total spending', description: 'Total spent over a period',
      explanation: 'What this screen is for, written once at build time and served verbatim.',
      params: { from: { type: 'date', required: true, description: 'start date' } }, examples: ex(3),
    }),
    defineCapability({
      id: 'transaction.create', kind: 'write', route: '/transactions/new',
      title: 'Add a transaction', description: 'Record a new transaction',
      explanation: 'What this screen is for, written once at build time and served verbatim.',
      params: { amount: { type: 'money', required: true } }, examples: ex(3),
    }),
    defineCapability({
      id: 'budget.delete', kind: 'destructive', route: '/budget',
      title: 'Delete a budget', description: 'Remove a budget permanently',
      explanation: 'What this screen is for, written once at build time and served verbatim.',
      params: { category: { type: 'enum:Category', required: true } }, examples: ex(3),
    }),
    defineBoundary({
      id: 'unsupported.move_money', title: 'Moving real money',
      description: 'Paying, sending or transferring real money to anyone',
      examples: ex(3),
      refusal: "I can record transactions, but I can't move real money.",
    }),
  ],
  enums: { Category: { values: ['food', 'transport'] } },
});

const dispatcher = new Dispatcher({ registry });

describe('ADR-004 — the policy table', () => {
  it('executes reads and navigations without confirmation', () => {
    for (const id of ['transactions.list', 'spending.total']) {
      const d = dispatcher.decide({ capabilityId: id, params: { from: '2026-01-01' } });
      expect(d.type).toBe('execute');
    }
  });

  it('confirms every write', () => {
    const d = dispatcher.decide({ capabilityId: 'transaction.create', params: { amount: 4500 } });
    expect(d).toMatchObject({ type: 'confirm', destructive: false });
  });

  it('confirms every destructive action and marks it as such', () => {
    const d = dispatcher.decide({ capabilityId: 'budget.delete', params: { category: 'food' } });
    expect(d).toMatchObject({ type: 'confirm', destructive: true });
  });

  it('shows the parsed parameters on the confirmation, not the utterance', () => {
    // ADR-004 rule 1: a misheard amount has to be visible as a field.
    const d = dispatcher.decide({ capabilityId: 'transaction.create', params: { amount: 1200 } });
    expect(d.type === 'confirm' && d.params).toEqual({ amount: 1200 });
  });

  it('cannot be talked out of confirming — no confidence is consulted', () => {
    // There is deliberately no confidence argument to decide(). Policy is a
    // function of kind alone, which is why it held on gemma3:1b, a model that
    // reports 0.95 while being wrong.
    const a = dispatcher.decide({ capabilityId: 'budget.delete', params: { category: 'food' } });
    const b = dispatcher.decide({ capabilityId: 'budget.delete', params: { category: 'transport' } });
    expect(a.type).toBe('confirm');
    expect(b.type).toBe('confirm');
  });
});

describe('ADR-004 — unclassified fails closed', () => {
  // The explicit test WP-03 requires. The realistic failure is not someone
  // marking a delete as `read`; it is someone adding a capability and
  // forgetting to classify it.
  const broken = {
    schemaVersion: 1,
    capabilities: [
      { id: 'mystery.action', kind: '', route: '/mystery', title: 'Mystery', description: 'Unclassified on purpose', examples: ex(3) },
      { id: 'typo.action', kind: 'reed', route: '/typo', title: 'Typo', description: 'Misspelled kind', examples: ex(3) },
      { id: 'admin.action', kind: 'admin', route: '/admin', title: 'Admin', description: 'Invented kind', examples: ex(3) },
    ],
  } as unknown as RegistryFile;
  const d = new Dispatcher({ registry: broken });

  it('refuses a capability with an empty kind', () => {
    expect(d.decide({ capabilityId: 'mystery.action', params: {} })).toMatchObject({ type: 'refuse', declared: false });
  });

  it('refuses a misspelled kind rather than guessing the nearest one', () => {
    expect(d.decide({ capabilityId: 'typo.action', params: {} })).toMatchObject({ type: 'refuse', declared: false });
  });

  it('refuses an invented kind', () => {
    expect(d.decide({ capabilityId: 'admin.action', params: {} })).toMatchObject({ type: 'refuse', declared: false });
  });

  it('never defaults an unclassified kind to read', () => {
    for (const id of ['mystery.action', 'typo.action', 'admin.action']) {
      expect(d.decide({ capabilityId: id, params: {} }).type).not.toBe('execute');
    }
  });

  it('returns null policy for an unclassified kind', () => {
    expect(policyFor('')).toBeNull();
    expect(policyFor('reed')).toBeNull();
    expect(requiresConfirmation({ kind: 'reed' } as never)).toBe(true);
  });
});

describe('Rule 4 — model-produced ids are untrusted', () => {
  it('refuses an id the registry does not contain', () => {
    expect(dispatcher.decide({ capabilityId: 'transactions.deleteEverything', params: {} }))
      .toMatchObject({ type: 'refuse', declared: false });
  });
});

describe('ADR-009 — declared limits', () => {
  it('refuses with the authored message, marked as declared', () => {
    const d = dispatcher.decide({ capabilityId: 'unsupported.move_money', params: {} });
    expect(d).toMatchObject({ type: 'refuse', declared: true });
    expect(d.type === 'refuse' && d.reason).toContain("can't move real money");
  });

  it('distinguishes a declared limit from an unclassified defect', () => {
    // Same outward answer, completely different meaning: one is the product
    // working as designed, the other is a bug that must fail the build.
    const declared = dispatcher.decide({ capabilityId: 'unsupported.move_money', params: {} });
    const defect = dispatcher.decide({ capabilityId: 'nope.nope', params: {} });
    expect(declared.type === 'refuse' && declared.declared).toBe(true);
    expect(defect.type === 'refuse' && defect.declared).toBe(false);
  });

  it('never navigates to a declared limit', () => {
    const nav = new NavigationEngine(registry);
    expect(nav.resolve('unsupported.move_money', {})).toMatchObject({ ok: false });
  });
});

describe('missing slots', () => {
  it('asks rather than executing with a hole in it', () => {
    const d = dispatcher.decide({ capabilityId: 'spending.total', params: {}, missing: ['from'] });
    expect(d).toMatchObject({ type: 'clarify' });
    // The question uses the param's description, not its variable name.
    expect(d.type === 'clarify' && d.question).toBe('Which start date?');
  });

  it('ignores a "missing" slot that is actually present', () => {
    const d = dispatcher.decide({ capabilityId: 'spending.total', params: { from: '2026-07-01' }, missing: ['from'] });
    expect(d.type).toBe('execute');
  });

  it('refuses an unclassified capability before asking about its slots', () => {
    // Ordering matters: a clarify would invite the user to complete an action
    // whose safety nobody has classified.
    const broken = { schemaVersion: 1, capabilities: [{ id: 'x.y', kind: '', route: '/x', title: 'X', description: 'D', params: { a: { type: 'string', required: true } }, examples: ex(3) }] } as unknown as RegistryFile;
    const d = new Dispatcher({ registry: broken }).decide({ capabilityId: 'x.y', params: {}, missing: ['a'] });
    expect(d.type).toBe('refuse');
  });
});

describe('NavigationEngine — Rule 3, the model never produces a route', () => {
  const nav = new NavigationEngine(registry);

  it('resolves a static route and keeps only declared params', () => {
    const r = nav.resolve('transactions.list', { category: 'food', injected: 'x' } as never);
    expect(r).toMatchObject({ ok: true, route: '/transactions', params: { category: 'food' } });
  });

  it('fills a path parameter', () => {
    expect(nav.resolve('budget.detail', { id: 'food' })).toMatchObject({ ok: true, route: '/budget/food' });
  });

  it('refuses rather than building a broken URL when a path param is unresolved', () => {
    expect(nav.resolve('budget.detail', {})).toMatchObject({ ok: false });
  });

  it('encodes path parameters', () => {
    const r = nav.resolve('budget.detail', { id: 'a/b c' });
    expect(r.ok && r.route).toBe('/budget/a%2Fb%20c');
  });

  it('refuses an unknown capability — a hallucinated route cannot exist', () => {
    expect(nav.resolve('expensez.list', {})).toMatchObject({ ok: false });
  });
});

describe('undo journal', () => {
  it('records a token before a destructive action proceeds', async () => {
    const record = vi.fn().mockResolvedValue('undo-1');
    const d = new Dispatcher({ registry, undo: { record, undo: vi.fn(), get: vi.fn() } });
    const confirm = d.decide({ capabilityId: 'budget.delete', params: { category: 'food' } });
    const result = await d.approve(confirm);
    expect(record).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ type: 'approved', undoToken: 'undo-1' });
  });

  it('refuses a destructive action when no journal is configured', async () => {
    // Losing the ability to undo is a reason not to act, not a reason to skip
    // the undo.
    const confirm = dispatcher.decide({ capabilityId: 'budget.delete', params: { category: 'food' } });
    expect(await dispatcher.approve(confirm)).toMatchObject({ type: 'refuse' });
  });

  it('does not journal a plain write', async () => {
    const record = vi.fn().mockResolvedValue('undo-1');
    const d = new Dispatcher({ registry, undo: { record, undo: vi.fn(), get: vi.fn() } });
    const confirm = d.decide({ capabilityId: 'transaction.create', params: { amount: 500 } });
    await d.approve(confirm);
    expect(record).not.toHaveBeenCalled();
  });

  it('will not approve something that was never a confirmation', async () => {
    const exec = dispatcher.decide({ capabilityId: 'transactions.list', params: {} });
    expect(await dispatcher.approve(exec)).toMatchObject({ type: 'refuse' });
  });
});
