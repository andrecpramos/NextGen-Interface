// The edge light: what the composer does while the assistant is alive.
//
// Two effects from the same family (border-beam and voice-glow) rebuilt as plain CSS,
// because the originals are React components that inject a <style> element — the
// one thing a strict Content-Security-Policy blocks, and a React runtime is not
// something a script tag carries. They live in the assistant's adopted stylesheet
// instead, and answer to the state the orb is in:
//
//   idle       a slow breath of the accent around the composer
//   thinking   a lit segment travelling the bottom edge, and the bloom it throws
//   listening  a glow centred on the bottom edge that rises with the microphone
//   speaking   the same glow, rising with the voice
//   error      the edge held in the danger colour, still
//
// The colours are the orb's: one accent turned both ways round the hue wheel, so the
// body, the dots and the light around the composer read as one thing on any page.
// Motion is never the only signal — the screen writes the state in text — and under
// reduced motion the light is a still line, under forced colours it is absent.
//
// No @property (a shadow tree ignores it and the animation silently stops), no url(),
// no filter reference: nothing here is a fetch.

import { DANGER_RGB, DEFAULT_RGB, mixRgb, parseColor, shiftHue, type LiquidState, type Rgb } from './liquid.ts';

const WHITE: Rgb = [255, 255, 255];
const BLACK: Rgb = [0, 0, 0];

export type BeamVariables = Readonly<Record<'--ng-beam-1' | '--ng-beam-2' | '--ng-beam-3' | '--ng-beam-e', string>>;

const rgb = (c: Rgb): string => `rgb(${Math.round(c[0])}, ${Math.round(c[1])}, ${Math.round(c[2])})`;

/**
 * The light's colours, from the page's accent: the accent and the two hues either side of
 * it, lifted toward white on a dark page and pressed toward black on a light one, plus
 * the danger tone. Written to the host, where the stylesheet reads them.
 */
export function beamVariables(accent: string | null, scheme: 'dark' | 'light'): BeamVariables {
  const base = parseColor(accent) ?? DEFAULT_RGB;
  const tune = (c: Rgb): string => rgb(scheme === 'light' ? mixRgb(c, BLACK, 0.22) : mixRgb(c, WHITE, 0.16));
  return {
    '--ng-beam-1': tune(shiftHue(base, -30)),
    '--ng-beam-2': tune(base),
    '--ng-beam-3': tune(shiftHue(base, 24)),
    '--ng-beam-e': tune(DANGER_RGB),
  };
}

export interface Beam {
  setState(state: LiquidState): void;
  /** 0..1 — the microphone or voice level the glow rises with. */
  setLevel(level: number): void;
}

const clamp01 = (v: number): number => Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0));

/** Lay the light over `composer` (which must be `position: relative`, as BEAM_CSS makes it). */
export function createBeam(composer: HTMLElement, doc: Document): Beam {
  const layer = (name: string): HTMLSpanElement => {
    const span = doc.createElement('span');
    span.className = name;
    return span;
  };
  const beam = layer('beam');
  beam.setAttribute('aria-hidden', 'true');
  beam.append(layer('beam-breath'), layer('beam-bloom'), layer('beam-line'), layer('beam-voice'));
  composer.append(beam);
  composer.dataset.state = 'idle';
  composer.style.setProperty('--ng-level', '0');

  return {
    setState(state) {
      composer.dataset.state = state;
    },
    setLevel(level) {
      const v = clamp01(level);
      composer.style.setProperty('--ng-level', v === 0 || v === 1 ? String(v) : v.toFixed(3));
    },
  };
}

export const BEAM_CSS = `
.composer { position: relative; }
.beam { position: absolute; inset: 0; border-radius: inherit; pointer-events: none; }
.beam > span { position: absolute; opacity: 0; transition: opacity 420ms ease; }

/* Idle: the accent breathing around the composer, so a page at rest is not dead. */
.beam-breath {
  inset: -1px; border-radius: inherit;
  box-shadow: 0 0 34px -2px var(--ng-beam-2, #79c0ce), inset 0 0 0 1px var(--ng-beam-2, #79c0ce);
  animation: nextgen-breathe 5.2s ease-in-out infinite;
}
@keyframes nextgen-breathe { 0%, 100% { opacity: .1; } 50% { opacity: .46; } }
.composer:not([data-state="idle"]) .beam-breath { animation-play-state: paused; opacity: 0; }

/* Thinking: a lit segment travelling the bottom edge, and the bloom it throws below it. */
.beam-line, .beam-bloom {
  left: 22px; right: 22px;
  background-image: linear-gradient(90deg, transparent, var(--ng-beam-1, #5fa9d6) 24%, var(--ng-beam-2, #79c0ce) 50%, var(--ng-beam-3, #8fd1b2) 76%, transparent);
  background-repeat: no-repeat; background-size: 36% 100%;
  animation: nextgen-sweep 2.4s cubic-bezier(.65, 0, .35, 1) infinite alternate;
  animation-play-state: paused;
}
.beam-line {
  bottom: -1px; height: 2px; border-radius: 2px;
  -webkit-mask-image: linear-gradient(90deg, transparent, #000 12%, #000 88%, transparent);
  mask-image: linear-gradient(90deg, transparent, #000 12%, #000 88%, transparent);
}
.beam-bloom { bottom: -10px; height: 22px; filter: blur(11px); }
@keyframes nextgen-sweep { from { background-position: 0% 0; } to { background-position: 100% 0; } }
.composer[data-state="thinking"] .beam-line { opacity: 1; animation-play-state: running; }
.composer[data-state="thinking"] .beam-bloom { opacity: 1; animation-play-state: running; }

/* Listening and speaking: a glow at the centre of the bottom edge, as tall as the sound. */
.beam-voice {
  left: 50%; bottom: -3px; transform: translateX(-50%);
  width: calc(28% + 64% * var(--ng-level, 0)); height: calc(7px + 34px * var(--ng-level, 0));
  background: radial-gradient(ellipse 50% 100% at 50% 100%, var(--ng-beam-2, #79c0ce) 0%, var(--ng-beam-1, #5fa9d6) 40%, transparent 74%);
  filter: blur(5px); transition: opacity 120ms linear;
}
.composer[data-state="listening"] .beam-voice,
.composer[data-state="speaking"] .beam-voice { opacity: calc(.55 + .45 * var(--ng-level, 0)); }
.composer[data-state="listening"] .beam-line,
.composer[data-state="speaking"] .beam-line {
  opacity: 1; animation: none;
  background-size: calc(26% + 66% * var(--ng-level, 0)) 100%; background-position: 50% 0;
}

/* Error: the edge held in the danger colour. Nothing moves. */
.composer[data-state="error"] .beam-line,
.composer[data-state="error"] .beam-bloom {
  opacity: .9; animation: none; background-size: 100% 100%;
  background-image: linear-gradient(90deg, transparent, var(--ng-beam-e, #d87c6b) 30%, var(--ng-beam-e, #d87c6b) 70%, transparent);
}
.composer[data-state="error"] .beam-bloom { opacity: .5; }

@media (prefers-reduced-motion: reduce) {
  .beam-line, .beam-bloom { background-size: 100% 100%; }
  .beam-breath { animation: none; opacity: .12; }
}
@media (forced-colors: active) {
  .beam { display: none; }
}
`;
