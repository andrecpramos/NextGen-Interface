import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { discoverRoutes } from './discover.ts';
import { generate } from './generate.ts';
import type { GeneratorConfig } from './types.ts';

/**
 * Routes spread into the route table from somewhere else.
 *
 *   export const routes = [ { path: '/a', element: <A /> }, ...extraRoutes, ...workspaces.flatMap(w => w.routes) ]
 *
 * Found by running the scanner on a real app whose route table ends `...workspaces`. A spread of an
 * imported array was not followed and a computed one was not read — and **neither was reported**: the
 * routes simply were not there, and `SKIPPED.md` said nothing. That is the worst failure a
 * generator can have: under-discovery that no skip report can mention. A spread now either is followed, into the module that
 * declares it, or is reported with the expression quoted.
 */

function app(files: Record<string, string>): GeneratorConfig {
  const appRoot = mkdtempSync(join(tmpdir(), 'nextgen-spread-'));
  for (const [name, source] of Object.entries({
    'A.tsx': 'export default function A() { return <h1>Ay</h1> }',
    'B.tsx': 'export default function B() { return <h1>Bee</h1> }',
    'C.tsx': 'export default function C() { return <h1>See</h1> }',
    ...files,
  })) {
    mkdirSync(dirname(join(appRoot, name)), { recursive: true });
    writeFileSync(join(appRoot, name), source, 'utf8');
  }
  return { appRoot, routesFile: 'routes.tsx', roleSetExport: 'ROUTE_ROLES', allRolesExport: 'APP_ROLES', manifests: [], localesDir: null, languages: ['en'] };
}

const paths = (config: GeneratorConfig) => discoverRoutes(config).routes.map((r) => r.path).sort();

describe('a spread of an imported array of routes', () => {
  const config = () =>
    app({
      'routes.tsx': [
        "import A from './A'",
        "import { extraRoutes } from './extra'",
        'export const routes = [',
        "  { path: '/a', element: <A /> },",
        '  ...extraRoutes,',
        ']',
      ].join('\n'),
      'extra.tsx': ["import B from './B'", "export const extraRoutes = [{ path: '/b', element: <B /> }]"].join('\n'),
    });

  it('is followed into the module that declares it, with that module’s own imports', () => {
    const found = discoverRoutes(config());
    expect(found.routes.map((r) => r.path).sort()).toEqual(['/a', '/b']);
    expect(found.routes.find((r) => r.path === '/b')?.componentFile).toMatch(/B\.tsx$/);
    expect(found.unreadable).toEqual([]);
  });

  it('gives the followed routes the roles an unguarded route has', () => {
    const found = discoverRoutes(config());
    expect(found.routes.find((r) => r.path === '/b')?.roles).toEqual(found.routes.find((r) => r.path === '/a')?.roles);
  });

  it('follows a chain of them, and stops at a cycle', () => {
    const chained = app({
      'routes.tsx': ["import A from './A'", "import { one } from './one'", 'export const routes = [{ path: "/a", element: <A /> }, ...one]'].join('\n'),
      'one.tsx': ["import B from './B'", "import { two } from './two'", 'export const one = [{ path: "/b", element: <B /> }, ...two]'].join('\n'),
      'two.tsx': ["import C from './C'", "import { one } from './one'", 'export const two = [{ path: "/c", element: <C /> }, ...one]'].join('\n'),
    });
    expect(paths(chained)).toEqual(['/a', '/b', '/c']);
  });

  it('does not report a conditional spread whose routes are written out right there', () => {
    const conditional = app({
      'routes.tsx': [
        "import A from './A'",
        'export const routes = [',
        "  { path: '/a', element: <A /> },",
        "  ...(import.meta.env.DEV ? [{ path: '/dev', element: <A /> }] : []),",
        ']',
      ].join('\n'),
    });
    const found = discoverRoutes(conditional);
    expect(found.routes.map((r) => r.path).sort()).toEqual(['/a', '/dev']);
    expect(found.unreadable).toEqual([]);
  });

  it('still reads an array declared in the same file, as it always has', () => {
    const local = app({
      'routes.tsx': [
        "import A from './A'",
        "import B from './B'",
        'const more = [{ path: "/b", element: <B /> }]',
        'export const routes = [{ path: "/a", element: <A /> }, ...more]',
      ].join('\n'),
    });
    const found = discoverRoutes(local);
    expect(found.routes.map((r) => r.path).sort()).toEqual(['/a', '/b']);
    expect(found.unreadable).toEqual([]);
  });
});

describe('a spread that cannot be followed', () => {
  const dynamic = () =>
    app({
      'routes.tsx': [
        "import A from './A'",
        "import { workspaces } from './workspaces'",
        'export const routes = [',
        "  { path: '/a', element: <A /> },",
        // Routes a function builds at run time: no reading of the source can say which.
        '  ...workspaces.flatMap((workspace) => workspace.routesFor(currentUser)),',
        ']',
      ].join('\n'),
      'workspaces.tsx': 'export const workspaces = []',
    });

  it('is reported, with the expression quoted, instead of vanishing', () => {
    const found = discoverRoutes(dynamic());
    expect(found.routes.map((r) => r.path)).toEqual(['/a']);
    expect(found.unreadable).toHaveLength(1);
    expect(found.unreadable[0]!.path).toContain('workspaces.flatMap');
    expect(found.unreadable[0]!.detail).toMatch(/spread/i);
  });

  it('reaches the skip report an adopter reads', async () => {
    const output = await generate({ config: dynamic(), model: null });
    const entry = output.skipped.find((s) => s.path.includes('workspaces.flatMap'));
    expect(entry).toBeDefined();
    expect(entry?.detail).toMatch(/spread/i);
  });

  it('is reported when it sits inside a nested route, where a parent’s path and guard would apply', () => {
    const nested = app({
      'routes.tsx': [
        "import A from './A'",
        "import { extraRoutes } from './extra'",
        'export const routes = [{ path: "/a", element: <A />, children: [{ path: "x", element: <A /> }, ...extraRoutes] }]',
      ].join('\n'),
      'extra.tsx': ["import B from './B'", "export const extraRoutes = [{ path: '/b', element: <B /> }]"].join('\n'),
    });
    const found = discoverRoutes(nested);
    // Not followed: the parent's path and roles would have to be carried in, and a guess there is a leak.
    expect(found.routes.map((r) => r.path)).not.toContain('/b');
    expect(found.unreadable.map((u) => u.path).join(' ')).toContain('extraRoutes');
  });

  it('is reported when the imported name is not an array the scanner can read', () => {
    const opaque = app({
      'routes.tsx': ["import A from './A'", "import { made } from './made'", 'export const routes = [{ path: "/a", element: <A /> }, ...made]'].join('\n'),
      'made.tsx': 'export const made = buildRoutes()',
    });
    expect(discoverRoutes(opaque).unreadable.map((u) => u.path).join(' ')).toContain('made');
  });
});
