import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { discoverRoutes } from './discover.ts';
import { generate } from './generate.ts';
import type { GeneratorConfig } from './types.ts';

/**
 * Routes declared by a folder layout: Next.js and Remix (readiness item 3).
 *
 * Until this, the generator read React Router route tables and nothing else, so
 * every Next, Remix, SvelteKit, Nuxt, Vue and Angular application failed at the
 * first step with "No route table found". The fixtures hold every naming rule
 * the adapters implement — including the ones that must NOT produce a
 * destination, which is where a folder-walking discovery goes wrong quietly.
 */

const NEXT = fileURLToPath(new URL('../fixtures/next-app', import.meta.url));
const REMIX = fileURLToPath(new URL('../fixtures/remix-app/app', import.meta.url));

const COMMON = {
  roleSetExport: 'ROUTE_ROLES',
  allRolesExport: 'APP_ROLES',
  manifests: [],
  localesDir: null,
  languages: ['en'],
};

const NEXT_CONFIG: GeneratorConfig = { ...COMMON, appRoot: NEXT, routesFile: 'app', router: 'next' };
const REMIX_CONFIG: GeneratorConfig = { ...COMMON, appRoot: REMIX, routesFile: 'routes', router: 'remix' };

const paths = (config: GeneratorConfig): string[] =>
  discoverRoutes(config)
    .routes.map((r) => r.path)
    .sort();

describe('discoverRoutes — Next.js', () => {
  it('declares the app router and the pages router together', () => {
    expect(paths(NEXT_CONFIG)).toEqual(['/', '/about', '/dashboard', '/dashboard/settings', '/docs', '/pricing', '/products/:id']);
  });

  it('declares no route group, private folder, slot, interception, handler, layout or special file', () => {
    const found = discoverRoutes(NEXT_CONFIG).routes.map((r) => r.componentFile ?? '');
    for (const notAPage of ['(marketing)/page', '_internal', '@modal', 'route.ts', 'layout.tsx', 'loading.tsx', 'not-found.tsx', '_app.tsx', 'nextauth']) {
      expect(found.some((file) => file.replace(/\\/g, '/').includes(notAPage))).toBe(false);
    }
  });

  it('declares an optional catch-all at its base URL, and reports a catch-all instead of dropping it', () => {
    const { routes, unreadable } = discoverRoutes(NEXT_CONFIG);
    expect(routes.find((r) => r.path === '/docs')?.componentFile).toMatch(/\[\[\.\.\.slug\]\][\\/]page\.tsx$/);
    expect(unreadable).toEqual([{ path: '/blog/[...slug]', reason: 'catch-all', detail: expect.stringMatching(/content, not code/) }]);
  });

  it('names each page from its default export', () => {
    const byPath = new Map(discoverRoutes(NEXT_CONFIG).routes.map((r) => [r.path, r]));
    expect(byPath.get('/pricing')?.component).toBe('PricingPage');
    expect(byPath.get('/about')?.component).toBe('About');
    expect(byPath.get('/about')?.componentFile).toMatch(/pages[\\/]about\.tsx$/);
  });

  it('titles screens from their metadata, reports the catch-all, and writes steps for a form', async () => {
    const output = await generate({ config: NEXT_CONFIG });
    const byRoute = new Map(output.master.map((c) => [c.route, c]));
    expect(byRoute.get('/pricing')?.title).toBe('Pricing');
    expect(byRoute.get('/dashboard/settings')?.title).toBe('Account settings');
    expect(byRoute.get('/docs')?.title).toBe('Docs'); // generateMetadata is code, so not evaluated
    expect(byRoute.get('/dashboard/settings')?.steps?.length ?? 0).toBeGreaterThan(0);
    expect(output.skipped).toContainEqual(expect.objectContaining({ path: '/blog/[...slug]', reason: 'catch-all' }));
  });
});

describe('discoverRoutes — Remix flat routes', () => {
  it('reads index, pathless, optional, folder and parameter routes into URLs', () => {
    expect(paths(REMIX_CONFIG)).toEqual(['/', '/about', '/join', '/login', '/notes', '/notes/:noteId', '/settings']);
  });

  it('declares no resource route and no pathless layout on its own', () => {
    const files = discoverRoutes(REMIX_CONFIG).routes.map((r) => (r.componentFile ?? '').replace(/\\/g, '/'));
    expect(files.some((f) => f.endsWith('healthcheck.tsx'))).toBe(false);
    expect(files.some((f) => f.includes('sitemap'))).toBe(false);
    expect(files.some((f) => f.endsWith('/_auth.tsx'))).toBe(false);
  });

  it('keeps a layout and its index as one destination, named by the layout', () => {
    const notes = discoverRoutes(REMIX_CONFIG).routes.filter((r) => r.path === '/notes');
    expect(notes).toHaveLength(1);
    expect(notes[0]?.component).toBe('NotesPage');
  });

  it('reports a splat instead of dropping it', () => {
    expect(discoverRoutes(REMIX_CONFIG).unreadable).toEqual([
      { path: '/files/$', reason: 'catch-all', detail: expect.stringMatching(/content, not code/) },
    ]);
  });

  it('titles a screen from its meta export', async () => {
    const output = await generate({ config: REMIX_CONFIG });
    expect(output.master.find((c) => c.route === '/join')?.title).toBe('Sign Up');
  });
});

describe('routeRoles — roles an app enforces in code, declared by the adopter', () => {
  it('narrows every route under a prefix, and only at a segment boundary', () => {
    const { routes } = discoverRoutes({ ...NEXT_CONFIG, routeRoles: { '/dashboard': ['ADMIN'], '/pri': ['NOBODY'] } });
    const roles = new Map(routes.map((r) => [r.path, r.roles]));
    expect(roles.get('/dashboard')).toEqual(['ADMIN']);
    expect(roles.get('/dashboard/settings')).toEqual(['ADMIN']);
    expect(roles.get('/pricing')).toEqual(['PUBLIC']); // '/pri' is not a segment of '/pricing'
    expect(roles.get('/')).toEqual(['PUBLIC']);
  });

  it('lets the longest matching prefix win', () => {
    const { routes } = discoverRoutes({ ...NEXT_CONFIG, routeRoles: { '/dashboard': ['ADMIN', 'STAFF'], '/dashboard/settings': ['ADMIN'] } });
    const roles = new Map(routes.map((r) => [r.path, r.roles]));
    expect(roles.get('/dashboard')).toEqual(['ADMIN', 'STAFF']);
    expect(roles.get('/dashboard/settings')).toEqual(['ADMIN']);
  });
});
