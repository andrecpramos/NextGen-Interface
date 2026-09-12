import { describe, expect, it } from 'vitest';

import { checkRegistryOwnership } from './registry-owner.ts';

/**
 * These cover the judgement that decides whether a write replaces one
 * application's capabilities with another's. Since WP-47 each domain writes its
 * own path, so the refusal is a backstop rather than a daily hazard — the
 * judgement it encodes is unchanged.
 */

const registryJson = (ids: readonly string[]) =>
  JSON.stringify({ schemaVersion: 1, capabilities: ids.map((id) => ({ id })), enums: {} });

const MODULES = ['module.capture', 'module.list', 'module.search', 'unsupported.automation'];
const FINANCE = ['transaction.create', 'budget.view', 'account.balance', 'unsupported.move_money'];

describe('checkRegistryOwnership', () => {
  it('refuses the documented failure: finance written over modules', () => {
    const verdict = checkRegistryOwnership(registryJson(MODULES), FINANCE);
    expect(verdict.safe).toBe(false);
    expect(verdict.reason).toContain('different application');
  });

  it('is symmetric — modules over finance is the same mistake', () => {
    expect(checkRegistryOwnership(registryJson(FINANCE), MODULES).safe).toBe(false);
  });

  it('allows a domain to rebuild its own registry', () => {
    expect(checkRegistryOwnership(registryJson(MODULES), MODULES).safe).toBe(true);
  });

  it('allows a rebuild that adds and removes capabilities, as long as it is the same app', () => {
    const grown = [...MODULES, 'module.archive'];
    const shrunk = ['module.capture'];
    expect(checkRegistryOwnership(registryJson(MODULES), grown).safe).toBe(true);
    expect(checkRegistryOwnership(registryJson(MODULES), shrunk).safe).toBe(true);
  });

  /**
   * The subtle one. Both domains declare `unsupported.*` boundaries (ADR-009),
   * so it is the single namespace they share. Counting it as evidence of common
   * ownership would make two entirely unrelated applications look like the same
   * one, and the guard would pass exactly when it matters most.
   */
  it('does not treat the shared `unsupported` namespace as common ownership', () => {
    expect(checkRegistryOwnership(registryJson(['unsupported.a', 'module.list']), [
      'unsupported.b',
      'budget.view',
    ]).safe).toBe(false);
  });

  it('has nothing to protect when only boundaries are declared on either side', () => {
    // No real capability namespace on one side means no evidence of ownership
    // either way. Refusing here would block a legitimate first build.
    expect(checkRegistryOwnership(registryJson(['unsupported.a']), FINANCE).safe).toBe(true);
  });

  describe('treats an absent or unusable file as safe to overwrite', () => {
    /**
     * Deliberate. This guards against a build pointed at the wrong domain, not
     * against a corrupted artefact — and failing closed on malformed content
     * would block the very rebuild that repairs it.
     */
    it.each([
      ['nothing there yet', null],
      ['an empty file', ''],
      ['whitespace', '   \n'],
      ['not JSON at all', 'half a file'],
      ['JSON with no capabilities', '{"schemaVersion":1}'],
      ['an empty capability list', '{"capabilities":[]}'],
    ])('%s', (_name, existing) => {
      expect(checkRegistryOwnership(existing, MODULES).safe).toBe(true);
    });

    it('survives a capability entry with no id', () => {
      expect(checkRegistryOwnership('{"capabilities":[{},{"id":"module.list"}]}', MODULES).safe).toBe(
        true,
      );
    });
  });

  it('names both sides in the refusal, so the reader can see which build they ran', () => {
    const reason = checkRegistryOwnership(registryJson(MODULES), FINANCE).reason ?? '';
    expect(reason).toContain('module');
    expect(reason).toContain('transaction');
    expect(reason).toContain('--force');
  });
});
