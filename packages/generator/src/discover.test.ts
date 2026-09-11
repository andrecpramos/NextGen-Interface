import { describe, expect, it } from 'vitest';

import { discoverRoutes, readRoleModel } from './discover.ts';
import { FIXTURE_CONFIG } from './fixture-app.ts';

const routeAt = (path: string) => {
  const { routes } = discoverRoutes(FIXTURE_CONFIG);
  return routes.find((route) => route.path === path);
};

describe('readRoleModel', () => {
  it('reads every role the application declares', () => {
    expect(readRoleModel(FIXTURE_CONFIG).allRoles).toEqual(['ADMIN', 'COACH', 'PARENT']);
  });

  it('resolves the three shapes a role set is written in', () => {
    const { namedSets } = readRoleModel(FIXTURE_CONFIG);
    expect(namedSets.get('squadOverview')).toEqual(['COACH', 'ADMIN']); // readRoles(...)
    expect(namedSets.get('squadPlayers')).toEqual(['COACH']); // array literal
    expect(namedSets.get('everyone')).toEqual(['ADMIN', 'COACH', 'PARENT']); // an identifier
  });

  // The spike read any call's string arguments as its role list. `exceptRole`
  // shows why that cannot be allowed to survive: its argument is the role being
  // *removed*, so the same reading grants precisely the wrong person access.
  // Rule 17's kill criterion is zero mis-assignments, so an unrecognised helper
  // yields nothing at all.
  it('refuses to evaluate a helper it has not proven to be an identity spread', () => {
    expect(readRoleModel(FIXTURE_CONFIG).namedSets.get('notForParents')).toBeNull();
  });
});

describe('discoverRoutes', () => {
  it('finds the application’s routes with absolute paths', () => {
    const { routes } = discoverRoutes(FIXTURE_CONFIG);
    expect(routes.map((r) => r.path)).toContain('/squad/players/:id');
    expect(routes.every((r) => r.path.startsWith('/'))).toBe(true);
  });

  it('attaches the roles that may reach each route', () => {
    expect(routeAt('/squad')?.roles).toEqual(['COACH', 'ADMIN']);
    expect(routeAt('/admin/users')?.roles).toEqual(['ADMIN']);
    expect(routeAt('/my/child')?.roles).toEqual(['PARENT']);
  });

  it('treats a route with no guard as reachable by every role', () => {
    expect(routeAt('/settings/notifications')?.roles).toEqual(['ADMIN', 'COACH', 'PARENT']);
  });

  it('leaves an unreadable guard null rather than defaulting it open', () => {
    expect(routeAt('/admin/unreadable')?.roles).toBeNull();
  });

  it('marks a route registered only under a development-build guard', () => {
    expect(routeAt('/dev/icons')?.devOnly).toBe(true);
    expect(routeAt('/squad')?.devOnly).toBe(false);
  });

  it('resolves each route to its component file and feature folder', () => {
    const route = routeAt('/squad/players');
    expect(route?.component).toBe('PlayersPage');
    expect(route?.componentFile).toMatch(/PlayersPage\.tsx$/);
    expect(route?.feature).toBe('squad');
  });

  it('keeps the comment a developer left on a route', () => {
    expect(routeAt('/squad/legacy-player/:id')?.comment).toContain('old bookmarks');
  });
});
