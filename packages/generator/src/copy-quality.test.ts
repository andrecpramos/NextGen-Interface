import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { generate } from './generate.ts';
import type { GeneratorConfig } from './types.ts';

/**
 * What a screen "shows", when the words come from translation files.
 *
 * Found by running the scanner on a real application's source. The first four strings a page says are
 * what the assistant tells a visitor it shows, and they came from wherever `t()` was called first in the
 * file: a toast ("Bem-estar registado com sucesso!"), a delete confirmation ("Eliminar ementa?"), an error
 * ("Erro ao submeter"), a generic button from the shared namespace — and, in 9 of 56 screens, a sentence
 * with its placeholder still in it ("Desenvolvimento de {{name}}"). None of those is what the page is.
 */

function app(page: string): GeneratorConfig {
  const appRoot = mkdtempSync(join(tmpdir(), 'nextgen-copy-'));
  const files: Record<string, string> = {
    'routes.jsx': [
      "import Wellness from './pages/Wellness';",
      'export default function App() { return <Routes><Route path="/wellness" element={<Wellness />} /></Routes>; }',
    ].join('\n'),
    'pages/Wellness.jsx': page,
    'locales/en/wellness.json': JSON.stringify({
      title: 'Daily wellness',
      subtitle: 'Log how you feel every day',
      history: 'Your recent entries',
      saved: 'Wellness saved successfully!',
      failed: 'Could not submit, try again',
      confirmDelete: 'Delete this entry?',
      greeting: 'Hello {{name}}, welcome back',
      dueOn: 'Due on {date}',
      toast: { created: 'Entry created' },
    }),
    'locales/en/common.json': JSON.stringify({ actions: { delete: 'Delete', cancel: 'Cancel', save: 'Save' } }),
  };
  for (const [name, source] of Object.entries(files)) {
    mkdirSync(dirname(join(appRoot, name)), { recursive: true });
    writeFileSync(join(appRoot, name), source, 'utf8');
  }
  return { appRoot, routesFile: 'routes.jsx', roleSetExport: 'ROUTE_ROLES', allRolesExport: 'APP_ROLES', manifests: [], localesDir: 'locales', languages: ['en'] };
}

// The order matters: everything incidental is called before anything is rendered.
const PAGE = [
  'export default function Wellness() {',
  "  const { t } = useTranslation('wellness');",
  "  const { t: tc } = useTranslation('common');",
  '  const onSave = () => {',
  "    toast.success(t('saved'));",
  "    toast.error(t('failed'));",
  "    toast(t('toast.created'));",
  '  };',
  '  return (',
  '    <main>',
  "      <ConfirmDialog title={t('confirmDelete')} confirm={tc('actions.delete')} cancel={tc('actions.cancel')} />",
  "      <p>{t('greeting', { name })}</p>",
  "      <p>{t('dueOn', { date })}</p>",
  "      <h1>{t('title')}</h1>",
  "      <p>{t('subtitle')}</p>",
  "      <h2>{t('history')}</h2>",
  '    </main>',
  '  );',
  '}',
].join('\n');

const explanation = async () => {
  const output = await generate({ config: app(PAGE), model: null });
  return output.master.find((c) => c.route === '/wellness')!.explanation;
};

describe('what a screen shows, from its translations', () => {
  it('never offers a sentence with its placeholder still in it', async () => {
    const said = await explanation();
    expect(said).not.toMatch(/\{\{|\{\w+\}/);
    expect(said).not.toContain('Hello');
    expect(said).not.toContain('Due on');
  });

  it('puts what the page shows ahead of its toasts, its errors and its confirmation dialogs', async () => {
    const said = await explanation();
    // The page's title ("Daily wellness") is its name, not something it shows.
    expect(said).toBe('This screen shows: Log how you feel every day, Your recent entries.');
    expect(said).not.toContain('Wellness saved successfully!');
    expect(said).not.toContain('Could not submit');
    expect(said).not.toContain('Delete this entry?');
    expect(said).not.toContain('Entry created');
  });

  it('puts the shared namespace’s buttons behind the page’s own words', async () => {
    const said = await explanation();
    expect(said).not.toMatch(/\bDelete\b|\bCancel\b/);
  });

  it('still has something to say when the page has nothing but incidental strings', async () => {
    const config = app(
      [
        'export default function Wellness() {',
        "  const { t } = useTranslation('wellness');",
        "  toast.success(t('saved'));",
        '  return <main />;',
        '}',
      ].join('\n'),
    );
    const output = await generate({ config, model: null });
    expect(output.master.find((c) => c.route === '/wellness')!.explanation).toContain('Wellness saved successfully');
  });
});
