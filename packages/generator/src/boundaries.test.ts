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

});
