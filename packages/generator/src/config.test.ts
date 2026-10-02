import { describe, expect, it } from 'vitest';

import { normaliseConfig } from './config.ts';

/**
 * The regression these exist for: pointing the generator at a fixture whose config omitted
 * `manifests` crashed with `TypeError: config.manifests is not iterable` from inside
 * labels.ts. Every config committed to this repo declared every field, so the omission had
 * never been exercised — the gap was in the fixtures, not in the code review.
 */
describe('normaliseConfig', () => {
  const minimal = { appRoot: '/app/src', routesFile: 'routes.tsx' };

  it('defaults the fields an adopter may legitimately omit', () => {
    const { config, problem } = normaliseConfig(minimal);

    expect(problem).toBeNull();
    // Each of these reached a use site unguarded, or is checked there and must stay falsy.
    expect(config!.manifests).toEqual([]);
    expect(config!.languages).toEqual(['en']);
    expect(config!.localesDir).toBeNull();
  });

  it('makes an omitted manifests list iterable rather than undefined', () => {
    const { config } = normaliseConfig(minimal);
    // The crash was a for..of over undefined, so iterability is the property, not equality.
    expect(() => [...config!.manifests]).not.toThrow();
  });

  it('keeps what the adopter did declare', () => {
    const { config } = normaliseConfig({
      ...minimal,
      manifests: ['lib/nav.ts'],
      languages: ['pt-PT', 'en'],
      localesDir: 'i18n/locales',
    });

    expect(config!.manifests).toEqual(['lib/nav.ts']);
    expect(config!.languages).toEqual(['pt-PT', 'en']);
    expect(config!.localesDir).toBe('i18n/locales');
  });

  it('treats an empty languages list as an omission, not as "no languages"', () => {
    // A config that declares `"languages": []` would otherwise generate nothing at all,
    // silently — generate.ts loops over this list to produce every title.
    const { config } = normaliseConfig({ ...minimal, languages: [] });
    expect(config!.languages).toEqual(['en']);
  });

  it('reports every missing required field at once, rather than the first', () => {
    const { config, problem } = normaliseConfig({});

    expect(config).toBeNull();
    expect(problem!.missing).toEqual(['appRoot', 'routesFile']);
  });

  it('reports a missing appRoot even when routesFile is present', () => {
    const { problem } = normaliseConfig({ routesFile: 'routes.tsx' });
    expect(problem!.missing).toEqual(['appRoot']);
  });

  it('does not throw on a config that is not an object at all', () => {
    // JSON.parse('null') and JSON.parse('7') both typecheck as the cast the CLI performs.
    expect(() => normaliseConfig(null as never)).not.toThrow();
    expect(normaliseConfig(null as never).problem!.missing).toEqual(['appRoot', 'routesFile']);
  });
});
