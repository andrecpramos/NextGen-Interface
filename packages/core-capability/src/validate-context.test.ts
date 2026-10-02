import { describe, expect, it } from 'vitest';

import { defineCapability, defineRegistry } from './define.ts';
import { validateRegistry } from './validate.ts';
import type { RegistryFile } from './types.ts';

/**
 * What the owner says about the app (`RegistryContext`) is text that goes into a model's prompt
 * (ADR-023), so the validator that every generated registry passes through checks its *shape*
 * and its *size* — not what it means, which is the owner's to say.
 */

const base = (): RegistryFile =>
  defineRegistry({
    domainDescription: 'A club application. It shows squads and settings.',
    capabilities: [
      defineCapability({
        id: 'settings.overview', kind: 'navigate', route: '/settings',
        title: 'Settings', description: 'Account settings and preferences',
        explanation: 'Where you change your account settings.',
        explanationSource: 'features/settings/pages/SettingsPage.tsx',
        examples: ['open settings', 'change my settings', 'account preferences'],
      }),
    ],
  });

const withContext = (context: unknown): RegistryFile => ({ ...base(), context }) as RegistryFile;
const errors = (registry: RegistryFile) => validateRegistry(registry).issues.filter((i) => i.severity === 'error').map((i) => i.rule);

describe('validateRegistry — the owner’s context', () => {
  it('accepts a registry with none, and an ordinary one', () => {
    expect(validateRegistry(base()).ok).toBe(true);
    const good = withContext({
      glossary: [{ term: 'educando', means: 'um jovem atleta', aliases: ['filho', 'filha'] }, { term: 'plantel' }],
      rules: ['O estado médico é por educando.'],
      limits: [{ about: 'Pagamentos', say: 'As quotas são geridas pela secretaria.' }],
    });
    expect(validateRegistry(good).ok).toBe(true);
    expect(errors(good)).toEqual([]);
  });

  it('refuses a context that is not an object', () => {
    for (const bad of ['text', 7, ['a'], true]) expect(errors(withContext(bad))).toContain('context-shape');
  });

  it('refuses an entry of the wrong shape, naming the rule', () => {
    expect(errors(withContext({ rules: 'one rule' }))).toContain('context-shape');
    expect(errors(withContext({ rules: ['ok', 3] }))).toContain('context-shape');
    expect(errors(withContext({ rules: ['ok', '   '] }))).toContain('context-shape');
    expect(errors(withContext({ glossary: [{ means: 'no term' }] }))).toContain('context-shape');
    expect(errors(withContext({ glossary: [{ term: 'x', aliases: 'nope' }] }))).toContain('context-shape');
    expect(errors(withContext({ limits: [{ about: 'x' }] }))).toContain('context-shape');
    expect(errors(withContext({ limits: [{ say: 'x' }] }))).toContain('context-shape');
  });

  it('refuses a context large enough to make every model turn enormous', () => {
    expect(errors(withContext({ rules: ['x'.repeat(700)] }))).toContain('context-size');
    expect(errors(withContext({ rules: Array.from({ length: 80 }, (_, i) => `regra ${i}`) }))).toContain('context-size');
    expect(errors(withContext({ glossary: Array.from({ length: 250 }, (_, i) => ({ term: `t${i}` })) }))).toContain('context-size');
  });

  it('says so, without failing, about a key it does not know', () => {
    const result = validateRegistry(withContext({ rules: ['ok'], regras: ['typo'] }));
    expect(result.ok).toBe(true);
    expect(result.issues.some((i) => i.severity === 'warning' && i.rule === 'context-unknown-key')).toBe(true);
  });
});
