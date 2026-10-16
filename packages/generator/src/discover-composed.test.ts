import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { discoverRoutes } from './discover.ts';
import { generate } from './generate.ts';
import type { GeneratorConfig } from './types.ts';

/**
 * A route table composed from workspaces, each in its own module.
 *
 *   ...workspaces.flatMap((w) => w.routes).filter((r) => !r.fullscreen).map(({ element: Page, ...route }) => …)
 *
 * Found on a real app once its screens moved into installed workspaces: the route table spread
 * them in through a computed expression the scanner reported and stopped at, so a build saw a third
 * of the app. Each workspace declares its routes with a helper spread for the page
 * (`...page(() => import('./X'))`), guards them with a role table of its own (`SPORT_ROLES.x`), and
 * marks an entry that only redirects with `redirect: true`. Every one of those shapes is here.
 */

function app(files: Record<string, string>): GeneratorConfig {
  const appRoot = mkdtempSync(join(tmpdir(), 'nextgen-composed-'));
  for (const [name, source] of Object.entries(files)) {
    mkdirSync(dirname(join(appRoot, name)), { recursive: true });
    writeFileSync(join(appRoot, name), source, 'utf8');
  }
  return {
    appRoot,
    routesFile: 'routes.tsx',
    permissionsFile: 'permissions.ts',
    roleSetExport: 'ROUTE_ROLES',
    allRolesExport: 'APP_ROLES',
    manifests: [],
    localesDir: null,
    languages: ['en'],
  };
}

const page = (name: string): string => `export default function ${name}() { return <h1>${name}</h1> }`;

const PERMISSIONS = [
  "export const APP_ROLES = ['ADMIN', 'COACH', 'PARENT']",
  'const readRoles = (...roles) => [...roles]',
  'export const ROUTE_ROLES = {',
  "  staff: readRoles('COACH'),",
  "  adminOnly: readRoles('ADMIN'),",
  '}',
].join('\n');

/** The composition root, two workspaces, and the pages they name. */
const COMPOSED: Record<string, string> = {
  'permissions.ts': PERMISSIONS,
  'A.tsx': page('A'),
  'routes.tsx': [
    "import A from './A'",
    "import { ROUTE_ROLES } from './permissions'",
    "import { workspaces } from './workspaces'",
    'export const routes = [',
    "  { path: 'a', element: <A />, roles: ROUTE_ROLES.staff },",
    '  ...workspaces',
    '    .flatMap((workspace) => workspace.routes)',
    '    .filter((route) => !route.fullscreen)',
    '    .map(({ element: Page, module, ...route }) => ({ ...route, element: <Page />, module })),',
    ']',
  ].join('\n'),
  'workspaces.ts': ["import { club } from './club'", "import { sport } from './sport'", 'export const workspaces = [club, sport]'].join('\n'),

  // A workspace whose index re-exports it, whose routes are spread together from one file per area,
  // and whose pages come from a helper declared in a module of its own.
  'club/index.ts': "export { club } from './routes'",
  'club/routes.ts': [
    "import { listRoutes } from './routes/list'",
    "import { adminRoutes } from './routes/admin'",
    'const routes = [...listRoutes, ...adminRoutes] satisfies unknown[]',
    "export const club = { id: 'club', routes }",
  ].join('\n'),
  'club/routes/page.ts': [
    "import { lazy } from 'react'",
    'export function page(preload) {',
    '  return { element: lazy(preload), preload, prefetch: true as const }',
    '}',
  ].join('\n'),
  'club/routes/list.ts': [
    "import { ROUTE_ROLES } from '../../permissions'",
    "import { page } from './page'",
    'export const listRoutes = [',
    "  { path: 'list', ...page(() => import('../pages/ListPage')), roles: [...ROUTE_ROLES.staff] },",
    "  { path: 'open', ...page(() => import('../pages/OpenPage')) },",
    ']',
  ].join('\n'),
  'club/routes/admin.ts': [
    "import { ROUTE_ROLES } from '../../permissions'",
    "import { page } from './page'",
    'export const adminRoutes = [',
    "  { path: 'admin', ...page(() => import('../pages/AdminPage')), roles: [...ROUTE_ROLES.adminOnly] },",
    "  { path: 'old/:id', redirect: true, ...page(() => import('../pages/OldRedirect')), roles: [...ROUTE_ROLES.adminOnly] },",
    ']',
  ].join('\n'),
  'club/pages/ListPage.tsx': page('ListPage'),
  'club/pages/OpenPage.tsx': page('OpenPage'),
  'club/pages/AdminPage.tsx': page('AdminPage'),
  'club/pages/OldRedirect.tsx': page('OldRedirect'),

  // A workspace with a role table of its own — one key named like a key of the core table, with
  // other roles — a local page helper, a `lazy(...)` component, a fullscreen route, and a list of
  // deep links that carry a path but are not routes.
  'sport/index.ts': "export { sport } from './routes'",
  'sport/permissions.ts': [
    'const readRoles = (...roles) => [...roles]',
    'export const SPORT_ROLES = {',
    "  live: readRoles('COACH'),",
    "  board: readRoles('COACH', 'PARENT'),",
    "  adminOnly: readRoles('COACH'),",
    '}',
  ].join('\n'),
  'sport/routes.ts': [
    "import { lazy } from 'react'",
    "import { SPORT_ROLES } from './permissions'",
    'function page(preload) {',
    '  return { element: lazy(preload), preload }',
    '}',
    'const routes = [',
    "  { path: 'board', ...page(() => import('./BoardPage')), roles: [...SPORT_ROLES.board] },",
    "  { path: 'live', component: lazy(() => import('./LivePage')), fullscreen: true, roles: SPORT_ROLES.live },",
    "  { path: 'collide', ...page(() => import('./CollidePage')), roles: SPORT_ROLES.adminOnly },",
    ']',
    "const deepLinks = [{ path: '/not-a-route', roles: ['PARENT'], reason: 'reachable from a link' }]",
    "export const sport = { id: 'sport', routes, deepLinks }",
  ].join('\n'),
  'sport/BoardPage.tsx': page('BoardPage'),
  'sport/LivePage.tsx': page('LivePage'),
  'sport/CollidePage.tsx': page('CollidePage'),
};

describe('a route table composed from workspaces in other modules', () => {
  const found = () => discoverRoutes(app(COMPOSED));
  const at = (path: string) => found().routes.find((route) => route.path === path);

  it('follows the flat-mapped, filtered and mapped spread into every workspace’s routes', () => {
    const { routes, unreadable } = found();
    // The fullscreen route is a screen too: the filter set it aside for another table, not away.
    expect(routes.map((r) => r.path).sort()).toEqual(['/a', '/admin', '/board', '/collide', '/list', '/live', '/open']);
    expect(unreadable.filter((u) => u.reason !== 'declared-redirect')).toEqual([]);
  });

  it('never takes a workspace’s deep links, which carry a path, for routes', () => {
    expect(at('/not-a-route')).toBeUndefined();
  });

  it('takes the lazy import a page helper puts into the element as the screen’s component', () => {
    expect(at('/list')?.componentFile).toMatch(/club[\\/]pages[\\/]ListPage\.tsx$/);
    expect(at('/list')?.component).toBe('ListPage');
    expect(at('/board')?.componentFile).toMatch(/sport[\\/]BoardPage\.tsx$/);
  });

  it('reads `component: lazy(() => import(…))` as the lazy page', () => {
    expect(at('/live')?.componentFile).toMatch(/sport[\\/]LivePage\.tsx$/);
    expect(at('/live')?.component).toBe('LivePage');
  });

  it('reads a role set through the import of the module the route is written in', () => {
    expect(at('/list')?.roles).toEqual(['COACH']);
    expect(at('/admin')?.roles).toEqual(['ADMIN']);
    expect(at('/board')?.roles).toEqual(['COACH', 'PARENT']);
    expect(at('/live')?.roles).toEqual(['COACH']);
  });

  it('never answers a workspace’s own role set with the core table’s key of the same name', () => {
    // `SPORT_ROLES.adminOnly` is COACH; the core table's `adminOnly` is ADMIN.
    expect(at('/collide')?.roles).toEqual(['COACH']);
  });

  it('gives a route with no guard every role, as an unguarded route in the table itself has', () => {
    expect(at('/open')?.roles).toEqual(['ADMIN', 'COACH', 'PARENT']);
  });

  it('skips a `redirect: true` entry as no screen, and says so', () => {
    expect(at('/old/:id')).toBeUndefined();
    expect(found().unreadable).toContainEqual(expect.objectContaining({ path: '/old/:id', reason: 'declared-redirect' }));
  });

  it('ships each followed screen only to the roles its guard allows', async () => {
    const output = await generate({ config: app(COMPOSED), model: null });
    const routesFor = (role: string) =>
      output.registries.get(role)!.capabilities.filter((c) => c.kind !== 'unsupported').map((c) => c.route);
    expect(routesFor('ADMIN')).toContain('/admin');
    expect(routesFor('PARENT')).not.toContain('/admin');
    expect(routesFor('PARENT')).not.toContain('/collide');
    expect(routesFor('ADMIN')).not.toContain('/collide');
    expect(routesFor('PARENT')).toContain('/board');
    expect(output.skipped).toContainEqual(expect.objectContaining({ path: '/old/:id', reason: 'declared-redirect' }));
  });
});

describe('the other array steps a composition root uses', () => {
  const sources = (spread: string): Record<string, string> => ({
    'permissions.ts': PERMISSIONS,
    'A.tsx': page('A'),
    'B.tsx': page('B'),
    'routes.tsx': [
      "import A from './A'",
      "import { workspaces } from './workspaces'",
      `export const routes = [{ path: 'a', element: <A /> }, ${spread}]`,
    ].join('\n'),
    'workspaces.tsx': [
      "import { lazy } from 'react'",
      "import { ROUTE_ROLES } from './permissions'",
      "const one = { routes: [{ path: 'b', element: lazy(() => import('./B')), roles: ROUTE_ROLES.adminOnly }] }",
      'export const workspaces = [one]',
    ].join('\n'),
  });
  const paths = (spread: string) => discoverRoutes(app(sources(spread))).routes.map((r) => r.path).sort();

  it('follows `.map((w) => w.routes).flat()`', () => {
    expect(paths('...workspaces.map((w) => w.routes).flat()')).toEqual(['/a', '/b']);
  });

  it('follows a destructured projection, `.flatMap(({ routes }) => routes)`', () => {
    expect(paths('...workspaces.flatMap(({ routes }) => routes)')).toEqual(['/a', '/b']);
  });

  it('reads `element: lazy(() => import(…))` as the lazy page', () => {
    const route = discoverRoutes(app(sources('...workspaces.flatMap((w) => w.routes)'))).routes.find((r) => r.path === '/b');
    expect(route?.componentFile).toMatch(/B\.tsx$/);
    expect(route?.roles).toEqual(['ADMIN']);
  });
});

describe('a composed spread that would change who reaches a route is reported, not followed', () => {
  const sources = (map: string): Record<string, string> => ({
    'permissions.ts': PERMISSIONS,
    'A.tsx': page('A'),
    'B.tsx': page('B'),
    'routes.tsx': [
      "import A from './A'",
      "import { workspaces } from './workspaces'",
      `export const routes = [{ path: 'a', element: <A /> }, ...workspaces.flatMap((w) => w.routes).map(${map})]`,
    ].join('\n'),
    'workspaces.tsx': [
      "import B from './B'",
      "import { ROUTE_ROLES } from './permissions'",
      "export const workspaces = [{ routes: [{ path: 'b', element: <B />, roles: ROUTE_ROLES.adminOnly }] }]",
    ].join('\n'),
  });

  it.each([
    ['drops the guard', '({ roles, ...route }) => route'],
    ['drops the guard and keeps the rest', '({ roles, ...route }) => ({ ...route })'],
    ['moves the route', "(route) => ({ ...route, path: 'elsewhere' })"],
    ['writes a guard of its own', "(route) => ({ ...route, roles: ['PARENT'] })"],
    ['builds the route from scratch', '(route) => ({ path: route.path, element: route.element })'],
  ])('a .map that %s', (_why, map) => {
    const found = discoverRoutes(app(sources(map)));
    expect(found.routes.map((r) => r.path)).toEqual(['/a']);
    const spread = found.unreadable.filter((u) => u.path.includes('workspaces.flatMap'));
    expect(spread).toHaveLength(1);
    expect(spread[0]!.detail).toMatch(/\.map/);
  });
});

describe('a helper spread into a route entry', () => {
  const sources = (entry: string, helpers: string): Record<string, string> => ({
    'permissions.ts': PERMISSIONS,
    'X.tsx': page('X'),
    'data.ts': 'export const data = 1',
    'helpers.ts': helpers,
    'routes.tsx': [
      "import { lazy } from 'react'",
      "import { ROUTE_ROLES } from './permissions'",
      "import { guarded, withData, secured } from './helpers'",
      `export const routes = [${entry}]`,
    ].join('\n'),
  });
  const HELPERS = [
    "import { lazy } from 'react'",
    'export const withData = (load) => ({ loader: load })',
    'export const secured = (roles, load) => ({ roles, element: lazy(load) })',
    'export const guarded = makeGuard()',
  ].join('\n');
  const route = (entry: string) => discoverRoutes(app(sources(entry, HELPERS))).routes.find((r) => r.path === '/x');

  it('leaves the roles in doubt when the helper cannot be read, since it could carry a guard', () => {
    expect(route("{ path: 'x', element: lazy(() => import('./X')), ...guarded() }")?.roles).toBeNull();
  });

  it('trusts a guard written after the spread, which wins over anything the spread set', () => {
    expect(route("{ path: 'x', element: lazy(() => import('./X')), ...guarded(), roles: ROUTE_ROLES.staff }")?.roles).toEqual(['COACH']);
  });

  it('reads the guard a helper takes as its argument, in the module of the route', () => {
    const found = route("{ path: 'x', ...secured(ROUTE_ROLES.adminOnly, () => import('./X')) }");
    expect(found?.roles).toEqual(['ADMIN']);
    expect(found?.componentFile).toMatch(/X\.tsx$/);
  });

  it('never takes an import the helper does not put into the element for the page', () => {
    const found = discoverRoutes(app(sources("{ path: 'x', ...withData(() => import('./data')) }", HELPERS)));
    expect(found.routes.find((r) => r.path === '/x')).toBeUndefined();
    expect(found.unreadable).toContainEqual(expect.objectContaining({ path: '/x', detail: expect.stringMatching(/no element/) }));
  });
});
