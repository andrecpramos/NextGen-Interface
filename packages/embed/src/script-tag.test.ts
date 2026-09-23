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

const GEN = fileURLToPath(new URL('../../../eval/frameworks/family/generated/', import.meta.url));
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

function page(
  attributes: Record<string, string>,
  options: { missing?: boolean; body?: string; lang?: string; beforeScript?: (window: JSDOM['window']) => void } = {},
): Page {
  const virtualConsole = new VirtualConsole();
  const warnings: string[] = [];
  virtualConsole.on('warn', (...args: unknown[]) => void warnings.push(args.map(String).join(' ')));
  const dom = new JSDOM(`<!doctype html><html lang="${options.lang ?? 'pt-PT'}"><head><title>t</title></head><body>${options.body ?? ''}</body></html>`, {
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
  options.beforeScript?.(window);
  const script = window.document.createElement('script');
  for (const [name, value] of Object.entries(attributes)) script.setAttribute(name, value);
  script.textContent = code;
  window.document.body.append(script);
  return { window, fetched, warnings };
}

function orbSide(window: Page['window']): string | null {
  return window.document.querySelector('[data-nextgen]')?.shadowRoot?.querySelector('.orb')?.getAttribute('data-side') ?? null;
}

async function settle(until: () => boolean): Promise<void> {
  for (let i = 0; i < 200 && !until(); i++) await new Promise((resolve) => setTimeout(resolve, 10));
}

describe('the script tag starts itself from its own attributes', () => {
  it('starts from data-nextgen-role and data-nextgen-base, with no inline call', async () => {
    const { window, fetched } = page({ 'data-nextgen-role': ROLE, 'data-nextgen-base': '/nextgen/' });
    await settle(() => window.document.querySelector('[data-nextgen]') !== null);

    const host = window.document.querySelector('[data-nextgen]')!;
    expect(host).not.toBeNull();
    expect([...fetched].sort()).toEqual([`/nextgen/index.${ROLE}.json`, `/nextgen/registry.${ROLE}.json`, '/nextgen/thresholds.hashing.json']);
    // The assistant layer, on the page's body: it positions itself.
    expect(host.hasAttribute('data-nextgen-assistant')).toBe(true);
    expect(host.parentElement).toBe(window.document.body);
  });

  it('does nothing at all without data-nextgen-role', async () => {
    const { window, fetched } = page({ 'data-nextgen-base': '/nextgen' });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(fetched).toEqual([]);
    expect(window.document.querySelector('[data-nextgen]')).toBeNull();
    // Still a library: the globals are there for a page that calls them itself.
    expect(typeof (window as unknown as { NextGen: { start: unknown } }).NextGen.start).toBe('function');
  });

  it('mounts inside data-nextgen-target, and rests the orb on the side data-nextgen-position names', async () => {
    const inside = page({ 'data-nextgen-role': ROLE, 'data-nextgen-base': '/nextgen', 'data-nextgen-target': '#slot' }, { body: '<div id="slot"></div>' });
    await settle(() => inside.window.document.querySelector('#slot [data-nextgen]') !== null);
    expect(inside.window.document.querySelector('#slot [data-nextgen]')).not.toBeNull();

    const cornered = page({ 'data-nextgen-role': ROLE, 'data-nextgen-base': '/nextgen', 'data-nextgen-position': 'top-left' });
    await settle(() => cornered.window.document.querySelector('[data-nextgen]') !== null);
    expect(orbSide(cornered.window)).toBe('left');
  });

  it('offers attachments only when data-nextgen-attach says "on" — an app with nowhere to send a file should not offer one', async () => {
    const offered = (window: Page['window']) => {
      const root = window.document.querySelector('[data-nextgen]')?.shadowRoot;
      return { paperclip: !root?.querySelector('.attach')?.hasAttribute('hidden'), camera: root?.querySelector('.camera') ?? null };
    };
    const plain = page({ 'data-nextgen-role': ROLE, 'data-nextgen-base': '/nextgen' });
    await settle(() => plain.window.document.querySelector('[data-nextgen]') !== null);
    expect(offered(plain.window).paperclip).toBe(false);

    for (const value of ['on', 'true', 'yes', '1', ' ON ']) {
      const on = page({ 'data-nextgen-role': ROLE, 'data-nextgen-base': '/nextgen', 'data-nextgen-attach': value });
      await settle(() => on.window.document.querySelector('[data-nextgen]') !== null);
      expect(offered(on.window).paperclip, value).toBe(true);
    }
    for (const value of ['off', 'false', 'no', '0', 'maybe']) {
      const off = page({ 'data-nextgen-role': ROLE, 'data-nextgen-base': '/nextgen', 'data-nextgen-attach': value });
      await settle(() => off.window.document.querySelector('[data-nextgen]') !== null);
      expect(offered(off.window).paperclip, value).toBe(false);
    }
  });

  it('warns and ignores a position that is not one of the four corners — it never becomes CSS', async () => {
    const { window, warnings } = page({ 'data-nextgen-role': ROLE, 'data-nextgen-base': '/nextgen', 'data-nextgen-position': 'bottom:0;background:red' });
    await settle(() => window.document.querySelector('[data-nextgen]') !== null);
    expect(warnings.join('\n')).toMatch(/ignoring data-nextgen-position/);
    const host = window.document.querySelector('[data-nextgen]') as HTMLElement;
    // Its only inline style is the theme it read from the page.
    expect(host.getAttribute('style') ?? '').not.toMatch(/bottom:\s*0|background:\s*red/);
    // jsdom draws nothing at the edges, so the emptier side is the default one.
    expect(orbSide(window)).toBe('right');
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

  it('announces a failure to start on the window as nextgen:error, with a reason — never silent', async () => {
    const events: { reason: string; message: string }[] = [];
    const missing = page({ 'data-nextgen-role': ROLE, 'data-nextgen-base': '/nextgen' }, { missing: true, beforeScript: (window) => {
      window.addEventListener('nextgen:error', (event) => void events.push((event as CustomEvent).detail));
    } });
    await settle(() => events.length > 0);
    expect(events).toHaveLength(1);
    expect(events[0]!.reason).toBe('bundle-unavailable');
    expect(events[0]!.message).toMatch(/404.*restarted/);
    expect(missing.window.document.querySelector('[data-nextgen]')).toBeNull();
  });

  it('keeps the distance from the corner data-nextgen-inset gives, and ignores one that is not two numbers', async () => {
    const inset = page({ 'data-nextgen-role': ROLE, 'data-nextgen-base': '/nextgen', 'data-nextgen-inset': '24, 144' });
    await settle(() => inset.window.document.querySelector('[data-nextgen]') !== null);
    const host = inset.window.document.querySelector('[data-nextgen]') as HTMLElement;
    expect(host.style.getPropertyValue('--ng-inset-x')).toBe('24px');
    expect(host.style.getPropertyValue('--ng-inset-y')).toBe('144px');

    const bad = page({ 'data-nextgen-role': ROLE, 'data-nextgen-base': '/nextgen', 'data-nextgen-inset': '1px;color:red' });
    await settle(() => bad.window.document.querySelector('[data-nextgen]') !== null);
    expect(bad.warnings.join('\n')).toMatch(/ignoring data-nextgen-inset/);
    expect((bad.window.document.querySelector('[data-nextgen]') as HTMLElement).style.getPropertyValue('--ng-inset-y')).toBe('20px');
  });

  it('serves a user with several roles from each role’s registry, merged, with no index to fetch', async () => {
    const { window, fetched } = page({ 'data-nextgen-role': 'COACH PARENT', 'data-nextgen-base': '/nextgen' });
    await settle(() => window.document.querySelector('[data-nextgen]') !== null);
    expect(window.document.querySelector('[data-nextgen]')).not.toBeNull();
    expect([...fetched].sort()).toEqual(['/nextgen/registry.COACH.json', '/nextgen/registry.PARENT.json', '/nextgen/thresholds.hashing.json']);
  });

  it('speaks Portuguese on a Portuguese page and English on any other, fetching nothing more for it', async () => {
    const greeting = (w: Page['window']) => w.document.querySelector('[data-nextgen]')!.shadowRoot!.querySelector('.greeting')!.textContent;
    const pt = page({ 'data-nextgen-role': ROLE, 'data-nextgen-base': '/nextgen' }, { lang: 'pt-PT' });
    await settle(() => pt.window.document.querySelector('[data-nextgen]') !== null);
    expect(greeting(pt.window)).toBe('Pronto quando quiser.');

    const es = page({ 'data-nextgen-role': ROLE, 'data-nextgen-base': '/nextgen' }, { lang: 'es-ES' });
    await settle(() => es.window.document.querySelector('[data-nextgen]') !== null);
    expect(greeting(es.window)).toBe('Ready when you are.');
    expect(es.fetched.every((url) => !url.includes('words'))).toBe(true);
  });

  it('hides the app’s own launchers named by data-nextgen-hide while it runs', async () => {
    const { window } = page(
      { 'data-nextgen-role': ROLE, 'data-nextgen-base': '/nextgen', 'data-nextgen-hide': '#club-chat, .tour-prompt' },
      { body: '<button id="club-chat">Chat</button><div class="tour-prompt">Take the tour</div><button id="keep">Keep</button>' },
    );
    await settle(() => window.document.querySelector('[data-nextgen]') !== null);
    const shown = (selector: string) => window.getComputedStyle(window.document.querySelector(selector)!).display !== 'none';
    expect(shown('#club-chat')).toBe(false);
    expect(shown('.tour-prompt')).toBe(false);
    expect(shown('#keep')).toBe(true);
  });
});
