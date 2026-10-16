import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { validateRegistry } from '@nextgen/core-capability';

import { importResolver } from './discover.ts';
import { generate } from './generate.ts';
import { readManifest } from './labels.ts';
import { readPage, readScreen } from './pages.ts';
import { assignTriggers } from './triggers.ts';
import { SCHOOL_CONFIG, SCHOOL_ROOT } from './fixture-app.ts';

/**
 * Naming a screen in the application's own words, in its own language.
 *
 * Every case is a defect found by generating a real app's registries and reading what a
 * parent's assistant was given: "Communication my Announcements", "Guardian avaliações",
 * "Settings personal Notifications", no trigger for their own home page, and two capabilities
 * for every page about a child. The fixture reproduces those shapes in a made-up school portal.
 */

const output = generate({ config: SCHOOL_CONFIG, model: null });
const at = async (route: string) => (await output).master.find((capability) => capability.route === route);
const page = (feature: string, name: string) => readPage(join(SCHOOL_ROOT, 'features', feature, 'pages', `${name}.tsx`));
const screen = (feature: string, name: string) =>
  readScreen(join(SCHOOL_ROOT, 'features', feature, 'pages', `${name}.tsx`), importResolver(SCHOOL_ROOT));

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
    expect(facts.titleKeys).toEqual(['student:announcements.title']);
    expect(facts.i18nKeys).toEqual(
      expect.arrayContaining(['communication:announcement.from', 'student:announcements.title', 'student:announcements.subtitle']),
    );
  });

  it('follows a title variable, and takes neither a sentence with a name in it nor a dialog’s title', () => {
    expect(page('guardian', 'ChildGradesPage').titleKeys).toEqual(['guardian:grades.page.heading']);
  });

  it('reads a header handed to a layout as a prop', () => {
    expect(page('guardian', 'MyChildrenPage').titleKeys).toEqual(['guardian:pageTitle']);
  });

  it('never takes a header from an early return, which names a loading or failed moment', () => {
    expect(page('dashboard', 'TeacherDashboardPage').titleKeys).toEqual(['dashboard:teacher.title']);
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
    const entries = readManifest(join(SCHOOL_ROOT, 'lib', 'nav.ts'));
    expect(entries.find((entry) => entry.path === '/classes')?.groupLabelKey).toBe('nav.classes');
    expect(entries.find((entry) => entry.path === '/my/children/grades')?.groupLabelKey).toBeNull();
  });
});

describe('generate — a title is the application’s name for the screen', () => {
  it('names a screen from the heading it renders, never from its component', async () => {
    expect((await at('/my/announcements'))?.title).toBe('Anúncios');
    const titles = (await output).master.map((capability) => capability.title);
    expect(titles.join(' | ')).not.toMatch(/My Announcements|Child Grades|Personal Notifications|Page\b/);
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
    expect((await at('/my/grades'))?.title).toBe('Avaliações');
    expect((await at('/my/children/grades'))?.title).toBe('Avaliações');
  });

  it('qualifies a title that competes inside a registry with its nav group, as the app’s palette does', async () => {
    expect((await at('/classes'))?.title).toBe('Turmas · Visão geral');
    expect((await at('/lessons'))?.title).toBe('Aulas · Visão geral');
  });
});

describe('generate — a trigger is ambiguous only inside a registry', () => {
  it('keeps a label two roles use for different screens when no role reaches both', async () => {
    expect((await at('/my'))?.triggers).toContain('painel');
    expect((await at('/dashboard'))?.triggers).toContain('painel');
  });

  it('still drops a label two screens of one registry share, and keeps the qualified one', async () => {
    const classes = (await at('/classes'))?.triggers ?? [];
    expect(classes).not.toContain('visao geral');
    expect(classes).toContain('turmas visao geral');
  });

  it('judges a claim by the roles that meet, when roles are given', () => {
    const candidates = new Map([
      ['lessons.calendar', ['Calendário']],
      ['exams.calendar', ['Calendário']],
    ]);
    const apart = assignTriggers(candidates, new Map([['lessons.calendar', ['TEACHER']], ['exams.calendar', ['SECRETARY']]]));
    expect(apart.triggers.get('lessons.calendar')).toEqual(['calendario']);
    expect(apart.triggers.get('exams.calendar')).toEqual(['calendario']);

    const together = assignTriggers(candidates, new Map([['lessons.calendar', ['TEACHER']], ['exams.calendar', ['TEACHER', 'SECRETARY']]]));
    expect(together.triggers.has('lessons.calendar')).toBe(false);
    expect(together.ambiguous.get('calendario')).toEqual(['exams.calendar', 'lessons.calendar']);
  });
});

describe('generate — one screen at two addresses is declared once', () => {
  it('declares a child’s page at the route that picks the child, and reports the other', async () => {
    const { master, skipped } = await output;
    const routes = master.map((capability) => capability.route);
    expect(routes).toContain('/my/children/grades');
    expect(routes).not.toContain('/my/children/:childId/grades');
    const skip = skipped.find((entry) => entry.path === '/my/children/:childId/grades');
    expect(skip?.reason).toBe('reached-through-resolver');
    expect(skip?.detail).toContain('/my/children/grades');
  });

  it('describes the resolver from the page it lands on', async () => {
    const resolver = await at('/my/children/grades');
    expect(resolver?.explanationSource).toBe('features/guardian/pages/ChildGradesPage.tsx');
    expect(resolver?.explanation).toContain('assiduidade');
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

/**
 * ADR-030: a visitor reads one language. The registry is written in the app's first language and says
 * so; every other language the app ships comes along as display text — its own names, and what the page
 * says in that language — never embedded, so no score moves.
 */
describe('the app’s other languages', () => {
  it('says which language its own words are in, and carries the others beside them', async () => {
    const { registries } = await output;
    for (const file of registries.values()) {
      expect(file.language).toBe('pt-PT');
      expect(validateRegistry(file).ok).toBe(true);
    }
    const children = await at('/my/children');
    expect(children!.title).toBe('Os Meus Educandos');
    expect(children!.translations?.en?.title).toBe('My Children');
  });

  it('writes an explanation in a language only from what the page says in it — never a sentence mixing two', async () => {
    const { master } = await output;
    for (const capability of master) {
      const en = capability.translations?.en?.explanation;
      if (!en) continue;
      expect(en.startsWith('This screen shows:')).toBe(true);
      expect(en).not.toMatch(/ã|ç|õ|Este ecrã/);
    }
  });

  it('gives the built-in limits in every language the app ships', async () => {
    const { boundaries } = await output;
    const outside = boundaries.find((b) => b.id === 'unsupported.other_applications')!;
    expect(outside.refusal).toMatch(/aplicação/);
    expect(outside.translations?.en?.refusal).toMatch(/application/);
  });
});
