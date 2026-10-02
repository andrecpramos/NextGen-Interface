import { describe, expect, it } from 'vitest';

import { synthesiseBoundaries } from './boundaries.ts';
import type { DiscoveredRoute } from './types.ts';

const route = (path: string, feature: string): DiscoveredRoute => ({
  path,
  component: 'Page',
  componentFile: null,
  feature,
  roles: ['COACH'],
  roleKey: null,
  devOnly: false,
  comment: null,
});

describe('synthesiseBoundaries — the catalogue', () => {
  it('always declares the limits true of any navigation assistant', () => {
    const ids = synthesiseBoundaries([route('/home', 'home')]).map((b) => b.id);
    expect(ids).toContain('unsupported.external_actions');
    expect(ids).toContain('unsupported.data_changes');
    expect(ids).toContain('unsupported.other_applications');
  });

  // A payments refusal in an app with no money anywhere is noise in the stage-2
  // corpus rather than a boundary.
  it('declares a payments limit only where the application has money in it', () => {
    const without = synthesiseBoundaries([route('/squad', 'squad')]).map((b) => b.id);
    const withMoney = synthesiseBoundaries([route('/finance/invoices', 'finance')]).map((b) => b.id);
    expect(without).not.toContain('unsupported.payments');
    expect(withMoney).toContain('unsupported.payments');
  });

  it('gives every boundary somewhere to refuse from and nowhere to go', () => {
    for (const boundary of synthesiseBoundaries([route('/finance', 'finance')])) {
      expect(boundary.kind).toBe('unsupported');
      expect(boundary.route).toBeNull();
      expect(boundary.refusal?.length ?? 0).toBeGreaterThan(20);
      expect(boundary.examples?.length ?? 0).toBeGreaterThanOrEqual(3);
    }
  });

  // Pilot-A field report, 2026-09-23 (P3-1): a Portuguese app refused its visitors in English.
  it('speaks the application’s primary language where the catalogue has it, and English otherwise', () => {
    const routes = [route('/finance/invoices', 'finance')];
    const pt = synthesiseBoundaries(routes, 'pt-PT');
    const en = synthesiseBoundaries(routes, 'en');
    expect(pt.map((b) => b.id)).toEqual(en.map((b) => b.id));
    expect(pt.find((b) => b.id === 'unsupported.payments')).toMatchObject({ title: 'Processar um pagamento' });
    expect((pt.find((b) => b.id === 'unsupported.payments') as { refusal: string }).refusal).toMatch(/não processo pagamentos/);
    for (const [a, b] of pt.map((p, i) => [p, en[i]!] as const)) {
      expect(a.title, a.id).not.toBe(b.title);
      // The examples are what recognises a request, in either language: they do not change.
      expect(a.examples).toEqual(b.examples);
    }
    expect(synthesiseBoundaries(routes, 'de-DE').map((b) => b.title)).toEqual(en.map((b) => b.title));
  });
});
