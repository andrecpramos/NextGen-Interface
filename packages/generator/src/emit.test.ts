import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { validateRegistry } from '@nextgen/core-capability';

import { formatControlsReport, formatInferredReport, formatSkipReport, splitByRole, writeOutput } from './emit.ts';
import type { AnnotatedCapability, GeneratorOutput } from './types.ts';

const capability = (id: string, roles: string[]): AnnotatedCapability => ({
  id,
  kind: 'navigate',
  route: `/${id.replace('.', '/')}`,
  title: id,
  description: `The ${id} screen, described well enough for stage-2 retrieval to have something to work with.`,
  explanation: `This is the ${id} screen. You come here to see what it holds and to work with it directly.`,
  explanationSource: `src/features/${id.split('.')[0]}/pages/Page.tsx`,
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
 * A role-gated app leaks through one ADMIN capability in a guardian's
 * registry reveals the shape of a surface that user must not know exists —
 * route names, screen titles, the vocabulary of an administrative system.
 * Generator role handling has zero tolerance for exactly this reason, so the property is asserted by diffing two registries
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

  // A limit goes to every role, but where it points is a screen: a route a role cannot open would name
  // the admin surface in a guardian's file — and be a link to nowhere.
  it('keeps where a limit points only where the role can open it, and drops it when none is left', () => {
    const pointing = { ...boundary, helpAt: ['/admin/users', '/my/child'] };
    const split = splitByRole(master, [pointing], 'A club application.', ['ADMIN', 'COACH', 'PARENT']);
    const limitOf = (role: string) => split.get(role)!.capabilities.find((c) => c.id === 'unsupported.payments')!;
    expect(limitOf('ADMIN').helpAt).toEqual(['/admin/users']);
    expect(limitOf('PARENT').helpAt).toEqual(['/my/child']);
    expect(limitOf('COACH')).not.toHaveProperty('helpAt');
    expect(JSON.stringify(split.get('PARENT'))).not.toContain('/admin/users');
    for (const registry of split.values()) expect(validateRegistry(registry).ok).toBe(true);
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

/**
 * ADR-042: Rule 17 for what a screen lets a visitor do. A control only some of a screen's roles may use is
 * absent from the others' registries — and which roles may use it is never shipped to anyone.
 */
describe('splitByRole — controls only some roles may use', () => {
  const sessions: AnnotatedCapability = {
    ...capability('training.sessions', ['ADMIN', 'COACH', 'PARENT']),
    actions: ['Export PDF', 'Cancel session', 'Excuse an absence'],
    actionRoles: { 'Cancel session': ['ADMIN', 'COACH'], 'Excuse an absence': ['PARENT'] },
    opens: ['New session'],
    opensRoles: { 'New session': ['ADMIN', 'COACH'] },
  };
  const registries = splitByRole([sessions], [], 'A club application.', ['ADMIN', 'COACH', 'PARENT']);
  const of = (role: string) => registries.get(role)!.capabilities[0]!;

  it('gives each role only the controls it may use', () => {
    expect(of('COACH').actions).toEqual(['Export PDF', 'Cancel session']);
    expect(of('PARENT').actions).toEqual(['Export PDF', 'Excuse an absence']);
    expect(of('COACH').opens).toEqual(['New session']);
    expect(of('PARENT').opens).toBeUndefined();
  });

  it('ships no role annotation of any kind', () => {
    for (const [, registry] of registries) {
      const text = JSON.stringify(registry);
      for (const leak of ['actionRoles', 'opensRoles', '"roles"']) expect(text).not.toContain(leak);
    }
  });

  it('emits registries the engine will accept', () => {
    for (const [role, registry] of registries) expect(validateRegistry(registry).errors, role).toEqual([]);
  });

  it('reports every control, who may use it, and what was left out — for the developer, in the review only', () => {
    const report = formatControlsReport([sessions], [{ route: '/training/sessions', names: ['Delete session'] }])!;
    expect(report).toContain('## /training/sessions — training.sessions');
    expect(report).toContain('- Opens: New session (ADMIN, COACH)');
    expect(report).toContain('- Does: Export PDF · Cancel session (ADMIN, COACH) · Excuse an absence (PARENT)');
    expect(report).toContain('- /training/sessions: Delete session');
    expect(formatControlsReport([capability('my.child', ['PARENT'])], [])).toBeNull();
  });
});

describe('writeOutput — Rule 16', () => {
  const output: GeneratorOutput = {
    registries: splitByRole(master, [boundary], 'A club application.', ['ADMIN']),
    master,
    boundaries: [boundary],
    skipped: [{ path: '/dev/icons', reason: 'dev-only', detail: 'development builds only' }],
    reviewInferred: [],
    domainDescription: 'A club application.',
    roles: ['ADMIN'],
  };

  /**
   * The installer never modifies the adopter's source. A tool that edits a
   * repository it does not own cannot be cleanly uninstalled and turns every
   * upgrade into a merge conflict — Rule 16, and the reason the adapter is a
   * folder that is copied rather than code that is merged. This guard is the one line between this package and that promise.
   */
  it('refuses to write anywhere inside the application it read', () => {
    const appRoot = mkdtempSync(join(tmpdir(), 'nextgen-app-'));
    expect(() => writeOutput(join(appRoot, 'generated'), appRoot, output)).toThrow(/never writes inside your app/);
    expect(() => writeOutput(appRoot, appRoot, output)).toThrow(/never writes inside your app/);
  });

  it('writes one registry per role, a master and both reports, outside the app', () => {
    const appRoot = mkdtempSync(join(tmpdir(), 'nextgen-app-'));
    const out = mkdtempSync(join(tmpdir(), 'nextgen-out-'));
    const result = writeOutput(out, appRoot, output);

    expect(result.invalid).toEqual([]);
    expect(readdirSync(out).sort()).toEqual(['INFERRED.md', 'SKIPPED.md', 'master.json', 'registry.ADMIN.json']);
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
    // Why a guard it could not read drops the route, in words an adopter can act on — not a rule number.
    expect(report).toContain('no role is shown a screen it cannot open');
  });
});

describe('formatInferredReport — ADR-020', () => {
  it('says plainly that nothing was found, rather than an empty section', () => {
    expect(formatInferredReport([])).toContain('Nothing found.');
  });

  it('quotes the raw source for every candidate that was not shipped', () => {
    const report = formatInferredReport([
      { route: '/expenses', pattern: 'disabled-submit', source: 'features/expenses/ExpensePage.tsx:5', detail: 'isSubmitting' },
      { route: '/members', pattern: 'guard-message', source: 'features/members/MemberPage.tsx:4', detail: 'if (!isLoggedIn) {…}' },
    ]);
    expect(report).toContain('/expenses');
    expect(report).toContain('isSubmitting');
    expect(report).toContain('features/expenses/ExpensePage.tsx:5');
    expect(report).toContain('/members');
    // The reason, in words: the adopter reading review/INFERRED.md has no ADRs to look up.
    expect(report).toContain('can be wrong in a way a declared one cannot');
    expect(report).not.toMatch(/ADR-\d/);
  });
});
