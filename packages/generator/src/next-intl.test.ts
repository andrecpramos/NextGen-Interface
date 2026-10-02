import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { generate } from './generate.ts';
import { readPage } from './pages.ts';
import type { GeneratorConfig } from './types.ts';

/**
 * next-intl, the i18n library of the Next.js app router.
 *
 * Found by running the scanner on a real Next.js app: every page took its words from
 * `const t = await getTranslations('portal.athlete')`, and the reader only understood i18next's
 * `useTranslation('ns')`. It found the keys (`cards.licence.title`) and could not say which
 * namespace they were in, so none resolved against `messages/pt.json` and no screen said a word about
 * what it shows. The library's messages are one nested file per language, and a namespace is a path
 * into it: `portal.athlete` is `messages.portal.athlete`.
 */

function app(files: Record<string, string>): GeneratorConfig {
  const appRoot = mkdtempSync(join(tmpdir(), 'nextgen-intl-'));
  for (const [name, source] of Object.entries(files)) {
    mkdirSync(dirname(join(appRoot, name)), { recursive: true });
    writeFileSync(join(appRoot, name), source, 'utf8');
  }
  return { appRoot, routesFile: 'routes.jsx', roleSetExport: 'ROUTE_ROLES', allRolesExport: 'APP_ROLES', manifests: [], localesDir: 'messages', languages: ['en'] };
}

const messages = JSON.stringify({
  portal: { athlete: { title: 'Athlete dashboard', subtitle: 'Your licence and registrations' } },
  billing: { pay: 'Pay the invoice' },
});

const routes = [
  "import Page from './pages/Athlete';",
  'export default function App() {',
  '  return <Routes><Route path="/athlete" element={<Page />} /></Routes>;',
  '}',
].join('\n');

const at = async (page: string) => {
  const config = app({ 'routes.jsx': routes, 'pages/Athlete.jsx': page, 'messages/en.json': messages });
  const output = await generate({ config, model: null });
  return { config, capability: output.master.find((c) => c.route === '/athlete') };
};

/**
 * A locale prefix is not something a visitor supplies. Declared as a required parameter, it made the
 * router see a missing slot on every screen of a locale-routed app — so "sign in", matched at 1.00, still
 * ended as a question instead of taking the visitor there. The widget fills it from the page they are on.
 */
describe('a locale prefix is not a parameter the visitor must supply', () => {
  const at = async (route: string) => {
    const config = app({
      'routes.jsx': [
        "import Page from './pages/Page';",
        `export default function App() { return <Routes><Route path="${route}" element={<Page />} /></Routes>; }`,
      ].join('\n'),
      'pages/Page.jsx': 'export default function Page() { return <h1>Players</h1>; }',
      'messages/en.json': '{}',
    });
    const output = await generate({ config, model: null });
    return output.master[0];
  };

  it('declares no parameter for it, so nothing is "missing"', async () => {
    expect((await at('/:locale/login'))?.params).toBeUndefined();
    expect((await at('/:lang/login'))?.params).toBeUndefined();
  });

  it('still declares the parameters that pick an item, prefixed or not', async () => {
    expect(Object.keys((await at('/:locale/players/:id'))?.params ?? {})).toEqual(['id']);
    expect(Object.keys((await at('/players/:id'))?.params ?? {})).toEqual(['id']);
  });

  it('keeps the prefix in the route, which the widget fills from the current page', async () => {
    expect((await at('/:locale/login'))?.route).toBe('/:locale/login');
  });
});

describe('next-intl — the namespace a translation function is bound to', () => {
  it('reads `const t = await getTranslations("ns")`, the server-component form', async () => {
    const { capability } = await at(
      [
        "import { getTranslations } from 'next-intl/server';",
        'export default async function Page() {',
        "  const t = await getTranslations('portal.athlete');",
        '  return <main><h1>{t("title")}</h1><p>{t("subtitle")}</p></main>;',
        '}',
      ].join('\n'),
    );
    expect(capability?.explanation).toContain('Your licence and registrations');
  });

  it('reads `const t = useTranslations("ns")`, the client-component form', async () => {
    const { capability } = await at(
      [
        "import { useTranslations } from 'next-intl';",
        'export default function Page() {',
        "  const t = useTranslations('portal.athlete');",
        '  return <main><h1>{t("title")}</h1><p>{t("subtitle")}</p></main>;',
        '}',
      ].join('\n'),
    );
    expect(capability?.explanation).toContain('Your licence and registrations');
  });

  it('reads the object form, `getTranslations({ locale, namespace })`', async () => {
    const { capability } = await at(
      [
        "import { getTranslations } from 'next-intl/server';",
        'export default async function Page({ params }) {',
        '  const { locale } = await params;',
        "  const t = await getTranslations({ locale, namespace: 'portal.athlete' });",
        '  return <main><p>{t("subtitle")}</p></main>;',
        '}',
      ].join('\n'),
    );
    expect(capability?.explanation).toContain('Your licence and registrations');
  });

  it('keeps two bound functions apart, each in its own namespace', async () => {
    const { capability } = await at(
      [
        "import { getTranslations } from 'next-intl/server';",
        'export default async function Page() {',
        "  const t = await getTranslations('portal.athlete');",
        "  const c = await getTranslations('billing');",
        '  return <main><p>{t("subtitle")}</p><button>{c("pay")}</button></main>;',
        '}',
      ].join('\n'),
    );
    expect(capability?.explanation).toContain('Your licence and registrations');
    expect(capability?.explanation).toContain('Pay the invoice');
  });

  it('records the namespace on the keys it read, so every one of them resolves', () => {
    const dir = mkdtempSync(join(tmpdir(), 'nextgen-intl-page-'));
    const file = join(dir, 'Page.jsx');
    writeFileSync(
      file,
      [
        "import { getTranslations } from 'next-intl/server';",
        'export default async function Page() {',
        "  const t = await getTranslations('portal.athlete');",
        '  return <main><h1>{t("title")}</h1></main>;',
        '}',
      ].join('\n'),
      'utf8',
    );
    expect(readPage(file).i18nKeys).toEqual(['portal.athlete:title']);
  });

  it('leaves i18next exactly as it was', () => {
    const dir = mkdtempSync(join(tmpdir(), 'nextgen-i18next-'));
    const file = join(dir, 'Page.jsx');
    writeFileSync(
      file,
      ["export default function Page() {", "  const { t } = useTranslation('squad');", '  return <h1>{t("title")}</h1>;', '}'].join('\n'),
      'utf8',
    );
    expect(readPage(file).i18nKeys).toEqual(['squad:title']);
  });
});
