import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { validateRegistry } from '@nextgen/core-capability';

import { generate } from './generate.ts';
import { writeOutput } from './emit.ts';
import { FIXTURE_CONFIG, FIXTURE_ROOT } from './fixture-app.ts';
import type { GeneratorOutput } from './types.ts';

const run = () => generate({ config: FIXTURE_CONFIG, model: null });

const skipFor = (output: GeneratorOutput, path: string) =>
  output.skipped.find((entry) => entry.path === path);

describe('generate — end to end, with no model', () => {
  it('declares the destinations and nothing else', async () => {
    const output = await run();
    expect(output.master.map((c) => c.route).sort()).toEqual([
      '/admin/users',
      '/my/child',
      '/settings',
      '/settings/notifications',
      '/squad',
      '/squad/players',
      '/squad/players/:id',
    ]);
  });

  it('records why each omitted route was omitted', async () => {
    const output = await run();
    expect(skipFor(output, '/squad/teams')?.reason).toBe('declared-legacy');
    expect(skipFor(output, '/dev/icons')?.reason).toBe('dev-only');
    expect(skipFor(output, '/admin/unreadable')?.reason).toBe('unresolved-roles');
    expect(skipFor(output, '/squad/legacy-player/:id')?.reason).toBe('bookmark-redirect');
    for (const entry of output.skipped) expect(entry.detail.length).toBeGreaterThan(10);
  });

  // The two halves of WP-30's most consequential miss, in one assertion: a
  // redirect that stays inside its own section is that section's landing page,
  // and a component that renders a real view is a destination whatever its name.
  it('keeps a section landing and a data-resolving redirect', async () => {
    const routes = (await run()).master.map((c) => c.route);
    expect(routes).toContain('/settings');
    expect(routes).toContain('/my/child');
  });

  it('never guesses a kind that could execute', async () => {
    const output = await run();
    expect([...new Set(output.master.map((c) => c.kind))]).toEqual(['navigate']);
  });

  it('declares the params a route needs to be built at all', async () => {
    const detail = (await run()).master.find((c) => c.route === '/squad/players/:id');
    expect(detail?.params).toMatchObject({ id: { type: 'string', required: true } });
  });

  it('emits a registry per role that the engine accepts', async () => {
    const output = await run();
    expect([...output.registries.keys()]).toEqual(['ADMIN', 'COACH', 'PARENT']);
    for (const [role, registry] of output.registries) {
      const result = validateRegistry(registry);
      expect(result.errors, `${role}: ${result.errors.map((e) => e.message).join('; ')}`).toEqual([]);
    }
  });

  it('gives a guardian no sight of the administration surface (Rule 17)', async () => {
    const output = await run();
    const guardian = JSON.stringify(output.registries.get('PARENT'));
    expect(guardian).not.toContain('/admin/users');
    expect(guardian).not.toContain('admin.users');
  });

  it('declares at least two limits, each with wording of its own', async () => {
    const output = await run();
    expect(output.boundaries.length).toBeGreaterThanOrEqual(2);
    for (const boundary of output.boundaries) {
      expect(boundary.kind).toBe('unsupported');
      expect(boundary.route).toBeNull();
      expect(boundary.refusal?.length ?? 0).toBeGreaterThan(20);
    }
  });
});

/**
 * WP-25 acceptance: "deterministic — same source ⇒ same registry, or the diff
 * is explainable". Without a model this is exact. With one it holds because
 * prose is cached against a hash of the facts that produced it, so a second run
 * over unchanged source reuses every sentence rather than re-rolling it —
 * Finding 10 measured two identical 8B runs disagreeing on 7 of 200 entries, so
 * "temperature 0" was never going to be the answer.
 */
describe('generate — determinism', () => {
  it('produces byte-identical output from unchanged source', async () => {
    const [first, second] = await Promise.all([run(), run()]);
    expect(JSON.stringify(second.master)).toBe(JSON.stringify(first.master));
    expect(JSON.stringify([...second.registries])).toBe(JSON.stringify([...first.registries]));
    expect(JSON.stringify(second.skipped)).toBe(JSON.stringify(first.skipped));
  });
});

/** A recursive fingerprint of a directory: names, sizes, and contents. */
function fingerprint(directory: string): string {
  const hash = createHash('sha256');
  const walk = (current: string): void => {
    for (const entry of readdirSync(current).sort()) {
      const path = join(current, entry);
      const stats = statSync(path);
      hash.update(`${path}:${stats.size}`);
      if (stats.isDirectory()) walk(path);
      else hash.update(readFileSync(path));
    }
  };
  walk(directory);
  return hash.digest('hex');
}

/**
 * Rule 16, proven mechanically rather than promised.
 *
 * "The installer never modifies the adopter's source. It reads their code and
 * writes only new, additive artefacts, and removing it must leave the app
 * exactly as it was." WP-25's acceptance asks for a test that `git status` in
 * the target stays clean; a content fingerprint is the same assertion without
 * needing the target to be a git repository.
 */
describe('generate — Rule 16', () => {
  it('leaves the application it read byte-for-byte unchanged', async () => {
    const before = fingerprint(FIXTURE_ROOT);
    const output = await run();
    writeOutput(mkdtempSync(join(tmpdir(), 'nextgen-out-')), FIXTURE_ROOT, output);
    expect(fingerprint(FIXTURE_ROOT)).toBe(before);
  });
});
