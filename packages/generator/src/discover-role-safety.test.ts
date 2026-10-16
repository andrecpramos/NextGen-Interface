import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { discoverRoutes } from './discover.ts';
import { generate } from './generate.ts';
import type { GeneratorConfig } from './types.ts';

/**
 * Route shapes that once offered a screen to every role while the application guards it (Rule 17).
 *
 * Each came from an independent review of the scanner: a `.filter` looked through while its
 * complement sat under a guarded parent, a pack's own role table answered with the core table's
 * key, a guard wrapper taken for the lazy page it wraps, a parameter read as the module-level name
 * it shadows, a cycle between two modules' tables, and a helper or computed key whose effect on the
 * guard was ignored. Every one must come out unresolved (`roles: null`), reported or absent — never
 * open to a role the application refuses.
 */

const ALL = ['ADMIN', 'COACH', 'PARENT'];

function app(files: Record<string, string>): GeneratorConfig {
  const appRoot = mkdtempSync(join(tmpdir(), 'nextgen-role-safety-'));
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

const BASE: Record<string, string> = {
  'permissions.ts': [
    "export const APP_ROLES = ['ADMIN', 'COACH', 'PARENT']",
    'const readRoles = (...roles) => [...roles]',
    "export const ROUTE_ROLES = { staff: readRoles('COACH'), adminOnly: readRoles('ADMIN'), wide: readRoles('ADMIN', 'COACH', 'PARENT') }",
  ].join('\n'),
  'X.tsx': page('X'),
  'Y.tsx': page('Y'),
  'Guard.tsx': 'export function ProtectedRoute() { return null }',
};

function discover(files: Record<string, string>) {
  return discoverRoutes(app({ ...BASE, ...files }));
}

const rolesOf = (found: ReturnType<typeof discover>, path: string) => found.routes.find((route) => route.path === path)?.roles;

describe('a .filter whose complement is spread under a guarded parent', () => {
  const LIST = [
    "import X from './X'",
    "import Y from './Y'",
    "export const extra = [{ path: 'secret', element: <X />, adminArea: true }, { path: 'pub', element: <Y /> }]",
  ].join('\n');

  it('is reported, not looked through — and neither half reaches every role', () => {
    const found = discover({
      'list.tsx': LIST,
      'routes.tsx': [
        "import { ProtectedRoute } from './Guard'",
        "import { extra } from './list'",
        'export const routes = [',
        "  { element: <ProtectedRoute allowedRoles={['ADMIN']} />, children: [...extra.filter((r) => r.adminArea)] },",
        '  ...extra.filter((r) => !r.adminArea),',
        ']',
      ].join('\n'),
    });
    expect(rolesOf(found, '/secret')).toBeUndefined();
    expect(rolesOf(found, '/pub')).toBeUndefined();
    expect(found.unreadable.map((u) => u.path)).toEqual(
      expect.arrayContaining(['...extra.filter((r) => r.adminArea)', '...extra.filter((r) => !r.adminArea)']),
    );
    expect(found.unreadable.find((u) => u.path === '...extra.filter((r) => r.adminArea)')?.detail).toMatch(/nested route/);
    expect(found.unreadable.find((u) => u.path === '...extra.filter((r) => !r.adminArea)')?.detail).toMatch(/\.filter/);
  });

  it('is refused when the filter is declared in another module, under a name of its own', () => {
    const found = discover({
      'list.tsx': `${LIST}\nexport const openRoutes = extra.filter((r) => !r.adminArea)`,
      'routes.tsx': [
        "import { ProtectedRoute } from './Guard'",
        "import { extra, openRoutes } from './list'",
        'export const routes = [',
        "  { element: <ProtectedRoute allowedRoles={['ADMIN']} />, children: [...extra.filter((r) => r.adminArea)] },",
        '  ...openRoutes,',
        ']',
      ].join('\n'),
    });
    expect(rolesOf(found, '/secret')).toBeUndefined();
    expect(rolesOf(found, '/pub')).toBeUndefined();
  });

  it('is refused when the guarded parent is only found in a module followed after the filter', () => {
    const found = discover({
      'list.tsx': LIST,
      'admin.tsx': [
        "import { ProtectedRoute } from './Guard'",
        "import { extra } from './list'",
        "export const adminArea = [{ element: <ProtectedRoute allowedRoles={['ADMIN']} />, children: [...extra.filter((r) => r.adminArea)] }]",
      ].join('\n'),
      'routes.tsx': [
        "import { extra } from './list'",
        "import { adminArea } from './admin'",
        "export const routes = [{ path: 'a', element: <div /> }, ...extra.filter((r) => !r.adminArea), ...adminArea]",
      ].join('\n'),
    });
    expect(rolesOf(found, '/secret')).toBeUndefined();
    expect(rolesOf(found, '/pub')).toBeUndefined();
  });

  it.each([
    ['a filter written out', "children: extra.filter((r) => r.adminArea)", "import { extra } from './list'"],
    ['a name for a filtered array', 'children: adminOnly', "import { extra, adminOnly } from './list'"],
  ])('is refused, and the children reported, when they are given as %s rather than spread', (_, children, imports) => {
    const found = discover({
      'list.tsx': `${LIST}\nexport const adminOnly = extra.filter((r) => r.adminArea)`,
      'routes.tsx': [
        "import { ProtectedRoute } from './Guard'",
        imports,
        'export const routes = [',
        `  { element: <ProtectedRoute allowedRoles={['ADMIN']} />, ${children} },`,
        '  ...extra.filter((r) => !r.adminArea),',
        ']',
      ].join('\n'),
    });
    expect(rolesOf(found, '/secret')).toBeUndefined();
    expect(rolesOf(found, '/pub')).toBeUndefined();
    expect(found.unreadable.find((u) => u.path === children)?.detail).toMatch(/nested route's children/);
    expect(found.unreadable.find((u) => u.path === '...extra.filter((r) => !r.adminArea)')?.detail).toMatch(/\.filter/);
  });

  it('still looks through a filter over routes no nested route spreads: an unguarded entry reaches every role', () => {
    const found = discover({
      'list.tsx': LIST,
      'routes.tsx': [
        "import { extra } from './list'",
        "export const routes = [{ path: 'a', element: <div /> }, ...extra.filter((r) => !r.adminArea)]",
      ].join('\n'),
    });
    expect(rolesOf(found, '/pub')).toEqual(ALL);
  });
});

describe('the configured role table, when a key cannot be read', () => {
  it('never answers a pack’s own table of the same name with the core table’s key', () => {
    const found = discover({
      'pack/perms.ts': [
        'const except = (all, role) => all.filter((r) => r !== role)',
        "export const ROUTE_ROLES = { wide: except(['ADMIN', 'COACH', 'PARENT'], 'PARENT') }",
      ].join('\n'),
      'pack/routes.tsx': [
        "import X from '../X'",
        "import { ROUTE_ROLES } from './perms'",
        "export const packRoutes = [{ path: 'p', element: <X />, roles: ROUTE_ROLES.wide }]",
      ].join('\n'),
      'routes.tsx': "import { packRoutes } from './pack/routes'\nexport const routes = [{ path: 'a', element: <div /> }, ...packRoutes]",
    });
    expect(rolesOf(found, '/p')).toBeNull();
  });

  it('never answers a table imported under that name from a module the scanner cannot read', () => {
    const found = discover({
      'pack/routes.tsx': [
        "import X from '../X'",
        "import { SPORT_ROLES as ROUTE_ROLES } from 'some-external-pkg'",
        "export const packRoutes = [{ path: 'p', element: <X />, roles: ROUTE_ROLES.wide }]",
      ].join('\n'),
      'routes.tsx': "import { packRoutes } from './pack/routes'\nexport const routes = [{ path: 'a', element: <div /> }, ...packRoutes]",
    });
    expect(rolesOf(found, '/p')).toBeNull();
  });

  it('never answers the route module’s own table of that name', () => {
    const found = discover({
      'routes.tsx': [
        "import X from './X'",
        'const narrowed = (roles) => roles.slice(1)',
        "const ROUTE_ROLES = { wide: narrowed(['ADMIN', 'COACH', 'PARENT']) }",
        "export const routes = [{ path: 'p', element: <X />, roles: ROUTE_ROLES.wide }]",
      ].join('\n'),
    });
    expect(rolesOf(found, '/p')).toBeNull();
  });
});

describe('a wrapper around a lazy loader', () => {
  const withPages = (routes: string) => ({ 'routes.tsx': routes });

  it.each([
    ['a guard wrapper', "export const routes = [{ path: 'adm', element: requireAdmin(() => import('./X')) }]"],
    ['a curried guard wrapper', "export const routes = [{ path: 'adm', Component: withRole('ADMIN')(() => import('./X')) }]"],
  ])('is not the page when it is %s: the route ships to no role', async (_, routes) => {
    const config = app({ ...BASE, ...withPages(routes) });
    expect(discoverRoutes(config).routes.find((route) => route.path === '/adm')?.component).toBeNull();
    const output = await generate({ config, model: null });
    expect(output.master.find((capability) => capability.route === '/adm')).toBeUndefined();
    expect(output.skipped.find((skip) => skip.path === '/adm')?.reason).toBe('no-component');
  });

  it.each([
    ['lazy', "import { lazy } from 'react'\nexport const routes = [{ path: 'p', element: lazy(() => import('./X')) }]"],
    ['React.lazy', "import React from 'react'\nexport const routes = [{ path: 'p', element: React.lazy(() => import('./X')) }]"],
    ['defineAsyncComponent', "import { defineAsyncComponent } from 'vue'\nexport const routes = [{ path: 'p', component: defineAsyncComponent(() => import('./X')) }]"],
  ])('is the page when it is %s', (_, routes) => {
    const found = discover(withPages(routes));
    expect(found.routes.find((route) => route.path === '/p')?.component).toBe('X');
  });

  it('written by a helper around its own parameter, leaves the route unresolved, never open', () => {
    const found = discover({
      'helpers.tsx': 'export function adminPage(load) { return { element: requireAdmin(load) } }',
      'routes.tsx': "import { adminPage } from './helpers'\nexport const routes = [{ path: 'adm', ...adminPage(() => import('./X')) }]",
    });
    expect(rolesOf(found, '/adm') ?? null).toBeNull();
  });
});

describe('a name a function or block declares again', () => {
  it.each([
    ['shorthand', 'roles'],
    ['written out', 'roles: roles'],
  ])('is not the module-level name (%s)', (_, written) => {
    const found = discover({
      'routes.tsx': [
        "import X from './X'",
        "const roles = ['ADMIN', 'COACH', 'PARENT']",
        `export function make(roles) { return [{ path: 'shadow', element: <X />, ${written} }] }`,
        "export const routes = [{ path: 'a', element: <div />, roles }]",
      ].join('\n'),
    });
    expect(rolesOf(found, '/shadow')).toBeNull();
    expect(rolesOf(found, '/a')).toEqual(ALL);
  });

  it('is not the module-level name when a local declares it', () => {
    const found = discover({
      'routes.tsx': [
        "import X from './X'",
        "const roles = ['ADMIN', 'COACH', 'PARENT']",
        "export function make() { const roles = currentRoles(); return [{ path: 'shadow', element: <X />, roles }] }",
      ].join('\n'),
    });
    expect(rolesOf(found, '/shadow')).toBeNull();
  });

  it('is not the configured role table when a parameter takes its name', () => {
    const found = discover({
      'routes.tsx': [
        "import X from './X'",
        "import { ROUTE_ROLES } from './permissions'",
        "export function make(ROUTE_ROLES) { return [{ path: 'shadow', element: <X />, roles: ROUTE_ROLES.wide }] }",
      ].join('\n'),
    });
    expect(rolesOf(found, '/shadow')).toBeNull();
  });

  it('is not the module-level name in a guard’s props, so the routes beneath it are unresolved', () => {
    const found = discover({
      'routes.tsx': [
        "import X from './X'",
        "import { ProtectedRoute } from './Guard'",
        "const roles = ['ADMIN', 'COACH', 'PARENT']",
        "export function make(roles) { return [{ element: <ProtectedRoute allowedRoles={roles} />, children: [{ path: 'inner', element: <X /> }] }] }",
      ].join('\n'),
    });
    expect(rolesOf(found, '/inner')).toBeNull();
  });
});

describe('role tables that refer to each other', () => {
  it('ends a cycle through two modules’ tables as unresolved, without overflowing the stack', () => {
    const found = discover({
      'A.ts': "import { S } from './B'\nexport const R = { a: [...S.b] }",
      'B.ts': "import { R } from './A'\nexport const S = { b: [...R.a] }",
      'routes.tsx': "import X from './X'\nimport { R } from './A'\nexport const routes = [{ path: 'cyc', element: <X />, roles: R.a }]",
    });
    expect(rolesOf(found, '/cyc')).toBeNull();
  });
});

describe('a guard something unread may have set', () => {
  it('leaves the children of a parent with a spread that cannot be read unresolved', () => {
    const found = discover({
      'routes.tsx': [
        "import X from './X'",
        "import { adminLayout } from 'external-layouts'",
        "export const routes = [{ path: 'admin', ...adminLayout(), children: [{ path: 'users', element: <X /> }] }]",
      ].join('\n'),
    });
    expect(rolesOf(found, '/admin/users')).toBeNull();
  });

  it('leaves such a child unresolved even when it names roles of its own', () => {
    const found = discover({
      'routes.tsx': [
        "import X from './X'",
        "import { adminLayout } from 'external-layouts'",
        "import { ROUTE_ROLES } from './permissions'",
        "export const routes = [{ path: 'admin', ...adminLayout(), children: [{ path: 'users', element: <X />, roles: ROUTE_ROLES.wide }] }]",
      ].join('\n'),
    });
    expect(rolesOf(found, '/admin/users')).toBeNull();
  });

  it('leaves a child that names roles of its own unresolved under a guard that cannot be read', () => {
    const found = discover({
      'routes.tsx': [
        "import X from './X'",
        "import { ProtectedRoute } from './Guard'",
        "import { ROUTE_ROLES } from './permissions'",
        "export const routes = [{ element: <ProtectedRoute allowedRoles={rolesFromServer()} />, children: [{ path: 'users', element: <X />, roles: ROUTE_ROLES.wide }] }]",
      ].join('\n'),
    });
    expect(rolesOf(found, '/users')).toBeNull();
  });

  it('leaves a route, and its children, unresolved when a helper writes an element of its own', () => {
    const found = discover({
      'helpers.tsx': [
        "import { ProtectedRoute } from './Guard'",
        "export function adminOnly() { return { element: <ProtectedRoute allowedRoles={['ADMIN']} /> } }",
      ].join('\n'),
      'routes.tsx': [
        "import X from './X'",
        "import { adminOnly } from './helpers'",
        "export const routes = [{ path: 'admin', element: <div />, ...adminOnly(), children: [{ path: 'users', element: <X /> }] }]",
      ].join('\n'),
    });
    expect(rolesOf(found, '/admin')).toBeNull();
    expect(rolesOf(found, '/admin/users')).toBeNull();
  });

  it.each([
    ['a getter', 'get roles() { return ALL }'],
    ['a method', 'roles() { return ALL }'],
    ['a computed key', '[K]: ALL'],
    ['a path of its own', "path: 'elsewhere'"],
  ])('leaves the route unresolved when a helper has %s', (_, member) => {
    const found = discover({
      'helpers.ts': [
        "import { lazy } from 'react'",
        "const ALL = ['ADMIN', 'COACH', 'PARENT']",
        "const K = 'roles'",
        `export function page(load) { return { element: lazy(load), ${member} } }`,
      ].join('\n'),
      'routes.tsx': "import { page } from './helpers'\nexport const routes = [{ path: 'g', roles: ['ADMIN'], ...page(() => import('./X')) }]",
    });
    expect(rolesOf(found, '/g')).toBeNull();
  });

  it('leaves the route unresolved when the entry itself has a computed key', () => {
    const found = discover({
      'routes.tsx': "import X from './X'\nconst K = 'roles'\nexport const routes = [{ path: 'c', element: <X />, [K]: ['ADMIN'] }]",
    });
    expect(rolesOf(found, '/c')).toBeNull();
  });

  it('still reads a helper that only gives the route its lazy page, and the roles written after it', () => {
    const found = discover({
      'helpers.ts': "import { lazy } from 'react'\nexport function page(load) { return { element: lazy(load), preload: load, prefetch: true } }",
      'routes.tsx': [
        "import { page } from './helpers'",
        "import { ROUTE_ROLES } from './permissions'",
        "export const routes = [{ path: 'p', ...page(() => import('./X')), roles: ROUTE_ROLES.staff }]",
      ].join('\n'),
    });
    expect(found.routes.find((route) => route.path === '/p')).toMatchObject({ component: 'X', roles: ['COACH'] });
  });
});

/** The route's page, as `generate` ships it: absent from every registry, and why. */
async function shipped(files: Record<string, string>, path: string) {
  const config = app({ ...BASE, ...files });
  const output = await generate({ config, model: null });
  return {
    capability: output.master.find((capability) => capability.route === path),
    skipped: output.skipped.find((skip) => skip.path === path)?.reason,
    route: discoverRoutes(config).routes.find((route) => route.path === path),
  };
}

describe('a loader that does something to the page it loads', () => {
  const GUARDED_THEN = "() => import('./X').then((m) => ({ default: requireAdmin(m.default) }))";

  it.each([
    ['inline', `import { lazy } from 'react'\nexport const routes = [{ path: 'adm', element: lazy(${GUARDED_THEN}) }]`],
    ['as a constant', `import { lazy } from 'react'\nconst Adm = lazy(${GUARDED_THEN})\nexport const routes = [{ path: 'adm', element: <Adm /> }]`],
    ['as a constant wrapping the loader', "const Adm = requireAdmin(() => import('./X'))\nexport const routes = [{ path: 'adm', element: <Adm /> }]"],
    ['around the import itself', "import { lazy } from 'react'\nexport const routes = [{ path: 'adm', element: lazy(() => withGuard(import('./X'))) }]"],
  ])('is not read as the page (%s): the route ships to no role', async (_, routes) => {
    const { capability, skipped, route } = await shipped({ 'routes.tsx': routes }, '/adm');
    expect(capability).toBeUndefined();
    expect(skipped).toBe('no-component');
    expect(route?.component).toBeNull();
  });

  it('is reported, and not read, as a route’s own lazy loader', async () => {
    const found = discover({
      'routes.tsx': "export const routes = [{ path: 'adm', lazy: () => import('./X').then((m) => ({ Component: requireAdmin(m.default) })) }]",
    });
    expect(rolesOf(found, '/adm')).toBeUndefined();
    expect(found.unreadable.find((u) => u.path === '/adm')?.detail).toMatch(/lazy loader does more than import the page/);
  });

  it.each([
    ['({ X }) => ({ default: X })'],
    ['({ X: Page }) => ({ default: Page })'],
    ['(m) => ({ default: m.X })'],
    ['(m) => ({ default: m.default })'],
  ])('is still the page when the callback only picks it out: %s', (callback) => {
    const found = discover({
      'X.tsx': 'export function X() { return <h1>X</h1> }\nexport default X',
      'routes.tsx': `import { lazy } from 'react'\nexport const routes = [{ path: 'p', element: lazy(() => import('./X').then(${callback})) }]`,
    });
    expect(found.routes.find((route) => route.path === '/p')?.componentFile).toMatch(/X\.tsx$/);
  });
});

describe('a lazy that is not React’s, or a defineAsyncComponent that is not Vue’s', () => {
  it.each([
    ['imported from the app’s own module', "import { lazy } from './guards'\nexport const routes = [{ path: 'adm', element: lazy(() => import('./X')) }]"],
    ['declared in the route module', "const lazy = (load) => requireAdmin(load)\nexport const routes = [{ path: 'adm', element: lazy(() => import('./X')) }]"],
    ['not imported at all', "export const routes = [{ path: 'adm', element: lazy(() => import('./X')) }]"],
    ['a React that is not react', "import React from './guards'\nexport const routes = [{ path: 'adm', element: React.lazy(() => import('./X')) }]"],
    ['a defineAsyncComponent of the app’s own', "import { defineAsyncComponent } from './guards'\nexport const routes = [{ path: 'adm', component: defineAsyncComponent(() => import('./X')) }]"],
  ])('is not the page when it is %s', async (_, routes) => {
    const { capability, route } = await shipped(
      { 'guards.ts': 'export const lazy = (load) => load\nexport const defineAsyncComponent = (load) => load\nexport default { lazy: (load) => load }', 'routes.tsx': routes },
      '/adm',
    );
    expect(capability).toBeUndefined();
    expect(route?.component ?? null).toBeNull();
  });

  it.each([
    ['an aliased import', "import { lazy as load } from 'react'\nexport const routes = [{ path: 'p', element: load(() => import('./X')) }]"],
    ['React’s namespace', "import * as React from 'react'\nexport const routes = [{ path: 'p', element: React.lazy(() => import('./X')) }]"],
  ])('is the page through %s', (_, routes) => {
    const found = discover({ 'routes.tsx': routes });
    expect(found.routes.find((route) => route.path === '/p')?.component).toBe('X');
  });
});

describe('a child under a parent whose roles can be read', () => {
  it('reaches only the roles its parent’s roles allow', () => {
    const found = discover({
      'routes.tsx': [
        "import X from './X'",
        "export const routes = [{ path: 'admin', element: <div />, roles: ['ADMIN'], children: [{ path: 'users', element: <X /> }] }]",
      ].join('\n'),
    });
    expect(rolesOf(found, '/admin/users')).toEqual(['ADMIN']);
  });

  it('never reaches more than every ancestor allows, whatever roles it names itself', () => {
    const found = discover({
      'routes.tsx': [
        "import X from './X'",
        "import Y from './Y'",
        "import { ProtectedRoute } from './Guard'",
        "import { ROUTE_ROLES } from './permissions'",
        'export const routes = [',
        "  { path: 'admin', element: <div />, roles: ['ADMIN', 'COACH'], children: [",
        "    { element: <ProtectedRoute allowedRoles={['ADMIN']} />, children: [{ path: 'users', element: <X />, roles: ROUTE_ROLES.wide }] },",
        "    { path: 'staff', element: <Y />, roles: ROUTE_ROLES.wide },",
        '  ] },',
        ']',
      ].join('\n'),
    });
    expect(rolesOf(found, '/admin/users')).toEqual(['ADMIN']);
    expect(rolesOf(found, '/admin/staff')).toEqual(['ADMIN', 'COACH']);
  });

  it('is unresolved when a parent’s roles cannot be read', () => {
    const found = discover({
      'routes.tsx': [
        "import X from './X'",
        "export const routes = [{ path: 'admin', element: <div />, roles: rolesFromServer(), children: [{ path: 'users', element: <X /> }] }]",
      ].join('\n'),
    });
    expect(rolesOf(found, '/admin/users')).toBeNull();
  });
});
