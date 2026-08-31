import { describe, expect, it } from 'vitest';

import { NextGenApp } from './app.ts';

/**
 * Composition smoke tests.
 *
 * Every package has its own suite; none of them proves the packages fit
 * together. These run the whole assembly — registry, router, dispatcher,
 * domain use case, trace — with **no model and no network**, so they are fast
 * and deterministic and can gate CI.
 *
 * `--no-model` means `module.capture` can never produce a usable proposal
 * (extraction needs a real model, with no deterministic fallback the way
 * `transaction.create`'s money/date parsing had in the finance domain) — so
 * these tests exercise the honest-clarify path rather than a full
 * capture→confirm→commit round trip. That round trip is covered where the
 * reasoning actually lives: `domain-modules`'s own suite, against
 * `FakeLlmRuntime`.
 */

const app = async () => NextGenApp.create({ noModel: true, embedder: 'hashing' });

describe('the stack composes', () => {
  it('navigates deterministically on an exact trigger phrase', async () => {
    const a = await app();
    const r = await a.turn('my modules');
    expect(r.decision.type).toBe('execute');
    expect(r.trace.decidedAt).toBe('deterministic');
    expect(r.trace.capabilityId).toBe('module.list');
  });

  it('asks for the missing search term rather than guessing it — query has no deterministic resolver', async () => {
    const a = await app();
    const r = await a.turn('search my notes for the passport');
    expect(r.decision.type).toBe('clarify');
  });

  it('answers a read with nothing to find, once a query is actually supplied', async () => {
    // Bypasses the router (Rule 7's other path): a menu-style invocation still
    // reaches the read handler, so the model-free case is exercised here.
    const a = await app();
    const r = await a.invoke('module.search');
    expect(r.decision.type).toBe('execute');
    expect(r.output.join(' ')).toContain('Nothing saved yet');
  });

  it('refuses a declared limit with the authored message, model-free', async () => {
    // ADR-009 end to end: no model is running, and it still refuses correctly.
    const a = await app();
    const r = await a.turn('check my email for the confirmation');
    expect(r.decision.type).toBe('refuse');
    expect(r.output.join(' ')).toContain("can't reach your email");
    expect(r.trace.latency.stage3).toBeUndefined();
  });

  it('asks rather than guessing when it cannot resolve without the model', async () => {
    const a = await app();
    const r = await a.turn('something entirely unrelated to anything this app does xyzzy');
    expect(r.decision.type).toBe('clarify');
  });
});

describe('module.capture says so rather than guessing when it has no model to reason with', () => {
  it('produces an honest clarify, never a silent write, when the module model is unavailable', async () => {
    const a = await app();
    const r = await a.turn('remember that my passport expires in June 2027');
    expect(r.decision.type).toBe('clarify');
    expect(r.decision.type === 'clarify' && r.decision.question).toMatch(/unavailable/);
  });

  it('the upload path (captureFromContent) degrades the same honest way, without consulting the router', async () => {
    const a = await app();
    const r = await a.captureFromContent({ text: 'a scanned document about a passport', sourceType: 'document' });
    expect(r.decision.type).toBe('clarify');
    expect(r.trace.transcript).toBe('[document upload]');
  });
});

describe('policy holds through the whole assembly', () => {
  it('never writes without a confirmation step', async () => {
    const a = await app();
    const r = await a.turn('remember that my passport expires in June 2027');
    expect(r.decision.type).not.toBe('execute');
  });

  it('will not approve something that was not a confirmation', async () => {
    const a = await app();
    const r = await a.turn('my modules');
    const out = await a.confirm(r.decision);
    expect(out.join(' ')).toContain('nothing to confirm');
  });
});

describe('every turn leaves an explainable record', () => {
  it('records a trace for each turn, including refusals and clarifies', async () => {
    const a = await app();
    for (const u of ['my modules', 'check my email for the confirmation', 'something entirely unrelated xyzzy']) {
      await a.turn(u);
    }
    expect(a.traceStore.count()).toBe(3);
  });

  it('explains the last turn without a model or a network call', async () => {
    const a = await app();
    await a.turn('my modules');
    const why = a.why();
    expect(why).toContain('How it decided:');
    expect(why).toContain('You said: "my modules"');
  });

  it('carries dataRead into the trace for a read turn', async () => {
    const a = await app();
    await a.invoke('module.search');
    const trace = a.traceStore.latest()!;
    expect(trace.dataRead.length).toBeGreaterThan(0);
    expect(trace.dataRead[0]!.table).toBe('modules');
  });
});
