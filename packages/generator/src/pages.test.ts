import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { readPage } from './pages.ts';
import { FIXTURE_ROOT } from './fixture-app.ts';

const page = (feature: string, name: string) =>
  readPage(join(FIXTURE_ROOT, 'features', feature, 'pages', `${name}.tsx`));

/**
 * WP-30's verdict, miss #1 — the single most consequential gap it found, and
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
 * WP-27. Guided steps are generated from these, and the anchor each step gets is
 * matched at run time by accessible name — so the name read here has to come
 * from the same sources, in the same order, that a screen reader uses.
 */
describe('fields — the form controls a page renders', () => {
  it('reads every named control in source order, with whatever names it', () => {
    expect(page('settings', 'NotificationsPage').fields).toEqual([
      // A <label htmlFor> whose text is t('…'): kept as a key, namespaced like
      // the page's other copy, and resolved against the locales later.
      { tag: 'input', label: null, labelKey: 'settings:notifications.email', id: 'notify-email', name: 'email', type: 'email' },
      // A literal <label htmlFor>.
      { tag: 'select', label: 'Digest frequency', labelKey: null, id: 'notify-frequency', name: 'frequency', type: null },
      // No visible label at all — named only by aria-label.
      { tag: 'input', label: 'Quiet hours', labelKey: null, id: null, name: 'quietHours', type: 'text' },
      // A submit button, named by its own text.
      { tag: 'button', label: null, labelKey: 'settings:notifications.save', id: null, name: null, type: 'submit' },
    ]);
  });

  it('finds nothing on a page with no form', () => {
    expect(page('squad', 'SquadOverviewPage').fields).toEqual([]);
  });
});
