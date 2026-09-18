import { describe, expect, it } from 'vitest';

import type { Registry, TurnTrace } from '@nextgen/core-intent/browser';

import { fillParams, isSamePlace, present, WORDS, wordsFor } from './present.ts';

/**
 * The script tag's policy for one turn: what it says, and whether it moves.
 * Every case here is one where moving, or acting, would be wrong.
 */

const caps = [
  { id: 'calendar.overview', kind: 'navigate', route: '/calendar', title: 'Calendar', explanation: 'Training and matches by day.' },
  { id: 'child.medical', kind: 'navigate', route: '/my/children/:childId/medical', title: 'Medical', explanation: 'Your child’s medical record.' },
  { id: 'child.development', kind: 'navigate', route: '/my/children/:childId/development', title: 'Development', explanation: 'Progress over time.' },
  { id: 'squad.search', kind: 'read', route: '/squad', title: 'Squad', explanation: 'Every player.' },
  { id: 'module.delete', kind: 'destructive', route: '/modules', title: 'Delete a module', explanation: 'Removes a module.' },
  { id: 'unsupported.payments', kind: 'unsupported', route: null, title: 'Payments', refusal: 'I can’t move money for you.' },
];

const registry = {
  capabilities: caps,
  byId: new Map(caps.map((c) => [c.id, c])),
  boundaryIds: new Set(['unsupported.payments']),
} as unknown as Registry;

const trace = (over: Partial<TurnTrace>): TurnTrace =>
  ({
    outcome: 'execute',
    capabilityId: null,
    candidates: [],
    explanationRequest: false,
    ...over,
  }) as TurnTrace;

const words = WORDS.en;

describe('present — when it moves the browser', () => {
  it('moves for an executed navigate turn, and says where', () => {
    const view = present(trace({ capabilityId: 'calendar.overview' }), registry, '/', words);
    expect(view).toMatchObject({ tone: 'go', destination: '/calendar', body: 'Training and matches by day.' });
    expect(view.title).toBe('Opening Calendar');
  });

  it('does not move when the user asked what a screen is (WP-36)', () => {
    const view = present(trace({ capabilityId: 'calendar.overview', explanationRequest: true }), registry, '/', words);
    expect(view.destination).toBeNull();
    expect(view.choices).toEqual([{ label: 'Open Calendar', route: '/calendar' }]);
  });

  it('does not move to where the user already is', () => {
    const view = present(trace({ capabilityId: 'calendar.overview' }), registry, '/calendar/', words);
    expect(view.destination).toBeNull();
    expect(view.title).toMatch(/already on Calendar/);
  });

  it('never performs a read, write or destructive capability: there is no dispatcher here', () => {
    for (const id of ['squad.search', 'module.delete']) {
      const view = present(trace({ capabilityId: id }), registry, '/', words);
      expect(view.destination).toBeNull();
      expect(view.tone).toBe('explain');
    }
  });
});

describe('present — routes with parameters', () => {
  it('fills a parameter from the page the user is on', () => {
    const view = present(trace({ capabilityId: 'child.medical' }), registry, '/my/children/42/development', words);
    expect(view.destination).toBe('/my/children/42/medical');
  });

  it('refuses to guess a parameter the current page does not carry', () => {
    const view = present(trace({ capabilityId: 'child.medical' }), registry, '/calendar', words);
    expect(view.destination).toBeNull();
    expect(view.body).toMatch(/one specific item/);
    expect(view.choices).toEqual([]);
  });

  it('drops an optional parameter it does not know, and keeps a plain route as it is', () => {
    expect(fillParams('/reports/:id?', '/', [])).toBe('/reports');
    expect(fillParams('/calendar', '/anything', [])).toBe('/calendar');
    expect(fillParams(null, '/', [])).toBeNull();
  });
});

describe('present — clarify and refuse', () => {
  it('offers the ranked screens as links, never a declared limit', () => {
    const view = present(
      trace({
        outcome: 'clarify',
        candidates: [
          { capabilityId: 'unsupported.payments', score: 0.9 },
          { capabilityId: 'calendar.overview', score: 0.5 },
          { capabilityId: 'squad.search', score: 0.4 },
        ],
      }),
      registry,
      '/',
      words,
    );
    expect(view.tone).toBe('choose');
    expect(view.destination).toBeNull();
    expect(view.choices).toEqual([
      { label: 'Calendar', route: '/calendar' },
      { label: 'Squad', route: '/squad' },
    ]);
  });

  it('states a declared limit in the registry’s own words, as a limit rather than an error', () => {
    const view = present(trace({ outcome: 'out_of_scope', capabilityId: 'unsupported.payments' }), registry, '/', words);
    expect(view).toMatchObject({ tone: 'limit', body: 'I can’t move money for you.', destination: null });
  });

  it('falls back to a general limit when no boundary was named', () => {
    expect(present(trace({ outcome: 'out_of_scope' }), registry, '/', words).body).toBe(words.limitFallback);
  });

  it('says it went wrong, and moves nothing, on an error', () => {
    expect(present(trace({ outcome: 'error' }), registry, '/', words)).toMatchObject({ tone: 'unsure', destination: null });
  });
});

/**
 * ADR-019 (WP-53). `trace.prose` is the model's answer, already checked by
 * `validateClaims` before this trace existed — `present()`'s only job is to prefer it
 * over the fixed, build-time text when it is there, exactly like every other field on a
 * trace that overrides a default.
 */
describe('present — the model’s validated answer, when there is one', () => {
  it('prefers trace.prose over the declared explanation on an executed turn', () => {
    const view = present(
      trace({ capabilityId: 'calendar.overview', prose: 'Training moved to Tuesday this week.' }),
      registry,
      '/',
      words,
    );
    expect(view.body).toBe('Training moved to Tuesday this week.');
  });

  it('falls back to the declared explanation when prose is null — the pre-WP-53 shape', () => {
    const view = present(trace({ capabilityId: 'calendar.overview', prose: null }), registry, '/', words);
    expect(view.body).toBe('Training and matches by day.');
  });

  it('prefers trace.prose over the declared refusal on a limit', () => {
    const view = present(
      trace({ outcome: 'out_of_scope', capabilityId: 'unsupported.payments', prose: 'This app has no way to move money at all.' }),
      registry,
      '/',
      words,
    );
    expect(view).toMatchObject({ tone: 'limit', body: 'This app has no way to move money at all.' });
  });

  it('carries prose into a choose view, alongside the offered links', () => {
    const view = present(
      trace({
        capabilityId: null,
        prose: 'I found a couple of things close to that.',
        candidates: [{ capabilityId: 'calendar.overview', score: 0.5 }],
      }),
      registry,
      '/',
      words,
    );
    expect(view.tone).toBe('choose');
    expect(view.body).toBe('I found a couple of things close to that.');
    expect(view.choices).toEqual([{ label: 'Calendar', route: '/calendar' }]);
  });
});

describe('words', () => {
  it('speaks the page’s language', () => {
    expect(wordsFor('pt-PT')).toBe(WORDS.pt);
    expect(wordsFor('en-GB')).toBe(WORDS.en);
    expect(wordsFor(null)).toBe(WORDS.en);
  });

  it('compares places on the path only', () => {
    expect(isSamePlace('/calendar', '/calendar?week=2')).toBe(true);
    expect(isSamePlace('/calendar', '/squad')).toBe(false);
  });
});
