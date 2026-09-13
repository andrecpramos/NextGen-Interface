import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';
import { JSDOM, VirtualConsole } from 'jsdom';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

/**
 * The script tag starting itself from its own attributes (script-tag.ts).
 *
 * jsdom runs the script exactly as a page would — as a <script> element, so
 * `document.currentScript` is set — but enforces no Content-Security-Policy; that
 * half is tooling/scripts/check-csp.mjs, in a real browser.
 *
 * The bundle is built in memory rather than to dist/, because embed.test.ts builds
 * dist/nextgen.js in parallel and two writers to one file is a flaky test.
 */

const GEN = fileURLToPath(new URL('../../../eval/fut-app/generated/', import.meta.url));
const ROLE = 'PARENT';
let code = '';

beforeAll(async () => {
  const out = await build({
    entryPoints: [fileURLToPath(new URL('./script-tag.ts', import.meta.url))],
    bundle: true,
    format: 'iife',
    globalName: 'NextGen',
    platform: 'browser',
    target: 'es2020',
    write: false,
  });
  code = out.outputFiles[0]!.text;
}, 120_000);

const rejections: unknown[] = [];
const onRejection = (reason: unknown): void => void rejections.push(reason);
process.on('unhandledRejection', onRejection);
afterEach(() => {
  rejections.length = 0;
});

interface Page {
  readonly window: JSDOM['window'];
  readonly fetched: string[];
  readonly warnings: string[];
}

function page(attributes: Record<string, string>, options: { missing?: boolean; body?: string } = {}): Page {
  const virtualConsole = new VirtualConsole();
  const warnings: string[] = [];
  virtualConsole.on('warn', (...args: unknown[]) => void warnings.push(args.map(String).join(' ')));
  const dom = new JSDOM(`<!doctype html><html lang="pt-PT"><head><title>t</title></head><body>${options.body ?? ''}</body></html>`, {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    url: 'https://clube.test/my/children/7',
    virtualConsole,
  });
  const { window } = dom;
  const fetched: string[] = [];
  Object.assign(window, {
    fetch: async (url: string) => {
      fetched.push(url);
      if (options.missing) return { ok: false, status: 404, json: async () => ({}) };
      const file = url.split('/').pop()!;
      return { ok: true, status: 200, json: async () => JSON.parse(readFileSync(`${GEN}${file}`, 'utf8')) };
    },
  });
  const script = window.document.createElement('script');
  for (const [name, value] of Object.entries(attributes)) script.setAttribute(name, value);
  script.textContent = code;
  window.document.body.append(script);
  return { window, fetched, warnings };
}

async function settle(until: () => boolean): Promise<void> {
  for (let i = 0; i < 200 && !until(); i++) await new Promise((resolve) => setTimeout(resolve, 10));
}

describe('the script tag starts itself from its own attributes', () => {
  it('starts from data-nextgen-role and data-nextgen-base, with no inline call', async () => {
    const { window, fetched } = page({ 'data-nextgen-role': ROLE, 'data-nextgen-base': '/nextgen/' });
    await settle(() => window.document.querySelector('[data-nextgen]') !== null);

    expect(window.document.querySelector('[data-nextgen]')).not.toBeNull();
    expect([...fetched].sort()).toEqual([`/nextgen/index.${ROLE}.json`, `/nextgen/registry.${ROLE}.json`, '/nextgen/thresholds.hashing.json']);
    const corner = window.document.querySelector('[data-nextgen]')!.parentElement as HTMLElement;
    expect(corner.style.bottom).toBe('16px');
    expect(corner.style.right).toBe('16px');
  });

  it('does nothing at all without data-nextgen-role', async () => {
    const { window, fetched } = page({ 'data-nextgen-base': '/nextgen' });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(fetched).toEqual([]);
    expect(window.document.querySelector('[data-nextgen]')).toBeNull();
    // Still a library: the globals are there for a page that calls them itself.
    expect(typeof (window as unknown as { NextGen: { start: unknown } }).NextGen.start).toBe('function');
  });

  it('mounts inside data-nextgen-target, or in the corner data-nextgen-position names', async () => {
    const inside = page({ 'data-nextgen-role': ROLE, 'data-nextgen-base': '/nextgen', 'data-nextgen-target': '#slot' }, { body: '<div id="slot"></div>' });
    await settle(() => inside.window.document.querySelector('#slot [data-nextgen]') !== null);
    expect(inside.window.document.querySelector('#slot [data-nextgen]')).not.toBeNull();

    const cornered = page({ 'data-nextgen-role': ROLE, 'data-nextgen-base': '/nextgen', 'data-nextgen-position': 'top-left' });
    await settle(() => cornered.window.document.querySelector('[data-nextgen]') !== null);
    const corner = cornered.window.document.querySelector('[data-nextgen]')!.parentElement as HTMLElement;
    expect(corner.style.top).toBe('16px');
    expect(corner.style.left).toBe('16px');
  });

  it('warns and ignores a position that is not one of the four corners — it never becomes CSS', async () => {
    const { window, warnings } = page({ 'data-nextgen-role': ROLE, 'data-nextgen-base': '/nextgen', 'data-nextgen-position': 'bottom:0;background:red' });
    await settle(() => window.document.querySelector('[data-nextgen]') !== null);
    expect(warnings.join('\n')).toMatch(/ignoring data-nextgen-position/);
    const corner = window.document.querySelector('[data-nextgen]')!.parentElement as HTMLElement;
    expect(corner.style.background).toBe('');
    expect(corner.style.right).toBe('16px');
  });

  it('warns, and throws nothing, when a target matches nothing or the bundle cannot be loaded', async () => {
    const noTarget = page({ 'data-nextgen-role': ROLE, 'data-nextgen-base': '/nextgen', 'data-nextgen-target': '#absent' });
    await settle(() => noTarget.warnings.length > 0);
    expect(noTarget.warnings.join('\n')).toMatch(/matches nothing/);
    expect(noTarget.fetched).toEqual([]);

    const missing = page({ 'data-nextgen-role': ROLE, 'data-nextgen-base': '/nextgen' }, { missing: true });
    await settle(() => missing.warnings.length > 0);
    expect(missing.warnings.join('\n')).toMatch(/\[NextGen\] the assistant did not start: .*404/);
    expect(missing.window.document.querySelector('[data-nextgen]')).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(rejections).toEqual([]);
  });
});
