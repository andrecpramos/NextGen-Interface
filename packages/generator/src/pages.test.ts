import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { readPage } from './pages.ts';
import { FIXTURE_ROOT } from './fixture-app.ts';

const page = (feature: string, name: string) =>
  readPage(join(FIXTURE_ROOT, 'features', feature, 'pages', `${name}.tsx`));

/**
 * The first spike's miss #1 — the single most consequential gap it had, and
 * the reason this module exists. The spike judged a destination by whether the
 * component's *name* contained "Redirect", and was wrong in both directions.
 */
describe('readPage — a destination is what a component does, not what it is called', () => {
  it('calls a component that renders nothing but a redirect a pure redirect', () => {
    const facts = page('squad', 'PlayerShimPage');
    expect(facts.isPureRedirect).toBe(true);
    expect(facts.redirectTargets).toEqual(['/players/']);
  });

  // The name says Redirect. The body renders a heading, a loading state and a
  // roster. A user sent here arrives somewhere.
  it('does not call a component that also renders a real view a redirect', () => {
    expect(page('guardian', 'ChildViewPage').isPureRedirect).toBe(false);
  });

  it('reads a page with no redirect at all as a destination', () => {
    expect(page('squad', 'PlayersPage').isPureRedirect).toBe(false);
  });

  it('keeps the literal prefix of a computed redirect target', () => {
    // `/settings/notifications` is knowable at build time even when the rest is not,
    // and the section it names is what decides whether the redirect leaves home.
    expect(page('settings', 'SettingsIndexPage').redirectTargets).toEqual(['/settings/notifications']);
  });
});

describe('readPage — the application’s own words', () => {
  it('collects the i18n keys a page renders, namespaced', () => {
    expect(page('squad', 'PlayersPage').i18nKeys).toEqual(['squad:players.title', 'squad:players.subtitle']);
  });

  it('keeps the component’s doc comment', () => {
    expect(page('squad', 'PlayersPage').doc).toContain('player directory');
  });

  it('collects literal on-screen text', () => {
    expect(page('squad', 'SquadOverviewPage').headings).toContain('Roster health');
  });
});

/**
 * Found by auditing descriptions against the pages they describe.
 *
 * bulletproof-react's discussion screen has no doc comment, and the only literal
 * text under it is an `ErrorBoundary` fallback. The model was handed that as the
 * screen's on-screen text and faithfully described the failure: *"A user tries to
 * view comments but sees an error message and attempts to refresh the screen."*
 * Fixing the extraction changed it to *"A user views and participates in a
 * discussion with others."*
 */
describe('readPage — the failure state is not the screen', () => {
  const injuries = page('squad', 'InjuriesPage');

  it('ignores what a screen shows when it is broken', () => {
    expect(injuries.headings).toContain('Current injuries');
    expect(injuries.headings).not.toContain('Failed to load injuries. Try to refresh the page.');
  });

  /**
   * The first version of the fix skipped `forbiddenFallback` too, and that made a
   * description worse: `/app/users`'s only clue about its audience is
   * `forbiddenFallback={<div>Only admin can view this.</div>}`, and without it the
   * description dropped from "An admin views a list of registered users" to "A
   * person views…". An authorization fallback describes the audience, which is
   * true of the screen; an error fallback describes a moment, which is not.
   */
  it('keeps what a screen says about who may see it', () => {
    expect(injuries.headings).toContain('Only medical staff can view this.');
  });

  it('does not leave the comment terminator in a one-line doc comment', () => {
    expect(injuries.doc).toBe('Who is injured, and when each of them is expected back.');
    // Every fixture page, not just this one: the strip runs on all of them.
    for (const name of ['PlayersPage', 'PlayerDetailPage', 'TeamsPage']) {
      expect(page('squad', name).doc).not.toMatch(/\*\/\s*$/);
    }
  });
});

/**
 * Guided steps are generated from these, and the anchor each step gets is
 * matched at run time by accessible name — so the name read here has to come
 * from the same sources, in the same order, that a screen reader uses.
 */
describe('fields — the form controls a page renders', () => {
  it('reads every named control in source order, with whatever names it', () => {
    expect(page('settings', 'NotificationsPage').fields).toEqual([
      // A <label htmlFor> whose text is t('…'): kept as a key, namespaced like
      // the page's other copy, and resolved against the locales later. Its
      // `required` attribute is a read-tier rule (ADR-020), read rather than guessed.
      {
        tag: 'input',
        label: null,
        labelKey: 'settings:notifications.email',
        id: 'notify-email',
        name: 'email',
        type: 'email',
        rules: [{ kind: 'required', line: 14 }],
      },
      // A literal <label htmlFor>.
      { tag: 'select', label: 'Digest frequency', labelKey: null, id: 'notify-frequency', name: 'frequency', type: null, rules: [] },
      // No visible label at all — named only by aria-label.
      { tag: 'input', label: 'Quiet hours', labelKey: null, id: null, name: 'quietHours', type: 'text', rules: [] },
      // A submit button, named by its own text.
      { tag: 'button', label: null, labelKey: 'settings:notifications.save', id: null, name: null, type: 'submit', rules: [] },
    ]);
  });

  it('finds nothing on a page with no form', () => {
    expect(page('squad', 'SquadOverviewPage').fields).toEqual([]);
  });
});

/**
 * ADR-031: a control whose only job is to show something — a form, a dialog, a drawer — is one the widget
 * may press for a visitor. Read from what the handler does, never from what the button is called: "Close"
 * sets state too, and "Save" is a click like any other.
 */
describe('readPage — controls that only open something', () => {
  const facts = readPage(join(FIXTURE_ROOT, '..', '..', 'openers', 'EventsPage.tsx'));

  it('finds state that shows something, and triggers, named as the page names them', () => {
    expect(facts.openers).toEqual([
      { label: null, labelKey: 'events:actions.new' },
      { label: 'Filters', labelKey: null },
      { label: 'Import events', labelKey: null },
      { label: 'Invite people', labelKey: null },
      { label: 'Share calendar', labelKey: null },
    ]);
  });

  it('never counts a control that does something, closes something, or asks to confirm', () => {
    const labels = (facts.openers ?? []).map((o) => o.label);
    for (const not of ['Save', 'Delete', 'Close', 'Remove all']) expect(labels).not.toContain(not);
  });
});
