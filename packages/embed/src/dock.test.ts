import { describe, expect, it } from 'vitest';

import { chooseDockSide, type DockContext } from './dock.ts';

const HTML = { tagName: 'HTML' };
const BODY = { tagName: 'BODY' };
const NAV = { tagName: 'NAV' };

/** A page whose only fixed chrome, if any, sits on `occupied`'s edge. */
function page(occupied: 'left' | 'right' | 'none'): DockContext {
  return {
    innerWidth: 1200,
    innerHeight: 800,
    elementsFromPoint: (x) => {
      const onLeftEdge = x < 20;
      const onRightEdge = x > 1180;
      if (occupied === 'left' && onLeftEdge) return [NAV, BODY, HTML];
      if (occupied === 'right' && onRightEdge) return [NAV, BODY, HTML];
      return [BODY, HTML];
    },
  };
}

describe('chooseDockSide — the emptier edge wins', () => {
  it('docks right when a fixed rail occupies the left edge', () => {
    expect(chooseDockSide(page('left'))).toBe('right');
  });

  it('docks left when a fixed rail occupies the right edge', () => {
    expect(chooseDockSide(page('right'))).toBe('left');
  });

  it('defaults to right when neither edge is claimed by anything', () => {
    expect(chooseDockSide(page('none'))).toBe('right');
  });

  it('is not fooled by a rail that only reaches partway down the page', () => {
    const ctx: DockContext = {
      innerWidth: 1200,
      innerHeight: 800,
      // Occupies the left edge at one sample out of three only.
      elementsFromPoint: (x, y) => (x < 20 && y === 800 * 0.5 ? [NAV, BODY, HTML] : [BODY, HTML]),
    };
    expect(chooseDockSide(ctx)).toBe('right');
  });
});
