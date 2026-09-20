import { describe, expect, it } from 'vitest';

import { createLiquid, mixParams, parseColor, radiusAt, shiftHue, STATE_PARAMS, type LiquidState, type Params } from './liquid.ts';

/**
 * The liquid's shape is arithmetic, so it is tested as arithmetic: it closes, it
 * stays a blob in every state, and the microphone visibly moves it. What it
 * looks like is judged in a browser (`pnpm embed:preview`), not here.
 */

const STATES = Object.keys(STATE_PARAMS) as LiquidState[];
const TAU = Math.PI * 2;

describe('radiusAt — the shape', () => {
  it('always closes the curve, in every state and at any level', () => {
    for (const state of STATES) {
      for (const level of [0, 0.5, 1]) {
        for (const t of [0, 1.3, 42]) {
          for (const layer of [0, 1, 2]) {
            const p = STATE_PARAMS[state];
            expect(radiusAt(TAU, t, layer, p, level)).toBeCloseTo(radiusAt(0, t, layer, p, level), 9);
          }
        }
      }
    }
  });

  it('stays a blob: it never collapses and never spikes', () => {
    let min = Infinity;
    let max = -Infinity;
    for (const state of STATES) {
      for (const level of [0, 0.25, 0.5, 0.75, 1]) {
        for (let t = 0; t < 20; t += 0.7) {
          for (let i = 0; i < 64; i++) {
            for (const layer of [0, 1, 2]) {
              const r = radiusAt((i / 64) * TAU, t, layer, STATE_PARAMS[state], level);
              min = Math.min(min, r);
              max = Math.max(max, r);
            }
          }
        }
      }
    }
    expect(min).toBeGreaterThan(0.5);
    expect(max).toBeLessThan(1.7);
  });

  it('listens: the microphone level visibly moves the edge', () => {
    const spread = (level: number): number => {
      const radii = Array.from({ length: 180 }, (_, i) => radiusAt((i / 180) * TAU, 3, 0, STATE_PARAMS.listening, level));
      return Math.max(...radii) - Math.min(...radii);
    };
    expect(spread(1)).toBeGreaterThan(spread(0) * 1.5);
  });
});

describe('mixParams', () => {
  it('goes from one state to the other and no further', () => {
    const keys = Object.keys(STATE_PARAMS.idle) as (keyof Params)[];
    const start = mixParams(STATE_PARAMS.idle, STATE_PARAMS.thinking, 0);
    const end = mixParams(STATE_PARAMS.idle, STATE_PARAMS.thinking, 1);
    for (const key of keys) {
      expect(start[key]).toBeCloseTo(STATE_PARAMS.idle[key], 12);
      expect(end[key]).toBeCloseTo(STATE_PARAMS.thinking[key], 12);
    }
  });
});

describe('shiftHue', () => {
  it('turns a colour around the wheel and keeps its lightness', () => {
    const green = shiftHue([255, 0, 0], 120);
    expect(green[0]).toBeCloseTo(0, 6);
    expect(green[1]).toBeCloseTo(255, 6);
    expect(green[2]).toBeCloseTo(0, 6);
    const back = shiftHue(shiftHue([121, 192, 206], -30), 30);
    [121, 192, 206].forEach((v, i) => expect(back[i]).toBeCloseTo(v, 6));
  });

  it('leaves a grey alone — it has no hue to turn', () => {
    expect(shiftHue([128, 128, 128], 90)).toEqual([128, 128, 128]);
  });
});

describe('parseColor — the host accent, or nothing', () => {
  it('reads hex and rgb()', () => {
    expect(parseColor('#79c0ce')).toEqual([121, 192, 206]);
    expect(parseColor(' #FFF ')).toEqual([255, 255, 255]);
    expect(parseColor('rgb(1, 2, 3)')).toEqual([1, 2, 3]);
    expect(parseColor('rgba(10 20 30 / .5)')).toEqual([10, 20, 30]);
  });

  it('returns null for anything it cannot be sure of, so the default stands', () => {
    expect(parseColor('teal')).toBeNull();
    expect(parseColor('rgb(300, 0, 0)')).toBeNull();
    expect(parseColor('')).toBeNull();
    expect(parseColor(null)).toBeNull();
  });
});

function fakeCanvas(): { canvas: HTMLCanvasElement; calls: string[] } {
  const calls: string[] = [];
  const gradient = { addColorStop: () => undefined };
  const ctx = new Proxy({} as Record<string, unknown>, {
    get: (_t, prop) => (prop === 'createRadialGradient' ? () => gradient : () => void calls.push(String(prop))),
    set: () => true,
  });
  return { canvas: { getContext: () => ctx, width: 0, height: 0 } as unknown as HTMLCanvasElement, calls };
}

function fakeView(): { view: Window; frames: unknown[] } {
  const frames: unknown[] = [];
  const view = {
    devicePixelRatio: 3,
    requestAnimationFrame: (cb: unknown) => frames.push(cb),
    cancelAnimationFrame: () => undefined,
    document: { hidden: false, addEventListener: () => undefined, removeEventListener: () => undefined },
  } as unknown as Window;
  return { view, frames };
}

describe('createLiquid', () => {
  it('is a harmless no-op where a canvas cannot draw', () => {
    const liquid = createLiquid({} as HTMLCanvasElement, { size: 320, palette: () => ({ accent: null, scheme: 'dark', bead: null }), reducedMotion: false, view: null });
    expect(() => {
      liquid.setState('thinking');
      liquid.setLevel(2);
      liquid.setBacking(-1);
      liquid.refresh();
      liquid.destroy();
    }).not.toThrow();
  });

  it('draws at the device pixel ratio, capped at 2', () => {
    const { canvas } = fakeCanvas();
    createLiquid(canvas, { size: 320, palette: () => ({ accent: null, scheme: 'dark', bead: null }), reducedMotion: false, view: fakeView().view });
    expect(canvas.width).toBe(640);
  });

  it('animates by default', () => {
    const { canvas } = fakeCanvas();
    const { view, frames } = fakeView();
    createLiquid(canvas, { size: 320, palette: () => ({ accent: null, scheme: 'dark', bead: null }), reducedMotion: false, view });
    expect(frames).toHaveLength(1);
  });

  it('under reduced motion draws still frames and never starts a loop', () => {
    const { canvas, calls } = fakeCanvas();
    const { view, frames } = fakeView();
    const liquid = createLiquid(canvas, { size: 320, palette: () => ({ accent: '#fff', scheme: 'light', bead: '#fff' }), reducedMotion: true, view });
    const drawn = calls.filter((c) => c === 'fill').length;
    liquid.setState('thinking');
    expect(frames).toHaveLength(0);
    expect(calls.filter((c) => c === 'fill').length).toBeGreaterThan(drawn);
  });
});

describe('createLiquid — the mind inside it', () => {
  const palette = () => ({ accent: '#79c0ce', scheme: 'dark' as const, bead: null });
  const fills = (mind: boolean | undefined): number => {
    const { canvas, calls } = fakeCanvas();
    createLiquid(canvas, { size: 320, palette, reducedMotion: true, view: fakeView().view, ...(mind === undefined ? {} : { mind }) });
    return calls.filter((c) => c === 'fill').length;
  };

  it('draws a dotted sphere in the body by default', () => {
    expect(fills(undefined)).toBeGreaterThan(fills(false) + 50);
  });

  it('can be left out, and then draws the liquid alone', () => {
    expect(fills(false)).toBeLessThan(20);
  });
});

describe('createLiquid — telling the composer', () => {
  const palette = () => ({ accent: null, scheme: 'dark' as const, bead: null });

  it('says which state it is in, as soon as it is asked', () => {
    const seen: string[] = [];
    const liquid = createLiquid(fakeCanvas().canvas, { size: 320, palette, reducedMotion: false, view: fakeView().view, onState: (s) => seen.push(s) });
    liquid.setState('thinking');
    liquid.setState('idle');
    expect(seen).toEqual(['thinking', 'idle']);
  });

  it('reports the level it is showing — smoothed, so a glow that follows it does not flicker', () => {
    const levels: number[] = [];
    const { view, frames } = fakeView();
    const liquid = createLiquid(fakeCanvas().canvas, { size: 320, palette, reducedMotion: false, view, onLevel: (l) => levels.push(l) });
    liquid.setLevel(1);
    (frames.shift() as FrameRequestCallback)(1000);
    (frames.shift() as FrameRequestCallback)(1016);
    expect(levels.length).toBeGreaterThan(0);
    expect(levels[0]!).toBeGreaterThan(0);
    expect(levels[0]!).toBeLessThan(1);
    expect(levels[1]!).toBeGreaterThan(levels[0]!);
  });

  it('is quiet when nothing changed', () => {
    const levels: number[] = [];
    const { view, frames } = fakeView();
    createLiquid(fakeCanvas().canvas, { size: 320, palette, reducedMotion: false, view, onLevel: (l) => levels.push(l) });
    (frames.shift() as FrameRequestCallback)(1000);
    (frames.shift() as FrameRequestCallback)(1016);
    expect(levels).toEqual([]);
  });
});
