import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { discoverRoutes } from './discover.ts';
import { generate } from './generate.ts';
import { chooseNavLabel, readManifest } from './labels.ts';
import type { GeneratorConfig } from './types.ts';

/**
 * A screen named by its own route entry's `nav` map.
 *
 *   { path: 'training/sessions', …, nav: { COACH: { labelKey: 'nav.sessions', group: { labelKey: 'nav.training' } } } }
 *
 * Found on a real app once its navigation moved into each route entry, one placement per role: with no
 * configured manifest naming those routes, every screen was titled after its component file — "Training
 * Calendar", in English, in a Portuguese registry. The label a sidebar shows is now the screen's name,
 * chosen across roles, under the group heading it sits beneath; a configured manifest still comes first.
 */

function app(files: Record<string, string>, manifests: string[] = []): GeneratorConfig {
  const appRoot = mkdtempSync(join(tmpdir(), 'nextgen-nav-'));
  for (const [name, source] of Object.entries(files)) {
    mkdirSync(dirname(join(appRoot, name)), { recursive: true });
    writeFileSync(join(appRoot, name), source, 'utf8');
  }
  return {
    appRoot,
    routesFile: 'routes.tsx',
    permissionsFile: 'permissions.ts',
    roleSetExport: 'ROUTE_ROLES',
    allRolesExport: 'APP_ROLES',
    manifests,
    localesDir: 'locales',
    languages: ['pt-PT', 'en'],
  };
}

const page = (name: string): string => `export default function ${name}() { return <div /> }`;

const placement = (labelKey: string, group?: string): string =>
  `{ id: '${labelKey}', labelKey: '${labelKey}', order: 0${group ? `, group: { id: '${group}', labelKey: '${group}', icon: 'x', order: 1 }` : ''} }`;

const LOCALES = {
  'locales/pt-PT/common.json': JSON.stringify({
    nav: {
      sessions: 'Sessões', schedule: 'Agenda', plan: 'Planeamento', overview: 'Visão geral', trainingSessions: 'Sessões de Treino',
      training: 'Treino', squad: 'Plantel', medical: 'Médico', rtp: 'Retorno ao jogo', medicalCentre: 'Centro Clínico',
      dashboard: 'Dashboard', fromManifest: 'Do manifesto', tactics: 'Tática', tacticsLibrary: 'Biblioteca de táticas',
    },
  }),
  'locales/en/common.json': JSON.stringify({
    nav: {
      sessions: 'Sessions', schedule: 'Schedule', plan: 'Planning', overview: 'Overview', trainingSessions: 'Training Sessions',
      training: 'Training', squad: 'Squad', medical: 'Medical', rtp: 'Return to play', medicalCentre: 'Clinical Centre',
      dashboard: 'Dashboard', fromManifest: 'From the manifest', tactics: 'Tactics', tacticsLibrary: 'Tactics library',
    },
  }),
  'locales/pt-PT/athlete.json': JSON.stringify({ home: { title: 'A Minha Página' } }),
  'locales/en/athlete.json': JSON.stringify({ home: { title: 'My Home' } }),
};

const FILES: Record<string, string> = {
  ...LOCALES,
  'permissions.ts': [
    "export const APP_ROLES = ['COACH', 'STAFF', 'DIRECTOR']",
    "export const ROUTE_ROLES = { all: ['COACH', 'STAFF', 'DIRECTOR'], director: ['DIRECTOR'], coach: ['COACH'] }",
  ].join('\n'),
  'Sessions.tsx': page('SessionsPage'),
  'Calendar.tsx': page('TrainingCalendarPage'),
  'Tie.tsx': page('TiePage'),
  'TrainingHome.tsx': page('TrainingHomePage'),
  'SquadHome.tsx': page('SquadHomePage'),
  'Plain.tsx': page('PlainPage'),
  'Centre.tsx': page('MedicalCentrePage'),
  'Drills.tsx': page('DrillsPage'),
  'Gym.tsx': page('GymPage'),
  'Dashboard.tsx': page('DashboardPage'),
  'Library.tsx': page('TacticsLibraryPage'),
  'MyHome.tsx': [
    "import { useTranslation } from 'react-i18next'",
    'export default function MyHomePage() {',
    "  const { t } = useTranslation('athlete')",
    "  return <h1>{t('home.title')}</h1>",
    '}',
  ].join('\n'),
  'routes.tsx': [
    "import { lazy } from 'react'",
    "import { ROUTE_ROLES } from './permissions'",
    'export const routes = [',
    // Two roles say "Agenda", one says "Sessões": the label most placements use wins, with its own group (none).
    `  { path: 'training/sessions', element: lazy(() => import('./Sessions')), nav: { COACH: ${placement('nav.sessions', 'nav.training')}, STAFF: ${placement('nav.schedule')}, DIRECTOR: ${placement('nav.schedule', 'nav.squad')} } },`,
    // One role each, and only the coach's placement names the area (its group, "Treino"): it wins the tie.
    `  { path: 'training/calendar', element: lazy(() => import('./Calendar')), nav: { STAFF: ${placement('nav.schedule')}, COACH: ${placement('nav.plan', 'nav.training')} } },`,
    // A role placed twice counts twice.
    `  { path: 'tie', element: lazy(() => import('./Tie')), nav: { COACH: ${placement('nav.plan')}, STAFF: [${placement('nav.sessions')}, ${placement('nav.sessions')}] } },`,
    // Two "Visão geral" leaves the same role sees, under their groups.
    `  { path: 'training', element: lazy(() => import('./TrainingHome')), nav: { COACH: ${placement('nav.overview', 'nav.training')} } },`,
    `  { path: 'squad', element: lazy(() => import('./SquadHome')), nav: { COACH: ${placement('nav.overview', 'nav.squad')} } },`,
    // Both groups say the area; only one label says a word of the address ("Clinical Centre").
    `  { path: 'medical/centre', element: lazy(() => import('./Centre')), nav: { COACH: ${placement('nav.rtp', 'nav.medical')}, STAFF: ${placement('nav.medicalCentre', 'nav.medical')} } },`,
    // A leaf that already says its group, on two screens one role reaches.
    `  { path: 'training/drills', element: lazy(() => import('./Drills')), nav: { COACH: ${placement('nav.trainingSessions', 'nav.training')} } },`,
    `  { path: 'training/gym', element: lazy(() => import('./Gym')), nav: { COACH: ${placement('nav.trainingSessions', 'nav.training')} } },`,
    // A leaf that says its group in the plural.
    `  { path: 'tactics/library', element: lazy(() => import('./Library')), nav: { COACH: ${placement('nav.tacticsLibrary', 'nav.tactics')} } },`,
    // One ungrouped label, "Dashboard", in three sidebars over two screens a director reaches.
    `  { path: 'dashboard', element: lazy(() => import('./Dashboard')), nav: { COACH: ${placement('nav.dashboard')}, STAFF: ${placement('nav.dashboard')} } },`,
    `  { path: 'home', element: lazy(() => import('./MyHome')), roles: ROUTE_ROLES.director, nav: { DIRECTOR: ${placement('nav.dashboard')} } },`,
    // No nav at all.
    "  { path: 'plain', element: lazy(() => import('./Plain')) },",
    ']',
  ].join('\n'),
};

describe('chooseNavLabel', () => {
  it('takes the label most placements use, with the group of the first placement that uses it', () => {
    expect(
      chooseNavLabel([
        { labelKey: 'a', groupLabelKey: 'g1' },
        { labelKey: 'b', groupLabelKey: null },
        { labelKey: 'b', groupLabelKey: 'g2' },
      ]),
    ).toEqual({ labelKey: 'b', groupLabelKey: null });
  });

  it('breaks a tie by declaration order when nothing ranks one placement above another', () => {
    expect(chooseNavLabel([{ labelKey: 'a', groupLabelKey: 'g1' }, { labelKey: 'b', groupLabelKey: 'g2' }])).toEqual({ labelKey: 'a', groupLabelKey: 'g1' });
  });

  it('breaks a tie by rank first, and never lets a rank outvote a majority', () => {
    const prefer = (placement: { labelKey: string }) => (placement.labelKey === 'b' ? 1 : 0);
    expect(chooseNavLabel([{ labelKey: 'a', groupLabelKey: null }, { labelKey: 'b', groupLabelKey: null }], prefer)?.labelKey).toBe('b');
    expect(
      chooseNavLabel([{ labelKey: 'a', groupLabelKey: null }, { labelKey: 'a', groupLabelKey: null }, { labelKey: 'b', groupLabelKey: null }], prefer)
        ?.labelKey,
    ).toBe('a');
  });

  it('has nothing to choose from no placements', () => {
    expect(chooseNavLabel([])).toBeNull();
    expect(chooseNavLabel(null)).toBeNull();
  });
});

describe('discoverRoutes — a route entry’s own nav map', () => {
  const at = (path: string) => discoverRoutes(app(FILES)).routes.find((route) => route.path === path);

  it('carries every placement in declaration order, for generate to choose from', () => {
    expect(at('/training/sessions')?.navPlacements).toEqual([
      { labelKey: 'nav.sessions', groupLabelKey: 'nav.training' },
      { labelKey: 'nav.schedule', groupLabelKey: null },
      { labelKey: 'nav.schedule', groupLabelKey: 'nav.squad' },
    ]);
  });

  it('carries each placement of a role placed twice', () => {
    expect(at('/tie')?.navPlacements?.map((p) => p.labelKey)).toEqual(['nav.plan', 'nav.sessions', 'nav.sessions']);
  });

  it('carries nothing for an entry with no nav', () => {
    expect(at('/plain')?.navPlacements).toBeUndefined();
  });
});

describe('generate — titles from the nav map', () => {
  const output = generate({ config: app(FILES), model: null });
  const titleOf = async (path: string, from: Promise<Awaited<typeof output>> = output) => {
    const capability = (await from).master.find((c) => c.route === path);
    return capability ? { pt: capability.title, en: capability.translations?.en?.title ?? capability.title } : undefined;
  };

  it('takes the label two roles share, bare when its placement has no group', async () => {
    expect(await titleOf('/training/sessions')).toEqual({ pt: 'Agenda', en: 'Schedule' });
  });

  it('counts each placement of a role placed twice', async () => {
    expect(await titleOf('/tie')).toEqual({ pt: 'Sessões', en: 'Sessions' });
  });

  it('puts a grouped label under its group, and breaks a tie for the placement that names the area', async () => {
    expect(await titleOf('/training/calendar')).toEqual({ pt: 'Treino · Planeamento', en: 'Training · Planning' });
  });

  it('breaks a tie the groups cannot break by the label that names the address, not by declaration order', async () => {
    // Both placements sit under "Médico", so the area alone ties them, and the coach's is declared first.
    expect(await titleOf('/medical/centre')).toEqual({ pt: 'Médico · Centro Clínico', en: 'Medical · Clinical Centre' });
  });

  it('tells two "Visão geral" leaves apart by the groups they sit in', async () => {
    expect(await titleOf('/training')).toEqual({ pt: 'Treino · Visão geral', en: 'Training · Overview' });
    expect(await titleOf('/squad')).toEqual({ pt: 'Plantel · Visão geral', en: 'Squad · Overview' });
  });

  it('never prefixes a group a leaf already says, even when two screens share the leaf', async () => {
    for (const path of ['/training/drills', '/training/gym']) {
      const title = await titleOf(path);
      expect(title?.pt.startsWith('Sessões de Treino')).toBe(true);
      expect(title?.en.startsWith('Training Sessions')).toBe(true);
    }
  });

  it('takes a leaf that says its group in the plural as saying it', async () => {
    expect(await titleOf('/tactics/library')).toEqual({ pt: 'Biblioteca de táticas', en: 'Tactics library' });
  });

  it('gives a shared ungrouped label to the screen most sidebars give it, and names the other by its own heading', async () => {
    expect(await titleOf('/dashboard')).toEqual({ pt: 'Dashboard', en: 'Dashboard' });
    expect(await titleOf('/home')).toEqual({ pt: 'A Minha Página', en: 'My Home' });
  });

  it('on a tie, names each screen that renders a heading by it, so neither keeps the shared label', async () => {
    const shared = `nav: { COACH: ${placement('nav.dashboard')}, STAFF: ${placement('nav.dashboard')} }`;
    expect(FILES['routes.tsx']).toContain(shared);
    const config = app({
      ...FILES,
      'locales/pt-PT/athlete.json': JSON.stringify({ home: { title: 'A Minha Página' }, board: { title: 'Painel do Clube' } }),
      'locales/en/athlete.json': JSON.stringify({ home: { title: 'My Home' }, board: { title: 'Club Board' } }),
      'Dashboard.tsx': [
        "import { useTranslation } from 'react-i18next'",
        'export default function DashboardPage() {',
        "  const { t } = useTranslation('athlete')",
        "  return <h1>{t('board.title')}</h1>",
        '}',
      ].join('\n'),
      // One sidebar each: the dashboard's coach, the home's director.
      'routes.tsx': FILES['routes.tsx']!.replace(shared, `nav: { COACH: ${placement('nav.dashboard')} }`),
    });
    const tied = generate({ config, model: null });
    expect(await titleOf('/dashboard', tied)).toEqual({ pt: 'Painel do Clube', en: 'Club Board' });
    expect(await titleOf('/home', tied)).toEqual({ pt: 'A Minha Página', en: 'My Home' });
  });

  it('lets a configured manifest name the route first', async () => {
    const config = app(
      { ...FILES, 'nav.ts': `export const NAV = [{ route: '/training/calendar', label: 'nav.fromManifest' }]` },
      ['nav.ts'],
    );
    const configured = generate({ config, model: null });
    expect(await titleOf('/training/calendar', configured)).toEqual({ pt: 'Do manifesto', en: 'From the manifest' });
    expect(await titleOf('/training/sessions', configured)).toEqual({ pt: 'Agenda', en: 'Schedule' });
  });

  it('chooses a route-keyed manifest’s placements the same way, tie-break included', async () => {
    const config = app(
      {
        ...FILES,
        'routeNav.ts': `export const ROUTE_NAV = { 'training/sessions': { COACH: ${placement('nav.rtp', 'nav.medical')}, STAFF: ${placement('nav.sessions', 'nav.training')} } }`,
      },
      ['routeNav.ts'],
    );
    expect(await titleOf('/training/sessions', generate({ config, model: null }))).toEqual({ pt: 'Treino · Sessões', en: 'Training · Sessions' });
  });
});

describe('readManifest — a nav map keyed by route', () => {
  it('reads each route’s placements, chosen the same way, as a manifest entry', () => {
    const config = app({
      'routeNav.ts': [
        'export const ROUTE_NAV = {',
        `  'training/calendar': { COACH: ${placement('nav.plan', 'nav.training')}, STAFF: ${placement('nav.schedule')}, DIRECTOR: ${placement('nav.schedule')} },`,
        `  squad: { COACH: ${placement('nav.overview', 'nav.squad')} },`,
        '}',
      ].join('\n'),
    });
    expect(readManifest(join(config.appRoot, 'routeNav.ts'))).toEqual([
      {
        path: '/training/calendar',
        labelKey: 'nav.schedule',
        groupLabelKey: null,
        placements: [
          { labelKey: 'nav.plan', groupLabelKey: 'nav.training' },
          { labelKey: 'nav.schedule', groupLabelKey: null },
          { labelKey: 'nav.schedule', groupLabelKey: null },
        ],
        reason: null,
      },
      { path: '/squad', labelKey: 'nav.overview', groupLabelKey: 'nav.squad', placements: [{ labelKey: 'nav.overview', groupLabelKey: 'nav.squad' }], reason: null },
    ]);
  });

  it('never takes a route entry that carries a nav beside its path for such a map', () => {
    const config = app({
      'entries.ts': `export const routes = [{ path: 'x', nav: { COACH: ${placement('nav.plan')} } }]`,
    });
    expect(readManifest(join(config.appRoot, 'entries.ts'))).toEqual([]);
  });

  it('never takes a map whose second-level keys are not roles for one', () => {
    const config = app({
      'cards.ts': `export const CARDS = { 'training/calendar': { summary: ${placement('nav.plan')}, details: ${placement('nav.schedule')} } }`,
    });
    expect(readManifest(join(config.appRoot, 'cards.ts'))).toEqual([]);
  });

  it('checks the second-level keys against the application’s roles, when it has them', () => {
    const config = app({ 'routeNav.ts': `export const ROUTE_NAV = { squad: { GUEST: ${placement('nav.overview')} } }` });
    const file = join(config.appRoot, 'routeNav.ts');
    expect(readManifest(file, ['COACH', 'STAFF'])).toEqual([]);
    expect(readManifest(file, ['COACH', 'GUEST']).map((entry) => entry.path)).toEqual(['/squad']);
  });

  it('still reads the entries a placement holds', () => {
    const config = app({
      'routeNav.ts': [
        'export const ROUTE_NAV = {',
        `  squad: { COACH: { id: 's', labelKey: 'nav.overview', order: 0, items: [{ path: '/squad/deep', label: 'nav.deep' }] } },`,
        '}',
      ].join('\n'),
    });
    expect(readManifest(join(config.appRoot, 'routeNav.ts')).map((entry) => [entry.path, entry.labelKey])).toEqual([
      ['/squad', 'nav.overview'],
      ['/squad/deep', 'nav.deep'],
    ]);
  });
});
