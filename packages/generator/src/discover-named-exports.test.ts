import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { discoverRoutes } from './discover.ts';
import { generate } from './generate.ts';
import type { GeneratorConfig } from './types.ts';

/**
 * A page loaded as one named export of a module: `import('./wrappers').then(({ X }) => ({ default: X }))`.
 *
 * Found on a real app once its route table moved every element behind a lazy loader: the screens
 * that pick a guardian's child and redirect to that child's page became named exports of one wrappers
 * module, each a one-line adapter around the same redirect page. Read as that module's default export,
 * every one was titled after the module's file name and none was recognised as a resolver, so each
 * child's detail screen came back as a screen of its own. A thin wrapper is now read as the component
 * it renders, and any other named export as itself, where it is declared.
 */

function app(files: Record<string, string>): GeneratorConfig {
  const appRoot = mkdtempSync(join(tmpdir(), 'nextgen-named-'));
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
    localesDir: 'locales',
    languages: ['en'],
  };
}

const FILES: Record<string, string> = {
  'locales/en/common.json': JSON.stringify({ nav: { medicalStatus: 'Medical status' } }),
  'permissions.ts': [
    "export const APP_ROLES = ['COACH', 'PARENT']",
    "export const ROUTE_ROLES = { parentSelf: ['PARENT'], staff: ['COACH'] }",
  ].join('\n'),
  'page.ts': [
    "import { lazy } from 'react'",
    'export function page(preload) {',
    '  return { element: lazy(preload), preload, prefetch: true }',
    '}',
  ].join('\n'),
  'guardian/useChildren.ts': 'export function useChildren() { return { children: [], isPending: false } }',
  'guardian/LoadingState.tsx': 'export function LoadingState() { return <p>…</p> }',
  // That app's shape: one child goes straight to that child's page, several to the roster.
  'guardian/GuardianChildRedirectPage.tsx': [
    "import { Navigate } from 'react-router-dom'",
    "import { LoadingState } from './LoadingState'",
    "import { useChildren } from './useChildren'",
    'export default function GuardianChildRedirectPage({ suffix }) {',
    '  const { children, isPending } = useChildren()',
    '  if (isPending) return <LoadingState />',
    '  if (children.length === 1) {',
    '    return <Navigate to={`/my/children/${children[0].playerId}/${suffix}`} replace />',
    '  }',
    '  return <Navigate to="/my/children" replace />',
    '}',
  ].join('\n'),
  'guardian/ChildMedicalPage.tsx': 'export default function ChildMedicalPage() { return <h1>Medical status</h1> }',
  'guardian/ChildNutritionPage.tsx': 'export default function ChildNutritionPage() { return <h1>Nutrition plan</h1> }',
  'wrappers.tsx': [
    "import GuardianChildRedirectPage from './guardian/GuardianChildRedirectPage'",
    'export function ChildMedicalRedirectRoute() {',
    '  return <GuardianChildRedirectPage suffix="medical" />',
    '}',
    'export function ChildNutritionRedirectRoute() {',
    '  return <GuardianChildRedirectPage suffix="nutrition" />',
    '}',
    // Not a wrapper: a page of its own, declared beside the others.
    'export function InlineReport() {',
    '  return <section><h1>Weekly report</h1><p>Every session this week</p></section>',
    '}',
  ].join('\n'),
  'barrel.ts': "export { ChildNutritionRedirectRoute as NutritionRoute } from './wrappers'",
  'routes.tsx': [
    "import { page } from './page'",
    "import { ROUTE_ROLES } from './permissions'",
    'export const routes = [',
    "  { path: 'my/children/medical', ...page(() => import('./wrappers').then(({ ChildMedicalRedirectRoute }) => ({ default: ChildMedicalRedirectRoute }))), roles: ROUTE_ROLES.parentSelf, nav: { PARENT: { id: 'medical', labelKey: 'nav.medicalStatus', order: 5 } } },",
    "  { path: 'my/children/:childId/medical', ...page(() => import('./guardian/ChildMedicalPage')), roles: ROUTE_ROLES.parentSelf },",
    // The other callback form, through a barrel that renames the export.
    "  { path: 'my/children/nutrition', ...page(() => import('./barrel').then((m) => ({ default: m.NutritionRoute }))), roles: ROUTE_ROLES.parentSelf },",
    "  { path: 'my/children/:childId/nutrition', ...page(() => import('./guardian/ChildNutritionPage')), roles: ROUTE_ROLES.parentSelf },",
    // Destructured under another name.
    "  { path: 'reports/weekly', ...page(() => import('./wrappers').then(({ InlineReport: Report }) => ({ default: Report }))), roles: ROUTE_ROLES.staff },",
    ']',
  ].join('\n'),
};

describe('discoverRoutes — a page loaded as a named export', () => {
  const at = (path: string) => discoverRoutes(app(FILES)).routes.find((route) => route.path === path);
  const posix = (file: string | null | undefined) => file?.split('\\').join('/') ?? null;

  it('reads a thin wrapper as the component it renders, in that component’s own file', () => {
    const route = at('/my/children/medical');
    expect(route?.component).toBe('GuardianChildRedirectPage');
    expect(posix(route?.componentFile)).toMatch(/\/guardian\/GuardianChildRedirectPage\.tsx$/);
  });

  it('reads `m => ({ default: m.X })` the same way, through a barrel that renames the export', () => {
    const route = at('/my/children/nutrition');
    expect(route?.component).toBe('GuardianChildRedirectPage');
    expect(posix(route?.componentFile)).toMatch(/\/guardian\/GuardianChildRedirectPage\.tsx$/);
  });

  it('reads any other export by its own name where it is declared, never as the file’s default', () => {
    const route = at('/reports/weekly');
    expect(route?.component).toBe('InlineReport');
    expect(route?.componentFile).toBeNull();
    expect(posix(route?.routedIn)).toMatch(/\/wrappers\.tsx$/);
  });
});

describe('generate — a resolver behind a thin wrapper', () => {
  const output = generate({ config: app(FILES), model: null });

  it('folds each child’s detail screen into the resolver that picks the child', async () => {
    const { master, skipped } = await output;
    const routes = master.map((capability) => capability.route);
    expect(routes).toEqual(expect.arrayContaining(['/my/children/medical', '/my/children/nutrition']));
    for (const detail of ['/my/children/:childId/medical', '/my/children/:childId/nutrition']) {
      expect(routes).not.toContain(detail);
      expect(skipped.find((entry) => entry.path === detail)?.reason).toBe('reached-through-resolver');
    }
  });

  it('names no screen after the wrappers module, and a resolver from its own nav label', async () => {
    const titles = (await output).master.map((capability) => capability.title);
    expect(titles.filter((title) => /wrapper/i.test(title))).toEqual([]);
    expect((await output).master.find((capability) => capability.route === '/my/children/medical')?.title).toBe('Medical status');
  });

  it('reads a page declared beside others as itself, not as the module or a neighbour', async () => {
    const report = (await output).master.find((capability) => capability.route === '/reports/weekly');
    expect(report?.title).toBe('Inline Report');
    expect(report?.explanationSource).toBe('wrappers.tsx');
    expect(report?.explanation).toBe('This screen shows: Weekly report, Every session this week.');
  });
});
