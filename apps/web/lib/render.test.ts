import { describe, expect, it } from 'vitest';

import type { NextGenApp } from '@nextgen/cli';
import type { Decision } from '@nextgen/core-dispatch';
import type { TurnTrace } from '@nextgen/core-trace';

import { renderAnswer, renderConfirm, renderNav, renderTrace } from './render.ts';

/**
 * WP-22 — the first tests `apps/web` has ever had.
 *
 * These cover the *contract*, not the pixels. Everything the surface is handed comes
 * out of these four functions, so a mistake here is a mistake the user sees, and three
 * of the properties below have a safety flavour rather than a cosmetic one:
 *
 * - the drawer may only offer `navigate` capabilities, or a one-tap entry could run a
 *   destructive action without ever meeting ADR-004's confirmation;
 * - a confirmation card must hide the raw uploaded source text it carries internally
 *   (Rule 15) while showing every value the user is approving (ADR-004 rule 1);
 * - a rendered trace must carry the runners-up, because a decision whose alternatives
 *   you cannot see is asserted rather than explained (Rule 9).
 */

const confirm = (over: Partial<Extract<Decision, { type: 'confirm' }>> = {}) =>
  ({
    type: 'confirm',
    capabilityId: 'module.capture',
    title: 'Remember this',
    destructive: false,
    params: { body: 'the wifi password is on the router', action: 'create' },
    ...over,
  }) as Extract<Decision, { type: 'confirm' }>;

/** A complete `core-trace` record — the shape `explain()` actually reads. */
const trace = (over: Partial<TurnTrace> = {}): TurnTrace =>
  ({
    turnId: 't-1',
    transcript: 'remember the wifi password',
    decidedAt: 'llm',
    candidates: [
      { capabilityId: 'module.capture', score: 0.81 },
      { capabilityId: 'module.search', score: 0.44 },
    ],
    outcome: 'execute',
    capabilityId: 'module.capture',
    capabilityKind: 'write',
    route: '/modules/new',
    params: { body: 'the wifi password is on the router' },
    missing: [],
    requiresConfirmation: true,
    modelId: 'qwen2.5:1.5b',
    promptVersion: 'v1',
    paramSources: { body: 'model', action: 'deterministic' },
    dataRead: [],
    latency: { total: 120 },
    undoToken: null,
    notes: [],
    createdAt: '2026-09-10T00:00:00.000Z',
    ...over,
  }) as TurnTrace;

describe('renderConfirm — what a confirmation card shows, and what it must not', () => {
  /**
   * ADR-004 rule 1: a misheard value has to be visible as a *field*, not buried in a
   * sentence. Every editable parameter is what makes the confirmation a review rather
   * than a yes/no.
   */
  it('shows each parsed parameter as an editable field', () => {
    const view = renderConfirm(confirm(), trace());
    expect(view.params.map((p) => p.name).sort()).toEqual(['action', 'body']);
    expect(view.params.every((p) => p.editable)).toBe(true);
  });

  /**
   * The excerpt is the user's raw uploaded document, and the candidate blob is
   * machine plumbing. Neither belongs on a card a person is asked to read and approve
   * — and the excerpt is untrusted third-party text (Rule 15).
   */
  it('hides the internal parameters that carry raw source text', () => {
    const view = renderConfirm(
      confirm({
        params: {
          body: 'something',
          sourceExcerpt: 'PAGES OF RAW UPLOADED DOCUMENT TEXT',
          sourceType: 'pdf',
          candidatesJson: '[]',
        },
      }),
      trace(),
    );
    const names = view.params.map((p) => p.name);
    expect(names).toEqual(['body']);
    expect(JSON.stringify(view)).not.toContain('RAW UPLOADED DOCUMENT');
  });

  /**
   * Rule 11 made deterministic values win over model-extracted ones. This is where a
   * user can *see* which is which — a date the grammar resolved and a date the model
   * guessed must not look identical on the card.
   */
  it('reports where each value came from', () => {
    const view = renderConfirm(confirm(), trace());
    const byName = Object.fromEntries(view.params.map((p) => [p.name, p.source]));
    expect(byName).toEqual({ body: 'model', action: 'deterministic' });
  });

  it('falls back to "model" for a value the trace never recorded', () => {
    const view = renderConfirm(confirm(), trace({ paramSources: {} } as Partial<TurnTrace>));
    // The safe default: claiming a value was deterministic when nothing says so
    // would overstate its provenance on a card a user approves.
    expect(view.params.every((p) => p.source === 'model')).toBe(true);
  });

  it('carries the destructive flag through, because the card is styled on it', () => {
    expect(renderConfirm(confirm({ destructive: true }), trace()).destructive).toBe(true);
    expect(renderConfirm(confirm(), trace()).destructive).toBe(false);
  });

  it('renders the long field as a textarea, not a single line', () => {
    const body = renderConfirm(confirm(), trace()).params.find((p) => p.name === 'body');
    expect(body?.multiline).toBe(true);
  });

  /**
   * `module.capture`'s hardest question — new module, or append to an existing one —
   * is a choice, so picking the wrong one is a deliberate act rather than a typo.
   */
  it('offers create, each existing candidate, and interpret-only as choices', () => {
    const view = renderConfirm(
      confirm({
        params: {
          action: 'create',
          candidatesJson: JSON.stringify([{ id: 'm-1', title: 'Router' }]),
        },
      }),
      trace(),
    );
    const action = view.params.find((p) => p.name === 'action');
    expect(action?.choices?.map((c) => c.value)).toEqual(['create', 'append:m-1', 'interpret']);
  });

  it('degrades to create-or-interpret when the candidate blob is unparseable', () => {
    const view = renderConfirm(
      confirm({ params: { action: 'create', candidatesJson: 'not json at all' } }),
      trace(),
    );
    const action = view.params.find((p) => p.name === 'action');
    expect(action?.choices?.map((c) => c.value)).toEqual(['create', 'interpret']);
  });
});

describe('renderAnswer — arriving somewhere, and being told what is there', () => {
  const appWith = (capability: Record<string, unknown>) =>
    ({ capabilities: [capability] }) as unknown as NextGenApp;

  /**
   * WP-36, and the second half of the product's promise: take them there *and*
   * tell them what they will find. The sentence is declared at build time and
   * served verbatim, so no model runs to produce it.
   */
  it('serves the capability’s declared explanation, unchanged', async () => {
    const explanation = 'Everything you have saved, grouped by category.';
    const view = await renderAnswer(
      appWith({ id: 'module.list', kind: 'navigate', title: 'Modules', route: '/modules', explanation }),
      'module.list',
      {},
    );
    expect(view.headline).toBe('Opened Modules.');
    expect(view.caption).toBe(explanation);
  });

  /**
   * WP-36's detection half. Both readings serve the same declared string; what
   * changes is which one leads. "What is the squad list?" has not asked to be
   * moved, so announcing "Opened X" answers a question nobody put — while the
   * route still resolved, so the navigation remains available and Rule 7 holds.
   */
  it('leads with the explanation when the user asked what something is', async () => {
    const explanation = 'Everything you have saved, grouped by category.';
    const view = await renderAnswer(
      appWith({ id: 'module.list', kind: 'navigate', title: 'Modules', route: '/modules', explanation }),
      'module.list',
      {},
      true,
    );
    expect(view.headline).toBe('Modules');
    expect(view.caption).toBe(explanation);
    expect(JSON.stringify(view)).not.toContain('Opened');
  });

  it('still announces the destination when nothing was asked to be explained', async () => {
    const view = await renderAnswer(
      appWith({ id: 'module.list', kind: 'navigate', title: 'Modules', route: '/modules', explanation: 'x' }),
      'module.list',
      {},
      false,
    );
    expect(view.headline).toBe('Opened Modules.');
  });

  /**
   * A capability with nothing declared cannot lead with an explanation it does
   * not have, so it must fall back rather than render an empty headline.
   */
  it('falls back to the destination when an explanation request has nothing to serve', async () => {
    const view = await renderAnswer(
      appWith({ id: 'module.list', kind: 'navigate', title: 'Modules', route: '/modules' }),
      'module.list',
      {},
      true,
    );
    expect(view.caption).toBe('Opened Modules.');
  });

  it('still says where it went when a capability declares no explanation', async () => {
    const view = await renderAnswer(
      appWith({ id: 'module.list', kind: 'navigate', title: 'Modules', route: '/modules' }),
      'module.list',
      {},
    );
    expect(view.caption).toBe('Opened Modules.');
  });
});

describe('renderNav — the drawer is generated, and it is not a menu anyone maintains', () => {
  const app = (capabilities: { id: string; kind: string; title: string; route: string | null }[]) =>
    ({ capabilities }) as unknown as NextGenApp;

  /**
   * The load-bearing filter. A drawer entry is a one-tap action, so offering a
   * `destructive` capability there would let a user delete something without ever
   * meeting the confirmation ADR-004 requires. `unsupported` is a declared refusal and
   * has nowhere to navigate to at all.
   */
  it('offers navigate capabilities only — never a write, destructive or declared limit', () => {
    const items = renderNav(
      app([
        { id: 'module.list', kind: 'navigate', title: 'Modules', route: '/modules' },
        { id: 'module.capture', kind: 'write', title: 'Remember this', route: '/modules/new' },
        { id: 'module.delete', kind: 'destructive', title: 'Delete', route: '/modules' },
        { id: 'module.search', kind: 'read', title: 'Search', route: '/modules/search' },
        { id: 'unsupported.automation', kind: 'unsupported', title: 'Acting elsewhere', route: null },
      ]),
    );
    expect(items.map((i) => i.capabilityId)).toEqual(['module.list']);
  });

  it('carries the route the dispatcher would use, not a hand-written one', () => {
    const items = renderNav(app([{ id: 'a.b', kind: 'navigate', title: 'A', route: '/a' }]));
    expect(items[0]).toEqual({ capabilityId: 'a.b', label: 'A', route: '/a' });
  });

  it('is empty rather than invented when the registry has nothing navigable', () => {
    expect(renderNav(app([{ id: 'a.b', kind: 'write', title: 'A', route: '/a' }]))).toEqual([]);
  });
});

describe('renderTrace — explaining a decision without narrating it', () => {
  /**
   * Rule 9: explainability is a record, never model narration. The panel draws the
   * runners-up because a decision whose alternatives you cannot see is asserted rather
   * than explained.
   */
  it('passes every candidate and its score through, with the chosen one named', () => {
    const view = renderTrace(trace(), true);
    expect(view.candidates).toEqual([
      { capabilityId: 'module.capture', score: 0.81 },
      { capabilityId: 'module.search', score: 0.44 },
    ]);
    expect(view.chosen).toBe('module.capture');
    expect(view.decidedAt).toBe('llm');
  });

  /**
   * WP-35. The surface decides whether to move the browser from these two, so a
   * silent `undefined` here would not throw — it would just stop navigation
   * working, which is the hardest kind of regression to notice.
   */
  it('passes through what the surface needs to decide about navigating', () => {
    const view = renderTrace(trace({ capabilityKind: 'navigate', explanationRequest: true }), true);
    expect(view.capabilityKind).toBe('navigate');
    expect(view.explanationRequest).toBe(true);
  });

  it('reports whether the turn stayed local', () => {
    expect(renderTrace(trace(), true).local).toBe(true);
    expect(renderTrace(trace(), false).local).toBe(false);
  });

  it('produces a headline without a model', () => {
    // `explain()` assembles prose from ids, enums and numbers in the record. If this
    // ever needed a model, `why` would be narration.
    expect(renderTrace(trace(), true).headline.length).toBeGreaterThan(0);
  });
});
