// The mind: a dotted sphere inside the orb, drawn with thinking-orbs' engine.
//
// The liquid (liquid.ts) is the orb's body; this is what is going on inside it. Nine
// hand-tuned motions ship in the engine — a scan meridian sweeping a globe, a waveform
// rolling through rings, a slowly morphing ring — and the orb's five states each take
// one, so a state always looks like what it is:
//
//   idle       a ring, slowly morphing     — breathing
//   listening  a waveform through the rings — the microphone's own motion
//   thinking   a globe with a scan across it — looking for the right screen
//   speaking   an undulating sash           — composing an answer
//   error      the idle ring                — an error rests; it does not perform
//
// Only `thinking-orbs/engine` is imported: pure geometry, no React, no DOM, ~19KB of it.
// It hands back finished dots (position, radius, depth); the painting is ours, because
// the library's own painter fades far dots to black, which on a glowing body reads as
// dirt. Here depth is alpha and a lift toward the page's ink instead, so the sphere
// sits in the liquid rather than on it.
//
// A change of state crossfades over about half a second. Under reduced motion nobody
// calls `step`, so the sphere is one still frame — the moment the library itself picks.

import { MODE_FRAMES, resolvePreset, type OrbState } from 'thinking-orbs/engine';

import type { LiquidState, Rgb } from './liquid.ts';

export const MIND_FOR: Readonly<Record<LiquidState, OrbState>> = {
  idle: 'breathing',
  listening: 'listening',
  thinking: 'searching',
  speaking: 'composing',
  error: 'breathing',
};

/** Every motion is authored in this square, at the size the library tunes its presets for. */
const FRAME = 64;
const MIDDLE = FRAME / 2;
/** The sphere's furthest dot centre from the middle of the frame, across all nine motions. */
const HALF = 27;
/** Per second: a crossfade is 90% done in half a second. */
const FADE = 4.6;
/** Seconds into the motion for the still frame — the library's own choice for reduced motion. */
const STILL = 0.6;
/** The microphone speeds the motion up by this much at full level, and swells the sphere by SWELL. */
const QUICKEN = 0.9;
const SWELL = 0.07;

const clamp01 = (v: number): number => Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0));

interface Layer {
  readonly orb: OrbState;
  weight: number;
}

export interface Mind {
  setState(state: LiquidState): void;
  /** Move `dt` seconds on. `level` (0..1, the microphone or the voice) quickens it. */
  step(dt: number, level: number): void;
  /** Draw the sphere centred on (`cx`, `cy`), `radius` to its furthest dot, in `ink`. */
  paint(ctx: CanvasRenderingContext2D, cx: number, cy: number, radius: number, ink: Rgb, light: boolean, level: number): void;
  /** Finish any crossfade at once, without moving the motion on — for a page that asked for none. */
  settle(): void;
  /** The motions currently drawn, oldest first — more than one while a change of state fades. */
  showing(): readonly OrbState[];
}

/** `from` moved `k` of the way to `to`, as a colour. */
function tone(from: Rgb, to: Rgb, k: number, alpha: number): string {
  const c = (i: 0 | 1 | 2): number => Math.round(from[i] + (to[i] - from[i]) * k);
  return `rgba(${c(0)},${c(1)},${c(2)},${Math.min(1, Math.max(0, alpha)).toFixed(3)})`;
}

const WHITE: Rgb = [255, 255, 255];
const BLACK: Rgb = [0, 0, 0];

export function createMind(): Mind {
  const layers: Layer[] = [{ orb: MIND_FOR.idle, weight: 1 }];
  let time = STILL;

  return {
    setState(state) {
      const orb = MIND_FOR[state];
      if (layers[layers.length - 1]!.orb === orb) return;
      // A motion asked for again while it is still fading out comes back from where it was.
      const at = layers.findIndex((layer) => layer.orb === orb);
      layers.push(at >= 0 ? layers.splice(at, 1)[0]! : { orb, weight: 0 });
    },

    step(dt, level) {
      if (!(dt > 0)) return;
      time += dt * (1 + QUICKEN * clamp01(level));
      const k = 1 - Math.exp(-dt * FADE);
      const last = layers.length - 1;
      layers.forEach((layer, i) => {
        layer.weight += ((i === last ? 1 : 0) - layer.weight) * k;
      });
      for (let i = last - 1; i >= 0; i--) if (layers[i]!.weight < 0.01) layers.splice(i, 1);
    },

    paint(ctx, cx, cy, radius, ink, light, level) {
      const k = (radius / HALF) * (1 + SWELL * clamp01(level));
      const toward = light ? BLACK : WHITE;
      for (const layer of layers) {
        if (layer.weight < 0.02) continue;
        const { mode, speed, opts } = resolvePreset(layer.orb, FRAME);
        const frame = MODE_FRAMES[mode](FRAME, time * speed, opts);
        // `white` is the ink of the library's paper theme: 0 is nearest and darkest. Near
        // is what we want strongest, on a light page and a dark one alike.
        const strength = (white: number, a: number | undefined): [number, number] => {
          const near = 1 - clamp01(white);
          return [near, (a ?? 1) * layer.weight * (0.25 + 0.75 * near)];
        };

        for (const line of frame.lines) {
          const [near, alpha] = strength(line.white, line.a);
          ctx.strokeStyle = tone(ink, toward, (light ? 0.15 : 0.2) + 0.5 * near, alpha);
          ctx.lineWidth = line.w * k;
          ctx.beginPath();
          ctx.moveTo(cx + (line.x1 - MIDDLE) * k, cy + (line.y1 - MIDDLE) * k);
          ctx.lineTo(cx + (line.x2 - MIDDLE) * k, cy + (line.y2 - MIDDLE) * k);
          ctx.stroke();
        }
        for (const dot of frame.dots) {
          const [near, alpha] = strength(dot.white, dot.a);
          ctx.fillStyle = tone(ink, toward, (light ? 0.15 : 0.2) + 0.5 * near, alpha);
          ctx.beginPath();
          ctx.arc(cx + (dot.x - MIDDLE) * k, cy + (dot.y - MIDDLE) * k, dot.r * k, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    },

    settle() {
      layers.splice(0, layers.length - 1);
      layers[0]!.weight = 1;
    },

    showing() {
      return layers.map((layer) => layer.orb);
    },
  };
}
