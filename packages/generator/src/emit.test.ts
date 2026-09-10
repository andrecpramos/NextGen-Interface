import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { validateRegistry } from '@nextgen/core-capability';

import { formatSkipReport, splitByRole, writeOutput } from './emit.ts';
import type { AnnotatedCapability, GeneratorOutput } from './types.ts';

const capability = (id: string, roles: string[]): AnnotatedCapability => ({
  id,
  kind: 'navigate',
  route: `/${id.replace('.', '/')}`,
  title: id,
  description: `The ${id} screen, described well enough for stage-2 retrieval to have something to work with.`,
  examples: ['one example', 'another example', 'a third example'],
  roles,
});

const boundary = {
  id: 'unsupported.payments',
  kind: 'unsupported',
  route: null,
  title: 'Processing a payment',
  description: 'Paying an invoice or a fee — outside what this application does.',
  refusal: 'I can show you invoices, but I can’t pay one for you.',
  examples: ['pay this invoice', 'process my fee', 'paga esta fatura'],
};

const master = [
  capability('admin.users', ['ADMIN']),
  capability('squad.players', ['COACH', 'ADMIN']),
  capability('my.child', ['PARENT']),
];

/**
 * Rule 17 is a security property, not a UX filter.
 *
 * `fut-app` is role-gated throughout, and one ADMIN capability in a guardian's
 * registry reveals the shape of a surface that user must not know exists —
 * route names, screen titles, the vocabulary of an administrative system.
 * PLAN.md §8 gives generator role handling a zero-tolerance kill criterion for
 * exactly this reason, so the property is asserted by diffing two registries
 * rather than by inspecting the code that builds them.
 */
describe('splitByRole — Rule 17', () => {
  const registries = splitByRole(master, [boundary], 'A club application.', ['ADMIN', 'COACH', 'PARENT']);

  it('gives each role only what that role can reach', () => {
    expect(registries.get('ADMIN')?.capabilities.map((c) => c.id).sort()).toEqual([
      'admin.users',
      'squad.players',
      'unsupported.payments',
    ]);
    expect(registries.get('PARENT')?.capabilities.map((c) => c.id).sort()).toEqual([
      'my.child',
      'unsupported.payments',
    ]);
  });

  it('makes an unreachable capability absent, not hidden', () => {
    const guardian = registries.get('PARENT')!;
    const admin = registries.get('ADMIN')!;
    const guardianIds = new Set(guardian.capabilities.map((c) => c.id));
    const adminOnly = admin.capabilities.filter((c) => c.kind !== 'unsupported' && !guardianIds.has(c.id));

    expect(adminOnly.map((c) => c.id)).toContain('admin.users');
    // Not merely filtered out of a list: nothing in the guardian's registry
    // mentions the route, the title or the id.
    expect(JSON.stringify(guardian)).not.toContain('admin.users');
    expect(JSON.stringify(guardian)).not.toContain('/admin/users');
  });

  it('ships no role annotation to anyone', () => {
    for (const registry of registries.values()) {
      for (const entry of registry.capabilities) {
        expect(entry).not.toHaveProperty('roles');
      }
    }
  });

  it('declares the application’s limits to every role', () => {
    for (const registry of registries.values()) {
      expect(registry.capabilities.some((c) => c.kind === 'unsupported')).toBe(true);
    }
  });

  it('emits registries the engine will accept', () => {
    for (const [role, registry] of registries) {
      const result = validateRegistry(registry);
      expect(result.errors, `${role}: ${result.errors.map((e) => e.message).join('; ')}`).toEqual([]);
    }
  });
});

describe('writeOutput — Rule 16', () => {
  const output: GeneratorOutput = {
    registries: splitByRole(master, [boundary], 'A club application.', ['ADMIN']),
    master,
    boundaries: [boundary],
    skipped: [{ path: '/dev/icons', reason: 'dev-only', detail: 'development builds only' }],
    domainDescription: 'A club application.',
    roles: ['ADMIN'],
  };

  /**
   * The installer never modifies the adopter's source. A tool that edits a
   * repository it does not own cannot be cleanly uninstalled and turns every
   * upgrade into a merge conflict — PLAN.md Rule 16, and the reason WP-26 exists
   * at all. This guard is the one line between this package and that promise.
   */
  it('refuses to write anywhere inside the application it read', () => {
    const appRoot = mkdtempSync(join(tmpdir(), 'nextgen-app-'));
    expect(() => writeOutput(join(appRoot, 'generated'), appRoot, output)).toThrow(/Rule 16/);
    expect(() => writeOutput(appRoot, appRoot, output)).toThrow(/Rule 16/);
  });

  it('writes one registry per role, a master and a report, outside the app', () => {
    const appRoot = mkdtempSync(join(tmpdir(), 'nextgen-app-'));
    const out = mkdtempSync(join(tmpdir(), 'nextgen-out-'));
    const result = writeOutput(out, appRoot, output);

    expect(result.invalid).toEqual([]);
    expect(readdirSync(out).sort()).toEqual(['SKIPPED.md', 'master.json', 'registry.ADMIN.json']);
    expect(JSON.parse(readFileSync(join(out, 'master.json'), 'utf8')).capabilities[0]).toHaveProperty('roles');
  });
});

describe('formatSkipReport', () => {
  it('quotes the application’s own evidence for every omission', () => {
    const report = formatSkipReport([
      { path: '/squad/teams', reason: 'declared-legacy', detail: 'the application says so: "Legacy team list"' },
      { path: '/admin/x', reason: 'unresolved-roles', detail: 'role guard could not be evaluated' },
    ]);
    expect(report).toContain('/squad/teams');
    expect(report).toContain('Legacy team list');
    expect(report).toContain('Rule 17');
  });
});
