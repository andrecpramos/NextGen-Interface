import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { build } from './build.ts';
import { init } from './detect.ts';
import { preview, type Preview } from './preview.ts';
import { report } from './report.ts';

/**
 * Readiness item 5: try it before wiring it in (`preview`), and send back what was found
 * (`doctor --report`). The browser half of the page — the widget starting under a strict
 * policy — is what tooling/scripts/check-csp.mjs proves; this checks what the server gives it.
 */

const TINY = fileURLToPath(new URL('../../generator/fixtures/tiny-app', import.meta.url));
let kit = '';
let roles: readonly string[] = [];
let server: Preview;

beforeAll(async () => {
  kit = join(mkdtempSync(join(tmpdir(), 'nextgen-preview-')), 'nextgen');
  init(TINY, kit);
  roles = (await build(kit)).roles;
  server = await preview(kit, { port: 0, appUrl: 'http://localhost:3000' });
}, 60_000);

afterAll(async () => {
  await server?.close();
});

const get = (path: string) => fetch(new URL(path, server.url));

describe('nextgen preview', () => {
  it('serves a page that starts the widget with the one-line script tag, under a strict policy', async () => {
    const response = await get('/');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-security-policy')).toMatch(/script-src 'self'; style-src 'self'/);
    const html = await response.text();
    expect(html).toContain(`<script src="/nextgen/nextgen.js" data-nextgen-role="${roles[0]}"`);
    expect(html).not.toMatch(/<script>|<style>|style="/); // nothing inline for the policy to block
    expect(html).toContain('data-app-url="http://localhost:3000/"');
    for (const role of roles) expect(html).toContain(`/?role=${encodeURIComponent(role)}`);
    expect(html).toMatch(/serve each signed-in user only their own role's files: a role's file lists the screens it can reach/);
  });

  it('switches role, and never writes a role this build does not have into the page', async () => {
    const other = roles[roles.length - 1]!;
    expect(await (await get(`/?role=${encodeURIComponent(other)}`)).text()).toContain(`data-nextgen-role="${other}"`);
    const hostile = await (await get('/?role=%22%3E%3Cscript%3Ealert(1)%3C%2Fscript%3E')).text();
    expect(hostile).not.toContain('alert(1)');
    expect(hostile).toContain(`data-nextgen-role="${roles[0]}"`);
  });

  it('serves the bundle, and nothing outside it', async () => {
    expect((await get('/nextgen/nextgen.js')).status).toBe(200);
    expect((await get(`/nextgen/registry.${roles[0]}.json`)).status).toBe(200);
    expect((await get('/preview.js')).status).toBe(200);
    for (const outside of ['/nextgen/..%2Freview%2Fmaster.json', '/nextgen/%2E%2E/review/build.json', '/review/master.json', '/nextgen/.hidden']) {
      expect((await get(outside)).status).toBe(404);
    }
  });

  it('refuses a folder that has not been built', async () => {
    await expect(preview(join(mkdtempSync(join(tmpdir(), 'nextgen-empty-')), 'nextgen'), { port: 0 })).rejects.toThrow(/Run "node scan.mjs build \S+" first/);
  });
});

describe('nextgen doctor --report', () => {
  it('writes doctor, every declared screen with its roles, and everything left out', () => {
    const markdown = report(kit);
    expect(markdown).toMatch(/^# NextGen kit report/);
    expect(markdown).toMatch(/Share it only\n> with people who may know that/);
    expect(markdown).toContain('```text\nnextgen doctor');
    expect(markdown).toMatch(/## Every screen it declared \(\d+\)/);
    expect(markdown).toMatch(/\| `\/squad` \|/);
    expect(markdown).toMatch(/## Everything it left out \(\d+\)/);
  });
});
