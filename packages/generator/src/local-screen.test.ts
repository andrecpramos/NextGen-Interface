import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { generate } from './generate.ts';
import type { GeneratorConfig } from './types.ts';

/**
 * A page component declared in the route table's own file.
 *
 * Found by running the scanner on a real app it had never seen — a one-page site whose route table
 * is `<Route path="/" element={<MainPage />} />` with `function MainPage() { return <><Hero /><Pricing />…</> }`
 * two lines above. Discovery followed only imports, so `MainPage` had no file, and the one screen
 * everything lives on was described as "a screen in the app area of this application, at /" — with
 * no word of what is on it. A visitor asking what membership costs had nothing to match.
 *
 * The composed sections are read exactly as a wrapper page's children already are (`readScreen`), and
 * nothing else in the file is: the header and footer the *app* renders around its routes are chrome,
 * not part of the page.
 */

function app(files: Record<string, string>): GeneratorConfig {
  const appRoot = mkdtempSync(join(tmpdir(), 'nextgen-local-'));
  for (const [name, source] of Object.entries(files)) {
    mkdirSync(dirname(join(appRoot, name)), { recursive: true });
    writeFileSync(join(appRoot, name), source, 'utf8');
  }
  return { appRoot, routesFile: 'App.jsx', roleSetExport: 'ROUTE_ROLES', allRolesExport: 'APP_ROLES', manifests: [], localesDir: null, languages: ['en'] };
}

const section = (name: string, jsx: string) => `export default function ${name}() {\n  return (\n    <section>\n${jsx}\n    </section>\n  );\n}\n`;

const files = (mainPage: string): Record<string, string> => ({
  'App.jsx': [
    "import { Routes, Route } from 'react-router-dom';",
    "import Header from './layout/Header';",
    "import Hero from './pages/Hero';",
    "import Pricing from './pages/Pricing';",
    "import Team from './pages/Team';",
    "import Privacy from './pages/Privacy';",
    '',
    mainPage,
    '',
    'export default function App() {',
    '  return (',
    '    <>',
    '      <Header />',
    '      <Routes>',
    '        <Route path="/" element={<MainPage />} />',
    '        <Route path="/privacy" element={<Privacy />} />',
    '      </Routes>',
    '    </>',
    '  );',
    '}',
  ].join('\n'),
  'layout/Header.jsx': section('Header', '      <h2>Site chrome heading</h2>'),
  'pages/Hero.jsx': section('Hero', '      <h1>Train with the best coaches</h1>'),
  'pages/Pricing.jsx': section('Pricing', '      <h2>Membership prices</h2>\n      <p>Monthly plans from thirty euros.</p>'),
  'pages/Team.jsx': section('Team', '      <h2>Meet our staff</h2>'),
  'pages/Privacy.jsx': section('Privacy', '      <h1>Privacy policy</h1>'),
});

const explanationAt = async (config: GeneratorConfig, route: string) => {
  const output = await generate({ config, model: null });
  return output.master.find((capability) => capability.route === route);
};

describe('a page declared in the route table’s own file', () => {
  it('is described by what the sections it composes say, for a function declaration', async () => {
    const config = app(files('function MainPage() {\n  return (\n    <main>\n      <Hero />\n      <Pricing />\n      <Team />\n    </main>\n  );\n}'));
    const home = await explanationAt(config, '/');
    expect(home?.explanation).toContain('Membership prices');
    expect(home?.explanation).toContain('Meet our staff');
    expect(home?.explanation).toContain('Train with the best coaches');
  });

  it('ends its sentence once, even when the last thing the page says already ended one', async () => {
    const config = app(files('function MainPage() {\n  return <Pricing />;\n}'));
    const home = await explanationAt(config, '/');
    expect(home?.explanation).toContain('Monthly plans from thirty euros.');
    expect(home?.explanation).not.toContain('..');
  });

  it('reads the text a page shows as a person reads it: an entity is the character it stands for', async () => {
    const config = app({
      ...files('function MainPage() {\n  return <Pricing />;\n}'),
      'pages/Pricing.jsx': section('Pricing', '      <h2>Match &amp; results</h2>\n      <p>Don&apos;t miss &quot;training&quot; &#8211; &lt;free&gt;&nbsp;now</p>'),
    });
    const home = await explanationAt(config, '/');
    expect(home?.explanation).toContain('Match & results');
    expect(home?.explanation).toContain('Don\'t miss "training" – <free> now');
    expect(home?.explanation).not.toMatch(/&\w+;|&#/);
  });

  it('is described the same when it is a const arrow, with props', async () => {
    const config = app(files('const MainPage = ({ onOpen }) => (\n  <main>\n    <Hero />\n    <Pricing onOpen={onOpen} />\n  </main>\n);'));
    const home = await explanationAt(config, '/');
    expect(home?.explanation).toContain('Membership prices');
  });

  it('never takes the chrome the app renders around its routes for part of the page', async () => {
    const config = app(files('function MainPage() {\n  return (\n    <main>\n      <Hero />\n      <Pricing />\n    </main>\n  );\n}'));
    const home = await explanationAt(config, '/');
    expect(home?.explanation).not.toContain('Site chrome heading');
    // …and a section the page does not compose is not its content either.
    expect(home?.explanation).not.toContain('Meet our staff');
  });

  it('does not read a skip link as something the page shows', async () => {
    const config = app(
      files(
        [
          'function MainPage() {',
          '  return (',
          '    <>',
          '      <a href="#main-content" className="skip-link">Skip to the main content</a>',
          '      <main id="main-content"><Pricing /></main>',
          '    </>',
          '  );',
          '}',
        ].join('\n'),
      ),
    );
    const home = await explanationAt(config, '/');
    expect(home?.explanation).toContain('Membership prices');
    expect(home?.explanation).not.toContain('Skip to the main content');
    // A link to another part of the page that is *not* a skip link is still the page's own words.
    const anchored = app(files('function MainPage() {\n  return (\n    <main>\n      <a href="#pricing">See our plans</a>\n      <Pricing />\n    </main>\n  );\n}'));
    expect((await explanationAt(anchored, '/'))?.explanation).toContain('See our plans');
  });

  it('says where the description came from, so a wrong answer is one path away from its cause', async () => {
    const config = app(files('function MainPage() {\n  return <Pricing />;\n}'));
    const home = await explanationAt(config, '/');
    expect(home?.explanationSource).toBe('App.jsx');
  });

  it('leaves a page that is imported exactly as it was', async () => {
    const config = app(files('function MainPage() {\n  return <Pricing />;\n}'));
    const privacy = await explanationAt(config, '/privacy');
    expect(privacy?.explanation).toContain('Privacy policy');
    expect(privacy?.explanationSource).toBe('pages/Privacy.jsx');
  });

  it('falls back to what it always said when the local component composes nothing it can read', async () => {
    const config = app(files('function MainPage() {\n  return <main />;\n}'));
    const home = await explanationAt(config, '/');
    expect(home).toBeDefined();
    expect(home?.explanation).toBe('Home is a screen in this application.');
  });
});
