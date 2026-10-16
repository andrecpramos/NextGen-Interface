import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { generate } from './generate.ts';
import { localeFolders, readLocales, translate } from './labels.ts';
import type { GeneratorConfig } from './types.ts';

/**
 * Translations spread over several folders, one per package.
 *
 * Found on a real app once it became a monorepo: the navigation's words live in a shared i18n package
 * and each feature package keeps its pages' words beside its code. `localesDir` named one folder, so
 * every screen named only by its own heading — a detail page, a settings tab — fell back to its
 * component's name: "Session Detail", in English, in a Portuguese registry. A list of folders merges per
 * namespace and key, the first listed winning a key two of them define, as an owner's copy wins over a
 * package that only adds entries to it.
 */

function tree(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'nextgen-locales-'));
  for (const [name, source] of Object.entries(files)) {
    mkdirSync(dirname(join(root, name)), { recursive: true });
    writeFileSync(join(root, name), source, 'utf8');
  }
  return root;
}

const json = (value: unknown) => JSON.stringify(value);

const FOLDERS = {
  // The shared package: navigation and errors.
  'shared/i18n/pt-PT/common.json': json({ nav: { sessions: 'Sessões' } }),
  'shared/i18n/pt-PT/errors.json': json({ codes: { notFound: 'Não encontrado' }, generic: 'Erro' }),
  // A feature package: its own namespace.
  'training/i18n/pt-PT/training.json': json({ detail: { title: 'Detalhe da Sessão' } }),
  // A package extending another's lookup table, and redefining one key it does not own.
  'pack/i18n/extends/pt-PT/errors.json': json({ codes: { offside: 'Fora de jogo', notFound: 'Sumiu' } }),
  // A flat-file folder, as vue-i18n lays them out.
  'flat/pt-PT.json': json({ banner: 'Bem-vindo' }),
};

describe('localeFolders', () => {
  it('reads one folder, a list, or none', () => {
    expect(localeFolders({ localesDir: 'i18n' })).toEqual(['i18n']);
    expect(localeFolders({ localesDir: ['a', 'b'] })).toEqual(['a', 'b']);
    expect(localeFolders({ localesDir: null })).toEqual([]);
  });
});

describe('readLocales — several folders', () => {
  const appRoot = tree(FOLDERS);
  const read = (localesDir: GeneratorConfig['localesDir']) => readLocales({ appRoot, localesDir }, 'pt-PT');

  it('reads a folder’s namespaces in file-name order, whatever order the file system lists them in', () => {
    const root = tree({ 'i18n/pt-PT/zeta.json': json({ a: 'z' }), 'i18n/pt-PT/alpha.json': json({ a: 'a' }), 'i18n/pt-PT/mid.json': json({ a: 'm' }) });
    expect([...readLocales({ appRoot: root, localesDir: 'i18n' }, 'pt-PT').translations.keys()]).toEqual(['alpha', 'mid', 'zeta']);
  });

  it('keeps one folder working exactly as before', () => {
    const { translations, collisions } = read('shared/i18n');
    expect(translate(translations, 'nav.sessions')).toBe('Sessões');
    expect(translate(translations, 'training:detail.title')).toBeNull();
    expect(collisions).toBe(0);
  });

  it('reads every namespace from every folder listed', () => {
    const { translations } = read(['shared/i18n', 'training/i18n', 'flat']);
    expect(translate(translations, 'nav.sessions')).toBe('Sessões');
    expect(translate(translations, 'training:detail.title')).toBe('Detalhe da Sessão');
    expect(translate(translations, 'banner')).toBe('Bem-vindo');
  });

  it('merges one namespace key by key, the first folder listed winning a key two define, and counts each', () => {
    const { translations, collisions } = read(['shared/i18n', 'pack/i18n/extends']);
    expect(translate(translations, 'errors:codes.offside')).toBe('Fora de jogo');
    expect(translate(translations, 'errors:codes.notFound')).toBe('Não encontrado');
    expect(translate(translations, 'errors:generic')).toBe('Erro');
    expect(collisions).toBe(1);
  });

  it('lets the order decide: listed the other way round, the other folder wins', () => {
    const { translations, collisions } = read(['pack/i18n/extends', 'shared/i18n']);
    expect(translate(translations, 'errors:codes.notFound')).toBe('Sumiu');
    expect(collisions).toBe(1);
  });

  it('skips a folder that does not exist rather than failing', () => {
    expect(translate(read(['missing', 'shared/i18n']).translations, 'nav.sessions')).toBe('Sessões');
  });
});

describe('generate — a page titled from a package’s own folder', () => {
  const files = {
    ...FOLDERS,
    'permissions.ts': "export const APP_ROLES = ['COACH']\nexport const ROUTE_ROLES = { all: ['COACH'] }",
    'SessionDetail.tsx': [
      "import { useTranslation } from 'react-i18next'",
      'export default function SessionDetailPage() {',
      "  const { t } = useTranslation('training')",
      "  return <h1>{t('detail.title')}</h1>",
      '}',
    ].join('\n'),
    'routes.tsx': [
      "import { lazy } from 'react'",
      "export const routes = [{ path: 'training/sessions/:id', element: lazy(() => import('./SessionDetail')) }]",
    ].join('\n'),
  };
  const config = (localesDir: GeneratorConfig['localesDir']): GeneratorConfig => ({
    appRoot: tree(files),
    routesFile: 'routes.tsx',
    permissionsFile: 'permissions.ts',
    roleSetExport: 'ROUTE_ROLES',
    allRolesExport: 'APP_ROLES',
    manifests: [],
    localesDir,
    languages: ['pt-PT'],
  });

  it('names the page in its own words once its package’s folder is listed, and says how many keys collided', async () => {
    const one = await generate({ config: config('shared/i18n'), model: null });
    expect(one.master[0]?.title).toBe('Session Detail');
    const all = await generate({ config: config(['shared/i18n', 'training/i18n', 'pack/i18n/extends']), model: null });
    expect(all.master[0]?.title).toBe('Detalhe da Sessão');
    expect(all.translationCollisions).toBe(1);
  });

  /**
   * ADR-042. A real app moved its pages into new packages and the config still listed the old folders,
   * which were still there: the build said "6 locale folders merged" and every control and title of the
   * moved pages resolved to nothing. A folder that is listed and exists proves nothing; a key the pages use
   * that resolves nowhere does.
   */
  it('says which keys the pages use resolve in no folder listed, by namespace', async () => {
    const missing = await generate({ config: config('shared/i18n'), model: null });
    expect(missing.untranslatedKeys).toEqual({ used: 1, unresolved: 1, namespaces: ['training'] });
    const all = await generate({ config: config(['shared/i18n', 'training/i18n']), model: null });
    expect(all.untranslatedKeys).toEqual({ used: 1, unresolved: 0, namespaces: [] });
  });
});
