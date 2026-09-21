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
 * When the router will not act but one screen is plainly ahead, a menu of equals is the wrong
 * answer: it makes the visitor do the ranking the router already did. So the leader is offered
 * first, as the likely one, with what the screen is for — and never executed, because a
 * suggestion costs one tap when it is wrong and a move costs a page.
 */
describe('present — a clear leader', () => {
  const clarify = (candidates: { capabilityId: string; score: number }[], path = '/', w = words) =>
    present(trace({ outcome: 'clarify', candidates }), registry, path, w);

  it('says which one it thinks you mean when one is clearly ahead, and what that screen is for', () => {
    const view = clarify([
      { capabilityId: 'calendar.overview', score: 0.3 },
      { capabilityId: 'squad.search', score: 0.12 },
    ]);
    expect(view).toMatchObject({ tone: 'choose', probable: true, destination: null, title: 'You probably want Calendar.' });
    expect(view.choices).toEqual([
      { label: 'Calendar', route: '/calendar', detail: 'Training and matches by day.' },
      { label: 'Squad', route: '/squad' },
    ]);
  });

  it('never moves the browser, whatever the margin', () => {
    expect(clarify([{ capabilityId: 'calendar.overview', score: 0.9 }]).destination).toBeNull();
  });

  it('keeps asking when two are close: a tie is a real question', () => {
    const view = clarify([
      { capabilityId: 'calendar.overview', score: 0.3 },
      { capabilityId: 'squad.search', score: 0.25 },
    ]);
    expect(view.probable).toBeUndefined();
    expect(view.title).toBe(words.whichOne);
    expect(view.choices).toHaveLength(2);
  });

  it('keeps asking when the best is barely a match at all', () => {
    expect(clarify([{ capabilityId: 'calendar.overview', score: 0.1 }, { capabilityId: 'squad.search', score: 0.02 }]).probable).toBeUndefined();
  });

  it('keeps asking when a declared limit is close behind: the request may be out of scope', () => {
    const view = clarify([
      { capabilityId: 'calendar.overview', score: 0.3 },
      { capabilityId: 'unsupported.payments', score: 0.25 },
    ]);
    expect(view.probable).toBeUndefined();
  });

  it('does not call a screen the likely one when it is not the one it can offer', () => {
    // The leader needs an item the page cannot supply, so what is offered first is not the leader.
    const view = clarify([
      { capabilityId: 'child.development', score: 0.4 },
      { capabilityId: 'calendar.overview', score: 0.1 },
    ]);
    expect(view.probable).toBeUndefined();
    expect(view.choices.map((c) => c.label)).toEqual(['Calendar']);
  });

  it('leaves the framing to the model when it wrote something, which wins over fixed wording', () => {
    const view = present(
      trace({ outcome: 'clarify', prose: 'I found a couple of things close to that.', candidates: [{ capabilityId: 'calendar.overview', score: 0.5 }, { capabilityId: 'squad.search', score: 0.1 }] }),
      registry,
      '/',
      words,
    );
    expect(view.probable).toBeUndefined();
    expect(view.title).toBe(words.whichOne);
    expect(view.body).toBe('I found a couple of things close to that.');
  });

  it('a lone candidate above the floor is the likely one', () => {
    expect(clarify([{ capabilityId: 'calendar.overview', score: 0.2 }]).probable).toBe(true);
  });

  it('gives a screen’s purpose as its first sentence only, and never an essay', () => {
    const long = { id: 'x.long', kind: 'navigate', route: '/long', title: 'Long', explanation: 'First sentence here. A second one that must not appear.' };
    const essay = { id: 'x.essay', kind: 'navigate', route: '/essay', title: 'Essay', explanation: `${'palavra '.repeat(40)}fim.` };
    const bare = { id: 'x.bare', kind: 'navigate', route: '/bare', title: 'Bare' };
    const reg = { capabilities: [long, essay, bare], byId: new Map([long, essay, bare].map((c) => [c.id, c])), boundaryIds: new Set() } as unknown as Registry;
    const detailOf = (id: string) => present(trace({ outcome: 'clarify', candidates: [{ capabilityId: id, score: 0.4 }] }), reg, '/', words).choices[0]!;
    expect(detailOf('x.long').detail).toBe('First sentence here.');
    expect(detailOf('x.essay').detail!.length).toBeLessThanOrEqual(141);
    expect(detailOf('x.essay').detail!.endsWith('…')).toBe(true);
    expect('detail' in detailOf('x.bare')).toBe(false);
  });

  it('says it in the page’s language', () => {
    const view = clarify([{ capabilityId: 'calendar.overview', score: 0.3 }, { capabilityId: 'squad.search', score: 0.1 }], '/', WORDS.pt);
    expect(view.title).toBe('Provavelmente quer Calendar.');
    expect(WORDS.pt.orElse).toBeTruthy();
    expect(WORDS.en.orElse).toBeTruthy();
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
