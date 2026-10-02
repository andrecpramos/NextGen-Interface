import { describe, expect, it } from 'vitest';

import { BEAM_CSS, beamVariables, createBeam } from './beam.ts';
import { parseColor } from './liquid.ts';
import { FakeDocument, type FakeElement } from './test-support/fake-dom.ts';

/**
 * The composer's edge light: border-beam's travelling line while the assistant thinks,
 * voice-glow's level-driven bloom while it listens or speaks, a slow breath at rest.
 * It is a stylesheet and four empty spans, so what is checked here is the contract
 * around them — the colours it derives, the state it reads, the level it clamps, and
 * that the stylesheet cannot do what a strict Content-Security-Policy or a shadow root
 * would refuse. What it looks like is judged in a browser (`pnpm preview`, /alive).
 */

const luminance = (rgb: string): number => {
  const parsed = parseColor(rgb);
  expect(parsed).not.toBeNull();
  return parsed![0] + parsed![1] + parsed![2];
};

describe('beamVariables — the light takes the page’s accent', () => {
  it('derives three tones and a danger tone, each one a colour the stylesheet can use', () => {
    const vars = beamVariables('#79c0ce', 'dark');
    expect(Object.keys(vars).sort()).toEqual(['--ng-beam-1', '--ng-beam-2', '--ng-beam-3', '--ng-beam-e']);
    for (const value of Object.values(vars)) expect(parseColor(value)).not.toBeNull();
  });

  it('turns the accent both ways round the wheel, so the beam has depth from one colour', () => {
    const vars = beamVariables('#79c0ce', 'dark');
    expect(new Set([vars['--ng-beam-1'], vars['--ng-beam-2'], vars['--ng-beam-3']]).size).toBe(3);
  });

  it('falls back to the default accent when the page has none it can be sure of', () => {
    expect(beamVariables(null, 'dark')).toEqual(beamVariables('#79c0ce', 'dark'));
    expect(beamVariables('teal', 'dark')).toEqual(beamVariables(null, 'dark'));
  });

  it('is denser on a light page, so the light does not wash out against white', () => {
    const dark = beamVariables('#79c0ce', 'dark');
    const light = beamVariables('#79c0ce', 'light');
    for (const name of ['--ng-beam-1', '--ng-beam-2', '--ng-beam-3', '--ng-beam-e'] as const) {
      expect(luminance(light[name])).toBeLessThan(luminance(dark[name]));
    }
  });

  it('keeps a grey accent grey — it has no hue to turn', () => {
    const vars = beamVariables('#808080', 'dark');
    expect(vars['--ng-beam-1']).toBe(vars['--ng-beam-3']);
  });
});

describe('createBeam — the layers and the state they read', () => {
  const form = (): { doc: FakeDocument; el: FakeElement } => {
    const doc = new FakeDocument('en');
    const el = doc.createElement('form');
    doc.body.append(el);
    return { doc, el };
  };

  it('adds one decorative element to the composer: the light is never announced', () => {
    const { doc, el } = form();
    createBeam(el as unknown as HTMLElement, doc as unknown as Document);
    expect(el.children).toHaveLength(1);
    expect(el.children[0]!.getAttribute('aria-hidden')).toBe('true');
    expect(el.children[0]!.children).toHaveLength(4);
  });

  it('starts at rest, and follows the state it is told', () => {
    const { doc, el } = form();
    const beam = createBeam(el as unknown as HTMLElement, doc as unknown as Document);
    expect(el.getAttribute('data-state')).toBe('idle');
    beam.setState('thinking');
    expect(el.getAttribute('data-state')).toBe('thinking');
    beam.setState('error');
    expect(el.getAttribute('data-state')).toBe('error');
  });

  it('hands the stylesheet the level as a number between 0 and 1', () => {
    const { doc, el } = form();
    const beam = createBeam(el as unknown as HTMLElement, doc as unknown as Document);
    expect(el.style['--ng-level']).toBe('0');
    beam.setLevel(0.5);
    expect(el.style['--ng-level']).toBe('0.500');
    beam.setLevel(7);
    expect(el.style['--ng-level']).toBe('1');
    beam.setLevel(-2);
    expect(el.style['--ng-level']).toBe('0');
    beam.setLevel(NaN);
    expect(el.style['--ng-level']).toBe('0');
  });
});

describe('BEAM_CSS — what the stylesheet may not do', () => {
  it('uses nothing a shadow root ignores or a strict policy blocks', () => {
    // @property is ignored in a shadow tree, so an animation built on it silently stops;
    // url() and @import are fetches a `style-src`/`img-src` policy may refuse.
    expect(BEAM_CSS).not.toMatch(/@property|@import|url\(|expression\(/);
  });

  it('reads every variable the script sets, and only those', () => {
    const used = new Set([...BEAM_CSS.matchAll(/var\((--[a-z0-9-]+)/g)].map((m) => m[1]));
    expect([...used].sort()).toEqual(['--ng-beam-1', '--ng-beam-2', '--ng-beam-3', '--ng-beam-e', '--ng-level']);
  });

  it('has a still form for reduced motion and no form at all in forced colours', () => {
    expect(BEAM_CSS).toMatch(/@media \(prefers-reduced-motion: reduce\)[^}]*\{[^]*\.beam-line/);
    expect(BEAM_CSS).toMatch(/@media \(forced-colors: active\)[^}]*\{[^}]*\.beam \{ display: none/);
  });

  it('answers to every state the orb has', () => {
    for (const state of ['idle', 'listening', 'thinking', 'speaking', 'error']) {
      expect(BEAM_CSS).toContain(`[data-state="${state}"]`);
    }
  });
});
