import { describe, expect, it } from 'vitest';

import { FinanceApp } from './app.ts';

/**
 * Composition smoke tests.
 *
 * Every package has its own suite; none of them proves the packages fit
 * together. These run the whole assembly — registry, router, dispatcher, query
 * engine, domain use cases, trace — with **no model and no network**, so they
 * are fast and deterministic and can gate CI.
 *
 * Two real cross-package defects were already caught by simply wiring this up:
 * a loaded registry did not satisfy the dispatcher's port, and `OllamaOptions`
 * rejected an explicit `undefined` under `exactOptionalPropertyTypes`. Neither
 * was reachable from inside a single package.
 */

const app = async () => FinanceApp.create({ noModel: true, embedder: 'hashing' });

describe('the stack composes', () => {
  it('answers a stage-1 question against real seeded data', async () => {
    const a = await app();
    const r = await a.turn('budgets');
    expect(r.decision.type).toBe('execute');
    expect(r.output.join('\n')).toContain('Food');
    expect(r.trace.decidedAt).toBe('deterministic');
  });

  it('lists accounts with computed balances', async () => {
    const a = await app();
    const r = await a.turn('what is my balance');
    expect(r.output.join('\n')).toMatch(/Everyday|Savings/);
  });

  it('refuses a declared limit with the authored message, model-free', async () => {
    // ADR-009 end to end: no model is running, and it still refuses correctly.
    const a = await app();
    const r = await a.turn('transfer 500 to my brother');
    expect(r.decision.type).toBe('refuse');
    expect(r.output.join(' ')).toContain("can't move real money");
    expect(r.trace.latency.stage3).toBeUndefined();
  });

  it('asks rather than guessing when it cannot resolve without the model', async () => {
    const a = await app();
    const r = await a.turn('what did the weekend cost me');
    expect(r.decision.type).toBe('clarify');
  });
});

describe('policy holds through the whole assembly', () => {
  it('never writes without a confirmation step', async () => {
    const a = await app();
    const r = await a.turn('add 45 for groceries');
    // Either it asks which capability, or it asks to confirm — never `execute`.
    expect(r.decision.type).not.toBe('execute');
  });

  it('will not approve something that was not a confirmation', async () => {
    const a = await app();
    const r = await a.turn('budgets');
    const out = await a.confirm(r.decision);
    expect(out.join(' ')).toContain('nothing to confirm');
  });
});

describe('every turn leaves an explainable record', () => {
  it('records a trace for each turn, including refusals and clarifies', async () => {
    const a = await app();
    for (const u of ['budgets', 'transfer 500 to my brother', 'what did the weekend cost me']) {
      await a.turn(u);
    }
    expect(a.traceStore.count()).toBe(3);
  });

  it('explains the last turn without a model or a network call', async () => {
    const a = await app();
    await a.turn('budgets');
    const why = a.why();
    expect(why).toContain('How it decided:');
    expect(why).toContain('You said: "budgets"');
    expect(why).toContain('Data used:');
  });

  it('reports where each value came from', async () => {
    const a = await app();
    await a.turn('show my transactions');
    expect(a.why()).toMatch(/worked out by code|No values were needed/);
  });

  it('carries dataRead into the trace, so "what did you use" is answerable', async () => {
    const a = await app();
    await a.turn('budgets');
    const trace = a.traceStore.latest()!;
    expect(trace.dataRead.length).toBeGreaterThan(0);
    expect(trace.dataRead[0]!.table).toBeTruthy();
  });
});
