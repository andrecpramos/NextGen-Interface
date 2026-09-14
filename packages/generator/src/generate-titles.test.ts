import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { validateRegistry } from '@nextgen/core-capability';

import { importResolver } from './discover.ts';
import { generate } from './generate.ts';
import { readManifest } from './labels.ts';
import { readPage, readScreen } from './pages.ts';
import { assignTriggers } from './triggers.ts';
import { FAMILY_CONFIG, FAMILY_ROOT } from './fixture-app.ts';

/**
 * Naming a screen in the application's own words, in its own language.
 *
 * Every case is a defect found by generating fut-app's registries and reading what a
 * guardian's assistant was given: "Communication my Announcements", "Guardian estado
 * Médico", "Settings personal Notifications", no trigger for their own home page, and two
 * capabilities for every page about a child. The fixture has fut-app's shapes, not its code.
 */

const output = generate({ config: FAMILY_CONFIG, model: null });
const at = async (route: string) => (await output).master.find((capability) => capability.route === route);
const page = (feature: string, name: string) => readPage(join(FAMILY_ROOT, 'features', feature, 'pages', `${name}.tsx`));
const screen = (feature: string, name: string) =>
  readScreen(join(FAMILY_ROOT, 'features', feature, 'pages', `${name}.tsx`), importResolver(FAMILY_ROOT));

describe('readScreen — a wrapper page is read through what it renders', () => {
  it('names the page from the layout’s card for its tab, under the layout’s own heading', () => {
    const facts = screen('settings', 'PersonalNotificationsPage');
    expect(facts.titleKeys).toEqual(['settings:sections.notif']);
    expect(facts.sectionTitleKeys).toEqual(['settings:personalPageTitle']);
    expect(facts.i18nKeys).toContain('settings:notifications.email');
    expect(facts.fields.map((field) => field.name)).toContain('email');
  });

  it('never reads the design system a page is built from', () => {
    expect(screen('settings', 'PersonalNotificationsPage').i18nKeys).not.toContain('common:actions.back');
  });

  it('reads a page that says anything about itself exactly as before', () => {
    expect(screen('communication', 'MyAnnouncementsPage')).toEqual(page('communication', 'MyAnnouncementsPage'));
  });
});

describe('readPage — the heading a page renders', () => {
  it('reads a translation function bound under another name, in its own namespace', () => {
    const facts = page('communication', 'MyAnnouncementsPage');
    expect(facts.titleKeys).toEqual(['player:announcements.title']);
    expect(facts.i18nKeys).toEqual(
      expect.arrayContaining(['communication:announcement.from', 'player:announcements.title', 'player:announcements.subtitle']),
    );
  });

  it('follows a title variable, and takes neither a sentence with a name in it nor a dialog’s title', () => {
    expect(page('guardian', 'ChildMedicalPage').titleKeys).toEqual(['guardian:medical.page.heading']);
  });

  it('reads a header handed to a layout as a prop', () => {
    expect(page('guardian', 'MyChildrenPage').titleKeys).toEqual(['guardian:pageTitle']);
  });

  it('never takes a header from an early return, which names a loading or failed moment', () => {
    expect(page('dashboard', 'CoachDashboardPage').titleKeys).toEqual(['dashboard:coach.title']);
  });
});

describe('generate — an old address is not a place', () => {
  it('skips a route-table redirect to a screen declared at its own address, with the evidence', async () => {
    const { master, skipped } = await output;
    expect(master.map((capability) => capability.route)).not.toContain('/my/schedule');
    const skip = skipped.find((entry) => entry.path === '/my/schedule');
    expect(skip?.reason).toBe('redirect-alias');
    expect(skip?.detail).toContain('/my');
  });

  it('keeps a redirect that lands a section on its own first page', async () => {
    expect((await output).master.map((capability) => capability.route)).toContain('/settings');
  });
});

describe('readManifest — where a nav item is filed', () => {
  it('records the group a nav item sits in, and none for an item outside one', () => {
    const entries = readManifest(join(FAMILY_ROOT, 'lib', 'nav.ts'));
    expect(entries.find((entry) => entry.path === '/squad')?.groupLabelKey).toBe('nav.squad');
    expect(entries.find((entry) => entry.path === '/my/children/medical')?.groupLabelKey).toBeNull();
  });
});

describe('generate — a title is the application’s name for the screen', () => {
  it('names a screen from the heading it renders, never from its component', async () => {
    expect((await at('/my/announcements'))?.title).toBe('Anúncios');
    const titles = (await output).master.map((capability) => capability.title);
    expect(titles.join(' | ')).not.toMatch(/My Announcements|Child Medical|Personal Notifications|Page\b/);
  });

  it('names a tab of a shared layout as the layout shows it, apart from the inbox it would collide with', async () => {
    expect((await at('/settings/notifications'))?.title).toBe('As Minhas Preferências · Notificações');
    const inbox = await at('/my/notifications');
    expect(inbox?.title).toBe('Notificações');
    expect(inbox?.triggers).toContain('notificacoes');
  });

  it('falls back to a nav item written inline in the source, before a component name', async () => {
    expect((await at('/settings'))?.title).toBe('Definições');
  });

  it('leaves a title alone when the screen that shares it is in no registry with it', async () => {
    expect((await at('/my/medical'))?.title).toBe('Estado Médico');
    expect((await at('/my/children/medical'))?.title).toBe('Estado Médico');
  });

  it('qualifies a title that competes inside a registry with its nav group, as the app’s palette does', async () => {
    expect((await at('/squad'))?.title).toBe('Plantel · Visão geral');
    expect((await at('/training'))?.title).toBe('Treino · Visão geral');
  });
});

describe('generate — a trigger is ambiguous only inside a registry', () => {
  it('keeps a label two roles use for different screens when no role reaches both', async () => {
    expect((await at('/my'))?.triggers).toContain('painel');
    expect((await at('/dashboard'))?.triggers).toContain('painel');
  });

  it('still drops a label two screens of one registry share, and keeps the qualified one', async () => {
    const squad = (await at('/squad'))?.triggers ?? [];
    expect(squad).not.toContain('visao geral');
    expect(squad).toContain('plantel visao geral');
  });

  it('judges a claim by the roles that meet, when roles are given', () => {
    const candidates = new Map([
      ['training.calendar', ['Calendário']],
      ['medical.calendar', ['Calendário']],
    ]);
    const apart = assignTriggers(candidates, new Map([['training.calendar', ['COACH']], ['medical.calendar', ['MEDICAL']]]));
    expect(apart.triggers.get('training.calendar')).toEqual(['calendario']);
    expect(apart.triggers.get('medical.calendar')).toEqual(['calendario']);

    const together = assignTriggers(candidates, new Map([['training.calendar', ['COACH']], ['medical.calendar', ['COACH', 'MEDICAL']]]));
    expect(together.triggers.has('training.calendar')).toBe(false);
    expect(together.ambiguous.get('calendario')).toEqual(['medical.calendar', 'training.calendar']);
  });
});

describe('generate — one screen at two addresses is declared once', () => {
  it('declares a child’s page at the route that picks the child, and reports the other', async () => {
    const { master, skipped } = await output;
    const routes = master.map((capability) => capability.route);
    expect(routes).toContain('/my/children/medical');
    expect(routes).not.toContain('/my/children/:childId/medical');
    const skip = skipped.find((entry) => entry.path === '/my/children/:childId/medical');
    expect(skip?.reason).toBe('reached-through-resolver');
    expect(skip?.detail).toContain('/my/children/medical');
  });

  it('describes the resolver from the page it lands on', async () => {
    const resolver = await at('/my/children/medical');
    expect(resolver?.explanationSource).toBe('features/guardian/pages/ChildMedicalPage.tsx');
    expect(resolver?.explanation).toContain('aptidão');
  });
});

describe('generate — derived examples speak each title’s language', () => {
  it('asks for a Portuguese title in Portuguese and an English one in English', async () => {
    const examples = (await at('/my/announcements'))?.examples ?? [];
    expect(examples).toEqual(expect.arrayContaining(['abre anúncios', 'open announcements']));
    expect(examples).not.toContain('open anúncios');
  });

  it('emits role registries the engine accepts', async () => {
    for (const [role, registry] of (await output).registries) {
      const result = validateRegistry(registry);
      expect(result.errors, `${role}: ${result.errors.map((error) => error.message).join('; ')}`).toEqual([]);
    }
  });
});
