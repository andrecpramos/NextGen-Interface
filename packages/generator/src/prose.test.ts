import { describe, expect, it } from 'vitest';

import { judgeProse } from './prose.ts';

/**
 * The first spike's miss #2: three routes with entirely correct roles that a
 * careful developer still leaves out, because the app's own prose says they are
 * legacy or dev-only. Reading that prose is easy; reading it *correctly* is the
 * part that decides whether a live destination survives.
 *
 * All three sentences below are quoted from the pilot target.
 */
describe('judgeProse', () => {
  it('says nothing about a route nobody warned about', () => {
    expect(judgeProse('/squad/players', ['The club-wide player directory'])).toEqual({ kind: 'ok' });
  });

  it('marks a route whose replacement is named after the marker', () => {
    const verdict = judgeProse('/squad/teams', ['Legacy team list — /squad/team is the canonical store-driven landing']);
    expect(verdict.kind).toBe('legacy');
  });

  // The legacy thing is named *before* the marker, and it is not this route.
  // `/match-hub` is the current sidebar entry point; only `/match-hub/:matchId`
  // is the one-release shim.
  it('does not mark a route that names a different one as the legacy subject', () => {
    const comment =
      'Match Hub — canonical hub is /competition/matches/:matchId. /match-hub is the sidebar entry point. ' +
      '/match-hub/:matchId is a legacy deep-link kept one release.';
    expect(judgeProse('/match-hub', [comment])).toEqual({ kind: 'ok' });
  });

  // A marker introducing a class of *other* routes, written on the route they
  // point at. Read carelessly this deletes the destination and keeps the shims.
  it('does not mark a route whose comment describes the legacy routes below it', () => {
    const comment = 'Combined clinical workspace; the legacy routes below redirect into its tabs so old links keep working.';
    expect(judgeProse('/medical/centre', [comment])).toEqual({ kind: 'ok' });
  });

  it('separates a dev-only route from a legacy one', () => {
    const verdict = judgeProse('/dev/icons', ['Dev-only icon gallery (FE-D5), registered only in development builds']);
    expect(verdict.kind).toBe('dev-only');
  });

  it('reads a stale bookmark as legacy', () => {
    const verdict = judgeProse('/dashboard', ['Stale-bookmark route only for these roles — DashboardPage redirects them to their landing.']);
    expect(verdict.kind).toBe('legacy');
  });

  it('quotes the evidence, so a wrong omission is one grep away', () => {
    const verdict = judgeProse('/tactics/overall', ['Legacy redirect component into the tactic editor (kept one release)']);
    expect(verdict.kind === 'legacy' && verdict.evidence).toContain('kept one release');
  });
});
