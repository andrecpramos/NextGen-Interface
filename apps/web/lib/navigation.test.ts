import { describe, expect, it } from 'vitest';

import { destinationFor, isSamePlace } from './navigation.ts';
import type { TurnResponse } from './wire.ts';

/**
 * WP-35 — the turn that finally moves the browser.
 *
 * Every case below is one where moving would be wrong, which is the whole of the
 * policy: the engine has resolved the route since WP-03, and the only question a
 * surface has to answer is whether acting on it is appropriate *this* turn.
 */

const response = (over: Partial<TurnResponse> = {}, trace: Partial<TurnResponse['trace']> = {}): TurnResponse =>
  ({
    turnId: 't-1',
    kind: 'execute',
    route: '/modules',
    trace: {
      turnId: 't-1',
      headline: 'h',
      steps: [],
      alternatives: [],
      dataUsed: [],
      values: [],
      timing: '1ms',
      candidates: [],
      chosen: 'module.list',
      capabilityKind: 'navigate',
      explanationRequest: false,
      decidedAt: 'deterministic',
      local: true,
      notes: [],
      ...trace,
    },
    ...over,
  }) as TurnResponse;

describe('destinationFor — when a turn should move the browser', () => {
  it('moves for an executed navigate capability', () => {
    expect(destinationFor(response())).toBe('/modules');
  });

  /**
   * The load-bearing refusal. A confirmation is a question the user has not
   * answered — arriving at the destination before they approve would defeat
   * ADR-004's confirmation gate by doing the thing first.
   */
  it.each(['confirm', 'clarify', 'refuse'] as const)('does not move on a %s turn', (kind) => {
    expect(destinationFor(response({ kind }))).toBeNull();
  });

  /**
   * A `read` executes too, and its answer has just been rendered. Moving to the
   * search screen replaces the answer with the form that would produce it.
   */
  it.each(['read', 'write', 'destructive', 'unsupported', null])(
    'does not move for a %s capability',
    (capabilityKind) => {
      expect(destinationFor(response({}, { capabilityKind }))).toBeNull();
    },
  );

  /**
   * WP-36. "What is the squad list?" is a question about a screen, not a request
   * to be put on it. The explanation is served either way; only the movement is
   * withheld.
   */
  it('does not move when the user asked what something is', () => {
    expect(destinationFor(response({}, { explanationRequest: true }))).toBeNull();
  });

  it.each(['', '   ', 'modules', 'https://elsewhere.example/x'])(
    'does not move to a route that is not a path: %s',
    (route) => {
      expect(destinationFor(response({ route }))).toBeNull();
    },
  );

  it('moves to the app root when that is genuinely the destination', () => {
    expect(destinationFor(response({ route: '/' }))).toBe('/');
  });
});

describe('isSamePlace — not pushing a history entry that goes nowhere', () => {
  it.each([
    ['/modules', '/modules'],
    ['/modules', '/modules/'],
    ['/modules/', '/modules'],
    ['/modules', '/modules?q=x'],
    ['/modules', '/modules#top'],
    ['/', '/'],
  ])('treats %s and %s as the same place', (a, b) => {
    expect(isSamePlace(a, b)).toBe(true);
  });

  it.each([
    ['/modules', '/modules/new'],
    ['/modules', '/'],
    ['/squad', '/training'],
  ])('treats %s and %s as different', (a, b) => {
    expect(isSamePlace(a, b)).toBe(false);
  });
});
