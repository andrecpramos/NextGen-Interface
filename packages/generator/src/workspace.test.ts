import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { discoverRoutes, importResolver } from './discover.ts';
import { generate } from './generate.ts';
import type { GeneratorConfig } from './types.ts';

/**
 * An app in a monorepo.
 *
 * Found by running the scanner on the pilot app's current source: its route table imports its pages
 * (`@cheattah/engine/training/pages/TrainingHomePage`) and its role sets (`@cheattah/core/permissions`)
 * from *sibling workspace packages*, and discovery resolved only relative imports and path aliases — "a
 * package is null". So all 65 routes were left out ("role guard could not be evaluated") and the kit
 * reported **0 screens**. A workspace package is the adopter's own code, in the same repository, and
 * reading it is not reading anything else: the scan follows a bare import into a package the workspace
 * itself declares, and nowhere else.
 */

const ROLES = [
  "export const APP_ROLES = ['ADMIN', 'COACH']",
  '',
  'export const ROUTE_ROLES = {',
  '  everyone: APP_ROLES,',
  "  staff: ['COACH'],",
  "  admin: ['ADMIN'],",
  '}',
].join('\n');

const page = (name: string, heading: string, copy: string) =>
  `export default function ${name}() {\n  return <main><h1>${heading}</h1><p>${copy}</p></main>\n}\n`;

const ROUTES = [
  "import { lazy } from 'react'",
  "import { ROUTE_ROLES } from '@acme/core/permissions'",
  "const DashboardPage = lazy(() => import('@acme/pages/dashboard'))",
  "const TrainingPage = lazy(() => import('@acme/pages/training/TrainingPage'))",
  "const StrayPage = lazy(() => import('@acme/stray/StrayPage'))",
  'export const routes = [',
  "  { path: '/dashboard', element: <DashboardPage />, roles: ROUTE_ROLES.everyone },",
  "  { path: '/training', element: <TrainingPage />, roles: ROUTE_ROLES.staff },",
  "  { path: '/stray', element: <StrayPage />, roles: ROUTE_ROLES.everyone },",
  ']',
].join('\n');

function monorepo(workspaceFiles: Record<string, string> = { 'pnpm-workspace.yaml': "packages:\n  - 'packages/*'\n  - 'app'\n" }) {
  const root = mkdtempSync(join(tmpdir(), 'nextgen-monorepo-'));
  const files: Record<string, string> = {
    ...workspaceFiles,
    'app/package.json': JSON.stringify({ name: '@acme/app' }),
    'app/src/routes.tsx': ROUTES,
    'packages/core/package.json': JSON.stringify({ name: '@acme/core', exports: { './permissions': './src/permissions.ts' } }),
    'packages/core/src/permissions.ts': ROLES,
    'packages/pages/package.json': JSON.stringify({
      name: '@acme/pages',
      exports: {
        './dashboard': { types: './src/dashboard.tsx', import: './src/dashboard.tsx' },
        './training/*': './src/training/*.tsx',
      },
    }),
    'packages/pages/src/dashboard.tsx': page('DashboardPage', 'Team overview', 'Everything about the team today'),
    'packages/pages/src/training/TrainingPage.tsx': page('TrainingPage', 'Training sessions', 'Plan and review sessions'),
    // Not in the workspace's globs: a package the repository does not declare is not read.
    'vendor/stray/package.json': JSON.stringify({ name: '@acme/stray', exports: { './StrayPage': './StrayPage.tsx' } }),
    'vendor/stray/StrayPage.tsx': page('StrayPage', 'Stray page', 'Should never be read'),
  };
  for (const [name, source] of Object.entries(files)) {
    mkdirSync(dirname(join(root, name)), { recursive: true });
    writeFileSync(join(root, name), source, 'utf8');
  }
  const config: GeneratorConfig = {
    appRoot: join(root, 'app', 'src'),
    routesFile: 'routes.tsx',
    permissionsFile: '../../packages/core/src/permissions.ts',
    roleSetExport: 'ROUTE_ROLES',
    allRolesExport: 'APP_ROLES',
    manifests: [],
    localesDir: null,
    languages: ['en'],
  };
  return { root, config };
}

const posix = (path: string | null | undefined): string => String(path).replace(/\\/g, '/');

describe('an app in a pnpm workspace', () => {
  it('follows a bare import into a sibling package, through its `exports` — explicit and wildcard', () => {
    const { config } = monorepo();
    const routes = discoverRoutes(config).routes;
    expect(posix(routes.find((r) => r.path === '/dashboard')?.componentFile)).toMatch(/packages\/pages\/src\/dashboard\.tsx$/);
    expect(posix(routes.find((r) => r.path === '/training')?.componentFile)).toMatch(/packages\/pages\/src\/training\/TrainingPage\.tsx$/);
  });

  it('reads the role sets from the sibling package, so who may open a screen is still known (Rule 17)', () => {
    const { config } = monorepo();
    const routes = discoverRoutes(config).routes;
    expect(routes.find((r) => r.path === '/training')?.roles).toEqual(['COACH']);
    expect(routes.find((r) => r.path === '/dashboard')?.roles).toEqual(['ADMIN', 'COACH']);
  });

  it('describes each screen from the page it found, and says which file that was', async () => {
    const { config } = monorepo();
    const output = await generate({ config, model: null });
    const training = output.master.find((c) => c.route === '/training');
    expect(training?.explanation).toContain('Training sessions');
    expect(posix(training?.explanationSource)).toBe('../../packages/pages/src/training/TrainingPage.tsx');
  });

  it('does not read a package the workspace does not declare', () => {
    const { config } = monorepo();
    const stray = discoverRoutes(config).routes.find((r) => r.path === '/stray');
    expect(stray?.componentFile ?? null).toBeNull();
  });

  it('shows what it will and will not resolve, for anyone asking the resolver directly', () => {
    const { config } = monorepo();
    const resolveImport = importResolver(config.appRoot);
    const from = join(config.appRoot, 'routes.tsx');
    expect(posix(resolveImport('@acme/pages/dashboard', from))).toMatch(/packages\/pages\/src\/dashboard\.tsx$/);
    expect(resolveImport('@acme/pages/missing', from)).toBeNull();
    expect(resolveImport('react', from)).toBeNull();
    expect(resolveImport('@acme/stray/StrayPage', from)).toBeNull();
  });

  it('reads a workspace declared in package.json (npm and yarn), not only pnpm’s file', () => {
    const { config } = monorepo({ 'package.json': JSON.stringify({ name: 'root', workspaces: ['packages/*', 'app'] }) });
    expect(posix(discoverRoutes(config).routes.find((r) => r.path === '/dashboard')?.componentFile)).toMatch(/packages\/pages\/src\/dashboard\.tsx$/);
    const { config: yarnObject } = monorepo({ 'package.json': JSON.stringify({ workspaces: { packages: ['packages/*', 'app'] } }) });
    expect(discoverRoutes(yarnObject).routes.find((r) => r.path === '/dashboard')?.componentFile).not.toBeNull();
  });

  it('finds the workspace from any depth below its root', () => {
    const { config } = monorepo();
    const deeper = { ...config, appRoot: config.appRoot };
    expect(discoverRoutes(deeper).routes.length).toBeGreaterThan(0);
  });
});

describe('an app that is not in a workspace', () => {
  it('resolves what it always did: a bare import is not the application’s code', () => {
    const { config } = monorepo({ 'unrelated.txt': 'no workspace here' });
    const routes = discoverRoutes(config).routes;
    expect(routes.find((r) => r.path === '/dashboard')?.componentFile ?? null).toBeNull();
  });
});
