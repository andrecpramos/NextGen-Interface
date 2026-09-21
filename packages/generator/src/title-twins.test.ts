import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { generate } from './generate.ts';
import type { GeneratorConfig } from './types.ts';

/**
 * Two screens one component renders — `/squad/new` and `/squad/:id/edit` are both `PlayerFormPage` — were
 * both named "Squad player Form". Qualifying a duplicate title by its area gives both the *same* area,
 * so the twins stayed twins, and a visitor offered "Squad player Form" and "Squad player Form" cannot
 * tell adding a player from editing one. Found on a real coaching app.
 */

function app(routes: string): GeneratorConfig {
  const appRoot = mkdtempSync(join(tmpdir(), 'nextgen-twins-'));
  const files: Record<string, string> = {
    'App.jsx': [
      "import { Routes, Route } from 'react-router-dom';",
      "import PlayerFormPage from './pages/PlayerFormPage';",
      "import SquadPage from './pages/SquadPage';",
      'export default function App() {',
      `  return <Routes>${routes}</Routes>;`,
      '}',
    ].join('\n'),
    'pages/PlayerFormPage.jsx': 'export default function PlayerFormPage() {\n  return <form><h1>Player</h1></form>;\n}',
    'pages/SquadPage.jsx': 'export default function SquadPage() {\n  return <main><h1>Squad</h1></main>;\n}',
  };
  for (const [name, source] of Object.entries(files)) {
    mkdirSync(dirname(join(appRoot, name)), { recursive: true });
    writeFileSync(join(appRoot, name), source, 'utf8');
  }
  return { appRoot, routesFile: 'App.jsx', roleSetExport: 'ROUTE_ROLES', allRolesExport: 'APP_ROLES', manifests: [], localesDir: null, languages: ['en'] };
}

const titlesOf = async (routes: string) => {
  const output = await generate({ config: app(routes), model: null });
  return Object.fromEntries(output.master.map((c) => [c.route, c.title]));
};

/**
 * A route whose element is a bare `<Navigate to="…" />` to an address the app never declares was named
 * after its component: "Navigate · schedule". A redirect component is not a name; the address is.
 */
describe('a route that only redirects, to an address the app does not declare', () => {
  it('is named for where it is, not for the component that redirects', async () => {
    const config = app('<Route path="/my/schedule" element={<Navigate to="/my/agenda" replace />} /><Route path="/squad" element={<SquadPage />} />');
    const output = await generate({ config, model: null });
    const schedule = output.master.find((c) => c.route === '/my/schedule');
    expect(schedule?.title).toMatch(/schedule/i);
    expect(schedule?.title).not.toMatch(/navigate/i);
  });
});

describe('two screens one component renders', () => {
  const twins = [
    '<Route path="/squad" element={<SquadPage />} />',
    '<Route path="/squad/new" element={<PlayerFormPage />} />',
    '<Route path="/squad/:playerId/edit" element={<PlayerFormPage />} />',
  ].join('');

  it('are told apart by the word that tells them apart in their own addresses', async () => {
    const titles = await titlesOf(twins);
    expect(titles['/squad/new']).not.toBe(titles['/squad/:playerId/edit']);
    expect(titles['/squad/new']).toMatch(/new/i);
    expect(titles['/squad/:playerId/edit']).toMatch(/edit/i);
  });

  it('keep a title that was already their own', async () => {
    const titles = await titlesOf(twins);
    expect(titles['/squad']).toBe('Squad');
  });

  it('leave every title alone when none of them collides', async () => {
    const titles = await titlesOf('<Route path="/squad" element={<SquadPage />} /><Route path="/squad/new" element={<PlayerFormPage />} />');
    expect(titles['/squad/new']).not.toMatch(/·/);
  });

  it('end up with no title shared between two screens of one registry', async () => {
    const titles = Object.values(await titlesOf(twins));
    expect(new Set(titles).size).toBe(titles.length);
  });
});
