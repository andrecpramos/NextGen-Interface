// The liquid: the assistant's body, drawn on a canvas.
//
// Four translucent masses of one liquid, each a closed curve whose radius is a
// sum of slow sine waves around the circle, drifting a little off the centre so
// the body sloshes rather than spins. No library, no shader, no image — a script
// tag has to carry all of it.
//
// The states borrow the sphere's grammar (packages/ui/src/Sphere.tsx), so the
// two surfaces mean the same thing by the same motion:
//   idle       slow breathing
//   listening  ripples driven by the live microphone level
//   thinking   one droplet in orbit — nothing else orbits
//   speaking   pulses driven by the voice (or an acted-out envelope)
//   error      contracts, tints toward danger, nearly still
//
// Its colours come from the adopter's page (theme.ts): on a dark page the masses
// brighten where they overlap; on a light one they are drawn as denser ink, so
// the liquid never washes out against a white background.
//
// Motion is never the only signal: the screen always writes the state in text.
// Under prefers-reduced-motion the loop never starts; each state change draws
// one still frame.

export type LiquidState = 'idle' | 'listening' | 'thinking' | 'speaking' | 'error';

export interface Params {
  readonly amp: number;
  readonly speed: number;
  readonly ripple: number;
  readonly scale: number;
  readonly spin: number;
  readonly orbit: number;
  readonly danger: number;
}

export const STATE_PARAMS: Readonly<Record<LiquidState, Params>> = {
  idle:      { amp: 0.13, speed: 0.55, ripple: 0,   scale: 1,    spin: 0.14, orbit: 0, danger: 0 },
  listening: { amp: 0.15, speed: 1,    ripple: 1,   scale: 1.05, spin: 0.22, orbit: 0, danger: 0 },
  thinking:  { amp: 0.09, speed: 1.6,  ripple: 0,   scale: 0.9,  spin: 0.9,  orbit: 1, danger: 0 },
  speaking:  { amp: 0.17, speed: 1.2,  ripple: 0.4, scale: 1.03, spin: 0.28, orbit: 0, danger: 0 },
  error:     { amp: 0.05, speed: 0.2,  ripple: 0,   scale: 0.86, spin: 0,    orbit: 0, danger: 1 },
};

const TAU = Math.PI * 2;
const POINTS = 72;

export type Rgb = readonly [number, number, number];

const DEFAULT_RGB: Rgb = [121, 192, 206]; // tokens.css --accent (dark)
const DANGER_RGB: Rgb = [216, 124, 107]; //  tokens.css --danger (dark)
const BEAD_DARK: Rgb = [11, 13, 16];
const BEAD_LIGHT: Rgb = [255, 255, 255];

const clamp01 = (v: number): number => Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0));

/**
 * The radius multiplier at angle `theta`, time `t` (seconds), for one layer.
 * Pure. Every term is a whole number of waves around the circle, so the curve
 * always closes; the weights keep it between roughly 0.5 and 1.6.
 */
export function radiusAt(theta: number, t: number, layer: number, p: Params, level: number): number {
  const ph = layer * 1.7;
  const wobble =
    0.55 * Math.sin(2 * theta + t * p.speed * 1.3 + ph) +
    0.3 * Math.sin(3 * theta - t * p.speed * 0.9 + ph * 1.3) +
    0.15 * Math.sin(5 * theta + t * p.speed * 1.7 + ph * 0.7);
  const ripple = p.ripple * level * Math.sin(9 * theta - t * 7 + ph);
  return p.scale * (1 + p.amp * (1 + level) * wobble + ripple * 0.06) * (1 + level * 0.1);
}

export function mixParams(from: Params, to: Params, k: number): Params {
  const m = (a: number, b: number): number => a + (b - a) * k;
  return {
    amp: m(from.amp, to.amp),
    speed: m(from.speed, to.speed),
    ripple: m(from.ripple, to.ripple),
    scale: m(from.scale, to.scale),
    spin: m(from.spin, to.spin),
    orbit: m(from.orbit, to.orbit),
    danger: m(from.danger, to.danger),
  };
}

/** `#rgb`, `#rrggbb`, `rgb()`/`rgba()`. Anything else is `null`, and the caller keeps its default. */
export function parseColor(input: string | null | undefined): Rgb | null {
  const s = (input ?? '').trim().toLowerCase();
  let m = /^#([0-9a-f]{3})$/.exec(s);
  if (m) return [0, 1, 2].map((i) => parseInt(m![1]![i]!.repeat(2), 16)) as unknown as Rgb;
  m = /^#([0-9a-f]{6})$/.exec(s);
  if (m) return [0, 2, 4].map((i) => parseInt(m![1]!.slice(i, i + 2), 16)) as unknown as Rgb;
  m = /^rgba?\(\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})/.exec(s);
  if (m) {
    const rgb = [m[1], m[2], m[3]].map(Number);
    return rgb.every((v) => v <= 255) ? (rgb as unknown as Rgb) : null;
  }
  return null;
}

const mixRgb = (a: Rgb, b: Rgb, k: number): Rgb =>
  [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k] as const;
const rgba = (c: Rgb, a: number): string =>
  `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${Math.max(0, Math.min(1, a)).toFixed(3)})`;

/** The same colour turned `degrees` around the hue wheel — depth in the liquid from one accent. */
export function shiftHue(color: Rgb, degrees: number): Rgb {
  const [r, g, b] = [color[0] / 255, color[1] / 255, color[2] / 255];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return color;
  const l = (max + min) / 2;
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const sector = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  const h = ((((sector * 60 + degrees) % 360) + 360) % 360) / 360;
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const channel = (x: number): number => {
    const t = x < 0 ? x + 1 : x > 1 ? x - 1 : x;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [channel(h + 1 / 3) * 255, channel(h) * 255, channel(h - 1 / 3) * 255];
}

export interface LiquidPalette {
  readonly accent: string | null;
  readonly scheme: 'dark' | 'light';
  /** The bead behind the liquid when it sits, small, on the page. */
  readonly bead: string | null;
}

export interface LiquidOptions {
  /** CSS pixels. The canvas backing store is this times the device pixel ratio (capped at 2). */
  readonly size: number;
  /** The colours to draw in — read again on `refresh()`, so the orb follows the adopter's page. */
  readonly palette: () => LiquidPalette;
  readonly reducedMotion: boolean;
  readonly view: Window | null;
}

export interface Liquid {
  setState(state: LiquidState): void;
  /** 0..1 — microphone or voice level. Rises fast, falls slowly. */
  setLevel(level: number): void;
  /** 0..1 — the bead behind the liquid, for when it sits on someone else's page. */
  setBacking(amount: number): void;
  refresh(): void;
  destroy(): void;
}

export function createLiquid(canvas: HTMLCanvasElement, options: LiquidOptions): Liquid {
  const { size, view, reducedMotion } = options;
  const ctx = typeof canvas.getContext === 'function' ? canvas.getContext('2d') : null;

  let target: Params = STATE_PARAMS.idle;
  let current: Params = target;
  let targetLevel = 0;
  let level = 0;
  let targetBacking = 1;
  let backing = 1;
  let rgb: Rgb = DEFAULT_RGB;
  let bead: Rgb = BEAD_DARK;
  let light = false;
  let t = 0;
  let last = 0;
  let raf = 0;
  let skip = false;
  let destroyed = false;

  const xs = new Float64Array(POINTS);
  const ys = new Float64Array(POINTS);

  if (ctx) {
    const dpr = Math.min(2, view?.devicePixelRatio || 1);
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function readPalette(): void {
    const palette = options.palette();
    light = palette.scheme === 'light';
    rgb = parseColor(palette.accent) ?? DEFAULT_RGB;
    bead = parseColor(palette.bead) ?? (light ? BEAD_LIGHT : BEAD_DARK);
  }

  function blob(c: CanvasRenderingContext2D, cx: number, cy: number, r: number, rot: number, layer: number, lv: number): void {
    for (let i = 0; i < POINTS; i++) {
      const theta = (i / POINTS) * TAU;
      const rr = r * radiusAt(theta + rot, t, layer, current, lv);
      xs[i] = cx + Math.cos(theta) * rr;
      ys[i] = cy + Math.sin(theta) * rr;
    }
    c.beginPath();
    c.moveTo((xs[0]! + xs[1]!) / 2, (ys[0]! + ys[1]!) / 2);
    for (let i = 1; i <= POINTS; i++) {
      const a = i % POINTS;
      const b = (i + 1) % POINTS;
      c.quadraticCurveTo(xs[a]!, ys[a]!, (xs[a]! + xs[b]!) / 2, (ys[a]! + ys[b]!) / 2);
    }
    c.closePath();
  }

  function circle(c: CanvasRenderingContext2D, x: number, y: number, r: number, fill: CanvasGradient): void {
    c.fillStyle = fill;
    c.beginPath();
    c.arc(x, y, r, 0, TAU);
    c.fill();
  }

  function draw(): void {
    if (!ctx) return;
    const c = size / 2;
    const R = size * 0.25;
    const lv = reducedMotion ? 0 : level;
    const accent = mixRgb(rgb, DANGER_RGB, current.danger);
    const cool = shiftHue(accent, -30);
    const warm = shiftHue(accent, 24);
    const deep = light ? mixRgb(accent, [0, 0, 0], 0.25) : mixRgb(accent, [6, 10, 14], 0.6);
    const bright = mixRgb(accent, [255, 255, 255], light ? 0.7 : 0.55);

    ctx.clearRect(0, 0, size, size);
    ctx.globalCompositeOperation = 'source-over';

    const aura = ctx.createRadialGradient(c, c, R * 0.6, c, c, R * 1.95);
    aura.addColorStop(0, rgba(accent, (light ? 0.1 : 0.12) + (light ? 0.16 : 0.2) * lv));
    aura.addColorStop(1, rgba(accent, 0));
    circle(ctx, c, c, R * 1.95, aura);

    // A bead behind the light, in the page's own raised colour, so the orb reads
    // on whatever it is docked over.
    if (backing > 0.01) {
      if (light) {
        const shade = ctx.createRadialGradient(c, c, R * 1.2, c, c, R * 1.6);
        shade.addColorStop(0, `rgba(15,23,42,${(0.14 * backing).toFixed(3)})`);
        shade.addColorStop(1, 'rgba(15,23,42,0)');
        circle(ctx, c, c, R * 1.6, shade);
      }
      const disc = ctx.createRadialGradient(c, c, R * 0.9, c, c, R * 1.42);
      disc.addColorStop(0, rgba(bead, 0.96 * backing));
      disc.addColorStop(0.78, rgba(bead, 0.94 * backing));
      disc.addColorStop(1, rgba(bead, 0));
      circle(ctx, c, c, R * 1.42, disc);
    }

    // Four masses of the same liquid, each drifting a little off the centre and
    // turning its own way. On a dark page `screen` lets them brighten where they
    // overlap; on a light one they are laid down as translucent ink instead.
    ctx.globalCompositeOperation = light ? 'source-over' : 'screen';
    const density = light ? 0.72 : 1;
    const drift = R * (0.1 + 0.08 * lv);
    const layers = [
      { scale: 1.02, spin: 0.5, col: deep, a: 0.95, fx: 0.7, fy: 0.6 },
      { scale: 0.9, spin: -0.7, col: cool, a: 0.7, fx: -0.9, fy: 0.8 },
      { scale: 0.8, spin: 0.9, col: accent, a: 0.62, fx: 1.1, fy: -0.7 },
      { scale: 0.62, spin: -1.2, col: warm, a: 0.5, fx: -0.6, fy: -1 },
    ];
    layers.forEach((layer, i) => {
      const ox = c + Math.sin(t * 0.7 * layer.fx + i * 2.1) * drift;
      const oy = c + Math.cos(t * 0.6 * layer.fy + i * 1.3) * drift;
      const r = R * layer.scale;
      const a = layer.a * density;
      blob(ctx, ox, oy, r, t * current.spin * layer.spin, i, lv);
      const g = ctx.createRadialGradient(ox - r * 0.3, oy - r * 0.35, r * 0.05, ox, oy, r * 1.3);
      g.addColorStop(0, rgba(bright, a * 0.42));
      g.addColorStop(0.45, rgba(layer.col, a * 0.8));
      g.addColorStop(1, rgba(layer.col, 0));
      ctx.fillStyle = g;
      ctx.fill();
    });

    if (current.orbit > 0.02) {
      const angle = t * 2.6;
      const x = c + Math.cos(angle) * R * 1.3;
      const y = c + Math.sin(angle) * R * 1.3;
      const drop = ctx.createRadialGradient(x, y, 0, x, y, R * 0.15);
      drop.addColorStop(0, rgba(light ? deep : bright, 0.95 * current.orbit));
      drop.addColorStop(1, rgba(accent, 0));
      circle(ctx, x, y, R * 0.15, drop);
    }

    // The surface: one thin edge around the outer mass, which is what makes it
    // read as liquid held together rather than as a glow.
    ctx.globalCompositeOperation = 'source-over';
    blob(ctx, c + Math.sin(t * 0.49) * drift * 0.5, c + Math.cos(t * 0.43) * drift * 0.5, R * 1.04, t * current.spin * 0.4, 0, lv);
    ctx.lineWidth = 1;
    ctx.strokeStyle = rgba(light ? deep : bright, (light ? 0.3 : 0.2) + 0.2 * lv);
    ctx.stroke();

    const sx = c - R * 0.32;
    const sy = c - R * 0.4;
    const spec = ctx.createRadialGradient(sx, sy, 0, sx, sy, R * 0.34);
    spec.addColorStop(0, `rgba(255,255,255,${light ? '0.35' : '0.16'})`);
    spec.addColorStop(1, 'rgba(255,255,255,0)');
    circle(ctx, sx, sy, R * 0.34, spec);
  }

  function tick(now: number): void {
    raf = 0;
    if (destroyed) return;
    const dt = last ? Math.min(0.05, (now - last) / 1000) : 1 / 60;
    last = now;
    t += dt;
    const k = 1 - Math.exp(-dt * 5);
    current = mixParams(current, target, k);
    level += (targetLevel - level) * (1 - Math.exp(-dt * (targetLevel > level ? 20 : 6)));
    backing += (targetBacking - backing) * k;
    // Docked and at rest, half the frames are plenty — this runs on someone else's page.
    const resting = target === STATE_PARAMS.idle && targetBacking > 0.5 && level < 0.01;
    skip = resting ? !skip : false;
    if (!skip) draw();
    schedule();
  }

  function schedule(): void {
    if (!ctx || reducedMotion || destroyed || raf || !view?.requestAnimationFrame) return;
    if (view.document?.hidden) return;
    raf = view.requestAnimationFrame(tick);
  }

  const onVisibility = (): void => {
    last = 0;
    schedule();
  };
  view?.document?.addEventListener?.('visibilitychange', onVisibility);

  const still = (): void => {
    if (reducedMotion) {
      current = target;
      backing = targetBacking;
      draw();
    }
  };

  readPalette();
  draw();
  schedule();

  return {
    setState(state) {
      target = STATE_PARAMS[state];
      still();
    },
    setLevel(value) {
      targetLevel = clamp01(value);
    },
    setBacking(amount) {
      targetBacking = clamp01(amount);
      still();
    },
    refresh() {
      readPalette();
      draw();
    },
    destroy() {
      destroyed = true;
      if (raf) view?.cancelAnimationFrame?.(raf);
      raf = 0;
      view?.document?.removeEventListener?.('visibilitychange', onVisibility);
    },
  };
}
