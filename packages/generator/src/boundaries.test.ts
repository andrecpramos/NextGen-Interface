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
  it('declares the limits true of an assistant over an app that does none of them', () => {
    const ids = synthesiseBoundaries([route('/home', 'home')]).map((b) => b.id);
    expect(ids).toContain('unsupported.external_actions');
    expect(ids).toContain('unsupported.other_applications');
  });

  /**
   * ADR-042. "Changing records for you" refused "cancela o treino de amanhã" as something the app does not
   * do, on an app whose sessions screen has a "Cancelar sessão" button. That the assistant never changes a
   * record is held by code (Rule 20: the screen is offered, never followed), so a limit saying it only
   * ever told visitors the app could not do what it can.
   */
  it('never declares that records cannot be changed', () => {
    expect(synthesiseBoundaries([route('/home', 'home')]).map((b) => b.id)).not.toContain('unsupported.data_changes');
  });

  /**
   * ADR-042. The first production integration refused "envia um email aos pais dos sub-15" as "acting outside
   * this application" — on an app whose communications screen sends email, SMS and push to the parents. A
   * generic limit is emitted only when the application has no control that does what the limit refuses.
   */
  it('never declares a limit the application contradicts with a control of its own', () => {
    const routes = [route('/finance/invoices', 'finance'), route('/communication', 'communication')];
    const of = (does: string[]) => synthesiseBoundaries(routes, 'en', [], new Set(does)).map((b) => b.id);
    expect(of([])).toEqual(expect.arrayContaining(['unsupported.external_actions', 'unsupported.payments']));
    expect(of(['send'])).not.toContain('unsupported.external_actions');
    expect(of(['book'])).not.toContain('unsupported.external_actions');
    expect(of(['pay'])).not.toContain('unsupported.payments');
    expect(of(['send', 'pay'])).toEqual(['unsupported.other_applications']);
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

  // A Portuguese app once refused its visitors in English.
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
