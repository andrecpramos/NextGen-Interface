import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { generate } from './generate.ts';
import type { GeneratorConfig } from './types.ts';

/**
 * ADR-042 end to end, for the frameworks read as markup. An Angular component is a `.ts` file, and the
 * controls its template declares — inline or in a `templateUrl` — must not be replaced by a TypeScript
 * reading that finds no JSX in it.
 */
const COMMON = { roleSetExport: 'ROUTE_ROLES', allRolesExport: 'APP_ROLES', manifests: [], localesDir: null, languages: ['en'] };
const VUE: GeneratorConfig = {
  ...COMMON, appRoot: fileURLToPath(new URL('../fixtures/vue-app/src', import.meta.url)), routesFile: 'router/index.js', router: 'vue-router',
} as GeneratorConfig;
const ANGULAR: GeneratorConfig = {
  ...COMMON, appRoot: fileURLToPath(new URL('../fixtures/angular-app/src', import.meta.url)), routesFile: 'app/app.routes.ts', router: 'angular',
} as GeneratorConfig;

const actionsAt = async (config: GeneratorConfig, route: string) =>
  (await generate({ config, model: null })).master.find((c) => c.route === route)?.actions;

describe('generate — what a markup page lets a visitor do', () => {
  it('reads a Vue view', async () => {
    expect(await actionsAt(VUE, '/login')).toEqual(['Sign in']);
  });

  it('reads an Angular component’s template, in its own file or inline', async () => {
    expect(await actionsAt(ANGULAR, '/editor')).toEqual(['Publish Article']);
    expect(await actionsAt(ANGULAR, '/login')).toEqual(['Sign in']);
  });
});
