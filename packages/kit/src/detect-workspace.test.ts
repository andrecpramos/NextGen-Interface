import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { build } from './build.ts';
import { detectApp, init } from './detect.ts';

/**
 * `init` on an app in a monorepo: the role sets live in a sibling package.
 *
 * Found on the pilot app's current source. `init` searched only the app's own `src/`, saw no permissions
 * module ("no permissions module, so the roles come from the route table itself"), guessed the default
 * names, and `build` then omitted every route it could not evaluate a guard for: **0 screens**. The
 * routes file names the module it reads — `import { ROUTE_ROLES } from '@acme/core/permissions'` — so that
 * is where to look.
 */

function monorepo(): { app: string; kit: string } {
  const root = mkdtempSync(join(tmpdir(), 'nextgen-kit-monorepo-'));
  const files: Record<string, string> = {
    'pnpm-workspace.yaml': "packages:\n  - 'packages/*'\n  - 'app'\n",
    'app/package.json': JSON.stringify({ name: '@acme/app', dependencies: { react: '18.0.0', 'react-router-dom': '7.0.0' } }),
    'app/src/main.tsx': "import './routes'",
    'app/src/routes.tsx': [
      "import { lazy } from 'react'",
      "import { ROUTE_ROLES } from '@acme/core/permissions'",
      "const DashboardPage = lazy(() => import('@acme/pages/dashboard'))",
      "const TrainingPage = lazy(() => import('@acme/pages/training'))",
      'export const routes = [',
      "  { path: '/dashboard', element: <DashboardPage />, roles: ROUTE_ROLES.everyone },",
      "  { path: '/training', element: <TrainingPage />, roles: ROUTE_ROLES.staff },",
      ']',
    ].join('\n'),
    'packages/core/package.json': JSON.stringify({ name: '@acme/core', exports: { './permissions': './src/permissions.ts' } }),
    'packages/core/src/permissions.ts': [
      "export const APP_ROLES = ['ADMIN', 'COACH']",
      'export const ROUTE_ROLES = { everyone: APP_ROLES, staff: [\'COACH\'] }',
    ].join('\n'),
    'packages/pages/package.json': JSON.stringify({ name: '@acme/pages', exports: { './dashboard': './src/dashboard.tsx', './training': './src/training.tsx' } }),
    'packages/pages/src/dashboard.tsx': 'export default function Dashboard() { return <main><h1>Team overview</h1></main> }',
    'packages/pages/src/training.tsx': 'export default function Training() { return <main><h1>Training sessions</h1></main> }',
  };
  for (const [name, source] of Object.entries(files)) {
    mkdirSync(dirname(join(root, name)), { recursive: true });
    writeFileSync(join(root, name), source, 'utf8');
  }
  return { app: join(root, 'app'), kit: join(root, 'nextgen') };
}

describe('init — an app in a monorepo', () => {
  it('finds the role module in the sibling package the route table imports it from', () => {
    const { app } = monorepo();
    const { config, findings } = detectApp(app);
    expect(config.permissionsFile?.replace(/\\/g, '/')).toBe('../../packages/core/src/permissions.ts');
    expect(config.roleSetExport).toBe('ROUTE_ROLES');
    expect(config.allRolesExport).toBe('APP_ROLES');
    expect(findings.find((f) => f.what === 'role table')).toMatchObject({ confident: true });
  });

  it('builds the screens, by role, instead of leaving every route out', async () => {
    const { app, kit } = monorepo();
    init(app, kit);
    const record = await build(kit);
    expect(record.capabilities).toBe(2);
    expect(record.roles).toEqual(['ADMIN', 'COACH']);
    expect(record.skipped).toEqual([]);
  }, 60_000);
});
