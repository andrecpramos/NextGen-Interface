import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { detectApp } from './detect.ts';

/**
 * Which language a Next.js app speaks, when its `<html lang>` is not written down.
 *
 * Found on a real next-intl app: `<html lang={locale}>` is decided per request, so there was no literal
 * to read, and the kit took the first language *alphabetically* — English — for a Portuguese federation
 * whose routing file says `defaultLocale: 'pt'` in so many words. Every description was then written in
 * the wrong language, and it was reported as a guess to confirm. The app had already said.
 */

function nextApp(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'nextgen-next-intl-'));
  const all: Record<string, string> = {
    'package.json': JSON.stringify({ dependencies: { next: '15.0.0', react: '19.0.0', 'next-intl': '4.0.0' } }),
    'src/app/[locale]/layout.tsx': 'export default function L({ children, params }) { return <html lang={params.locale}><body>{children}</body></html>; }',
    'src/app/[locale]/page.tsx': 'export default function Home() { return <h1>Home</h1>; }',
    'messages/en.json': '{"title":"Home"}',
    'messages/pt.json': '{"title":"Início"}',
    ...files,
  };
  for (const [name, source] of Object.entries(all)) {
    mkdirSync(dirname(join(dir, name)), { recursive: true });
    writeFileSync(join(dir, name), source, 'utf8');
  }
  return dir;
}

const language = (dir: string) => detectApp(dir).findings.find((f) => f.what === 'app language');

describe('init — the language of a Next.js app with locale routing', () => {
  it('takes the language from the routing file’s defaultLocale, and puts it first', () => {
    const dir = nextApp({ 'src/i18n/routing.ts': "export const routing = defineRouting({ locales: ['en', 'pt'], defaultLocale: 'pt', localePrefix: 'always' });" });
    const { config, warnings } = detectApp(dir);
    expect(config.languages).toEqual(['pt', 'en']);
    expect(language(dir)).toMatchObject({ value: 'pt', confident: true, evidence: expect.stringMatching(/defaultLocale "pt" in src\/i18n\/routing\.ts/) });
    expect(warnings.join(' ')).not.toMatch(/language is a guess/);
  });

  it('finds it in next.config too, the pages router’s `i18n` block', () => {
    const dir = nextApp({ 'next.config.mjs': "export default { i18n: { locales: ['en', 'pt'], defaultLocale: 'pt' } };" });
    expect(detectApp(dir).config.languages).toEqual(['pt', 'en']);
  });

  it('still prefers a literal <html lang>, which is the app saying what it renders', () => {
    const dir = nextApp({
      'src/app/layout.tsx': 'export default function L({ children }) { return <html lang="en"><body>{children}</body></html>; }',
      'src/i18n/routing.ts': "export const routing = defineRouting({ defaultLocale: 'pt' });",
    });
    expect(detectApp(dir).config.languages).toEqual(['en', 'pt']);
  });

  it('says it is a guess when the app never says, exactly as before', () => {
    const dir = nextApp({});
    expect(language(dir)).toMatchObject({ value: 'en', confident: false });
    expect(detectApp(dir).warnings.join(' ')).toMatch(/language is a guess/);
  });

  it('ignores a default locale that is not a language the app has messages for', () => {
    const dir = nextApp({ 'src/i18n/routing.ts': "export const routing = defineRouting({ defaultLocale: 'fr' });" });
    expect(detectApp(dir).config.languages).toEqual(['en', 'pt']);
  });
});
