import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { discoverRoutes } from './discover.ts';
import { generate } from './generate.ts';
import { readPage } from './pages.ts';
import type { GeneratorConfig } from './types.ts';

/**
 * Vue Router and Angular (readiness item 3c): route tables in code, read the way React
 * Router's are, with their own spellings — `component: () => import(...)` through a Vite
 * alias to a `.vue` file, and Angular's `loadComponent`, `loadChildren` from another file,
 * paths without a leading slash, and a page whose text is its template.
 */

const VUE = fileURLToPath(new URL('../fixtures/vue-app/src', import.meta.url));
const ANGULAR = fileURLToPath(new URL('../fixtures/angular-app/src', import.meta.url));

const COMMON = { roleSetExport: 'ROUTE_ROLES', allRolesExport: 'APP_ROLES', manifests: [], localesDir: null, languages: ['en'] };
const VUE_CONFIG: GeneratorConfig = { ...COMMON, appRoot: VUE, routesFile: 'router/index.js', router: 'vue-router' };
const ANGULAR_CONFIG: GeneratorConfig = { ...COMMON, appRoot: ANGULAR, routesFile: 'app/app.routes.ts', router: 'angular' };

const paths = (config: GeneratorConfig): string[] =>
  discoverRoutes(config)
    .routes.map((r) => r.path)
    .sort();

describe('discoverRoutes — Vue Router', () => {
  it('declares eager and lazy pages, nested children, and no redirect or 404', () => {
    expect(paths(VUE_CONFIG)).toEqual(['/', '/admin', '/login', '/profile/:username', '/profile/:username/favorites', '/settings']);
  });

  it('follows lazy imports through the Vite alias to .vue files, with and without the extension', () => {
    const files = new Map(discoverRoutes(VUE_CONFIG).routes.map((r) => [r.path, (r.componentFile ?? '').replace(/\\/g, '/')]));
    expect(files.get('/')).toMatch(/views\/Home\.vue$/);
    expect(files.get('/login')).toMatch(/views\/Login\.vue$/);
    expect(files.get('/settings')).toMatch(/views\/Settings\.vue$/);
    expect(files.get('/profile/:username/favorites')).toMatch(/views\/Favorites\.vue$/);
  });

  it('reports nothing unreadable: a redirect is not a problem', () => {
    expect(discoverRoutes(VUE_CONFIG).unreadable).toEqual([]);
  });

  it('reads roles from route meta, and not from requiresAuth, which is authentication', () => {
    const roles = new Map(discoverRoutes(VUE_CONFIG).routes.map((r) => [r.path, r.roles]));
    expect(roles.get('/admin')).toEqual(['ADMIN']);
    expect(roles.get('/settings')).toEqual(['ADMIN', 'PUBLIC']); // open to everyone, the admin included
  });

  it('titles screens from their page components and reads their markup', async () => {
    const output = await generate({ config: VUE_CONFIG });
    const titles = new Map(output.master.map((c) => [c.route, c.title]));
    expect(titles.get('/')).toBe('Home');
    expect(titles.get('/login')).toBe('Login');
    expect(readPage(join(VUE, 'views', 'Login.vue')).fields.map((f) => f.label)).toEqual(['Email', 'Password', 'Sign in']);
  });
});

describe('discoverRoutes — Angular', () => {
  it('declares every page, including lazy children from their own file, and no redirect or 404', () => {
    expect(paths(ANGULAR_CONFIG)).toEqual([
      '/',
      '/admin',
      '/editor',
      '/editor/:slug',
      '/login',
      '/profile/:username',
      '/profile/:username/favorites',
      '/settings',
    ]);
    expect(discoverRoutes(ANGULAR_CONFIG).unreadable).toEqual([]);
  });

  it('resolves loadComponent — a default export, and a named export taken with .then()', () => {
    const files = new Map(discoverRoutes(ANGULAR_CONFIG).routes.map((r) => [r.path, (r.componentFile ?? '').replace(/\\/g, '/')]));
    expect(files.get('/login')).toMatch(/auth\/login\.component\.ts$/);
    expect(files.get('/settings')).toMatch(/settings\/settings\.component\.ts$/);
    expect(files.get('/profile/:username/favorites')).toMatch(/profile\/favorites\.component\.ts$/);
  });

  it('reads roles from route data, and not from canActivate', () => {
    const roles = new Map(discoverRoutes(ANGULAR_CONFIG).routes.map((r) => [r.path, r.roles]));
    expect(roles.get('/admin')).toEqual(['ADMIN']);
    expect(roles.get('/settings')).toEqual(['ADMIN', 'PUBLIC']); // open to everyone, the admin included
  });

  it('reads a page from its templateUrl or inline template, and skips an @if (error) block', () => {
    const settings = readPage(join(ANGULAR, 'app', 'settings', 'settings.component.ts'));
    expect(settings.headings).toContain('Your settings');
    expect(settings.headings.join(' ')).not.toMatch(/Could not save/);
    const login = readPage(join(ANGULAR, 'app', 'auth', 'login.component.ts'));
    expect(login.headings).toContain('Sign in');
    expect(login.fields.map((f) => f.label)).toEqual(['Email', 'Sign in']);
  });

  it('titles a screen from its component, without "Component"', async () => {
    const output = await generate({ config: ANGULAR_CONFIG });
    const titles = new Map(output.master.map((c) => [c.route, c.title]));
    expect(titles.get('/')).toBe('Home');
    expect(titles.get('/login')).toBe('Login');
    expect(titles.get('/settings')).toBe('Settings');
    // Rule 17: the admin screen is in the admin registry, and in no other.
    const routesOf = (role: string) => (output.registries.get(role)?.capabilities ?? []).map((c) => c.route);
    expect(routesOf('ADMIN')).toContain('/admin');
    expect(routesOf('PUBLIC')).not.toContain('/admin');
    expect(routesOf('PUBLIC')).toContain('/settings');
  });
});
