import { describe, expect, it } from 'vitest';

import { contrast, css, GRAPHITE, parseCssColor, readTheme, themeVariables, type Rgba, type ThemeSource } from './theme.ts';

/**
 * The assistant takes the adopter's look from what their page renders. These tests
 * hand `readTheme` pages described as computed styles — the only thing a browser
 * would give it — and check it reads them the way a designer would.
 */

function near(actual: Rgba | null, expected: readonly [number, number, number], tolerance = 2): void {
  expect(actual).not.toBeNull();
  actual!.slice(0, 3).forEach((v, i) => expect(Math.abs(v - expected[i]!)).toBeLessThanOrEqual(tolerance));
}

function page({
  hasStyles = true,
  variables = {},
  elements = {},
}: {
  hasStyles?: boolean;
  variables?: Record<string, string>;
  elements?: Record<string, Record<string, string>>;
} = {}): ThemeSource {
  const made = new Map<string, Element>();
  const element = (name: string): Element => {
    if (!made.has(name)) made.set(name, { name } as unknown as Element);
    return made.get(name)!;
  };
  return {
    hasStyles,
    root: element('html'),
    body: element('body'),
    variable: (name) => variables[name] ?? '',
    style: (el, property) => elements[(el as unknown as { name: string }).name]?.[property] ?? '',
    first: (selector) => {
      const wanted = selector.split(',').map((s) => s.trim());
      const found = Object.keys(elements).find((key) => key !== 'html' && key !== 'body' && wanted.includes(key));
      return found ? element(found) : null;
    },
  };
}

const lightBody = { 'background-color': 'rgb(245, 246, 248)', color: 'rgb(29, 35, 48)', 'font-family': 'system-ui, sans-serif' };

describe('parseCssColor', () => {
  it('reads hex and rgb, in every syntax a computed style uses', () => {
    expect(parseCssColor('#1f6e7e')).toEqual([31, 110, 126, 1]);
    expect(parseCssColor('rgb(245, 246, 248)')).toEqual([245, 246, 248, 1]);
    expect(parseCssColor('rgba(0, 0, 0, 0)')).toEqual([0, 0, 0, 0]);
    expect(parseCssColor('rgb(10 20 30 / 50%)')).toEqual([10, 20, 30, 0.5]);
    expect(parseCssColor('transparent')).toEqual([0, 0, 0, 0]);
    near(parseCssColor('#fff8'), [255, 255, 255]);
  });

  it('reads hsl, and shadcn/ui’s bare HSL triplets', () => {
    near(parseCssColor('hsl(222.2 47.4% 11.2%)'), [15, 23, 42]);
    near(parseCssColor('222.2 47.4% 11.2%'), [15, 23, 42]);
  });

  it('reads oklch (Tailwind v4) and color(srgb …)', () => {
    near(parseCssColor('oklch(62.8% 0.2577 29.23)'), [255, 0, 0], 3);
    near(parseCssColor('oklch(0.985 0 0)'), [250, 250, 250]);
    expect(parseCssColor('color(srgb 1 0 0)')).toEqual([255, 0, 0, 1]);
  });

  it('returns null for anything it cannot be sure of', () => {
    expect(parseCssColor('teal')).toBeNull();
    expect(parseCssColor('var(--x)')).toBeNull();
    expect(parseCssColor('')).toBeNull();
    expect(parseCssColor(null)).toBeNull();
  });
});

describe('readTheme', () => {
  it('a page with no stylesheet of its own gets the default look', () => {
    expect(readTheme(page({ hasStyles: false }))).toBe(GRAPHITE);
  });

  it('a declared --nextgen-accent is honoured even on a page with no other CSS', () => {
    const theme = readTheme(page({ hasStyles: false, variables: { '--nextgen-accent': '#b23a48' } }));
    expect(theme.adopted).toBe(false);
    expect(theme.accent).toEqual([178, 58, 72, 1]);
  });

  it('a light app: its background, text, typeface and brand colour', () => {
    const theme = readTheme(
      page({
        elements: {
          body: lightBody,
          '[aria-current="page"]': { color: 'rgb(31, 110, 126)', 'background-color': 'rgb(230, 242, 244)' },
        },
      }),
    );
    expect(theme.adopted).toBe(true);
    expect(theme.scheme).toBe('light');
    expect(theme.background).toEqual([245, 246, 248, 1]);
    expect(theme.text).toEqual([29, 35, 48, 1]);
    expect(theme.accent).toEqual([31, 110, 126, 1]);
    expect(theme.onAccent).toEqual([255, 255, 255, 1]);
    expect(theme.font).toBe('system-ui, sans-serif');
    expect(contrast(theme.muted, theme.background)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(theme.accentText, theme.raised)).toBeGreaterThanOrEqual(4);
  });

  it('a dark app is a dark screen', () => {
    const theme = readTheme(page({ elements: { body: { 'background-color': 'rgb(15, 23, 42)', color: 'rgb(226, 232, 240)' } } }));
    expect(theme.scheme).toBe('dark');
    expect(theme.accent).toEqual(GRAPHITE.accent);
  });

  it('reads a design system’s primary colour', () => {
    const theme = readTheme(
      page({
        variables: { '--primary': '222.2 47.4% 11.2%' },
        elements: { body: { 'background-color': 'rgb(255, 255, 255)', color: 'rgb(2, 8, 23)' } },
      }),
    );
    near(theme.accent, [15, 23, 42]);
    expect(theme.onAccent).toEqual([255, 255, 255, 1]);
  });

  it('does not mistake a hover grey called --accent for a brand colour', () => {
    const theme = readTheme(
      page({
        variables: { '--accent': '210 40% 96.1%' },
        elements: { body: lightBody, 'a[href]': { color: 'rgb(37, 99, 235)' } },
      }),
    );
    expect(theme.accent).toEqual([37, 99, 235, 1]);
  });

  it('takes the shape of the app’s buttons and fields', () => {
    const theme = readTheme(
      page({
        elements: {
          body: lightBody,
          'button:not([disabled])': { 'border-top-left-radius': '6px' },
          textarea: {
            'border-top-left-radius': '4px',
            'background-color': 'rgb(255, 255, 255)',
            'border-top-width': '1px',
            'border-top-color': 'rgb(203, 213, 225)',
          },
        },
      }),
    );
    expect(theme.radius).toBe('6px');
    expect(theme.fieldRadius).toBe('4px');
    expect(theme.field).toEqual([255, 255, 255, 1]);
    expect(theme.border).toEqual([203, 213, 225, 1]);
  });

  it('finds the background through a transparent body', () => {
    const theme = readTheme(
      page({ elements: { body: { 'background-color': 'rgba(0, 0, 0, 0)' }, html: { 'background-color': 'rgb(10, 10, 10)' } } }),
    );
    expect(theme.background).toEqual([10, 10, 10, 1]);
    expect(theme.scheme).toBe('dark');
  });

  it('ignores an accent too faint to see against the page, and keeps looking', () => {
    const theme = readTheme(
      page({
        elements: {
          body: { 'background-color': 'rgb(255, 255, 255)', color: 'rgb(17, 24, 39)' },
          '[aria-current="page"]': { color: 'rgb(236, 246, 248)' },
          'a[href]': { color: 'rgb(37, 99, 235)' },
        },
      }),
    );
    expect(theme.accent).toEqual([37, 99, 235, 1]);
  });
});

describe('themeVariables', () => {
  it('names the typeface and corner shape only when the page has them', () => {
    const plain = themeVariables(GRAPHITE);
    expect(plain['--ng-font']).toBeUndefined();
    expect(plain['--ng-radius']).toBeUndefined();
    expect(plain['--ng-accent']).toBe(css(GRAPHITE.accent));

    const shaped = themeVariables({ ...GRAPHITE, adopted: true, font: 'Georgia, serif', radius: '6px', fieldRadius: '4px' });
    expect(shaped['--ng-font']).toBe('Georgia, serif');
    expect(shaped['--ng-radius']).toBe('6px');
    expect(shaped['--ng-field-radius']).toBe('4px');
  });

  // The signature look: glass, metal, light. Every value is derived from the page's own scheme and accent, so
  // it looks like part of their application and not like ours laid over it.
  describe('the glass, metal and light of the signature look', () => {
    const alpha = (value: string | undefined): number => {
      const match = /\/\s*([\d.]+)\)/.exec(value ?? '');
      return match ? Number(match[1]) : 1;
    };
    const channels = (value: string | undefined): number[] => (/rgb\((\d+) (\d+) (\d+)/.exec(value ?? '') ?? []).slice(1, 4).map(Number);
    const lightness = (value: string | undefined): number => channels(value).reduce((a, b) => a + b, 0) / 3;
    const amber = { ...GRAPHITE, accent: [224, 160, 74, 1] as const, accentText: [224, 160, 74, 1] as const, onAccent: [30, 20, 5, 1] as const };

    it('gives translucent surfaces, so the aurora and the page can be seen through them', () => {
      const vars = themeVariables(GRAPHITE);
      expect(alpha(vars['--ng-glass'])).toBeLessThan(0.8);
      expect(alpha(vars['--ng-glass'])).toBeGreaterThan(0.3);
      // The strong one is for what must stay legible: it is still glass, but mostly there.
      expect(alpha(vars['--ng-glass-strong'])).toBeGreaterThan(alpha(vars['--ng-glass']));
      expect(alpha(vars['--ng-glass-strong'])).toBeLessThan(1);
    });

    it('lights the top-left edge and leaves the bottom-right dim, in a dark page and in a light one', () => {
      const light = { ...GRAPHITE, scheme: 'light' as const, background: [255, 255, 255, 1] as const, raised: [255, 255, 255, 1] as const };
      for (const vars of [themeVariables(GRAPHITE), themeVariables(light)]) {
        expect(alpha(vars['--ng-edge-hi'])).toBeGreaterThan(alpha(vars['--ng-edge-lo']));
        expect(vars['--ng-inner']).toBeTruthy();
      }
    });

    it('is white glass with soft depth on a light page — the light half of the look', () => {
      const light = { ...GRAPHITE, scheme: 'light' as const, background: [246, 247, 249, 1] as const, raised: [255, 255, 255, 1] as const };
      const dark = themeVariables(GRAPHITE);
      const bright = themeVariables(light);
      expect(lightness(bright['--ng-glass'])).toBeGreaterThan(200);
      expect(lightness(dark['--ng-glass'])).toBeLessThan(100);
      expect(lightness(bright['--ng-edge-hi'])).toBeGreaterThan(240);
      expect(bright['--ng-glass']).not.toBe(dark['--ng-glass']);
    });

    it('makes the metal from the page’s accent: lighter at the top, darker at the bottom, the same hue', () => {
      const vars = themeVariables(amber);
      const [r, g, b] = channels(vars['--ng-accent']);
      expect(lightness(vars['--ng-metal-hi'])).toBeGreaterThan(lightness(vars['--ng-accent']));
      expect(lightness(vars['--ng-metal-lo'])).toBeLessThan(lightness(vars['--ng-accent']));
      // Amber stays amber: red strongest, blue weakest, in the lit and in the shaded end alike.
      for (const end of ['--ng-metal-hi', '--ng-metal-lo']) {
        const [er = 0, eg = 0, eb = 0] = channels(vars[end]);
        expect(er).toBeGreaterThanOrEqual(eg);
        expect(eg).toBeGreaterThanOrEqual(eb);
      }
      expect([r, g, b]).toEqual([224, 160, 74]);
    });

    it('throws light in the page’s accent and never in ours', () => {
      const vars = themeVariables(amber);
      for (const name of ['--ng-glow', '--ng-aurora-1', '--ng-aurora-2']) {
        expect(vars[name]).toMatch(/22\d[, ]+1\d\d[, ]+\d\d/);
        expect(alpha(vars[name])).toBeLessThan(0.7);
      }
      expect(JSON.stringify(vars)).not.toContain('121 192 206');
    });
  });

  it('gives the accent as a soft fill and as a line, both in the page’s accent and not ours', () => {
    const amber = { ...GRAPHITE, accent: [224, 160, 74, 1] as const };
    const vars = themeVariables(amber);
    // Amber in, amber out: a fallback colour written into the stylesheet must never show through.
    for (const name of ['--ng-accent-soft', '--ng-accent-line']) {
      expect(vars[name]).toMatch(/224[, ]+160[, ]+74/);
    }
    expect(vars['--ng-accent-line']).not.toBe(vars['--ng-accent-soft']);
  });
});
