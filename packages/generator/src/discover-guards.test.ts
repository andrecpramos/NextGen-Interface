import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { discoverRoutes } from './discover.ts';
import { generate } from './generate.ts';
import type { GeneratorConfig } from './types.ts';

/**
 * WP-43 — the third way an application gates a route, found on a public app we do
 * not own (Tutor-Support-System, MIT).
 *
 * The roles are on a **parent** route's element, and its children inherit them:
 *
 *   <Route element={<ProtectedRoute allowedRoles={['ADMIN']} />}>
 *     <Route path="/admin/users" element={<UserManagement />} />
 *
 * Run against that app before this existed, the generator emitted all 16 screens —
 * including four admin-only ones — into a single `PUBLIC` registry, reported **0**
 * skips, and `doctor` finished with "nothing needs fixing". Rule 17 is a security
 * property and that was a leak, which is what WP-43 existed to find.
 */

const ROOT = fileURLToPath(new URL('../fixtures/guarded-app/src', import.meta.url));

const CONFIG: GeneratorConfig = {
  appRoot: ROOT,
  routesFile: 'App.tsx',
  roleSetExport: 'ROUTE_ROLES',
  allRolesExport: 'APP_ROLES',
  manifests: [],
  localesDir: null,
  languages: ['en'],
};

const rolesFor = (path: string): readonly string[] | null | undefined =>
  discoverRoutes(CONFIG).routes.find((route) => route.path === path)?.roles;

describe('discoverRoutes — a guard on a parent route (WP-43)', () => {
  it('gives a child only the roles its guard allows', () => {
    expect(rolesFor('/admin/overview')).toEqual(['ADMIN']);
    expect(rolesFor('/admin/users')).toEqual(['ADMIN']);
    expect(rolesFor('/search')).toEqual(['STUDENT', 'TUTOR']);
  });

  it('treats a guard with no role list as "any signed-in user", which narrows nothing', () => {
    expect(rolesFor('/settings')).toEqual(['ADMIN', 'STUDENT', 'TUTOR']);
  });

  it('leaves an unguarded route reachable by every role the app names', () => {
    expect(rolesFor('/')).toEqual(['ADMIN', 'STUDENT', 'TUTOR']);
    expect(rolesFor('/login')).toEqual(['ADMIN', 'STUDENT', 'TUTOR']);
  });

  /**
   * The safety half. An app with no permissions module used to yield one `PUBLIC`
   * audience for everything, so a guard this parser could not evaluate silently
   * became "everyone" — the exact inversion of Rule 17's kill criterion.
   */
  it('refuses to guess a guard it cannot evaluate, and drops the route instead', () => {
    expect(rolesFor('/admin/secret')).toBeNull();
  });

  it('takes the role universe from the app’s own guards, not from an invented audience', () => {
    expect(discoverRoutes(CONFIG).roles.allRoles).toEqual(['ADMIN', 'STUDENT', 'TUTOR']);
  });
});

describe('generate — the unreadable guard reaches the skip report', () => {
  it('omits it with a reason a person can act on, and ships the rest by role', async () => {
    const output = await generate({ config: CONFIG });

    expect(output.skipped.find((s) => s.path === '/admin/secret')).toMatchObject({ reason: 'unresolved-roles' });
    expect(output.master.map((c) => c.route)).not.toContain('/admin/secret');

    // Rule 17: an ADMIN screen is absent from the other roles' registries, not hidden in them.
    const routesFor = (role: string) =>
      output.registries.get(role)!.capabilities.filter((c) => c.kind !== 'unsupported').map((c) => c.route);
    expect(routesFor('ADMIN')).toContain('/admin/users');
    expect(routesFor('STUDENT')).not.toContain('/admin/users');
    expect(routesFor('TUTOR')).not.toContain('/admin/users');
    expect(routesFor('STUDENT')).toContain('/search');
    expect(routesFor('ADMIN')).not.toContain('/search');
  });
});
