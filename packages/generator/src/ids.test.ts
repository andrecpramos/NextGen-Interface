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
 * WP-30's verdict, the mechanical one: 17.6% of the spike's ids failed
 * `core-capability`'s `id-format` rule because it fell back to a lowercased
 * component name — `settingspage`, `matchhubpage` — whenever no label existed.
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
});
