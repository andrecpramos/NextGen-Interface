import { describe, expect, it } from 'vitest';

import { judgeProse } from './prose.ts';

/**
 * The first spike's miss #2: three routes with entirely correct roles that a
 * careful developer still leaves out, because the app's own prose says they are
 * legacy or dev-only. Reading that prose is easy; reading it *correctly* is the
 * part that decides whether a live destination survives.
 *
 * The sentences below are shaped like the ones real route tables carry.
 */
describe('judgeProse', () => {
  it('says nothing about a route nobody warned about', () => {
    expect(judgeProse('/classes/students', ['The school-wide student directory'])).toEqual({ kind: 'ok' });
  });

  it('marks a route whose replacement is named after the marker', () => {
    const verdict = judgeProse('/classes/groups', ['Legacy group list — /classes/group is the canonical store-driven landing']);
    expect(verdict.kind).toBe('legacy');
  });

  // The legacy thing is named *before* the marker, and it is not this route.
  // `/gradebook` is the current sidebar entry point; only `/gradebook/:termId`
  // is the one-release shim.
  it('does not mark a route that names a different one as the legacy subject', () => {
    const comment =
      'Gradebook — canonical gradebook is /grades/terms/:termId. /gradebook is the sidebar entry point. ' +
      '/gradebook/:termId is a legacy deep-link kept one release.';
    expect(judgeProse('/gradebook', [comment])).toEqual({ kind: 'ok' });
  });

  // A marker introducing a class of *other* routes, written on the route they
  // point at. Read carelessly this deletes the destination and keeps the shims.
  it('does not mark a route whose comment describes the legacy routes below it', () => {
    const comment = 'Combined student-services workspace; the legacy routes below redirect into its tabs so old links keep working.';
    expect(judgeProse('/student-services', [comment])).toEqual({ kind: 'ok' });
  });

  it('separates a dev-only route from a legacy one', () => {
    const verdict = judgeProse('/dev/icons', ['Dev-only icon gallery, registered only in development builds']);
    expect(verdict.kind).toBe('dev-only');
  });

  it('reads a stale bookmark as legacy', () => {
    const verdict = judgeProse('/dashboard', ['Stale-bookmark route only for these roles — DashboardPage redirects them to their landing.']);
    expect(verdict.kind).toBe('legacy');
  });

  it('quotes the evidence, so a wrong omission is one grep away', () => {
    const verdict = judgeProse('/timetable/overall', ['Legacy redirect component into the timetable editor (kept one release)']);
    expect(verdict.kind === 'legacy' && verdict.evidence).toContain('kept one release');
  });
});
