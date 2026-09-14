import { describe, expect, it } from 'vitest';

import type { Registry } from '@nextgen/core-intent/browser';

import { suggestionsFor } from './present.ts';

/**
 * The places the assistant screen offers before anything is asked. They are
 * links, so the same rules as a clarifying answer apply: somewhere the user can
 * actually go from here, never a boundary, never a parameter guessed.
 */

const caps = [
  { id: 'calendar.overview', kind: 'navigate', route: '/calendar', title: 'Calendar' },
  { id: 'squad.search', kind: 'read', route: '/squad/search', title: 'Search the squad' },
  { id: 'child.development', kind: 'navigate', route: '/my/children/:childId/development', title: 'Development' },
  { id: 'child.medical', kind: 'navigate', route: '/my/children/:childId/medical', title: 'Medical' },
  { id: 'calendar.again', kind: 'navigate', route: '/calendar/', title: 'Calendar, again' },
  { id: 'standings', kind: 'navigate', route: '/competition/standings', title: 'Standings' },
  { id: 'settings', kind: 'navigate', route: '/settings', title: 'Settings' },
  { id: 'module.delete', kind: 'destructive', route: '/modules', title: 'Delete a module' },
  { id: 'unsupported.payments', kind: 'unsupported', route: null, title: 'Payments' },
];

const registry = (boundary: string[] = ['unsupported.payments']): Registry =>
  ({ capabilities: caps, byId: new Map(caps.map((c) => [c.id, c])), boundaryIds: new Set(boundary) }) as unknown as Registry;

const routes = (...args: Parameters<typeof suggestionsFor>): string[] => suggestionsFor(...args).map((c) => c.route);

describe('suggestionsFor', () => {
  it('offers only screens the user can go to from here, once each', () => {
    expect(routes(registry(), '/home')).toEqual(['/calendar', '/competition/standings', '/settings']);
  });

  it('fills a parameter from the page the user is on, and skips that page itself', () => {
    expect(routes(registry(), '/my/children/42/development')).toEqual([
      '/calendar',
      '/my/children/42/medical',
      '/competition/standings',
      '/settings',
    ]);
  });

  it('stops at the limit', () => {
    expect(routes(registry(), '/home', 2)).toEqual(['/calendar', '/competition/standings']);
  });

  it('never offers a boundary, even one that navigates', () => {
    expect(routes(registry(['unsupported.payments', 'standings']), '/home')).toEqual(['/calendar', '/settings']);
  });

  it('does not offer the page the user is already on', () => {
    expect(routes(registry(), '/settings/')).toEqual(['/calendar', '/competition/standings']);
  });
});
