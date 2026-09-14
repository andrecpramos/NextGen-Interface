import { fileURLToPath } from 'node:url';

import type { GeneratorConfig } from './types.ts';

/**
 * The tiny application the tests read.
 *
 * It lives here rather than in a test file because several suites share it, and
 * importing one test file from another silently re-runs its cases. It is a real
 * React Router application in miniature — a legacy route, a dev-only route, an
 * unreadable role guard, a URL shim, a section landing and a data-resolving
 * redirect — so the tests never need `fut-app` to be checked out, which CI's
 * runner does not have.
 */
export const FIXTURE_ROOT = fileURLToPath(new URL('../fixtures/tiny-app/src', import.meta.url));

export const FIXTURE_CONFIG: GeneratorConfig = {
  appRoot: FIXTURE_ROOT,
  routesFile: 'routes.tsx',
  permissionsFile: 'lib/permissions.ts',
  roleSetExport: 'ROUTE_ROLES',
  allRolesExport: 'APP_ROLES',
  manifests: ['lib/nav.ts'],
  localesDir: 'i18n/locales',
  languages: ['en'],
};

/**
 * A Portuguese-first application in fut-app's shapes, for naming a screen in two
 * languages: nav groups whose leaves are all "Visão geral", a label two roles share
 * without ever meeting, a heading read through an aliased translation function, and a
 * route that picks a child and redirects to that child's page.
 */
export const FAMILY_ROOT = fileURLToPath(new URL('../fixtures/family-app/src', import.meta.url));

export const FAMILY_CONFIG: GeneratorConfig = {
  appRoot: FAMILY_ROOT,
  routesFile: 'routes.tsx',
  permissionsFile: 'lib/permissions.ts',
  roleSetExport: 'ROUTE_ROLES',
  allRolesExport: 'APP_ROLES',
  manifests: ['lib/nav.ts'],
  localesDir: 'i18n/locales',
  languages: ['pt-PT', 'en'],
};
