// The assistant layer — what `start()` puts on an adopter's page.
//
// On the adopter's landing route it IS the landing page: a full-screen assistant
// with a liquid orb in the middle, a greeting and a composer. Everywhere else the
// original page is left exactly as it was, and the orb waits, small, at the
// emptier edge; tapping it opens the same screen.
//
// It looks like the app it sits on (theme.ts): the page's background, text,
// typeface, brand colour and the shape of its buttons and fields, read from what
// the page renders. Its menu is the app's own navigation (nav.ts), not a second
// one of ours.
//
// When a turn resolves to a destination the screen dissolves, the orb flies back
// to the edge, and the browser moves. On the next page the orb says where the user
// landed — and when the registry declares steps for that screen (WP-27), it walks
// them through it, highlighting each field.
//
// It mounts what this project calls the AI interface, rung A1: navigate, explain,
// guide, and "why" — every answer carries a disclosure rendered from its own turn
// record (Rule 9), never model prose. Voice is hands-free once the visitor turns it
// on, and on the device or absent (voice.ts, Rule 8).
//
// Shadow DOM, as the chat box: the host's stylesheet cannot reach in and this
// cannot leak out. Every destination is a real link (Rule 7). The screen is a modal
// dialog: focus moves in, Tab stays in, Escape closes it and focus returns to the orb.

import type { GuidedStep } from '@nextgen/core-capability';
import type { TurnTrace } from '@nextgen/core-intent/browser';

import { resolveSteps, type AnchorRoot, type ResolvedStep } from './anchor.ts';
import { commandFor, type Command } from './commands.ts';
import { BEAM_CSS, beamVariables, createBeam } from './beam.ts';
import { chooseDockSide, type DockSide } from './dock.ts';
import { createLiquid } from './liquid.ts';
import { adopterNav, type NavLink, type NavRoot } from './nav.ts';
import { fillParams, isSamePlace, present, suggestionsFor, wordsFor, type Choice, type View, type Words } from './present.ts';
import { css, GRAPHITE, pageThemeSource, readTheme, themeVariables, type Theme } from './theme.ts';
import {
  converse,
  installTranscription,
  speak,
  speechLang,
  transcriptionFor,
  voiceEnv,
  type Conversation,
  type Speaking,
  type Transcription,
  type VoiceEnv,
} from './voice.ts';
import { adoptStyles, offerMove, type MountOptions, type Routable } from './widget.ts';

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export interface AssistantOptions extends MountOptions {
  /** Force the edge the orb waits on, or find the emptier one. Default `'auto'`. */
  readonly dockSide?: 'auto' | DockSide;
  /**
   * The routes where the assistant screen is the landing page: open on arrival,
   * and closable to the original page underneath. Default `['/']`; `[]` for none.
   */
  readonly home?: readonly string[];
  /** Where the arrival note survives a full page load. Default `sessionStorage`; `null` keeps nothing. */
  readonly storage?: Store | null;
  /** Where the visitor's own choices live — hands-free listening, answers read aloud. Default `localStorage`. */
  readonly preferences?: Store | null;
  /** Offer voice at all. Default `true`; it only appears where the browser supports it. */
  readonly voice?: boolean;
  /** The browser's voice APIs. A seam for tests; the default reads them from the page. */
  readonly voiceEnv?: VoiceEnv | null;
}

export interface MountedAssistant {
  readonly host: HTMLElement;
  open(): void;
  close(): void;
  /** Ask programmatically; resolves to what was shown. */
  ask(utterance: string): Promise<View | null>;
  destroy(): void;
}

interface Arrival {
  readonly title: string;
  readonly side: DockSide;
  readonly at: number;
  readonly capabilityId: string | null;
}

const STAGE = 320;
/** The canvas is wider than the liquid in it — the glow spills past the slot the layout reserves. */
const STAGE_OVERSCAN = 1.6;
const DOCK = 92;
const EDGE = 20;
const FLIGHT_MS = 780;
const ARRIVAL_KEY = 'nextgen:arrival';
const ARRIVAL_TTL_MS = 15_000;
const HANDS_FREE_KEY = 'nextgen:hands-free';
const READ_ALOUD_KEY = 'nextgen:read-aloud';

// Every colour, typeface and corner below is a `--ng-*` variable set from the
// adopter's page (theme.ts); the fallbacks are the Graphite HUD default.
const CSS = `
:host { all: initial; }
*, *::before, *::after { box-sizing: border-box; }
[hidden] { display: none !important; }
.sr-only {
  position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0;
  overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0;
}

.screen {
  position: fixed; inset: 0; z-index: 2147483000;
  color-scheme: var(--ng-scheme, dark); color: var(--ng-text, #e6e9ee);
  font: 400 15px/1.5 var(--ng-font, ui-sans-serif, -apple-system, "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif);
  -webkit-font-smoothing: antialiased;
  opacity: 0; visibility: hidden;
  transition: opacity 380ms cubic-bezier(.32,.72,0,1), visibility 0s linear 380ms;
}
.screen[data-open="true"] { opacity: 1; visibility: visible; transition-delay: 0s; }
.backdrop {
  position: absolute; inset: 0;
  background: var(--ng-backdrop, rgb(8 9 12));
  -webkit-backdrop-filter: blur(18px) saturate(115%);
  backdrop-filter: blur(18px) saturate(115%);
}
.controls { position: absolute; top: 16px; z-index: 2; display: flex; gap: 4px; }
.controls-start { left: 16px; }
.controls-end { right: 16px; }

.stage {
  position: relative; height: 100%; overflow-y: auto; overscroll-behavior: contain;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 18px; padding: 72px 16px 48px;
}
.stage > :not(.slot) {
  opacity: 0; transform: translateY(16px);
  transition: opacity 420ms cubic-bezier(.22,1,.36,1), transform 620ms cubic-bezier(.22,1,.36,1);
}
.screen[data-open="true"] .stage > :not(.slot) { opacity: 1; transform: none; }
.screen[data-open="true"] .greeting,
.screen[data-open="true"] .answer   { transition-delay: 90ms; }
.screen[data-open="true"] .composer { transition-delay: 160ms; }

.slot { flex: none; width: min(200px, 46vw, 26vh); aspect-ratio: 1; }
.caption {
  margin: -10px 0 0; min-height: 1rem; max-width: 36rem; text-align: center;
  font-size: .6875rem; font-weight: 600; letter-spacing: .14em; text-transform: uppercase; color: var(--ng-muted, #7a838f);
}
.greeting {
  margin: 0; text-align: center;
  font-size: clamp(1.375rem, 1.05rem + 1.1vw, 1.875rem); font-weight: 500; letter-spacing: -.015em;
}
.screen[data-conversation="true"] .greeting { display: none; }

.answer { width: min(640px, 100%); text-align: center; }
.answer:empty { display: none; }
.question { margin: 0 0 8px; font-size: .8125rem; color: var(--ng-muted, #7a838f); }
.title { margin: 0; font-size: 1.25rem; font-weight: 600; letter-spacing: -.01em; }
.body { margin: 6px auto 0; max-width: 52ch; color: var(--ng-muted, #9aa3af); }
.chips { list-style: none; margin: 16px 0 0; padding: 0; display: flex; flex-wrap: wrap; justify-content: center; gap: 8px; }
.chip {
  display: inline-flex; align-items: center; min-height: 48px; padding: 0 20px;
  border-radius: var(--ng-radius, 999px);
  background: var(--ng-surface, #171b21); border: 1px solid var(--ng-border, rgb(255 255 255 / .09));
  color: var(--ng-text, #e6e9ee); text-decoration: none;
  transition: background-color 180ms ease, border-color 180ms ease;
}
.chip:hover { background: var(--ng-hover-strong, #1d222a); border-color: var(--ng-accent, #79c0ce); }

.why { margin: 14px auto 0; max-width: 34rem; text-align: center; color: var(--ng-muted, #9aa3af); font-size: .8125rem; }
.why > :not(summary) { text-align: left; }
.why summary {
  display: inline-flex; align-items: center; min-height: 48px; padding: 0 16px; border-radius: var(--ng-radius, 999px);
  color: var(--ng-muted, #9aa3af); cursor: pointer; list-style: none; transition: background-color 160ms ease, color 160ms ease;
}
.why summary::-webkit-details-marker { display: none; }
.why summary:hover, .why[open] summary { color: var(--ng-text, #e6e9ee); background: var(--ng-hover, rgb(255 255 255 / .045)); }
.why-how { margin: 6px 16px 12px; }
.why-heading { margin: 0 16px 8px; font-size: .6875rem; font-weight: 600; letter-spacing: .12em; text-transform: uppercase; color: var(--ng-muted, #7a838f); }
.why-list { list-style: none; margin: 0; padding: 0 16px; display: grid; gap: 10px; }
.why-list li { display: grid; grid-template-columns: 1fr auto; gap: 4px 12px; align-items: baseline; }
.why-name { color: var(--ng-text, #c9ced6); }
.why-list li[data-chosen="true"] .why-name { font-weight: 600; }
.why-score { font: .75rem/1.4 ui-monospace, "SF Mono", "Cascadia Mono", Consolas, monospace; font-variant-numeric: tabular-nums; }
.why-bar { grid-column: 1 / -1; position: relative; height: 3px; border-radius: 2px; background: var(--ng-border, rgb(255 255 255 / .08)); overflow: hidden; }
.why-bar::after { content: ''; position: absolute; inset: 0 auto 0 0; width: var(--w, 0%); border-radius: inherit; background: var(--ng-accent, #79c0ce); }
.why-removed { margin: 10px 16px 12px; font-size: .75rem; color: var(--ng-muted, #7a838f); }

.composer {
  width: min(720px, 100%); display: flex; align-items: center; gap: 2px; margin: 6px 0 0;
  padding: 4px 4px 4px 22px; border-radius: var(--ng-field-radius, 999px);
  background: var(--ng-field, #1a1e24); border: 1px solid var(--ng-border, rgb(255 255 255 / .08));
  box-shadow: 0 28px 70px -24px var(--ng-shadow, rgb(0 0 0 / .8));
  transition: border-color 200ms ease;
}
.composer:focus-within { border-color: var(--ng-accent, #79c0ce); }
.composer input {
  flex: 1; min-width: 0; min-height: 48px; margin: 0; padding: 0; border: 0; outline: 0;
  background: transparent; color: var(--ng-text, #e6e9ee); font: inherit; font-size: 1rem;
}
.composer input::placeholder { color: var(--ng-muted, #7a838f); }
${BEAM_CSS}
.icon {
  display: inline-grid; place-items: center; flex: none; min-width: 48px; min-height: 48px; margin: 0; padding: 0;
  border: 0; border-radius: var(--ng-radius, 999px); background: transparent; color: var(--ng-muted, #9aa3af);
  font: inherit; cursor: pointer; transition: background-color 160ms ease, color 160ms ease;
}
.icon:hover { background: var(--ng-hover, rgb(255 255 255 / .06)); color: var(--ng-text, #e6e9ee); }
.glyph { position: relative; display: grid; place-items: center; pointer-events: none; }
.glyph svg { display: block; }
.send .glyph,
.mic[aria-pressed="true"] .glyph {
  width: 38px; height: 38px; border-radius: var(--ng-radius, 999px);
  background: var(--ng-accent, #79c0ce); color: var(--ng-on-accent, #07171b);
}
.send:hover, .mic[aria-pressed="true"]:hover { background: transparent; }
.sound[aria-pressed="false"] .glyph::after {
  content: ''; position: absolute; left: 50%; top: 50%; width: 24px; height: 2px; margin: -1px 0 0 -12px;
  border-radius: 1px; background: currentColor; transform: rotate(-45deg);
}

:focus-visible { outline: 2px solid var(--ng-accent, #79c0ce); outline-offset: 2px; }

.scrim {
  position: absolute; inset: 0; z-index: 3; background: var(--ng-scrim, rgb(0 0 0 / .5));
  opacity: 0; visibility: hidden; transition: opacity 260ms ease, visibility 0s linear 260ms;
}
.scrim[data-open="true"] { opacity: 1; visibility: visible; transition-delay: 0s; }
.drawer {
  position: absolute; top: 0; bottom: 0; left: 0; z-index: 4; width: min(320px, 86vw);
  display: flex; flex-direction: column;
  background: var(--ng-raised, #171b21); color: var(--ng-text, #e6e9ee);
  border-right: 1px solid var(--ng-border, rgb(255 255 255 / .1));
  box-shadow: 24px 0 60px -30px var(--ng-shadow, rgb(0 0 0 / .7));
  transform: translateX(-100%); visibility: hidden;
  transition: transform 320ms cubic-bezier(.22,1,.36,1), visibility 0s linear 320ms;
}
.drawer[data-open="true"] { transform: none; visibility: visible; transition-delay: 0s; }
.drawer-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 12px 8px 4px 20px; }
.drawer-title { margin: 0; font-size: .6875rem; font-weight: 600; letter-spacing: .12em; text-transform: uppercase; color: var(--ng-muted, #7a838f); }
.drawer-list { list-style: none; margin: 0; padding: 4px 8px 16px; display: grid; gap: 2px; overflow-y: auto; }
.drawer-link {
  display: flex; align-items: center; min-height: 48px; padding: 0 12px; border-radius: var(--ng-radius, 10px);
  color: var(--ng-text, #e6e9ee); text-decoration: none; transition: background-color 160ms ease;
}
.drawer-link:hover { background: var(--ng-hover, rgb(255 255 255 / .06)); }
.drawer-link[aria-current="page"] {
  background: var(--ng-accent-soft, rgb(121 192 206 / .16)); color: var(--ng-accent-text, #79c0ce); font-weight: 600;
}

.orb {
  position: fixed; left: 0; top: 0; z-index: 2147483001;
  width: 320px; height: 320px; margin: 0; padding: 0; border: 0; border-radius: 50%;
  background: transparent; cursor: pointer; -webkit-tap-highlight-color: transparent;
  transform-origin: 0 0;
  transform: translate3d(var(--x, -400px), var(--y, -400px), 0) scale(var(--s, .2875));
  transition: transform 780ms cubic-bezier(.22,1,.36,1);
}
.orb[data-ready="false"] { transition-duration: 0s; }
.orb:focus-visible { outline: calc(2px / var(--s, 1)) solid var(--ng-accent, #79c0ce); outline-offset: calc(-8px / var(--s, 1)); }
.orb canvas {
  display: block; width: 100%; height: 100%; pointer-events: none;
  animation: nextgen-arrive 900ms cubic-bezier(.22,1,.36,1) both;
}
@keyframes nextgen-arrive { from { opacity: 0; transform: scale(.35); } to { opacity: 1; transform: none; } }

.bubble, .guide {
  position: fixed; z-index: 2147483001; margin: 0;
  background: var(--ng-raised, #171b21); color: var(--ng-text, #e6e9ee); border: 1px solid var(--ng-border, rgb(255 255 255 / .1));
  box-shadow: 0 18px 44px -14px var(--ng-shadow, rgb(0 0 0 / .65));
  font: 500 14px/1.4 var(--ng-font, ui-sans-serif, -apple-system, "Segoe UI", system-ui, sans-serif);
}
.bubble {
  bottom: 46px; max-width: min(300px, calc(100vw - 152px)); padding: 10px 16px; border-radius: 16px;
  opacity: 0; transform: translateY(8px) scale(.97); pointer-events: none;
  transition: opacity 260ms ease, transform 460ms cubic-bezier(.22,1,.36,1);
}
.bubble[data-side="right"] { right: 124px; }
.bubble[data-side="left"]  { left: 124px; }
.bubble[data-show="true"]  { opacity: 1; transform: none; }

.guide { bottom: 124px; width: min(340px, calc(100vw - 40px)); padding: 16px; border-radius: 18px; }
.guide[data-side="right"] { right: 20px; }
.guide[data-side="left"]  { left: 20px; }
.guide-title { margin: 0; font-weight: 600; }
.guide-count { margin: 2px 0 8px; font-size: .6875rem; font-weight: 600; letter-spacing: .12em; text-transform: uppercase; color: var(--ng-muted, #7a838f); }
.guide-text { margin: 0 0 12px; font-weight: 400; }
.guide-actions { display: flex; justify-content: flex-end; gap: 8px; }
.pill {
  min-height: 48px; min-width: 48px; padding: 0 18px; border-radius: var(--ng-radius, 999px);
  border: 1px solid var(--ng-border, rgb(255 255 255 / .12)); background: transparent; color: var(--ng-text, #e6e9ee);
  font: inherit; cursor: pointer; transition: background-color 160ms ease;
}
.pill:hover { background: var(--ng-hover, rgb(255 255 255 / .06)); }
.pill.primary { border-color: transparent; background: var(--ng-accent, #79c0ce); color: var(--ng-on-accent, #07171b); font-weight: 600; }

.ring {
  position: fixed; z-index: 2147482999; pointer-events: none;
  left: var(--rx, 0); top: var(--ry, 0); width: var(--rw, 0); height: var(--rh, 0);
  border: 2px solid var(--ng-accent, #79c0ce); border-radius: 12px;
  box-shadow: 0 0 0 6px rgb(8 9 12 / .16);
  opacity: 0;
  transition: opacity 200ms ease, left 280ms cubic-bezier(.22,1,.36,1), top 280ms cubic-bezier(.22,1,.36,1), width 280ms ease, height 280ms ease;
}
.ring[data-show="true"] { opacity: 1; }

@media (forced-colors: active) {
  .backdrop { background: Canvas; -webkit-backdrop-filter: none; backdrop-filter: none; }
  .composer, .chip, .bubble, .guide, .pill, .drawer { background: Canvas; color: CanvasText; border: 1px solid CanvasText; }
  .send .glyph, .mic[aria-pressed="true"] .glyph, .pill.primary, .why-bar::after { background: Highlight; color: HighlightText; }
  .drawer-link[aria-current="page"] { background: Highlight; color: HighlightText; }
  .orb { border: 1px solid ButtonText; }
  .ring { border-color: Highlight; }
}
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { transition: none !important; animation: none !important; }
}
`;

// Constant markup only. Nothing from a registry, a page or a user ever reaches innerHTML.
const svg = (body: string, size = 20): string =>
  `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" focusable="false">${body}</svg>`;
const ICON_MENU = svg('<path d="M4 7h16M4 12h16M4 17h16"/>');
const ICON_CLOSE = svg('<path d="M6 6l12 12M18 6L6 18"/>');
const ICON_MIC = svg('<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>');
const ICON_SEND = svg('<path d="M12 19V5M6 11l6-6 6 6"/>', 18);
const ICON_SOUND = svg('<path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/>');

function browserStore(view: Window | null, which: 'sessionStorage' | 'localStorage'): Store | null {
  try {
    return view?.[which] ?? null;
  } catch {
    return null; // storage blocked by the browser: nothing is remembered
  }
}

export function mountAssistant(target: Element, assistant: Routable, options: AssistantOptions = {}): MountedAssistant {
  const doc = target.ownerDocument;
  const view = doc.defaultView;
  const pageLang = options.lang ?? doc.documentElement?.getAttribute('lang');
  const words: Words = { ...wordsFor(pageLang), ...options.words };
  const lang = speechLang(pageLang);
  const currentPath = options.currentPath ?? (() => view?.location.pathname ?? '/');
  /**
   * Move the browser: the adopter's router, else the page if it takes `nextgen:navigate`
   * (a strict Content-Security-Policy leaves a script-tag page no other way to pass one),
   * else `location.assign`. True when the move happened without unloading this page.
   */
  const go = (route: string): boolean => {
    if (options.navigate) {
      options.navigate(route);
      return true;
    }
    if (view && offerMove(view, route)) return true;
    view?.location.assign(route);
    return false;
  };
  const storage = options.storage !== undefined ? options.storage : browserStore(view, 'sessionStorage');
  const preferences = options.preferences !== undefined ? options.preferences : browserStore(view, 'localStorage');
  const homes = options.home ?? ['/'];
  const reducedMotion = Boolean(view?.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
  const env = options.voice === false ? null : options.voiceEnv !== undefined ? options.voiceEnv : view ? voiceEnv(view) : null;
  const canListen = Boolean(env?.getUserMedia);
  const canSpeak = Boolean(env?.synth && env.Utterance);

  let destroyed = false;
  const timers = new Set<number>();
  const later = (fn: () => void, ms: number): void => {
    if (!view) return fn();
    const id = view.setTimeout(() => {
      timers.delete(id);
      if (!destroyed) fn();
    }, reducedMotion ? Math.min(ms, 60) : ms);
    timers.add(id);
  };
  const wait = (ms: number): Promise<void> => new Promise((resolve) => later(resolve, ms));

  const readChoice = (key: string, fallback: boolean): boolean => {
    try {
      const value = preferences?.getItem(key);
      return value === 'on' ? true : value === 'off' ? false : fallback;
    } catch {
      return fallback;
    }
  };
  const saveChoice = (key: string, on: boolean): void => {
    try {
      preferences?.setItem(key, on ? 'on' : 'off');
    } catch {
      // storage refused: the choice lasts as long as this page
    }
  };

  const make = <K extends keyof HTMLElementTagNameMap>(tag: K, className = ''): HTMLElementTagNameMap[K] => {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    return node;
  };
  const glyph = (icon: string): HTMLSpanElement => {
    const g = make('span', 'glyph');
    g.setAttribute('aria-hidden', 'true');
    g.innerHTML = icon;
    return g;
  };
  const iconButton = (className: string, name: string, icon: string): HTMLButtonElement => {
    const button = make('button', `icon ${className}`);
    button.type = 'button';
    const text = make('span', 'sr-only');
    text.textContent = name;
    button.append(text, glyph(icon));
    return button;
  };
  const pill = (className: string, text: string): HTMLButtonElement => {
    const button = make('button', `pill ${className}`);
    button.type = 'button';
    button.textContent = text;
    return button;
  };

  // ------------------------------------------------------------------ build --

  const host = make('div');
  host.setAttribute('data-nextgen', '');
  host.setAttribute('data-nextgen-assistant', '');
  const root = host.attachShadow({ mode: 'open' });

  const screen = make('div', 'screen');
  screen.setAttribute('role', 'dialog');
  screen.setAttribute('aria-modal', 'true');
  screen.setAttribute('aria-labelledby', 'nextgen-greeting');
  screen.setAttribute('inert', '');
  screen.dataset.open = 'false';
  const backdrop = make('div', 'backdrop');

  const startControls = make('div', 'controls controls-start');
  const menuButton = iconButton('menu', words.menu, ICON_MENU);
  menuButton.setAttribute('aria-controls', 'nextgen-menu');
  menuButton.setAttribute('aria-expanded', 'false');
  startControls.append(menuButton);
  const endControls = make('div', 'controls controls-end');
  const soundButton = iconButton('sound', words.readAloud, ICON_SOUND);
  soundButton.hidden = !canSpeak;
  const closeButton = iconButton('close', words.close, ICON_CLOSE);
  endControls.append(soundButton, closeButton);

  const stage = make('div', 'stage');
  const slot = make('div', 'slot');
  slot.setAttribute('aria-hidden', 'true');
  const caption = make('p', 'caption');
  caption.setAttribute('role', 'status');
  caption.setAttribute('aria-live', 'polite');
  const greeting = make('h2', 'greeting');
  greeting.id = 'nextgen-greeting';
  greeting.textContent = words.greeting;
  const answer = make('div', 'answer');
  answer.setAttribute('role', 'status');
  answer.setAttribute('aria-live', 'polite');

  const form = make('form', 'composer');
  form.setAttribute('role', 'search');
  const label = make('label', 'sr-only');
  label.setAttribute('for', 'nextgen-ask');
  label.textContent = words.label;
  const input = make('input');
  input.id = 'nextgen-ask';
  input.type = 'text';
  input.autocomplete = 'off';
  input.placeholder = words.composer;
  input.setAttribute('enterkeyhint', 'go');
  const mic = iconButton('mic', words.listen, ICON_MIC);
  mic.hidden = !canListen;
  const send = iconButton('send', words.submit, ICON_SEND);
  send.type = 'submit';
  form.append(label, input, mic, send);
  const beam = createBeam(form, doc);

  stage.append(slot, caption, greeting, answer, form);

  const scrim = make('div', 'scrim');
  scrim.setAttribute('aria-hidden', 'true');
  scrim.dataset.open = 'false';
  const drawer = make('nav', 'drawer');
  drawer.id = 'nextgen-menu';
  drawer.setAttribute('aria-label', words.menu);
  drawer.setAttribute('inert', '');
  drawer.dataset.open = 'false';
  const drawerHead = make('div', 'drawer-head');
  const drawerTitle = make('p', 'drawer-title');
  drawerTitle.textContent = words.menu;
  const drawerClose = iconButton('drawer-close', words.closeMenu, ICON_CLOSE);
  drawerHead.append(drawerTitle, drawerClose);
  const drawerList = make('ul', 'drawer-list');
  drawer.append(drawerHead, drawerList);

  screen.append(backdrop, startControls, endControls, stage, scrim, drawer);

  const orb = make('button', 'orb');
  orb.type = 'button';
  orb.setAttribute('aria-label', words.openAssistant);
  orb.setAttribute('aria-expanded', 'false');
  orb.dataset.ready = 'false';
  const canvas = make('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  orb.append(canvas);

  const bubble = make('p', 'bubble');
  bubble.setAttribute('role', 'status');
  bubble.setAttribute('aria-live', 'polite');
  bubble.dataset.show = 'false';

  const guidePanel = make('section', 'guide');
  guidePanel.setAttribute('aria-label', words.guideLabel);
  guidePanel.hidden = true;
  const guideTitle = make('p', 'guide-title');
  const guideCount = make('p', 'guide-count');
  const guideText = make('p', 'guide-text');
  guideText.setAttribute('role', 'status');
  guideText.setAttribute('aria-live', 'polite');
  const guideActions = make('div', 'guide-actions');
  const guideBack = pill('guide-back', words.guideBack);
  const guideNext = pill('primary guide-next', words.guideNext);
  const guideDone = pill('primary guide-done', words.guideDone);
  guideActions.append(guideBack, guideNext, guideDone);
  guidePanel.append(guideTitle, guideCount, guideText, guideActions);
  const ring = make('div', 'ring');
  ring.setAttribute('aria-hidden', 'true');
  ring.dataset.show = 'false';

  // A constructed sheet, never a <style> element where the browser can help it: a strict
  // `style-src` blocks the element and the screen would render unstyled (widget.ts).
  adoptStyles(root, doc, CSS);
  root.append(screen, orb, bubble, guidePanel, ring);
  target.append(host);

  let theme: Theme = GRAPHITE;
  const liquid = createLiquid(canvas, {
    size: STAGE,
    reducedMotion,
    view,
    palette: () => ({ accent: css(theme.accent), scheme: theme.scheme, bead: css(theme.raised) }),
    onState: (state) => beam.setState(state),
    onLevel: (level) => beam.setLevel(level),
  });

  /** Read the adopter's look from the page as it is now, and wear it. */
  function applyTheme(): void {
    theme = readTheme(pageThemeSource(doc, view, host));
    for (const [name, value] of Object.entries(themeVariables(theme))) host.style.setProperty(name, value);
    for (const [name, value] of Object.entries(beamVariables(css(theme.accent), theme.scheme))) host.style.setProperty(name, value);
    liquid.refresh();
  }
  applyTheme();

  // ------------------------------------------------------------------ state --

  let mode: 'docked' | 'stage' = 'docked';
  let side: DockSide = 'right';
  let latest = 0;
  let busyTurn = 0;
  let busy = false;
  let savedOverflow: string | null = null;
  let handsFree = canListen && readChoice(HANDS_FREE_KEY, false);
  let readAloud = readChoice(READ_ALOUD_KEY, true);
  let conversation: Conversation | null = null;
  let startingConversation = false;
  let toldToType = false;
  let speaking: Speaking | null = null;
  let transcription: Transcription = 'unavailable';
  let detection: Promise<Transcription> | null = null;
  let lastSaid = '';
  let menuOpen = false;
  let menuLinks: HTMLAnchorElement[] = [];
  let answerLinks: HTMLAnchorElement[] = [];
  let whySummary: HTMLElement | null = null;
  let guide: ResolvedStep[] = [];
  let guideAt = 0;
  let ringTarget: Element | null = null;

  const setCaption = (text: string): void => {
    caption.textContent = text;
  };
  const reflectVoice = (): void => mic.setAttribute('aria-pressed', String(handsFree));
  const reflectSound = (): void => soundButton.setAttribute('aria-pressed', String(readAloud));
  reflectVoice();
  reflectSound();

  const onHome = (): boolean => homes.some((route) => isSamePlace(route, currentPath()));

  // --------------------------------------------------------------- placement --

  function place(): void {
    const w = view?.innerWidth ?? 1024;
    const h = view?.innerHeight ?? 768;
    let x: number;
    let y: number;
    let size: number;
    if (mode === 'stage') {
      const rect = slot.getBoundingClientRect();
      if (rect.width > 0) {
        size = rect.width * STAGE_OVERSCAN;
        x = rect.left + rect.width / 2;
        y = rect.top + rect.height / 2;
      } else {
        size = Math.min(STAGE, w * 0.64);
        x = w / 2;
        y = h * 0.34;
      }
    } else {
      size = DOCK;
      x = side === 'right' ? w - EDGE - DOCK / 2 : EDGE + DOCK / 2;
      y = h - EDGE - DOCK / 2;
    }
    orb.style.setProperty('--x', `${(x - size / 2).toFixed(1)}px`);
    orb.style.setProperty('--y', `${(y - size / 2).toFixed(1)}px`);
    orb.style.setProperty('--s', (size / STAGE).toFixed(4));
    orb.dataset.mode = mode;
    orb.dataset.side = side;
    bubble.dataset.side = side;
    guidePanel.dataset.side = side;
  }

  function resolveSide(): DockSide {
    if (options.dockSide === 'left' || options.dockSide === 'right') return options.dockSide;
    if (!view || typeof doc.elementsFromPoint !== 'function') return 'right';
    return chooseDockSide({
      innerWidth: view.innerWidth,
      innerHeight: view.innerHeight,
      // While the screen is open our own layer covers every edge. It is not the page.
      elementsFromPoint: (x, y) => doc.elementsFromPoint(x, y).filter((node) => node !== host),
    });
  }

  function lockScroll(lock: boolean): void {
    const html = doc.documentElement;
    if (!html?.style) return;
    if (lock && savedOverflow === null) {
      savedOverflow = html.style.overflow ?? '';
      html.style.overflow = 'hidden';
    } else if (!lock && savedOverflow !== null) {
      html.style.overflow = savedOverflow;
      savedOverflow = null;
    }
  }

  // ------------------------------------------------------------------- links --

  const patterns = assistant.registry.capabilities
    .map((c) => c.route)
    .filter((r): r is string => typeof r === 'string');

  function capabilityAt(route: string) {
    const here = currentPath();
    const path = route.replace(/[?#].*$/, '');
    return assistant.registry.capabilities.find(
      (c) => c.kind !== 'unsupported' && fillParams(c.route, here, patterns) === path,
    );
  }

  function link(choice: Choice, className: string): HTMLAnchorElement {
    const a = make('a', className);
    a.href = choice.route;
    a.textContent = choice.label;
    a.addEventListener('click', (event) => {
      const e = event as MouseEvent;
      // A modified click keeps its ordinary meaning: a new tab, a new window.
      if (e.defaultPrevented || e.button > 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      // Already there: the page is right behind the screen.
      if (isSamePlace(choice.route, currentPath())) return dock(true);
      const capability = capabilityAt(choice.route);
      void travel(choice.route, capability?.title ?? choice.label, capability?.id ?? null);
    });
    return a;
  }

  function listItems(links: readonly HTMLAnchorElement[]): HTMLLIElement[] {
    return links.map((a) => {
      const li = make('li');
      li.append(a);
      return li;
    });
  }

  /**
   * "Why?" — the turn's own record, rendered.
   *
   * Rule 9, restated by ADR-019 rather than weakened by it: this panel is still never
   * model narration. `decidedAt`, the candidates and their scores are mechanics the
   * cascade recorded, not the model describing its own reasoning — that stays true even
   * now that the model may write the visitor an answer (WP-53), because that answer
   * renders as the answer (`present.ts`'s `body`), never in here. What this panel adds
   * for a prose turn is `whyRemoved` below, and that text is OURS: a count and a reason
   * code the validator produced, never the removed sentence itself — showing a visitor
   * the very thing that was judged unsafe to show them would defeat the point of removing
   * it.
   */
  function whyFor(trace: TurnTrace): [HTMLDetailsElement, HTMLElement] {
    const details = make('details', 'why');
    const summary = make('summary');
    summary.textContent = words.why;
    const how = make('p', 'why-how');
    const total = trace.latency?.total;
    how.textContent = words.whyHow(trace.decidedAt, typeof total === 'number' ? Math.round(total) : null);
    details.append(summary, how);

    const weighed = trace.candidates.slice(0, 3);
    if (weighed.length > 0) {
      const heading = make('p', 'why-heading');
      heading.textContent = words.whyConsidered;
      const list = make('ul', 'why-list');
      for (const candidate of weighed) {
        const chosen = candidate.capabilityId === trace.capabilityId;
        const item = make('li');
        if (chosen) item.dataset.chosen = 'true';
        const name = make('span', 'why-name');
        name.textContent = assistant.registry.byId.get(candidate.capabilityId)?.title ?? candidate.capabilityId;
        const score = make('span', 'why-score');
        score.textContent = `${candidate.score.toFixed(2)}${chosen ? ` · ${words.whyChosen}` : ''}`;
        const bar = make('span', 'why-bar');
        bar.setAttribute('aria-hidden', 'true');
        bar.style.setProperty('--w', `${Math.round(Math.max(0, Math.min(1, candidate.score)) * 100)}%`);
        item.append(name, score, bar);
        list.append(item);
      }
      details.append(heading, list);
    }

    if ((trace.proseRemoved ?? []).length > 0) {
      const removed = make('p', 'why-removed');
      removed.textContent = words.whyRemoved(trace.proseRemoved.length);
      details.append(removed);
    }

    return [details, summary];
  }

  function showAnswer(question: string, shown: View, trace: TurnTrace | null): void {
    const nodes: HTMLElement[] = [];
    const q = make('p', 'question');
    q.textContent = question;
    const title = make('p', 'title');
    title.textContent = shown.title;
    nodes.push(q, title);
    if (shown.body) {
      const body = make('p', 'body');
      body.textContent = shown.body;
      nodes.push(body);
    }
    answerLinks = shown.choices.map((c) => link(c, 'chip'));
    if (answerLinks.length > 0) {
      const list = make('ul', 'chips');
      list.append(...listItems(answerLinks));
      nodes.push(list);
    }
    whySummary = null;
    if (trace) {
      const [details, summary] = whyFor(trace);
      whySummary = summary;
      nodes.push(details);
    }
    // Replacing the answer must not drop a keyboard user who was standing on it (widget.ts, WP-45).
    const active = root.activeElement;
    const wasInside = active !== null && answer.contains(active);
    answer.dataset.tone = shown.tone;
    answer.replaceChildren(...nodes);
    if (wasInside) input.focus();
  }

  // -------------------------------------------------------------------- menu --

  /** The adopter's own navigation — or, on a page without one, the places the registry knows. */
  function openMenu(): void {
    if (menuOpen || mode !== 'stage') return;
    const found = adopterNav(doc as unknown as NavRoot, {
      base: view?.location.href ?? 'http://localhost/',
      currentPath: currentPath(),
      exclude: host,
    });
    const items: readonly NavLink[] =
      found.length > 0
        ? found
        : suggestionsFor(assistant.registry, currentPath(), Infinity).map((c) => ({ label: c.label, href: c.route, current: false }));
    menuLinks = items.map((item) => {
      const a = link({ label: item.label, route: item.href }, 'drawer-link');
      if (item.current) a.setAttribute('aria-current', 'page');
      return a;
    });
    drawerList.replaceChildren(...listItems(menuLinks));
    menuOpen = true;
    drawer.removeAttribute('inert');
    drawer.dataset.open = 'true';
    scrim.dataset.open = 'true';
    menuButton.setAttribute('aria-expanded', 'true');
    (menuLinks.find((a) => a.hasAttribute('aria-current')) ?? menuLinks[0] ?? drawerClose).focus();
  }

  function closeMenu(returnFocus: boolean): void {
    if (!menuOpen) return;
    menuOpen = false;
    drawer.dataset.open = 'false';
    scrim.dataset.open = 'false';
    drawer.setAttribute('inert', '');
    menuButton.setAttribute('aria-expanded', 'false');
    if (returnFocus) menuButton.focus();
  }

  // ------------------------------------------------------------ open / close --

  /** `fromTap`: opened by the visitor's own tap, which is the only time a browser will fetch a speech pack. */
  function open(fromTap = false): void {
    if (destroyed || mode === 'stage') return;
    applyTheme();
    bubble.dataset.show = 'false';
    endGuide();
    mode = 'stage';
    screen.removeAttribute('inert');
    screen.dataset.open = 'true';
    orb.setAttribute('aria-expanded', 'true');
    orb.setAttribute('aria-hidden', 'true');
    orb.tabIndex = -1;
    lockScroll(true);
    liquid.setBacking(0);
    liquid.setState('idle');
    place();
    later(() => {
      if (mode !== 'stage' || menuOpen) return;
      place();
      input.focus();
    }, 30);
    if (handsFree) void startConversation(fromTap);
  }

  function dock(returnFocus: boolean, toSide?: DockSide): void {
    if (destroyed || mode === 'docked') return;
    closeMenu(false);
    stopConversation();
    stopSpeaking();
    latest++; // a turn still in flight must not move anything once the user has left
    side = toSide ?? resolveSide();
    mode = 'docked';
    screen.dataset.open = 'false';
    screen.setAttribute('inert', '');
    orb.setAttribute('aria-expanded', 'false');
    orb.removeAttribute('aria-hidden');
    orb.tabIndex = 0;
    lockScroll(false);
    liquid.setBacking(1);
    liquid.setState('idle');
    place();
    if (returnFocus) orb.focus();
  }

  const close = (): void => dock(true);

  // ----------------------------------------------------------------- arrival --

  function forget(): void {
    try {
      storage?.removeItem(ARRIVAL_KEY);
    } catch {
      // storage refused
    }
  }

  function recall(): Arrival | null {
    try {
      const raw = storage?.getItem(ARRIVAL_KEY);
      if (!raw) return null;
      const a = JSON.parse(raw) as Partial<Arrival>;
      const age = typeof a.at === 'number' ? Date.now() - a.at : Infinity;
      if (typeof a.title === 'string' && (a.side === 'left' || a.side === 'right') && age >= 0 && age < ARRIVAL_TTL_MS) {
        return {
          title: a.title,
          side: a.side,
          at: a.at as number,
          capabilityId: typeof a.capabilityId === 'string' ? a.capabilityId : null,
        };
      }
      forget();
    } catch {
      // unreadable: treat it as no note at all
    }
    return null;
  }

  function arrive(arrival: Arrival): void {
    forget();
    const steps = arrival.capabilityId ? (assistant.registry.byId.get(arrival.capabilityId)?.steps ?? []) : [];
    if (steps.length > 0) return startGuide(steps, arrival.title);
    bubble.textContent = words.here(arrival.title);
    bubble.dataset.show = 'true';
    liquid.setState('speaking');
    liquid.setLevel(0.7);
    later(() => {
      liquid.setLevel(0);
      if (mode === 'docked') liquid.setState('idle');
    }, 1200);
    later(() => {
      bubble.dataset.show = 'false';
    }, 4500);
  }

  async function travel(route: string, title: string, capabilityId: string | null): Promise<void> {
    if (destroyed) return;
    closeMenu(false);
    const to = resolveSide();
    if (mode === 'stage') {
      liquid.setState('speaking');
      liquid.setLevel(0.6);
      const before = latest;
      await wait(520);
      if (destroyed || latest !== before) return; // closed, or asked something else
      liquid.setLevel(0);
      dock(false, to);
      const flying = latest;
      await wait(FLIGHT_MS);
      if (destroyed || latest !== flying) return;
    }
    try {
      storage?.setItem(ARRIVAL_KEY, JSON.stringify({ title, side: to, at: Date.now(), capabilityId } satisfies Arrival));
    } catch {
      // storage refused: the next page simply will not greet
    }
    // A single-page app moved without unloading us, so act on the new page now.
    if (go(route)) {
      later(() => {
        if (onHome()) {
          forget();
          open();
          return;
        }
        const note = recall();
        if (note) arrive(note);
      }, 320);
    }
  }

  // ------------------------------------------------------------------- guide --

  function startGuide(steps: readonly GuidedStep[], title: string): void {
    guide = resolveSteps(steps, doc as unknown as AnchorRoot);
    guideAt = 0;
    guideTitle.textContent = words.here(title);
    guidePanel.dataset.side = side;
    guidePanel.hidden = false;
    showStep();
  }

  function showStep(): void {
    const step = guide[guideAt];
    if (!step) return endGuide();
    const last = guideAt === guide.length - 1;
    guideCount.textContent = words.guideStep(guideAt + 1, guide.length);
    guideText.textContent = step.text;
    guideBack.hidden = guideAt === 0;
    guideNext.hidden = last;
    guideDone.hidden = !last;
    // A step whose anchor could not be trusted has no element: its text is the guidance (anchor.ts).
    ringTarget = step.element as unknown as Element | null;
    if (ringTarget && typeof ringTarget.scrollIntoView === 'function') {
      ringTarget.scrollIntoView({ block: 'center', behavior: reducedMotion ? 'auto' : 'smooth' });
    }
    positionRing();
    stopSpeaking();
    void say(step.text, readAloud).then(() => {
      if (mode === 'docked') liquid.setState('idle');
    });
  }

  function positionRing(): void {
    const rect = ringTarget && typeof ringTarget.getBoundingClientRect === 'function' ? ringTarget.getBoundingClientRect() : null;
    if (!rect || (rect.width === 0 && rect.height === 0)) {
      ring.dataset.show = 'false';
      return;
    }
    ring.style.setProperty('--rx', `${(rect.left - 6).toFixed(1)}px`);
    ring.style.setProperty('--ry', `${(rect.top - 6).toFixed(1)}px`);
    ring.style.setProperty('--rw', `${(rect.width + 12).toFixed(1)}px`);
    ring.style.setProperty('--rh', `${(rect.height + 12).toFixed(1)}px`);
    ring.dataset.show = 'true';
  }

  function endGuide(): void {
    if (guide.length === 0 && guidePanel.hidden) return;
    guide = [];
    ringTarget = null;
    guidePanel.hidden = true;
    ring.dataset.show = 'false';
    stopSpeaking();
    if (mode === 'docked') liquid.setState('idle');
  }

  // ------------------------------------------------------------------ voice --

  function stopSpeaking(): void {
    const s = speaking;
    speaking = null;
    s?.cancel();
  }

  /** Say `text` in a local voice when reading aloud is on; otherwise act the speaking out, briefly. */
  function say(text: string, aloud: boolean): Promise<void> {
    return new Promise((resolve) => {
      let pulse = 0;
      let done = false;
      let n = 0;
      let voice: Speaking | null = null;
      const handle: Speaking = {
        cancel: () => {
          voice?.cancel();
          finish();
        },
      };
      function finish(): void {
        if (done) return;
        done = true;
        if (pulse) view?.clearInterval(pulse);
        if (speaking === handle) speaking = null;
        liquid.setLevel(0);
        resolve();
      }
      liquid.setState('speaking');
      if (!view || !text) return finish();
      voice = aloud && env ? speak(env, text, lang, { onBoundary: () => liquid.setLevel(0.95), onEnd: finish }) : null;
      if (!voice && reducedMotion) return finish();
      speaking = handle;
      pulse = view.setInterval(() => liquid.setLevel(0.3 + 0.45 * Math.abs(Math.sin(++n * 1.9))), voice ? 160 : 130);
      // An utterance that never reports its end still lets the turn finish.
      later(finish, voice ? 15_000 : Math.max(600, Math.min(2200, text.length * 28)));
    });
  }

  /** While the assistant thinks and speaks, it does not listen — so it never hears itself. */
  function setBusy(value: boolean): void {
    busy = value;
    if (!conversation) return;
    if (value) conversation.pause();
    else if (mode === 'stage') {
      conversation.resume();
      if (!caption.textContent) setCaption(words.listening);
    }
  }

  /** `fromTap`: browsers download a speech pack only while handling the visitor's own tap. */
  async function startConversation(fromTap = false): Promise<void> {
    if (!handsFree || !env?.getUserMedia || conversation || startingConversation || destroyed || mode !== 'stage') return;
    startingConversation = true;
    if (detection) transcription = await detection;
    if (transcription === 'downloadable') {
      if (!fromTap) {
        // Without a tap the download is refused and the recogniser would listen to nothing. Say what to do.
        startingConversation = false;
        setCaption(words.setUpVoice);
        return;
      }
      setCaption(words.preparingVoice);
      await installTranscription(env, lang);
      // Read it again rather than assume: a refused or failed download must not stick for the visit.
      detection = transcriptionFor(env, lang);
      transcription = await detection;
      if (transcription === 'downloadable' || destroyed || mode !== 'stage' || !handsFree) {
        startingConversation = false;
        if (transcription === 'downloadable') setCaption(words.setUpVoice);
        return;
      }
    }
    const transcribing = transcription === 'available';
    let session: Conversation;
    try {
      session = await converse(env, {
        lang,
        transcribe: transcribing,
        onLevel: (level) => {
          if (!busy) liquid.setLevel(level);
        },
        onSpeech: (active) => {
          if (busy) return;
          liquid.setState(active ? 'listening' : 'idle');
          if (!active && !transcribing && !toldToType) {
            toldToType = true;
            setCaption(words.voiceTypeInstead);
          }
        },
        onText: (text, final) => {
          if (busy || !text) return;
          input.value = text;
          if (final) void ask(text);
        },
        onTranscriptionLost: () => setCaption(words.voiceTypeInstead),
      });
    } catch {
      // Refused, or no microphone. Turn it off so the next landing does not ask again unbidden.
      startingConversation = false;
      handsFree = false;
      saveChoice(HANDS_FREE_KEY, false);
      reflectVoice();
      setCaption(words.micDenied);
      return;
    }
    startingConversation = false;
    if (destroyed || mode !== 'stage' || !handsFree) return session.stop();
    conversation = session;
    if (busy) session.pause();
    else setCaption(words.listening);
  }

  function stopConversation(): void {
    const session = conversation;
    conversation = null;
    session?.stop();
    if (caption.textContent === words.listening) setCaption('');
  }

  function toggleVoice(): void {
    if (!canListen || destroyed) return;
    handsFree = !handsFree;
    saveChoice(HANDS_FREE_KEY, handsFree);
    reflectVoice();
    if (!handsFree) {
      stopConversation();
      liquid.setLevel(0);
      if (!busy) liquid.setState('idle');
    } else if (mode === 'stage') {
      void startConversation(true);
    } else {
      open(true);
    }
  }

  // -------------------------------------------------------------------- turn --

  /** The few things a visitor says to the assistant itself (commands.ts): acted on at once, never routed. */
  function runCommand(command: Command): boolean {
    switch (command) {
      case 'close':
        if (mode === 'stage') close();
        return true;
      case 'menu':
        open();
        openMenu();
        return true;
      case 'back':
        if (!view?.history || view.history.length <= 1) return false;
        dock(false);
        view.history.back();
        return true;
      case 'home': {
        const home = homes[0];
        if (!home) return false;
        if (isSamePlace(home, currentPath())) {
          open();
          return true;
        }
        const capability = capabilityAt(home);
        void travel(home, capability?.title ?? home, capability?.id ?? null);
        return true;
      }
      case 'stop':
        stopSpeaking();
        return true;
      case 'repeat':
        if (!lastSaid) return false;
        stopSpeaking();
        void say(lastSaid, readAloud).then(() => {
          if (mode === 'stage' && !busy) liquid.setState('idle');
        });
        return true;
      case 'mute':
        if (handsFree) toggleVoice();
        return true;
    }
  }

  async function ask(text: string): Promise<View | null> {
    const utterance = text.trim();
    if (!utterance || destroyed) return null;
    const command = commandFor(utterance, pageLang);
    if (command && runCommand(command)) {
      input.value = '';
      return null;
    }
    open();
    closeMenu(false);
    stopSpeaking();
    const mine = ++latest;
    busyTurn = mine;
    setBusy(true);
    try {
      screen.dataset.conversation = 'true';
      answer.setAttribute('aria-busy', 'true');
      setCaption(words.thinking);
      liquid.setState('thinking');

      let shown: View;
      let trace: TurnTrace | null = null;
      try {
        const where = currentPath();
        trace = await assistant.route(utterance, { route: where });
        shown = present(trace, assistant.registry, where, words);
      } catch {
        trace = null;
        shown = { tone: 'unsure', title: words.error, body: null, destination: null, choices: [] };
      }
      if (destroyed || mine !== latest) return shown;

      answer.removeAttribute('aria-busy');
      setCaption('');
      input.value = '';
      showAnswer(utterance, shown, trace);

      if (shown.title === words.error) {
        liquid.setState('error');
        later(() => {
          if (mine === latest) liquid.setState('idle');
        }, 1600);
        return shown;
      }

      lastSaid = [shown.title, shown.body].filter(Boolean).join('. ');
      await say(lastSaid, readAloud);
      if (destroyed || mine !== latest) return shown;
      if (shown.destination) {
        const destination = trace?.capabilityId ? assistant.registry.byId.get(trace.capabilityId) : undefined;
        await travel(shown.destination, destination?.title ?? shown.title, destination?.id ?? null);
      } else {
        liquid.setState('idle');
      }
      return shown;
    } finally {
      if (busyTurn === mine) setBusy(false);
    }
  }

  // ------------------------------------------------------------------ events --

  orb.addEventListener('click', () => {
    if (mode === 'docked') open(true);
    else toggleVoice();
  });
  menuButton.addEventListener('click', () => {
    if (menuOpen) closeMenu(true);
    else openMenu();
  });
  drawerClose.addEventListener('click', () => closeMenu(true));
  scrim.addEventListener('click', () => closeMenu(true));
  closeButton.addEventListener('click', close);
  soundButton.addEventListener('click', () => {
    readAloud = !readAloud;
    saveChoice(READ_ALOUD_KEY, readAloud);
    reflectSound();
    if (!readAloud) stopSpeaking();
  });
  mic.addEventListener('click', toggleVoice);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void ask(input.value);
  });
  guideBack.addEventListener('click', () => {
    guideAt = Math.max(0, guideAt - 1);
    showStep();
  });
  guideNext.addEventListener('click', () => {
    guideAt++;
    showStep();
  });
  guideDone.addEventListener('click', endGuide);
  // Browsers keep audio suspended until the page is touched.
  screen.addEventListener('pointerdown', () => conversation?.wake());
  screen.addEventListener('keydown', (event) => {
    const e = event as KeyboardEvent;
    conversation?.wake();
    if (e.key === 'Escape') {
      e.preventDefault();
      if (menuOpen) closeMenu(true);
      else close();
      return;
    }
    if (e.key !== 'Tab') return;
    const stops: HTMLElement[] = menuOpen
      ? [drawerClose, ...menuLinks]
      : [
          menuButton,
          ...(soundButton.hidden ? [] : [soundButton]),
          closeButton,
          ...answerLinks,
          ...(whySummary ? [whySummary] : []),
          input,
          ...(mic.hidden ? [] : [mic]),
          send,
        ];
    const at = stops.indexOf(root.activeElement as HTMLElement);
    if (e.shiftKey && at <= 0) {
      e.preventDefault();
      stops[stops.length - 1]!.focus();
    } else if (!e.shiftKey && at === stops.length - 1) {
      e.preventDefault();
      stops[0]!.focus();
    }
  });
  const onResize = (): void => {
    place();
    if (ringTarget) positionRing();
  };
  const onScroll = (): void => {
    if (ringTarget) positionRing();
  };
  view?.addEventListener('resize', onResize);
  view?.addEventListener('scroll', onScroll, true);

  if (canListen && env) {
    detection = transcriptionFor(env, lang);
    void detection.then((status) => {
      transcription = status;
    });
  }
  if (canSpeak) {
    try {
      env?.synth?.getVoices(); // some browsers only list voices after the first ask
    } catch {
      // no synthesis
    }
  }

  // ------------------------------------------------------------------ arrive --

  const arrival = recall();
  const landing = onHome();
  side = arrival?.side ?? resolveSide();
  place();
  later(() => {
    if (!arrival) {
      side = resolveSide();
      place();
    }
    orb.dataset.ready = 'true';
    if (landing) {
      // The landing page is the assistant screen; the note has done its job.
      forget();
      open();
    } else if (arrival) {
      arrive(arrival);
    }
  }, 50);

  return {
    host,
    open,
    close,
    ask: (utterance) => ask(utterance),
    destroy() {
      if (destroyed) return;
      destroyed = true;
      stopConversation();
      stopSpeaking();
      guide = [];
      ringTarget = null;
      for (const id of timers) view?.clearTimeout(id);
      timers.clear();
      view?.removeEventListener('resize', onResize);
      view?.removeEventListener('scroll', onScroll, true);
      lockScroll(false);
      liquid.destroy();
      host.remove();
    },
  };
}
