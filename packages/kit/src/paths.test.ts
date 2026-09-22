import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { arg, self, shown } from './paths.ts';

/**
 * Every "Next:" line the kit prints is copied and pasted. Until 2026-09-22 each said `node scan.mjs …`
 * with an absolute kit path, which fails from the app's root — where the adopter is, and where the tool
 * is `nextgen-tool/scan.mjs` (judo_app rehearsal).
 */
describe('printed commands run from where they were printed', () => {
  const app = resolve('/work/my-app');

  it('names the tool as it was run, relative to where the person is', () => {
    expect(self(join(app, 'nextgen-tool', 'scan.mjs'), app)).toBe('node nextgen-tool/scan.mjs');
    expect(self(join(app, 'scan.mjs'), app)).toBe('node scan.mjs');
  });

  it('falls back to the bare name when this is not the copied tool', () => {
    expect(self(join(app, 'node_modules', 'vitest', 'vitest.mjs'), app)).toBe('node scan.mjs');
    expect(self(undefined, app)).toBe('node scan.mjs');
  });

  it('shows a folder below the person relative, and one elsewhere absolute', () => {
    expect(shown(join(app, 'nextgen'), app)).toBe('nextgen');
    expect(shown(app, app)).toBe('.');
    expect(shown(resolve('/elsewhere/kit'), app)).toBe(resolve('/elsewhere/kit'));
  });

  it('quotes a path with a space, so it stays one argument', () => {
    expect(arg('my kit')).toBe('"my kit"');
    expect(arg('nextgen')).toBe('nextgen');
    expect(self(join(app, 'my tools', 'scan.mjs'), app)).toBe('node "my tools/scan.mjs"');
  });
});
