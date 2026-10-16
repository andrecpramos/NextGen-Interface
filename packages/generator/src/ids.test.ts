import { describe, expect, it } from 'vitest';

import { synthesiseId, featureOf } from './ids.ts';
import type { DiscoveredRoute } from './types.ts';

const route = (path: string, feature: string | null = null): DiscoveredRoute => ({
  path,
  component: 'SomePage',
  componentFile: feature ? `/app/src/features/${feature}/pages/SomePage.tsx` : null,
  feature,
  roles: ['COACH'],
  roleKey: null,
  devOnly: false,
  comment: null,
});

/**
 * The first spike's mechanical failure: 17.6% of its ids failed
 * `core-capability`'s `id-format` rule because it fell back to a lowercased
 * component name — `settingspage`, `gradebookpage` — whenever no label existed.
 * There is no fallback here, so these tests are about the *only* path.
 */
describe('synthesiseId', () => {
  const none = new Set<string>();

  it('always produces two dotted segments', () => {
    expect(synthesiseId(route('/settings', 'settings'), none)).toBe('settings.overview');
    expect(synthesiseId(route('/squad/players', 'squad'), none)).toBe('squad.players');
  });

  it('accepts every id it produces against the registry’s own rule', () => {
    const pattern = /^[a-z][a-z0-9]*(\.[a-z][a-z0-9_]*)+$/;
    const paths = ['/settings', '/squad/players', '/my/children/medical', '/video/reports/themes', '/a'];
    for (const path of paths) {
      expect(synthesiseId(route(path, 'squad'), none)).toMatch(pattern);
    }
  });

  // The first segment of an id may not contain an underscore, and a camelCase
  // feature folder normalises into one. `adminUsers` is a real folder name.
  it('reduces a multi-word feature folder to a single leading word', () => {
    expect(synthesiseId(route('/admin/users', 'adminUsers'), none)).toBe('admin.users');
  });

  it('does not repeat the feature in both segments', () => {
    expect(synthesiseId(route('/squad', 'squad'), none)).toBe('squad.overview');
  });

  it('keeps a detail route distinct from the list it opens from', () => {
    const taken = new Set(['squad.players']);
    expect(synthesiseId(route('/squad/players/:id', 'squad'), taken)).toBe('squad.players_detail');
  });

  it('never collides, even when two routes reduce to the same name', () => {
    const taken = new Set(['squad.players']);
    expect(synthesiseId(route('/squad/players', 'squad'), taken)).toBe('squad.players_2');
  });

  it('falls back to the route’s own first segment when no component was found', () => {
    expect(featureOf(route('/reports/monthly'))).toBe('reports');
  });

  // Found on a real Next.js app whose every route began `/:locale/…` (next-intl): each screen was
  // "in the locale area", and its id was `locale.auth_login`. A parameter is a value, not a section.
  it('never takes a leading parameter, such as a locale, for the area a screen belongs to', () => {
    expect(featureOf(route('/:locale/portal/atleta'))).toBe('portal');
    expect(featureOf(route('/:locale/auth/login'))).toBe('auth');
    expect(featureOf(route('/:tenant/:locale/reports'))).toBe('reports');
    expect(featureOf(route('/:locale'))).toBe('app');
  });

  it('gives such a screen an id named for what it is, not for its locale', () => {
    const none = new Set<string>();
    expect(synthesiseId(route('/:locale/auth/login'), none)).toBe('auth.login');
    expect(synthesiseId(route('/:locale/portal/atleta'), none)).toBe('portal.atleta');
    expect(synthesiseId(route('/:locale/portal'), none)).toBe('portal.overview');
    expect(synthesiseId(route('/:locale'), none)).toBe('app.overview');
  });

  it('still marks a route that picks one item out of a place, however it is prefixed', () => {
    const none = new Set<string>();
    expect(featureOf(route('/players/:id'))).toBe('players');
    expect(synthesiseId(route('/players/:id'), none)).toBe('players.overview_detail');
    expect(synthesiseId(route('/:locale/players/:id'), none)).toBe('players.overview_detail');
  });
});
