import { describe, expect, it } from 'vitest';
import { resolvePreset } from 'thinking-orbs/engine';

import { STATE_PARAMS, type LiquidState } from './liquid.ts';
import { createMind, MIND_FOR } from './mind.ts';

/**
 * The mind is the dotted sphere inside the orb (thinking-orbs' engine). Its geometry is
 * the library's and is tested there; this checks what is ours — which state means which
 * motion, that every dot lands inside the orb, that a change of state crossfades and
 * settles, and that the microphone visibly moves it. Whether it looks alive is judged in
 * a browser (`pnpm preview`, /alive).
 */

const STATES = Object.keys(STATE_PARAMS) as LiquidState[];

interface Dot {
  readonly x: number;
  readonly y: number;
  readonly r: number;
  readonly fill: string;
}

function recorder(): { ctx: CanvasRenderingContext2D; dots: Dot[] } {
  const dots: Dot[] = [];
  let pending = { x: 0, y: 0, r: 0 };
  let fillStyle = '';
  const ctx = {
    set fillStyle(v: string) {
      fillStyle = v;
    },
    get fillStyle() {
      return fillStyle;
    },
    strokeStyle: '',
    lineWidth: 0,
    beginPath: () => undefined,
    moveTo: () => undefined,
    lineTo: () => undefined,
    stroke: () => undefined,
    arc: (x: number, y: number, r: number) => void (pending = { x, y, r }),
    fill: () => void dots.push({ ...pending, fill: fillStyle }),
  } as unknown as CanvasRenderingContext2D;
  return { ctx, dots };
}

const CENTRE = 160;
const RADIUS = 80;

function paint(mind: ReturnType<typeof createMind>, level = 0, light = false): Dot[] {
  const { ctx, dots } = recorder();
  mind.paint(ctx, CENTRE, CENTRE, RADIUS, [121, 192, 206], light, level);
  return dots;
}

describe('MIND_FOR — which state means which motion', () => {
  it('gives every orb state a motion the engine can draw', () => {
    for (const state of STATES) {
      expect(() => resolvePreset(MIND_FOR[state], 64)).not.toThrow();
    }
  });

  it('keeps the grammar: listening listens, thinking searches, speaking composes', () => {
    expect(MIND_FOR.listening).toBe('listening');
    expect(MIND_FOR.thinking).toBe('searching');
    expect(MIND_FOR.speaking).toBe('composing');
  });

  it('lets an error rest rather than perform: the same slow ring as idle', () => {
    expect(MIND_FOR.error).toBe(MIND_FOR.idle);
  });
});

describe('createMind — the dots', () => {
  it('draws dots in every state, and every one lands inside the orb', () => {
    for (const state of STATES) {
      const mind = createMind();
      mind.setState(state);
      for (const dt of [0, 0.4, 1.7]) {
        mind.step(dt, 0);
        const dots = paint(mind);
        expect(dots.length).toBeGreaterThan(10);
        for (const d of dots) {
          expect(Number.isFinite(d.x + d.y + d.r)).toBe(true);
          expect(d.r).toBeGreaterThan(0);
          expect(Math.hypot(d.x - CENTRE, d.y - CENTRE)).toBeLessThanOrEqual(RADIUS * 1.02);
        }
      }
    }
  });

  it('is deterministic before it moves — the still frame reduced motion draws', () => {
    expect(paint(createMind())).toEqual(paint(createMind()));
  });

  it('moves when time passes, and not when it does not', () => {
    const mind = createMind();
    const before = paint(mind);
    mind.step(0, 0);
    expect(paint(mind)).toEqual(before);
    mind.step(0.5, 0);
    expect(paint(mind)).not.toEqual(before);
  });

  it('is pushed outward by the microphone', () => {
    const reach = (level: number): number => {
      const mind = createMind();
      mind.setState('listening');
      return Math.max(...paint(mind, level).map((d) => Math.hypot(d.x - CENTRE, d.y - CENTRE)));
    };
    expect(reach(1)).toBeGreaterThan(reach(0));
  });

  it('survives a level that is not a level', () => {
    const mind = createMind();
    for (const level of [NaN, Infinity, -3, 9]) {
      expect(() => paint(mind, level)).not.toThrow();
      for (const d of paint(mind, level)) expect(Number.isFinite(d.x + d.y + d.r)).toBe(true);
    }
  });

  it('is ink on a light page and light on a dark one', () => {
    const mean = (dots: Dot[]): number => {
      const sums = dots.map((d) => (/rgba\((\d+),(\d+),(\d+)/.exec(d.fill)?.slice(1).map(Number) ?? [0, 0, 0]).reduce((a, b) => a + b, 0));
      return sums.reduce((a, b) => a + b, 0) / sums.length;
    };
    const mind = createMind();
    expect(mean(paint(mind, 0, false))).toBeGreaterThan(mean(paint(mind, 0, true)));
  });

  it('never paints an invisible dot, and never one more opaque than opaque', () => {
    for (const d of paint(createMind())) {
      const alpha = Number(/rgba\([^)]*,([\d.]+)\)/.exec(d.fill)?.[1]);
      expect(alpha).toBeGreaterThan(0);
      expect(alpha).toBeLessThanOrEqual(1);
    }
  });
});

describe('createMind — a change of state', () => {
  it('crossfades: the old motion is still there while the new one arrives', () => {
    const mind = createMind();
    expect(mind.showing()).toEqual(['breathing']);
    mind.setState('thinking');
    expect(mind.showing()).toEqual(['breathing', 'searching']);
  });

  it('settles on the new motion and lets the old one go', () => {
    const mind = createMind();
    mind.setState('thinking');
    mind.step(0.1, 0);
    expect(mind.showing()).toHaveLength(2);
    mind.step(2, 0);
    expect(mind.showing()).toEqual(['searching']);
  });

  it('does not crossfade a state into itself, nor idle into error — they are the same motion', () => {
    const mind = createMind();
    mind.setState('idle');
    mind.setState('error');
    expect(mind.showing()).toEqual(['breathing']);
  });

  it('can skip the fade, for a page that asked for no motion', () => {
    const mind = createMind();
    mind.setState('thinking');
    mind.settle();
    expect(mind.showing()).toEqual(['searching']);
    expect(paint(mind).length).toBeGreaterThan(10);
  });

  it('follows the last state asked for when they come faster than it can fade', () => {
    const mind = createMind();
    mind.setState('thinking');
    mind.step(0.05, 0);
    mind.setState('speaking');
    mind.step(0.05, 0);
    mind.setState('listening');
    mind.step(3, 0);
    expect(mind.showing()).toEqual(['listening']);
  });
});
