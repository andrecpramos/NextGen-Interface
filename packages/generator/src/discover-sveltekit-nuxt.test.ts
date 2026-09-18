import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { discoverRoutes } from './discover.ts';
import { generate } from './generate.ts';
import { readTranslations, translate } from './labels.ts';
import { readPage } from './pages.ts';
import type { GeneratorConfig } from './types.ts';

/**
 * SvelteKit and Nuxt (readiness item 3b): folder layouts whose pages are markup,
 * not TSX, and — in Nuxt's case — whose translations are flat files keyed by the
 * text itself. The fixtures hold every naming rule, including the ones that must
 * not produce a destination, and the markup cases a page reader gets wrong quietly:
 * a heading built from data, a failure state, a title with the site's name on it.
 */

const SVELTE = fileURLToPath(new URL('../fixtures/sveltekit-app/src', import.meta.url));
const NUXT = fileURLToPath(new URL('../fixtures/nuxt-app/app', import.meta.url));

const COMMON = { roleSetExport: 'ROUTE_ROLES', allRolesExport: 'APP_ROLES', manifests: [] };

const SVELTE_CONFIG: GeneratorConfig = { ...COMMON, appRoot: SVELTE, routesFile: 'routes', router: 'sveltekit', localesDir: null, languages: ['en'] };
const NUXT_CONFIG: GeneratorConfig = {
  ...COMMON,
  appRoot: NUXT,
  routesFile: 'pages',
  router: 'nuxt',
  localesDir: '../i18n/locales',
  languages: ['en', 'pt-PT'],
};

const paths = (config: GeneratorConfig): string[] =>
  discoverRoutes(config)
    .routes.map((r) => r.path)
    .sort();

describe('discoverRoutes — SvelteKit', () => {
  it('declares every +page.svelte, reading groups, optional parameters, matchers and a literal @', () => {
    expect(paths(SVELTE_CONFIG)).toEqual(['/', '/about', '/blog/:slug', '/dashboard', '/items/:id', '/login', '/orders', '/profile/@:user']);
  });

  it('declares no layout, error page, server-only route or component beside a page', () => {
    const files = discoverRoutes(SVELTE_CONFIG).routes.map((r) => (r.componentFile ?? '').replace(/\\/g, '/'));
    expect(files.every((f) => f.endsWith('/+page.svelte'))).toBe(true);
    expect(files.some((f) => f.includes('/settings/'))).toBe(false);
  });

  it('reports a rest parameter as a catch-all', () => {
    expect(discoverRoutes(SVELTE_CONFIG).unreadable).toEqual([
      { path: '/docs/[...path]', reason: 'catch-all', detail: expect.stringMatching(/content, not code/) },
    ]);
  });

  it('titles screens from <title> without the site name, and calls a site-name-only home page Home', async () => {
    const output = await generate({ config: SVELTE_CONFIG });
    const titles = new Map(output.master.map((c) => [c.route, c.title]));
    expect(titles.get('/login')).toBe('Sign in');
    expect(titles.get('/dashboard')).toBe('Dashboard');
    expect(titles.get('/about')).toBe('About');
    expect(titles.get('/')).toBe('Home');
    expect(titles.get('/profile/@:user')).toBe('Profile');
  });

  it('reads literal copy and form fields, and skips a heading built from data or shown only on failure', () => {
    const login = readPage(join(SVELTE, 'routes', 'login', '+page.svelte'));
    expect(login.fields.map((f) => f.label)).toEqual(['Email', 'Password', 'Sign in']);
    const dashboard = readPage(join(SVELTE, 'routes', '(app)', 'dashboard', '+page.svelte'));
    expect(dashboard.headings).toEqual(['Recent activity']);
    const orders = readPage(join(SVELTE, 'routes', 'orders', '+page.svelte'));
    expect(orders.headings).toContain('Your orders');
    expect(orders.headings.join(' ')).not.toMatch(/Could not load/);
  });
});

describe('discoverRoutes — Nuxt', () => {
  it('declares every page, reading index, parameters, groups, optional parameters and nested pages', () => {
    expect(paths(NUXT_CONFIG)).toEqual(['/', '/:type', '/:type/:id', '/about', '/parent', '/parent/child', '/pricing', '/search']);
  });

  it('keeps a parent page over its own index, and reports the catch-all', () => {
    const { routes, unreadable } = discoverRoutes(NUXT_CONFIG);
    expect(routes.find((r) => r.path === '/parent')?.componentFile).toMatch(/pages[\\/]parent\.vue$/);
    expect(unreadable).toEqual([{ path: '/[...slug]', reason: 'catch-all', detail: expect.stringMatching(/content, not code/) }]);
  });

  it('titles from useHead and definePageMeta literals, and names a parameter-only route by its parameters', async () => {
    const output = await generate({ config: NUXT_CONFIG });
    const titles = new Map(output.master.map((c) => [c.route, c.title]));
    expect(titles.get('/search')).toBe('Search');
    expect(titles.get('/pricing')).toBe('Pricing');
    expect(titles.get('/')).toBe('Home');
    expect(titles.get('/:type')).toBe('Type'); // a conditional title is code: not read
    expect(titles.get('/:type/:id')).toBe('Type Id');
  });

  it('reads translation keys that are the text itself, and skips the failure state', () => {
    const search = readPage(join(NUXT, 'pages', 'search.vue'));
    expect(search.i18nKeys).toEqual(expect.arrayContaining(['Search the catalogue', 'Type to search...']));
    expect(search.headings).toContain('Search the catalogue');
    expect(search.headings.join(' ')).not.toMatch(/Error occurred/);
    expect(search.fields).toEqual([{ tag: 'input', label: null, labelKey: 'Type to search...', id: null, name: 'q', type: 'text', rules: [] }]);
  });

  it('loads one flat locale file per language, and finds a key whose dots are not a path', () => {
    const portuguese = readTranslations(NUXT_CONFIG, 'pt-PT');
    expect(translate(portuguese, 'Type to search...')).toBe('Escreva para pesquisar...');
    expect(translate(portuguese, 'Search the catalogue')).toBe('Pesquisar o catálogo');
  });
});
