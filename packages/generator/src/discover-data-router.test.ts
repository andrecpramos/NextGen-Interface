import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { discoverRoutes } from './discover.ts';
import { generate } from './generate.ts';
import type { GeneratorConfig } from './types.ts';

/**
 * A target app we do not own.
 *
 * Run against a real public React Router application (bulletproof-react), the
 * generator discovered **one** capability out of eight real routes and reported
 * **zero** skipped. It had not skipped the other seven; it never saw them. Its
 * routes were written the data-router way — `path: paths.app.users.path`, read
 * from a path table through a tsconfig alias, and `lazy: () => import(...)` for
 * every page — and discovery read neither, then dropped each route with no record.
 *
 * Silent under-discovery is the worst failure a generator can have, because no
 * skip report can mention a route nothing knew existed. This fixture reproduces
 * that app's shape; the tests hold both fixes: the shape is now read, and what
 * still cannot be read is reported.
 */

const ROOT = fileURLToPath(new URL('../fixtures/data-router-app/src', import.meta.url));

const CONFIG: GeneratorConfig = {
  appRoot: ROOT,
  routesFile: 'app/router.tsx',
  roleSetExport: 'ROUTE_ROLES',
  allRolesExport: 'APP_ROLES',
  manifests: [],
  localesDir: null,
  languages: ['en'],
};

describe('discoverRoutes — the data-router shape', () => {
  it('reads paths from a path table imported through a tsconfig alias', () => {
    const { routes } = discoverRoutes(CONFIG);
    expect(routes.map((r) => r.path).sort()).toEqual(['/', '/app', '/app/reports', '/app/reports/:reportId']);
  });

  it('follows `lazy` imports to the page file — relative and through the alias', () => {
    const { routes } = discoverRoutes(CONFIG);
    const byPath = new Map(routes.map((r) => [r.path, r]));
    expect(byPath.get('/')?.component).toBe('Landing');
    expect(byPath.get('/app/reports')?.componentFile).toMatch(/reports\.tsx$/);
    // This one is imported as '@/app/routes/app/report' — only the alias finds it.
    expect(byPath.get('/app/reports/:reportId')?.componentFile).toMatch(/report\.tsx$/);
  });

  /** The half that matters more: what it still cannot read, it says so. */
  it('reports a path it cannot evaluate instead of dropping it', () => {
    const { unreadable } = discoverRoutes(CONFIG);
    expect(unreadable).toEqual([
      { path: 'computed()', detail: expect.stringMatching(/cannot evaluate/) },
    ]);
  });

  it('still treats a catch-all as the app’s 404, not a destination and not a problem', () => {
    const { routes, unreadable } = discoverRoutes(CONFIG);
    expect(routes.some((r) => r.path.includes('*'))).toBe(false);
    expect(unreadable.some((u) => u.path.includes('*'))).toBe(false);
  });
});

describe('generate — an unreadable route reaches the skip report', () => {
  it('lists it with its own reason, where an adopter will see it', async () => {
    const output = await generate({ config: CONFIG });
    expect(output.skipped).toContainEqual(
      expect.objectContaining({ path: 'computed()', reason: 'unreadable-route' }),
    );
    expect(output.master.map((c) => c.route).sort()).toEqual(['/', '/app', '/app/reports', '/app/reports/:reportId']);
  });
});
