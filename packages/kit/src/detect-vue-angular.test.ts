import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { build } from './build.ts';
import { detectApp, init } from './detect.ts';
import { doctor } from './doctor.ts';

/** `init` on Vue Router and Angular (readiness item 3c). */

const FIXTURES = fileURLToPath(new URL('../../generator/fixtures/', import.meta.url));
const VUE = join(FIXTURES, 'vue-app');
const ANGULAR = join(FIXTURES, 'angular-app');

const posix = (path: string): string => path.replace(/\\/g, '/');

describe('init — Vue Router and Angular', () => {
  it('finds a Vue app\'s route table and its language', () => {
    const { config, findings } = detectApp(VUE);
    expect(config.router).toBe('vue-router');
    expect(posix(config.appRoot)).toMatch(/vue-app\/src$/);
    expect(config.routesFile).toBe('router/index.js');
    expect(config.languages).toEqual(['en']);
    expect(findings.find((f) => f.what === 'framework')).toMatchObject({ value: expect.stringMatching(/Vue Router/), confident: true });
  });

  it('finds an Angular app\'s Routes array, over its lazy child routes and the file that provides the router', () => {
    const { config, findings } = detectApp(ANGULAR);
    expect(config.router).toBe('angular');
    expect(posix(config.appRoot)).toMatch(/angular-app\/src$/);
    expect(config.routesFile).toBe('app/app.routes.ts');
    expect(config.languages).toEqual(['en']);
    expect(findings.find((f) => f.what === 'framework')).toMatchObject({ value: expect.stringMatching(/Angular/), confident: true });
  });
});

describe('the kit, end to end, on an Angular app', () => {
  it('builds a registry per audience, and keeps the admin screen out of the others', async () => {
    const kit = join(mkdtempSync(join(tmpdir(), 'nextgen-kit-')), 'nextgen');
    init(ANGULAR, kit);
    const record = await build(kit);
    expect([...record.roles].sort()).toEqual(['ADMIN', 'PUBLIC']);
    expect(record.perRole.ADMIN).toBe(8); // every open screen, and the admin one
    expect(record.perRole.PUBLIC).toBe(7); // every open screen, and not the admin one
    expect(doctor(kit).ok).toBe(true);
  }, 60_000);
});
