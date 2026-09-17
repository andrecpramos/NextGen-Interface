import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { build } from './build.ts';
import { init } from './detect.ts';
import { doctor } from './doctor.ts';
import { sweepingTools } from './tooling.ts';

/**
 * Readiness item 4: the kit folder must not turn the adopter's CI red, and a multi-role
 * bundle must not be served to everyone.
 */

const TINY = fileURLToPath(new URL('../../generator/fixtures/tiny-app', import.meta.url));

function project(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'nextgen-tooling-'));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(dir, path, '..'), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  return dir;
}

const manifest = (scripts: Record<string, string>): string => JSON.stringify({ name: 'app', scripts });

describe('sweepingTools', () => {
  it('names Prettier when a check runs over the whole project, with the line to add', () => {
    const dir = project({ 'package.json': manifest({ 'format:check': 'prettier --check .' }) });
    expect(sweepingTools(dir, join(dir, 'nextgen'))).toEqual([
      { tool: 'Prettier', script: 'format:check', fix: 'add "nextgen/" to .prettierignore', certain: true },
    ]);
  });

  it('is satisfied by .prettierignore, or by .gitignore, which Prettier 3 honours', () => {
    const scripts = { format: 'prettier --write .' };
    const ignored = project({ 'package.json': manifest(scripts), '.prettierignore': 'dist\nnextgen/\n' });
    const gitIgnored = project({ 'package.json': manifest(scripts), '.gitignore': 'node_modules\nnextgen\n' });
    expect(sweepingTools(ignored, join(ignored, 'nextgen'))).toEqual([]);
    expect(sweepingTools(gitIgnored, join(gitIgnored, 'nextgen'))).toEqual([]);
  });

  it('names ESLint for `eslint .` with a flat config that does not ignore the folder, and not once it does', () => {
    const scripts = { lint: 'eslint .' };
    const bare = project({ 'package.json': manifest(scripts), 'eslint.config.js': "export default [{ ignores: ['dist'] }];" });
    const covered = project({ 'package.json': manifest(scripts), 'eslint.config.js': "export default [{ ignores: ['dist', 'nextgen/**'] }];" });
    expect(sweepingTools(bare, join(bare, 'nextgen'))).toMatchObject([{ tool: 'ESLint', script: 'lint', certain: false }]);
    expect(sweepingTools(covered, join(covered, 'nextgen'))).toEqual([]);
  });

  it('names Biome, which checks the whole project when given no path', () => {
    const dir = project({ 'package.json': manifest({ check: 'biome check' }) });
    expect(sweepingTools(dir, join(dir, 'nextgen'))).toMatchObject([{ tool: 'Biome', script: 'check' }]);
  });

  it('says nothing when a script reads only src, even with a flag that takes a value', () => {
    const dir = project({
      'package.json': manifest({ lint: 'eslint src --ignore-path .gitignore', format: 'prettier --check "src/**/*.ts"', nextLint: 'next lint' }),
    });
    expect(sweepingTools(dir, join(dir, 'nextgen'))).toEqual([]);
  });

  it('says nothing when the kit folder is outside the project', () => {
    const dir = project({ 'package.json': manifest({ format: 'prettier --check .' }) });
    expect(sweepingTools(dir, join(tmpdir(), 'elsewhere', 'nextgen'))).toEqual([]);
  });
});

describe('doctor — before you ship', () => {
  function tinyApp(scripts: Record<string, string>): string {
    const dir = mkdtempSync(join(tmpdir(), 'nextgen-doctor-'));
    cpSync(TINY, dir, { recursive: true });
    writeFileSync(join(dir, 'package.json'), manifest(scripts));
    return dir;
  }

  it('passes a formatter warning on, and points a multi-role app at the serving recipes', async () => {
    const dir = tinyApp({ 'format:check': 'prettier --check .' });
    const kit = join(dir, 'nextgen');
    init(dir, kit);
    const record = await build(kit);
    expect(record.roles.length).toBeGreaterThan(1);
    const report = doctor(kit);
    expect(report.ok).toBe(true);
    expect(report.text).toMatch(/Prettier runs over your whole project \(script "format:check"\)/);
    expect(report.text).toMatch(/add "nextgen\/" to \.prettierignore/);
    // The pointer differs by installation path: an adopter who copied adapter/ has no
    // node_modules, and used to be sent to one. What must always be there is the rule and
    // somewhere to read the handlers.
    expect(report.text).toMatch(/Ready-made handlers for Express and Next.js/);
    expect(report.text).toMatch(/role comes from your session, never from the request/);
  }, 60_000);

  it('refuses a multi-role bundle inside public/, which the app serves to everyone', async () => {
    const dir = tinyApp({});
    const kit = join(dir, 'public', 'nextgen');
    init(dir, kit);
    await build(kit);
    const report = doctor(kit);
    expect(report.ok).toBe(false);
    expect(report.text).toMatch(/public\/nextgen\/bundle is served to everyone/);
  }, 60_000);
});
