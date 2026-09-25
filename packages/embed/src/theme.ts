// The adopter's look, read from their page.
//
// The assistant screen sits over someone else's application, so it should look
// like part of it: their background, their text colour, their typeface, their
// brand colour, the shape of their buttons and fields. Nothing here is configured
// — it is read from what the page already renders, in this order:
//
//   1. `--nextgen-accent`, if the adopter declared it.
//   2. Well-known design-system variables (`--primary`, `--bs-primary`, …),
//      including shadcn/ui's bare HSL triplets.
//   3. The rendered page: the background of body/html/the app root, the colour of
//      the current navigation item, a primary button, a link; a real button's
//      corner radius, a real field's background and border.
//   4. The Graphite HUD default — which is also what a page with no stylesheet at
//      all gets, because there is no adopter look to follow.
//
// Colours are read as computed values, so `oklch()` (Tailwind v4), `hsl()` and
// `color(srgb …)` are understood. Readability is enforced, not assumed: secondary
// text is pushed until it reaches 4.5:1 on the adopter's background, and an accent
// too faint to see is not used.

export type Rgba = readonly [number, number, number, number];

export interface Theme {
  /** `false` when the page has no look of its own and the default is used. */
  readonly adopted: boolean;
  readonly scheme: 'light' | 'dark';
  readonly background: Rgba;
  readonly surface: Rgba;
  readonly raised: Rgba;
  readonly field: Rgba;
  readonly text: Rgba;
  readonly muted: Rgba;
  readonly border: Rgba;
  readonly accent: Rgba;
  /** The accent as text on its own soft tint — the current item in a menu. */
  readonly accentText: Rgba;
  readonly onAccent: Rgba;
  readonly font: string | null;
  readonly radius: string | null;
  readonly fieldRadius: string | null;
}

/** What `readTheme` needs from a page. `pageThemeSource` builds it from the real one. */
export interface ThemeSource {
  readonly hasStyles: boolean;
  readonly root: Element;
  readonly body: Element | null;
  variable(name: string): string;
  style(element: Element, property: string): string;
  /** The first rendered element matching `selector`, outside the assistant's own layer. */
  first(selector: string): Element | null;
}

const WHITE: Rgba = [255, 255, 255, 1];
const INK: Rgba = [17, 20, 24, 1];
const BLACK: Rgba = [0, 0, 0, 1];

export const GRAPHITE: Theme = {
  adopted: false,
  scheme: 'dark',
  background: [8, 9, 12, 1],
  surface: [23, 27, 33, 1],
  raised: [23, 27, 33, 1],
  field: [26, 30, 36, 1],
  text: [230, 233, 238, 1],
  // #848D99: AA on the raised surface with room to spare. #7A838F measured 4.50:1 on #171B21 — AA only
  // to the second decimal, and below it on any step lighter (Pilot-A field report, 2026-09-23).
  muted: [132, 141, 153, 1],
  border: [255, 255, 255, 0.09],
  accent: [121, 192, 206, 1],
  accentText: [121, 192, 206, 1],
  onAccent: [7, 23, 27, 1],
  font: null,
  radius: null,
  fieldRadius: null,
};

/** tokens.css --accent in its light theme: the default accent on a light page. */
const LIGHT_ACCENT: Rgba = [31, 110, 126, 1];

const PRIMARY_VARIABLES = [
  '--primary',
  '--color-primary',
  '--bs-primary',
  '--mdc-theme-primary',
  '--mantine-primary-color-filled',
  '--ion-color-primary',
  '--brand',
  '--color-brand',
  '--accent',
  '--color-accent',
];
const FIELD_SELECTOR =
  'input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="range"]), textarea, select';
const BUTTON_SELECTOR = 'button:not([disabled]), [role="button"], input[type="submit"], .btn, .button';

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

// ---------------------------------------------------------------- colour --

function alphaOf(part: string): number {
  const v = part.trim();
  return clamp(v.endsWith('%') ? parseFloat(v) / 100 : parseFloat(v), 0, 1);
}

function channel(v: string): number {
  return v.endsWith('%') ? (parseFloat(v) / 100) * 255 : parseFloat(v);
}

function hslToRgb(h: number, s: number, l: number, a: number): Rgba {
  if (s === 0) return [l * 255, l * 255, l * 255, a];
  const hue = (((h % 360) + 360) % 360) / 360;
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (x: number): number => {
    const t = x < 0 ? x + 1 : x > 1 ? x - 1 : x;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [f(hue + 1 / 3) * 255, f(hue) * 255, f(hue - 1 / 3) * 255, a];
}

function oklabToRgb(L: number, A: number, B: number, alpha: number): Rgba {
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  const gamma = (x: number): number =>
    255 * clamp(x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055, 0, 1);
  return [
    gamma(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    gamma(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    gamma(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
    alpha,
  ];
}

/**
 * A CSS colour as computed styles and design-system variables express it.
 * `null` for anything it cannot be sure of — never a guess.
 */
export function parseCssColor(input: string | null | undefined): Rgba | null {
  const s = (input ?? '').trim().toLowerCase();
  if (!s) return null;
  if (s === 'transparent') return [0, 0, 0, 0];

  const hex = /^#([0-9a-f]{3,8})$/.exec(s)?.[1];
  if (hex) {
    if (hex.length === 3 || hex.length === 4) {
      const [r, g, b, a = 'f'] = hex.split('') as [string, string, string, string?];
      return [parseInt(r + r, 16), parseInt(g + g, 16), parseInt(b + b, 16), parseInt(a + a, 16) / 255];
    }
    if (hex.length === 6 || hex.length === 8) {
      const at = (i: number): number => parseInt(hex.slice(i, i + 2), 16);
      return [at(0), at(2), at(4), hex.length === 8 ? at(6) / 255 : 1];
    }
    return null;
  }

  const fn = /^([a-z-]+)\((.*)\)$/.exec(s);
  const name = fn?.[1];
  const [body = '', alphaPart] = (fn?.[2] ?? s).split('/');
  const parts = body.split(/[\s,]+/).filter(Boolean);
  const num = (i: number): number => parseFloat(parts[i] ?? 'NaN');
  const legacyAlpha = (i: number): number =>
    alphaPart !== undefined ? alphaOf(alphaPart) : parts[i] !== undefined ? alphaOf(parts[i]!) : 1;
  const lightness = (): number => (parts[0]?.endsWith('%') ? num(0) / 100 : num(0));

  let out: Rgba | null = null;
  if (name === 'rgb' || name === 'rgba') {
    out = [channel(parts[0] ?? 'NaN'), channel(parts[1] ?? 'NaN'), channel(parts[2] ?? 'NaN'), legacyAlpha(3)];
  } else if (name === 'hsl' || name === 'hsla' || (!name && parts.length === 3 && parts[1]!.endsWith('%') && parts[2]!.endsWith('%'))) {
    out = hslToRgb(num(0), num(1) / 100, num(2) / 100, legacyAlpha(3));
  } else if (name === 'oklch') {
    const h = (num(2) * Math.PI) / 180;
    out = oklabToRgb(lightness(), num(1) * Math.cos(h), num(1) * Math.sin(h), legacyAlpha(3));
  } else if (name === 'oklab') {
    out = oklabToRgb(lightness(), num(1), num(2), legacyAlpha(3));
  } else if (name === 'color' && parts[0] === 'srgb') {
    out = [num(1) * 255, num(2) * 255, num(3) * 255, alphaPart !== undefined ? alphaOf(alphaPart) : 1];
  }
  if (!out || out.some((v) => !Number.isFinite(v))) return null;
  return [
    clamp(Math.round(out[0]), 0, 255),
    clamp(Math.round(out[1]), 0, 255),
    clamp(Math.round(out[2]), 0, 255),
    clamp(out[3], 0, 1),
  ];
}

/** WCAG relative luminance. */
export function luminance([r, g, b]: Rgba): number {
  const lin = (v: number): number => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG contrast ratio, 1 to 21. */
export function contrast(a: Rgba, b: Rgba): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

export function mix(a: Rgba, b: Rgba, k: number): Rgba {
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k, a[3] + (b[3] - a[3]) * k];
}

export function css(c: Rgba): string {
  return `rgb(${Math.round(c[0])} ${Math.round(c[1])} ${Math.round(c[2])} / ${Number(c[3].toFixed(3))})`;
}

const withAlpha = (c: Rgba, a: number): Rgba => [c[0], c[1], c[2], a];
const opaque = (c: Rgba): Rgba => withAlpha(c, 1);
/** A translucent colour as it actually shows over `background`. */
const over = (c: Rgba, background: Rgba): Rgba => (c[3] >= 1 ? c : opaque(mix(opaque(background), opaque(c), c[3])));

function saturation([r, g, b]: Rgba): number {
  const max = Math.max(r, g, b) / 255;
  const min = Math.min(r, g, b) / 255;
  if (max === min) return 0;
  const l = (max + min) / 2;
  return l > 0.5 ? (max - min) / (2 - max - min) : (max - min) / (max + min);
}

/** Move `color` toward `toward` until it reads at `ratio` against `background`. */
function readable(color: Rgba, background: Rgba, ratio: number, toward: Rgba): Rgba {
  let c = color;
  for (let k = 0.1; contrast(c, background) < ratio && k < 1.05; k += 0.1) c = mix(color, toward, Math.min(1, k));
  return c;
}

const onColor = (c: Rgba): Rgba => (contrast(WHITE, c) >= contrast(INK, c) ? WHITE : INK);

// ----------------------------------------------------------------- read --

function backgroundOf(source: ThemeSource): Rgba {
  for (const el of [source.body, source.root, source.first('#root, #__next, #app, main')]) {
    if (!el) continue;
    const c = parseCssColor(source.style(el, 'background-color'));
    if (c && c[3] > 0.5) return opaque(c);
  }
  return WHITE; // what a browser paints behind a page that sets no background
}

function pickAccent(source: ThemeSource, background: Rgba): Rgba | null {
  const usable = (c: Rgba, minSaturation: number): boolean => saturation(c) >= minSaturation && contrast(c, background) >= 2;
  for (const name of PRIMARY_VARIABLES) {
    const c = parseCssColor(source.variable(name));
    if (!c || c[3] <= 0.5) continue;
    const shown = over(c, background);
    // `--accent` and `--brand` mean different things in different systems (in shadcn/ui,
    // `--accent` is a hover grey), so those must at least look like a colour.
    if (usable(shown, /accent|brand/.test(name) ? 0.25 : 0)) return shown;
  }
  const samples: [string, string[]][] = [
    ['[aria-current="page"], [aria-current="true"]', ['color', 'background-color', 'border-bottom-color', 'border-left-color']],
    ['button[type="submit"], .btn-primary, .button-primary, [class*="primary"]', ['background-color', 'color']],
    ['a[href]', ['color']],
  ];
  for (const [selector, properties] of samples) {
    const el = source.first(selector);
    if (!el) continue;
    for (const property of properties) {
      const c = parseCssColor(source.style(el, property));
      if (c && c[3] > 0.5 && usable(over(c, background), 0.25)) return over(c, background);
    }
  }
  return null;
}

function radiusOf(value: string): string | null {
  const v = value.trim();
  const n = parseFloat(v);
  if (!Number.isFinite(n)) return null;
  if (v.endsWith('%')) return n >= 50 ? '999px' : null;
  return `${Math.max(0, Math.round(n))}px`;
}

export function readTheme(source: ThemeSource): Theme {
  const declared = parseCssColor(source.variable('--nextgen-accent'));
  if (!source.hasStyles) {
    if (!declared || declared[3] <= 0) return GRAPHITE;
    const accent = over(declared, GRAPHITE.background);
    return { ...GRAPHITE, accent, accentText: readable(accent, GRAPHITE.raised, 4.5, WHITE), onAccent: onColor(accent) };
  }

  const bodyEl = source.body ?? source.root;
  const background = backgroundOf(source);
  const scheme = contrast(WHITE, background) > contrast(INK, background) ? 'dark' : 'light';
  const extreme = scheme === 'dark' ? WHITE : INK;
  const text = readable(
    over(parseCssColor(source.style(bodyEl, 'color')) ?? extreme, background),
    background,
    4.5,
    extreme,
  );

  const declaredAccent = declared && declared[3] > 0 ? over(declared, background) : null;
  const accent = readable(
    declaredAccent ?? pickAccent(source, background) ?? (scheme === 'dark' ? GRAPHITE.accent : LIGHT_ACCENT),
    background,
    3,
    extreme,
  );

  const surface = mix(background, text, scheme === 'dark' ? 0.07 : 0.04);
  const raised = scheme === 'dark' ? mix(background, text, 0.1) : mix(background, WHITE, 0.7);
  const softTint = over(withAlpha(accent, scheme === 'dark' ? 0.18 : 0.12), raised);

  const fieldEl = source.first(FIELD_SELECTOR);
  const buttonEl = source.first(BUTTON_SELECTOR);
  const fieldBackground = fieldEl ? parseCssColor(source.style(fieldEl, 'background-color')) : null;
  const fieldBorder =
    fieldEl && parseFloat(source.style(fieldEl, 'border-top-width')) > 0
      ? parseCssColor(source.style(fieldEl, 'border-top-color'))
      : null;
  const radius = buttonEl ? radiusOf(source.style(buttonEl, 'border-top-left-radius')) : null;

  return {
    adopted: true,
    scheme,
    background,
    surface,
    raised,
    field: fieldBackground && fieldBackground[3] > 0.5 ? over(fieldBackground, background) : surface,
    text,
    muted: readable(mix(text, background, 0.42), background, 4.5, text),
    border: fieldBorder && fieldBorder[3] > 0 ? fieldBorder : mix(background, text, scheme === 'dark' ? 0.18 : 0.16),
    accent,
    accentText: readable(accent, softTint, 4.5, extreme),
    onAccent: onColor(accent),
    font: source.style(bodyEl, 'font-family') || null,
    radius,
    fieldRadius: (fieldEl ? radiusOf(source.style(fieldEl, 'border-top-left-radius')) : null) ?? radius,
  };
}

/** The theme as the custom properties the assistant's stylesheet reads. */
export function themeVariables(theme: Theme): Record<string, string> {
  const dark = theme.scheme === 'dark';
  const vars: Record<string, string> = {
    '--ng-scheme': theme.scheme,
    // Opaque: only where the browser cannot blur, or the visitor asked for no transparency.
    '--ng-backdrop': css(theme.background),
    // Behind the full-screen conversation: the page's own background, lifted a shade toward its text on a
    // dark page, and translucent — the app stays there underneath, blurred, rather than going black.
    '--ng-veil': css(withAlpha(dark ? mix(theme.background, theme.text, 0.08) : theme.background, dark ? 0.7 : 0.6)),
    // The corner panel: the page's raised surface as glass, mostly there so text on it stays legible.
    '--ng-panel': css(withAlpha(dark ? mix(theme.raised, theme.text, 0.02) : theme.raised, 0.98)),
    '--ng-text': css(theme.text),
    '--ng-muted': css(theme.muted),
    '--ng-surface': css(theme.surface),
    '--ng-raised': css(theme.raised),
    '--ng-field': css(theme.field),
    '--ng-border': css(theme.border),
    '--ng-hover': css(withAlpha(theme.text, 0.06)),
    '--ng-hover-strong': css(mix(theme.surface, theme.text, 0.06)),
    '--ng-accent': css(theme.accent),
    '--ng-accent-soft': css(withAlpha(theme.accent, dark ? 0.18 : 0.12)),
    '--ng-accent-line': css(withAlpha(theme.accent, dark ? 0.34 : 0.3)),
    '--ng-accent-text': css(theme.accentText),
    '--ng-on-accent': css(theme.onAccent),
    '--ng-shadow': dark ? 'rgb(0 0 0 / 0.6)' : 'rgb(15 23 42 / 0.16)',
    '--ng-scrim': dark ? 'rgb(0 0 0 / 0.5)' : 'rgb(15 23 42 / 0.28)',
    // The surface is flat (ADR-035): the page's own raised colour, a hairline border, its accent — no
    // lit edge, no metal, no glow. The names are kept so an older stylesheet rule still resolves; each is
    // now plain. Surfaces are all but opaque, so the page beneath is never mistaken for part of them.
    '--ng-glass': css(withAlpha(theme.raised, dark ? 0.97 : 0.98)),
    '--ng-glass-strong': css(theme.raised),
    '--ng-edge-hi': 'transparent',
    '--ng-edge-lo': 'transparent',
    '--ng-inner': 'transparent',
    '--ng-metal-hi': css(theme.accent),
    '--ng-metal-lo': css(theme.accent),
    '--ng-glow': 'transparent',
    '--ng-aurora-1': 'transparent',
    '--ng-aurora-2': 'transparent',
  };
  if (theme.font) vars['--ng-font'] = theme.font;
  if (theme.radius) vars['--ng-radius'] = theme.radius;
  if (theme.fieldRadius) vars['--ng-field-radius'] = theme.fieldRadius;
  return vars;
}

/** Read a real page: computed styles, rendered elements only, never the assistant's own layer. */
export function pageThemeSource(doc: Document, view: Window | null, exclude: Element | null): ThemeSource {
  const computed = (el: Element): CSSStyleDeclaration | null => {
    try {
      return view?.getComputedStyle?.(el) ?? null;
    } catch {
      return null;
    }
  };
  const rendered = (el: Element): boolean => typeof el.getClientRects !== 'function' || el.getClientRects().length > 0;
  let inlineStyles = false;
  try {
    inlineStyles = typeof doc.querySelector === 'function' && doc.querySelector('[style]:not([data-nextgen-assistant])') !== null;
  } catch {
    inlineStyles = false;
  }
  return {
    hasStyles: (doc.styleSheets?.length ?? 0) > 0 || inlineStyles,
    root: doc.documentElement,
    body: doc.body ?? null,
    variable: (name) => computed(doc.documentElement)?.getPropertyValue(name).trim() ?? '',
    style: (el, property) => computed(el)?.getPropertyValue(property).trim() ?? '',
    first: (selector) => {
      try {
        for (const el of Array.from(doc.querySelectorAll(selector))) {
          if (exclude?.contains(el) || !rendered(el)) continue;
          return el;
        }
      } catch {
        // a selector this browser cannot parse
      }
      return null;
    },
  };
}
