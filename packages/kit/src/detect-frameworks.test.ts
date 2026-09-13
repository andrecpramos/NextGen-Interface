import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { build } from './build.ts';
import { detectApp, init } from './detect.ts';
import { doctor } from './doctor.ts';

/**
 * `init` on applications that are not React Router (readiness item 3).
 *
 * The kit used to look for a React Router route table and, finding none, stop
 * with "No route table found" — true, and useless to someone whose app is Next.js.
 * It now recognises the framework first, reads the ones it has adapters for, and
 * names the ones it does not, so the message is about their app.
 */

const FIXTURES = fileURLToPath(new URL('../../generator/fixtures/', import.meta.url));
const NEXT = join(FIXTURES, 'next-app');
const REMIX = join(FIXTURES, 'remix-app');

const kitFolder = (): string => join(mkdtempSync(join(tmpdir(), 'nextgen-kit-')), 'nextgen');

function scratchApp(dependencies: Record<string, string>, files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'nextgen-app-'));
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'scratch', dependencies }));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(dir, path, '..'), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  return dir;
}

describe('init — the framework is recognised before anything is read', () => {
  it('reads a Next.js app from its app folder, and its language from the root layout', () => {
    const { config, findings } = detectApp(NEXT);
    expect(config.router).toBe('next');
    expect(config.appRoot.replace(/\\/g, '/')).toMatch(/next-app\/app$/);
    expect(config.routesFile).toBe('.');
    expect(config.languages).toEqual(['en']);
    expect(findings.find((f) => f.what === 'framework')).toMatchObject({ value: expect.stringMatching(/Next\.js/), confident: true });
  });

  it('reads a Remix app from app/routes', () => {
    const { config, findings } = detectApp(REMIX);
    expect(config.router).toBe('remix');
    expect(config.appRoot.replace(/\\/g, '/')).toMatch(/remix-app\/app$/);
    expect(config.routesFile).toBe('routes');
    expect(config.languages).toEqual(['en']);
    expect(findings.find((f) => f.what === 'framework')).toMatchObject({ value: expect.stringMatching(/Remix/), confident: true });
  });

  it('finds src/app in a Next.js app that keeps its source under src/', () => {
    const dir = scratchApp({ next: '15.0.0' }, { 'src/app/page.tsx': 'export default function Home() { return <h1>Hi</h1>; }' });
    const { config } = detectApp(dir);
    expect(config.router).toBe('next');
    expect(config.appRoot.replace(/\\/g, '/')).toMatch(/\/src\/app$/);
    expect(config.routesFile).toBe('.');
  });

  it.each([
    ['SvelteKit', { '@sveltejs/kit': '2.0.0' }, { 'src/routes/+page.svelte': '<h1>Hi</h1>' }],
    ['Nuxt', { nuxt: '4.0.0' }, { 'app/pages/index.vue': '<template><h1>Hi</h1></template>' }],
    ['Angular', { '@angular/router': '21.0.0' }, { 'src/app/app.routes.ts': 'export const routes = [];' }],
    ['Vue Router', { 'vue-router': '5.0.0' }, { 'src/router/index.js': 'export default {}' }],
  ] as const)('names %s plainly when it cannot read it yet, and says what it can', (name, dependencies, files) => {
    const dir = scratchApp(dependencies, files);
    expect(() => detectApp(dir)).toThrow(new RegExp(`${name.replace(' ', '\\s')}.*React Router, Next\\.js and Remix`, 's'));
  });
});

describe('the kit, end to end, on a Next.js app', () => {
  it('builds a registry of its pages and explains the catch-all it left out', async () => {
    const kit = kitFolder();
    init(NEXT, kit);
    const record = await build(kit);
    expect(record.capabilities).toBe(7);
    expect(record.skipped.map((s) => `${s.path} ${s.reason}`)).toContain('/blog/[...slug] catch-all');
    const report = doctor(kit);
    expect(report.ok).toBe(true);
    expect(report.text).toMatch(/\/blog\/\[\.\.\.slug\]/);
  }, 60_000);
});
