import { describe, expect, it } from 'vitest';

import { untranslatedWarning } from './build.ts';

/**
 * ADR-042. A config that lists locale folders the app has moved away from — but which still exist — built
 * without a word, and every title and control of the moved pages came out as nothing. The build now says
 * so, when enough of the keys the pages use resolve nowhere that it cannot be a typo.
 */
describe('untranslatedWarning — a locale folder missing from the config', () => {
  it('names the share and the namespaces, and what to check', () => {
    const warning = untranslatedWarning({ used: 400, unresolved: 180, namespaces: ['communication', 'competition'] });
    expect(warning).toMatch(/^45% of the translation keys/);
    expect(warning).toContain('communication, competition');
    expect(warning).toContain('localesDir');
  });

  it('says nothing about a few stray keys, or a page or two', () => {
    expect(untranslatedWarning({ used: 400, unresolved: 30, namespaces: ['common'] })).toBeNull();
    expect(untranslatedWarning({ used: 12, unresolved: 12, namespaces: ['training'] })).toBeNull();
    expect(untranslatedWarning(undefined)).toBeNull();
  });
});
