import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { isChrome, readControls, type Control } from './controls.ts';
import { readRoleScope } from './discover.ts';
import type { GeneratorConfig } from './types.ts';

const DIR = fileURLToPath(new URL('../fixtures/actions/', import.meta.url));

/** The fixture's own modules, by relative import; anything else (a design system, an API module) is not read. */
const resolve = (specifier: string, from: string): string | null => {
  if (!specifier.startsWith('.')) return null;
  for (const extension of ['.tsx', '.ts']) {
    const file = `${join(dirname(from), specifier)}${extension}`;
    if (existsSync(file)) return file;
  }
  return null;
};

const scope = readRoleScope({
  appRoot: DIR,
  routesFile: 'SessionsPage.tsx',
  permissionsFile: 'permissions.ts',
  roleSetExport: 'ROUTE_ROLES',
  allRolesExport: 'APP_ROLES',
  manifests: [],
  localesDir: [],
  languages: ['en'],
} as unknown as GeneratorConfig);

const names = (controls: readonly Control[]) => controls.map((c) => c.label ?? `key:${c.labelKey}`);
const rolesOf = (controls: readonly Control[], name: string) => controls.find((c) => (c.label ?? `key:${c.labelKey}`) === name)?.roles;

/**
 * ADR-042. What a screen lets a visitor do is in its controls, and most of them are not in the page's own
 * file: a toolbar, a sheet, a list's row. They are read through the application's own components, two
 * levels down.
 */
describe('readControls — what a screen lets a visitor do', () => {
  const reading = readControls(join(DIR, 'SessionsPage.tsx'), resolve, undefined, scope);

  it('finds the controls that do something, in the page and in the components it renders', () => {
    expect(names(reading.actions)).toEqual([
      'key:sessions:actions.cancel_session',
      'Publish plan',
      'Duplicate session',
      'Remove all sessions',
      'key:common:save_changes',
      'Archive season',
      'Plan the week',
      'Excuse an absence',
      'Notify parents',
      'Schedule a match',
      'Export PDF',
      'Mark attendance',
    ]);
  });

  it('keeps what only opens something apart, as an opener', () => {
    expect(names(reading.openers)).toEqual(['New session', 'Filters']);
  });

  it('never lists a control that moves, switches a view, closes, or names no task', () => {
    for (const not of ['Back to training', 'Month', 'Close', 'Cancel', 'OK']) expect(names(reading.actions)).not.toContain(not);
  });

  it('never guesses a label that is computed', () => {
    expect(names(reading.actions).some((name) => name.startsWith('Save '))).toBe(false);
  });

  it('stops two levels below the page', () => {
    expect(names(reading.actions)).not.toContain('Add a note three levels down');
  });

  it('fails soft on a file that is not there', () => {
    expect(readControls(join(DIR, 'NoSuchPage.tsx'), resolve, undefined, scope)).toEqual({ actions: [], openers: [], guarded: [] });
  });
});

/**
 * Rule 17 for what a screen lets a visitor do: a control is listed for the roles every condition above it
 * lets through, read from the permissions module — and a condition about who that cannot be read leaves
 * it out, whatever that condition means at run time.
 */
describe('readControls — who may use each control', () => {
  const reading = readControls(join(DIR, 'SessionsPage.tsx'), resolve, undefined, scope);

  it('reads the roles from the permissions module the route table is read from', () => {
    expect(scope.allRoles).toEqual(['ADMIN', 'COACH', 'PARENT']);
  });

  it('follows a role list through a pack module that builds it from the app’s', () => {
    expect(rolesOf(reading.actions, 'Schedule a match')).toEqual(['ADMIN', 'COACH']);
  });

  it('never takes a list of something other than roles for who may do something', () => {
    expect(names(reading.actions)).not.toContain('Translate page');
    expect(names(reading.guarded)).toContain('Translate page');
  });

  it('says nothing about who when nothing above a control does', () => {
    expect(rolesOf(reading.actions, 'Publish plan')).toBeUndefined();
    expect(rolesOf(reading.actions, 'Export PDF')).toBeUndefined();
  });

  it('narrows a control to the roles a role list, a role name, or its negation lets through', () => {
    expect(rolesOf(reading.actions, 'Archive season')).toEqual(['ADMIN']);
    // `tab === 'week'` says nothing about who; `canPlan` is CAPABILITY_ROLES.sessionsManage.
    expect(rolesOf(reading.actions, 'Plan the week')).toEqual(['ADMIN', 'COACH']);
    expect(rolesOf(reading.actions, 'Excuse an absence')).toEqual(['PARENT']);
    expect(rolesOf(reading.actions, 'Notify parents')).toEqual(['ADMIN', 'COACH']);
  });

  it('leaves out every control a condition about who guards when it cannot be read, and says which', () => {
    const guarded = names(reading.guarded);
    for (const name of ['Delete session', 'Lock session', 'Reorder drills', 'Approve budget', 'Reset attendance']) {
      expect(names(reading.actions)).not.toContain(name);
      expect(guarded).toContain(name);
    }
  });

  it('with no permissions module to read, lists nothing that depends on who', () => {
    const blind = readControls(join(DIR, 'SessionsPage.tsx'), resolve);
    for (const name of ['Archive season', 'Plan the week', 'Excuse an absence', 'Notify parents', 'Schedule a match']) {
      expect(names(blind.actions)).not.toContain(name);
      expect(names(blind.guarded)).toContain(name);
    }
    expect(names(blind.actions)).toContain('Publish plan');
  });
});

/** Shapes found rehearsing the adapter on real apps it had not seen (2026-10-16). */
describe('readControls — shapes from real apps', () => {
  const reading = readControls(join(DIR, 'SignInForm.tsx'), resolve, 'SignInForm', scope);

  it('names a control by its idle state when its label only changes while it is busy', () => {
    expect(names(reading.actions)).toEqual(['key:auth.login.submit', 'Send request', 'Save draft', 'New post']);
  });

  it('reads past an icon beside the words', () => {
    expect(names(reading.actions)).toContain('New post');
  });

  it('never takes a word that only starts like a permission flag for one — CANCELLED, candidate', () => {
    const state = readControls(join(DIR, 'SignInForm.tsx'), resolve, 'SessionState', scope);
    expect(names(state.actions)).toEqual(['Reopen session', 'Mark all present', 'Shortlist candidate']);
    expect(state.guarded).toEqual([]);
  });

  it('leaves out a control only the item’s author or owner may use', () => {
    const owned = readControls(join(DIR, 'SignInForm.tsx'), resolve, 'PostActions', scope);
    expect(names(owned.actions)).toEqual([]);
    expect(names(owned.guarded)).toEqual(['Delete post']);
  });

  it('counts a button with no type inside a form as submitting it, and never a type="button"', () => {
    const form = readControls(join(DIR, 'SignInForm.tsx'), resolve, 'ReportForm', scope);
    expect(names(form.actions)).toEqual(['Create report']);
  });

  it('still never guesses a label a condition about anything else computes', () => {
    expect(names(reading.actions)).not.toContain('One');
    expect(names(reading.actions)).not.toContain('Other');
  });

  it('never lists a control that signs out, views, or pages through', () => {
    for (const name of ['Sign Out', 'Terminar sessão', 'Or click here to logout.', 'View Provenance', 'Ver modalidades', 'Fotografia anterior', 'Next photo'])
      expect(names(reading.actions), name).not.toContain(name);
  });
});

describe('isChrome — a control that names no task', () => {
  it('is a lone word every dialog has, in either language', () => {
    for (const chrome of ['Cancel', 'cancelar', 'OK', 'Fechar', 'Voltar', 'Seguinte', 'Guardar', 'Save', 'Confirmar', 'Ver mais', 'Load more', 'Limpar filtros', 'Anular', '← Voltar à biblioteca', 'Back to sessions', 'Recomeçar'])
      expect(isChrome(chrome), chrome).toBe(true);
  });

  it('is never a control that names what it does', () => {
    for (const task of ['Cancelar sessão', 'Cancel session', 'Publicar', 'Exportar PDF', 'Save changes', 'Registar lesão'])
      expect(isChrome(task), task).toBe(false);
  });
});
