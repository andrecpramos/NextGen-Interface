import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { build } from './build.ts';
import { detectApp, init } from './detect.ts';
import { doctor } from './doctor.ts';

/** `init` on SvelteKit and Nuxt (readiness item 3b). */

const FIXTURES = fileURLToPath(new URL('../../generator/fixtures/', import.meta.url));
const SVELTE = join(FIXTURES, 'sveltekit-app');
const NUXT = join(FIXTURES, 'nuxt-app');

const posix = (path: string): string => path.replace(/\\/g, '/');
const kitFolder = (): string => join(mkdtempSync(join(tmpdir(), 'nextgen-kit-')), 'nextgen');

describe('init — SvelteKit and Nuxt', () => {
  it('reads a SvelteKit app from src/routes, and its language from app.html', () => {
    const { config, findings } = detectApp(SVELTE);
    expect(config.router).toBe('sveltekit');
    expect(posix(config.appRoot)).toMatch(/sveltekit-app\/src$/);
    expect(config.routesFile).toBe('routes');
    expect(config.languages).toEqual(['en']);
    expect(findings.find((f) => f.what === 'framework')).toMatchObject({ value: expect.stringMatching(/SvelteKit/), confident: true });
  });

  it('reads a Nuxt 4 app from app/pages, with flat locale files and its defaultLocale first', () => {
    const { config, findings } = detectApp(NUXT);
    expect(config.router).toBe('nuxt');
    expect(posix(config.appRoot)).toMatch(/nuxt-app\/app$/);
    expect(config.routesFile).toBe('pages');
    expect(config.localesDir).toBe('../i18n/locales');
    expect(config.languages).toEqual(['en', 'pt-PT']);
    expect(findings.find((f) => f.what === 'app language')).toMatchObject({ value: 'en', confident: true, evidence: expect.stringMatching(/defaultLocale/) });
  });

  it('reads a Nuxt 3 app whose pages sit at the project root', () => {
    const dir = mkdtempSync(join(tmpdir(), 'nextgen-app-'));
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ dependencies: { nuxt: '3.15.0' } }));
    mkdirSync(join(dir, 'pages'));
    writeFileSync(join(dir, 'pages', 'index.vue'), '<template><h1>Hi</h1></template>');
    const { config } = detectApp(dir);
    expect(config.router).toBe('nuxt');
    expect(posix(config.appRoot)).toMatch(/\/pages$/);
    expect(config.routesFile).toBe('.');
  });
});

describe('the kit, end to end, on a Nuxt app', () => {
  it('builds its pages and explains the catch-all it left out', async () => {
    const kit = kitFolder();
    init(NUXT, kit);
    const record = await build(kit);
    expect(record.capabilities).toBe(8);
    expect(record.skipped.map((s) => `${s.path} ${s.reason}`)).toContain('/[...slug] catch-all');
    expect(doctor(kit).ok).toBe(true);
  }, 60_000);
});
