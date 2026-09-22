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
import { ACCEPT, checkAttachment, kindOf, LIMITS, offerFiles, safeName, sizeText, thumbnail, type Rejection } from './attach.ts';
import { smalltalkFor } from './chat.ts';
import { commandFor, type Command } from './commands.ts';
import { followUpFor } from './followup.ts';
import { BEAM_CSS, beamVariables, createBeam } from './beam.ts';
import { chooseDockSide, type DockSide } from './dock.ts';
import { createLiquid } from './liquid.ts';
import { adopterNav, type NavLink, type NavRoot } from './nav.ts';
import { attachmentView, fillParams, followUpView, gist, isSamePlace, present, smalltalkView, suggestionsFor, wordsFor, type Choice, type ParamHints, type View, type Words } from './present.ts';
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
  /**
   * Offer to attach a photo or a file. Default `false`: most apps have nowhere to send one, and a
   * button that goes nowhere is a dead end (ADR-024 addendum). What is attached never leaves the
   * visitor's device: it goes to the page as a `nextgen:attach` event, and to nothing else. Say `true`
   * only once the page listens for that event and does something with the files.
   */
  readonly attach?: boolean;
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
/**
 * A reply this short, after a question the router asked about, is read together with that question too
 * ("no treino", "the injury one"). Longer is a new question. A choice of when to try a second reading,
 * not a router threshold: the second reading is kept only when the router itself settles it.
 */
const SHORT_REPLY_WORDS = 4;
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
/* The page behind the glass. Opaque underneath — on the landing route this screen is the page — with the
   host's accent lit softly through it: glass over a flat colour is only a grey rectangle. */
.backdrop {
  position: absolute; inset: 0;
  background:
    radial-gradient(70% 52% at 50% 6%, var(--ng-aurora-1, rgb(121 192 206 / .2)), transparent 72%),
    radial-gradient(48% 42% at 96% 98%, var(--ng-aurora-2, rgb(121 192 206 / .1)), transparent 70%),
    radial-gradient(44% 38% at 2% 72%, var(--ng-aurora-2, rgb(121 192 206 / .1)), transparent 70%),
    var(--ng-backdrop, rgb(8 9 12));
  -webkit-backdrop-filter: blur(18px) saturate(115%);
  backdrop-filter: blur(18px) saturate(115%);
}
.controls { position: absolute; top: 16px; z-index: 2; display: flex; gap: 4px; }
/* The corner controls: small glass discs, so they stay findable over whatever the aurora is doing. */
.controls .icon {
  background: var(--ng-glass, rgb(23 27 33 / .56));
  -webkit-backdrop-filter: blur(16px) saturate(150%); backdrop-filter: blur(16px) saturate(150%);
  box-shadow: inset 1px 1px 0 var(--ng-edge-hi, rgb(255 255 255 / .26)), inset -1px -1px 0 var(--ng-edge-lo, rgb(255 255 255 / .04)), 0 8px 20px -12px var(--ng-shadow, rgb(0 0 0 / .6));
}
.controls .icon:hover { background: var(--ng-glass-strong, rgb(23 27 33 / .82)); }
.controls-start { left: 16px; }
.controls-end { right: 16px; }

/* Two layouts of one screen. Before anyone has said anything it is a landing page: the orb, a
   greeting, a composer. From the first question it is a conversation: the orb shrinks to the
   top, the thread fills the screen and scrolls, and the composer stays at the bottom. */
.stage {
  position: relative; height: 100%; min-height: 0;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 18px; padding: 72px 16px calc(28px + env(safe-area-inset-bottom, 0px));
}
.screen[data-conversation="true"] .stage { justify-content: flex-start; gap: 8px; padding-top: 58px; }
.stage > :not(.slot) {
  opacity: 0; transform: translateY(16px);
  transition: opacity 420ms cubic-bezier(.22,1,.36,1), transform 620ms cubic-bezier(.22,1,.36,1);
}
.screen[data-open="true"] .stage > :not(.slot) { opacity: 1; transform: none; }
.screen[data-open="true"] .thread   { transition-delay: 90ms; }
.screen[data-open="true"] .composer { transition-delay: 160ms; }

.slot { flex: none; width: min(200px, 46vw, 26vh); aspect-ratio: 1; }
.screen[data-conversation="true"] .slot { width: 60px; }
.caption {
  margin: 6px 0 0; min-height: 1rem; max-width: 36rem; text-align: center;
  font-size: .6875rem; font-weight: 600; letter-spacing: .14em; text-transform: uppercase; color: var(--ng-muted, #7a838f);
}
.screen[data-conversation="true"] .caption { margin: -4px 0 0; }

.thread {
  width: min(720px, 100%); display: flex; flex-direction: column; gap: 6px;
  overflow-y: auto; overscroll-behavior: contain; scroll-behavior: smooth;
  /* A thin scrollbar in the host's colours, not the platform's grey slab across the glass. */
  scrollbar-width: thin; scrollbar-color: var(--ng-border, rgb(255 255 255 / .16)) transparent;
}
/* In a conversation the thread spans the screen and centres its column with padding, so the scrollbar
   sits at the screen's edge rather than floating beside the messages. */
.screen[data-conversation="true"] .thread {
  flex: 1 1 auto; min-height: 0; width: 100%; padding: 18px max(2px, calc((100% - 720px) / 2)) 12px;
  -webkit-mask-image: linear-gradient(to bottom, transparent 0, #000 18px);
  mask-image: linear-gradient(to bottom, transparent 0, #000 18px);
}
.msg { display: flex; min-width: 0; animation: nextgen-rise 320ms cubic-bezier(.22,1,.36,1) both; }
@keyframes nextgen-rise { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
/* A turn is a question and its answer: close together, with more air before the next one. */
.msg.user { justify-content: flex-end; margin-top: 16px; }
.msg.intro + .msg.user { margin-top: 8px; }
.msg-body { min-width: 0; max-width: min(88%, 36rem); padding: 11px 16px; border-radius: 20px; overflow-wrap: anywhere; }
/* Messages are lit glass, not blurred glass: dozens of them scrolling, each with its own backdrop filter,
   would stutter a phone, and over a smooth aurora a blur would add nothing anyway. */
.msg.user .msg-body {
  background: linear-gradient(150deg, var(--ng-accent-line, rgb(121 192 206 / .34)), var(--ng-accent-soft, rgb(121 192 206 / .16)));
  color: var(--ng-text, #e6e9ee); border-bottom-right-radius: 6px;
  box-shadow: inset 1px 1px 0 var(--ng-edge-hi, rgb(255 255 255 / .26)), inset 0 0 0 1px var(--ng-accent-soft, rgb(121 192 206 / .16)), 0 10px 24px -16px var(--ng-glow, rgb(121 192 206 / .5));
}
.msg.assistant .msg-body {
  background: var(--ng-glass, rgb(23 27 33 / .56)); border-bottom-left-radius: 6px;
  box-shadow: inset 1px 1px 0 var(--ng-edge-hi, rgb(255 255 255 / .26)), inset -1px -1px 0 var(--ng-edge-lo, rgb(255 255 255 / .04)), 0 14px 32px -20px var(--ng-shadow, rgb(0 0 0 / .6));
}
.msg-text { margin: 0; }

.greeting { margin: 0; font-size: .9375rem; font-weight: 500; }
.greeting-hint { margin: 8px auto 0; max-width: 30rem; font-size: .9375rem; color: var(--ng-muted, #9aa3af); text-wrap: balance; }
/* Once a conversation has started, the hint has done its job: the greeting stays as a short bubble. */
.screen[data-conversation="true"] .greeting-hint { display: none; }
.msg.intro { justify-content: center; }
.screen[data-conversation="true"] .msg.intro { justify-content: flex-start; }
.screen[data-conversation="false"] .msg.intro .msg-body { background: none; border: 0; box-shadow: none; padding: 0; max-width: none; text-align: center; }
.screen[data-conversation="false"] .greeting { font-size: clamp(1.375rem, 1.05rem + 1.1vw, 1.875rem); letter-spacing: -.015em; }

.typing .msg-body { padding: 15px 18px; }
.dots { display: inline-flex; align-items: center; gap: 5px; height: 8px; }
.dots span { width: 6px; height: 6px; border-radius: 50%; background: var(--ng-muted, #7a838f); opacity: .6; animation: nextgen-dot 1.2s ease-in-out infinite both; }
.dots span:nth-child(2) { animation-delay: .15s; }
.dots span:nth-child(3) { animation-delay: .3s; }
@keyframes nextgen-dot { 0%, 60%, 100% { opacity: .3; transform: translateY(0); } 30% { opacity: 1; transform: translateY(-3px); } }

.title { margin: 0; font-size: .9375rem; font-weight: 600; letter-spacing: -.005em; }
.body { margin: 4px 0 0; font-size: .875rem; color: var(--ng-muted, #9aa3af); }
.chips { list-style: none; margin: 12px -8px -6px; padding: 6px 0 0; display: grid; gap: 2px; border-top: 1px solid var(--ng-border, rgb(255 255 255 / .09)); }
.chip {
  display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 48px; padding: 0 12px;
  border-radius: 12px; color: var(--ng-accent-text, #79c0ce); font-weight: 500; text-decoration: none;
  transition: background-color 160ms ease;
}
.chip::after { content: "→"; content: "→" / ""; color: var(--ng-muted, #7a838f); transition: transform 180ms ease, color 180ms ease; }
.chip:hover { background: var(--ng-hover, rgb(255 255 255 / .06)); }
.chip:hover::after { transform: translateX(3px); color: var(--ng-accent, #79c0ce); }

/* The likely one: a card of its own, above the alternatives. */
.chip.lead {
  flex-direction: column; align-items: stretch; justify-content: flex-start; gap: 3px; min-height: 0;
  margin: 12px 0 0; padding: 12px 14px; border-radius: 14px;
  background: linear-gradient(155deg, var(--ng-accent-line, rgb(121 192 206 / .28)), var(--ng-accent-soft, rgb(121 192 206 / .16)) 58%);
  box-shadow: inset 1px 1px 0 var(--ng-edge-hi, rgb(255 255 255 / .26)), inset 0 0 0 1px var(--ng-accent-line, rgb(121 192 206 / .28)), 0 10px 26px -16px var(--ng-glow, rgb(121 192 206 / .5));
  transition: box-shadow 160ms ease, background-color 160ms ease;
}
.chip.lead::after { content: none; }
.chip.lead:hover { box-shadow: inset 1px 1px 0 var(--ng-edge-hi, rgb(255 255 255 / .26)), inset 0 0 0 1px var(--ng-accent, #79c0ce), 0 12px 30px -14px var(--ng-glow, rgb(121 192 206 / .5)); }
.lead-label { display: flex; align-items: center; justify-content: space-between; gap: 12px; font-weight: 600; }
.lead-label::after { content: "→"; content: "→" / ""; transition: transform 180ms ease; }
.chip.lead:hover .lead-label::after { transform: translateX(3px); }
.lead-detail { font-size: .8125rem; font-weight: 400; color: var(--ng-muted, #9aa3af); }
/* Any other place that says what it is for: the same two lines, quieter. */
.chip.card {
  flex-direction: column; align-items: stretch; justify-content: flex-start; gap: 3px; min-height: 0; padding: 10px 12px;
  box-shadow: inset 1px 1px 0 var(--ng-edge-lo, rgb(255 255 255 / .04));
}
.chip.card:hover { box-shadow: inset 1px 1px 0 var(--ng-edge-hi, rgb(255 255 255 / .26)); }
.chip.card::after { content: none; }
.chip.card:hover .lead-label::after { transform: translateX(3px); }
.or { margin: 14px 0 0; font-size: .75rem; letter-spacing: .02em; color: var(--ng-muted, #7a838f); }
.or + .chips { margin-top: 2px; padding-top: 0; border-top: 0; }
/* After a guess: the way out is to say more. */
.hint { margin: 14px 0 0; font-size: .75rem; color: var(--ng-muted, #7a838f); }

/* What can be done with an answer: copy it, see why it was given. One quiet row, not a row each. */
.msg-tools { display: flex; flex-wrap: wrap; align-items: center; gap: 0 2px; margin: 6px -10px -8px; }
.copy { order: 0; }
.why { order: 1; flex: 0 1 auto; margin: 0; color: var(--ng-muted, #9aa3af); font-size: .8125rem; }
.why[open] { flex-basis: 100%; }
.why > :not(summary) { text-align: left; }
.tool, .why summary {
  display: inline-flex; align-items: center; min-height: 44px; margin: 0; padding: 0 12px; border: 0; border-radius: 12px; background: transparent;
  color: var(--ng-muted, #9aa3af); font: inherit; font-size: .75rem; cursor: pointer; list-style: none;
  transition: background-color 160ms ease, color 160ms ease;
}
.tool:hover { color: var(--ng-text, #e6e9ee); background: var(--ng-hover, rgb(255 255 255 / .06)); }
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
  padding: 4px; border-radius: var(--ng-field-radius, 999px);
  background: var(--ng-glass-strong, rgb(26 30 36 / .82));
  -webkit-backdrop-filter: blur(24px) saturate(160%); backdrop-filter: blur(24px) saturate(160%);
  box-shadow: inset 1px 1px 0 var(--ng-edge-hi, rgb(255 255 255 / .26)), inset -1px -1px 0 var(--ng-edge-lo, rgb(255 255 255 / .04)), 0 28px 70px -24px var(--ng-shadow, rgb(0 0 0 / .8));
  transition: box-shadow 200ms ease;
}
.composer:focus-within {
  box-shadow: inset 0 0 0 1px var(--ng-accent, #79c0ce), 0 0 0 4px var(--ng-accent-soft, rgb(121 192 206 / .16)), 0 28px 70px -24px var(--ng-shadow, rgb(0 0 0 / .8));
}
.composer input {
  flex: 1; min-width: 0; min-height: 48px; margin: 0; padding: 0 8px 0 12px; border: 0; outline: 0;
  background: transparent; color: var(--ng-text, #e6e9ee); font: inherit; font-size: 1rem;
}
.composer input::placeholder { color: var(--ng-muted, #7a838f); }

/* What is waiting to be sent, above the box: small glass chips, each with its own way out. */
.tray {
  list-style: none; margin: 0; padding: 2px; width: min(720px, 100%);
  display: flex; gap: 8px; overflow-x: auto; overscroll-behavior: contain; scrollbar-width: none;
}
.tray::-webkit-scrollbar { display: none; }
.attach-item {
  flex: none; display: flex; align-items: center; gap: 10px; max-width: 250px; padding: 6px 2px 6px 6px; border-radius: 18px;
  background: var(--ng-glass-strong, rgb(23 27 33 / .82));
  -webkit-backdrop-filter: blur(16px) saturate(150%); backdrop-filter: blur(16px) saturate(150%);
  box-shadow: inset 1px 1px 0 var(--ng-edge-hi, rgb(255 255 255 / .26)), inset -1px -1px 0 var(--ng-edge-lo, rgb(255 255 255 / .04)), 0 10px 24px -14px var(--ng-shadow, rgb(0 0 0 / .6));
  animation: nextgen-rise 260ms cubic-bezier(.22,1,.36,1) both;
}
.attach-thumb {
  flex: none; display: grid; place-items: center; width: 48px; height: 48px; border-radius: 13px; overflow: hidden;
  background: var(--ng-hover, rgb(255 255 255 / .06)); color: var(--ng-muted, #9aa3af);
}
.attach-canvas, .msg-file canvas { display: block; width: 100%; height: 100%; object-fit: cover; }
.attach-icon { display: grid; place-items: center; gap: 1px; }
.attach-ext { font-size: .5625rem; font-weight: 700; letter-spacing: .06em; line-height: 1; }
.attach-meta { display: grid; min-width: 0; gap: 1px; }
.attach-name { max-width: 128px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: .8125rem; font-weight: 500; }
.attach-size { font-size: .6875rem; color: var(--ng-muted, #7a838f); }
.attach-x {
  flex: none; display: grid; place-items: center; min-width: 44px; min-height: 44px; margin: -6px 0; padding: 0; border: 0;
  background: transparent; color: var(--ng-muted, #9aa3af); font: inherit; cursor: pointer;
}
.attach-x .glyph { width: 24px; height: 24px; border-radius: 50%; background: var(--ng-hover, rgb(255 255 255 / .08)); }
.attach-x:hover { color: var(--ng-text, #e6e9ee); }
/* …and in the visitor's own message, once sent. */
.msg-files { list-style: none; margin: 0 0 8px; padding: 0; display: flex; flex-wrap: wrap; gap: 6px; justify-content: flex-end; }
.msg-file { display: flex; align-items: center; gap: 8px; }
.msg-file[data-kind="image"] canvas {
  width: 72px; height: 72px; border-radius: 14px;
  box-shadow: inset 1px 1px 0 var(--ng-edge-hi, rgb(255 255 255 / .26)), 0 8px 20px -12px var(--ng-shadow, rgb(0 0 0 / .6));
}
.msg-file .attach-icon { width: 36px; height: 36px; border-radius: 10px; background: var(--ng-hover, rgb(255 255 255 / .08)); }
.msg-file-name { max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: .8125rem; }
/* A file being dragged over: the whole screen says it will take it. */
.screen[data-dropping="true"] .stage { outline: 2px dashed var(--ng-accent, #79c0ce); outline-offset: -10px; border-radius: 28px; }
.hint.note { margin-top: 10px; }
${BEAM_CSS}
.icon {
  display: inline-grid; place-items: center; flex: none; min-width: 48px; min-height: 48px; margin: 0; padding: 0;
  border: 0; border-radius: var(--ng-radius, 999px); background: transparent; color: var(--ng-muted, #9aa3af);
  font: inherit; cursor: pointer; transition: background-color 160ms ease, color 160ms ease;
}
.icon:hover { background: var(--ng-hover, rgb(255 255 255 / .06)); color: var(--ng-text, #e6e9ee); }
.glyph { position: relative; display: grid; place-items: center; pointer-events: none; }
.glyph svg { display: block; }
/* The primary actions are metal: the host's accent, lit from above and shaded below, in a bright-edged rim
   — and a sweep of light across it when it is reached for. */
.send .glyph,
.mic[aria-pressed="true"] .glyph,
.pill.primary {
  color: var(--ng-on-accent, #07171b); border: 1px solid transparent; overflow: hidden;
  background:
    linear-gradient(165deg, var(--ng-metal-hi, #a9d8e2), var(--ng-accent, #79c0ce) 48%, var(--ng-metal-lo, #52858f)) padding-box,
    conic-gradient(from 200deg, rgb(255 255 255 / .85), rgb(255 255 255 / .1) 22%, var(--ng-metal-hi, #a9d8e2) 42%, rgb(255 255 255 / .06) 60%, var(--ng-metal-lo, #52858f) 78%, rgb(255 255 255 / .8)) border-box;
  box-shadow: inset 0 1px 0 rgb(255 255 255 / .5), inset 0 -1px 1px rgb(0 0 0 / .25), 0 8px 18px -8px var(--ng-glow, rgb(121 192 206 / .5));
}
.send .glyph, .mic[aria-pressed="true"] .glyph { width: 38px; height: 38px; border-radius: var(--ng-radius, 999px); }
.send .glyph::before, .mic[aria-pressed="true"] .glyph::before, .pill.primary::before {
  content: ''; position: absolute; inset: -1px; pointer-events: none;
  background: linear-gradient(115deg, transparent 32%, rgb(255 255 255 / .45) 50%, transparent 68%);
  transform: translateX(-125%); transition: transform 720ms cubic-bezier(.22,1,.36,1);
}
.send:hover .glyph::before, .mic[aria-pressed="true"]:hover .glyph::before, .pill.primary:hover::before { transform: translateX(125%); }
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
  background: var(--ng-glass-strong, rgb(23 27 33 / .82)); color: var(--ng-text, #e6e9ee);
  -webkit-backdrop-filter: blur(26px) saturate(160%); backdrop-filter: blur(26px) saturate(160%);
  box-shadow: inset -1px 0 0 var(--ng-edge-lo, rgb(255 255 255 / .06)), inset 1px 1px 0 var(--ng-edge-hi, rgb(255 255 255 / .26)), 24px 0 60px -30px var(--ng-shadow, rgb(0 0 0 / .7));
  transform: translateX(-100%); visibility: hidden;
  transition: transform 320ms cubic-bezier(.22,1,.36,1), visibility 0s linear 320ms;
}
.drawer[data-open="true"] { transform: none; visibility: visible; transition-delay: 0s; }
.drawer-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 12px 8px 4px 20px; }
.drawer-title { margin: 0; font-size: .6875rem; font-weight: 600; letter-spacing: .12em; text-transform: uppercase; color: var(--ng-muted, #7a838f); }
.drawer-list {
  list-style: none; margin: 0; padding: 4px 8px 16px; display: grid; gap: 2px; overflow-y: auto;
  scrollbar-width: thin; scrollbar-color: var(--ng-border, rgb(255 255 255 / .16)) transparent;
}
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
  background: var(--ng-glass-strong, rgb(23 27 33 / .82)); color: var(--ng-text, #e6e9ee);
  -webkit-backdrop-filter: blur(20px) saturate(160%); backdrop-filter: blur(20px) saturate(160%);
  box-shadow: inset 1px 1px 0 var(--ng-edge-hi, rgb(255 255 255 / .26)), inset -1px -1px 0 var(--ng-edge-lo, rgb(255 255 255 / .04)), 0 18px 44px -14px var(--ng-shadow, rgb(0 0 0 / .65));
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
  position: relative; min-height: 48px; min-width: 48px; padding: 0 18px; border-radius: var(--ng-radius, 999px);
  border: 0; background: var(--ng-glass, rgb(23 27 33 / .56)); color: var(--ng-text, #e6e9ee);
  box-shadow: inset 1px 1px 0 var(--ng-edge-hi, rgb(255 255 255 / .26)), inset -1px -1px 0 var(--ng-edge-lo, rgb(255 255 255 / .04));
  font: inherit; cursor: pointer; transition: background-color 160ms ease;
}
.pill:hover { background: var(--ng-glass-strong, rgb(23 27 33 / .82)); }
.pill.primary { font-weight: 600; }

.ring {
  position: fixed; z-index: 2147482999; pointer-events: none;
  left: var(--rx, 0); top: var(--ry, 0); width: var(--rw, 0); height: var(--rh, 0);
  border: 2px solid var(--ng-accent, #79c0ce); border-radius: 12px;
  box-shadow: 0 0 0 6px rgb(8 9 12 / .16);
  opacity: 0;
  transition: opacity 200ms ease, left 280ms cubic-bezier(.22,1,.36,1), top 280ms cubic-bezier(.22,1,.36,1), width 280ms ease, height 280ms ease;
}
.ring[data-show="true"] { opacity: 1; }

/* Glass is only ever an enhancement: where the browser cannot blur, or the visitor has asked for no
   transparency, every surface is the host's own solid raised colour, exactly as it was before. */
@supports not ((-webkit-backdrop-filter: blur(1px)) or (backdrop-filter: blur(1px))) {
  .composer, .drawer, .bubble, .guide, .controls .icon, .pill, .msg.assistant .msg-body { background: var(--ng-raised, #171b21); }
}
/* A phone: four buttons and a box in one row must still be four 44px targets and a box you can type in. */
@media (max-width: 480px) {
  .composer { gap: 0; }
  .composer .icon { min-width: 44px; min-height: 44px; }
  .composer input { padding: 0 6px; }
  .attach-name { max-width: 96px; }
}
@media (prefers-reduced-transparency: reduce) {
  .attach-item { background: var(--ng-raised, #171b21); -webkit-backdrop-filter: none; backdrop-filter: none; }
  .composer, .drawer, .bubble, .guide, .controls .icon, .pill, .msg.assistant .msg-body { background: var(--ng-raised, #171b21); -webkit-backdrop-filter: none; backdrop-filter: none; }
  .backdrop { background: var(--ng-backdrop, rgb(8 9 12)); -webkit-backdrop-filter: none; backdrop-filter: none; }
}
@media (forced-colors: active) {
  .backdrop { background: Canvas; -webkit-backdrop-filter: none; backdrop-filter: none; }
  .composer, .msg-body, .bubble, .guide, .pill, .drawer, .controls .icon, .attach-item { background: Canvas; color: CanvasText; border: 1px solid CanvasText; box-shadow: none; -webkit-backdrop-filter: none; backdrop-filter: none; }
  .chip, .chip.lead, .chip.card { color: LinkText; box-shadow: none; }
  .send .glyph::before, .mic .glyph::before, .pill.primary::before { display: none; }
  .send .glyph, .mic[aria-pressed="true"] .glyph, .pill.primary, .why-bar::after { background: Highlight; color: HighlightText; box-shadow: none; }
  .drawer-link[aria-current="page"] { background: Highlight; color: HighlightText; }
  .orb { border: 1px solid ButtonText; }
  .ring { border-color: Highlight; }
}
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { transition: none !important; animation: none !important; }
  .thread { scroll-behavior: auto; }
}
`;

// Constant markup only. Nothing from a registry, a page or a user ever reaches innerHTML.
const svg = (body: string, size = 20): string =>
  `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" focusable="false">${body}</svg>`;
const ICON_MENU = svg('<path d="M4 7h16M4 12h16M4 17h16"/>');
const ICON_CLOSE = svg('<path d="M6 6l12 12M18 6L6 18"/>');
const ICON_MIC = svg('<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>');
const ICON_SEND = svg('<path d="M12 19V5M6 11l6-6 6 6"/>', 18);
const ICON_ATTACH = svg('<path d="M20.5 11.5l-8.2 8.2a5 5 0 0 1-7.1-7.1l8.5-8.5a3.3 3.3 0 0 1 4.7 4.7l-8.5 8.5a1.7 1.7 0 0 1-2.4-2.4l7.8-7.8"/>');
const ICON_CAMERA = svg('<path d="M4 8h3l1.6-2.2h6.8L17 8h3v11H4z"/><circle cx="12" cy="13.2" r="3.4"/>');
const ICON_FILE = svg('<path d="M7 3h7l4 4v14H7z"/><path d="M14 3v4h4"/>', 22);
const ICON_REMOVE = svg('<path d="M7 7l10 10M17 7L7 17"/>', 14);
const ICON_RESTART = svg('<path d="M4 4v6h6"/><path d="M4.6 14a8 8 0 1 0 1.9-8.3L4 10"/>');
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
  // What the page knows that its URL may not say: the locale an i18n router prefixes routes with, for the
  // pages of its default language (`localePrefix: 'as-needed'`). Only ever a fallback (fillParams).
  const hints: ParamHints = { locale: pageLang ?? undefined };
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
  screen.setAttribute('aria-describedby', 'nextgen-greeting-hint');
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
  // Only once there is a conversation to start over from.
  const restartButton = iconButton('restart', words.startOver, ICON_RESTART);
  restartButton.hidden = true;
  endControls.append(restartButton, soundButton, closeButton);

  const stage = make('div', 'stage');
  const slot = make('div', 'slot');
  slot.setAttribute('aria-hidden', 'true');
  const caption = make('p', 'caption');
  caption.setAttribute('role', 'status');
  caption.setAttribute('aria-live', 'polite');
  // The conversation. A log: what is added to it is announced, in order, once it is complete
  // (`aria-busy` while a turn is being worked out). It opens with the greeting, which is also
  // what names the dialog.
  const thread = make('div', 'thread');
  thread.setAttribute('role', 'log');
  const greeting = make('h2', 'greeting');
  greeting.id = 'nextgen-greeting';
  greeting.textContent = words.greeting;
  // "Ready when you are" says nothing to someone who has never seen this: one line on what it is for.
  const greetingHint = make('p', 'greeting-hint');
  greetingHint.id = 'nextgen-greeting-hint';
  greetingHint.textContent = words.greetingHint;
  const intro = make('div', 'msg assistant intro');
  const introBody = make('div', 'msg-body');
  introBody.append(greeting, greetingHint);
  intro.append(introBody);
  thread.append(intro);

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
  // A photo or a file, kept on the device (attach.ts). The camera is offered only where the device is
  // touch-first: on a laptop the paperclip already opens a picker that can take a file from anywhere.
  const attachButton = iconButton('attach', words.attach, ICON_ATTACH);
  const cameraButton = iconButton('camera', words.attachCamera, ICON_CAMERA);
  const canAttach = options.attach === true;
  const coarse = Boolean(view?.matchMedia?.('(pointer: coarse)').matches);
  attachButton.hidden = !canAttach;
  cameraButton.hidden = !canAttach || !coarse;
  // The box shares its row with four buttons on a phone: ask in fewer words rather than be clipped.
  if (coarse && canAttach) input.placeholder = words.composerShort;
  const picker = (accept: string, className: string): HTMLInputElement => {
    const control = make('input', className);
    control.type = 'file';
    control.accept = accept;
    control.hidden = true;
    control.tabIndex = -1;
    control.setAttribute('aria-hidden', 'true');
    return control;
  };
  const filePicker = picker(ACCEPT, 'file-picker');
  filePicker.multiple = true;
  const cameraPicker = picker('image/*', 'camera-picker');
  cameraPicker.setAttribute('capture', 'environment');
  form.append(label, attachButton, cameraButton, input, mic, send, filePicker, cameraPicker);
  const beam = createBeam(form, doc);
  // What is waiting to be sent with the next message.
  const tray = make('ul', 'tray');
  tray.hidden = true;
  tray.setAttribute('aria-label', words.attach);

  screen.dataset.conversation = 'false';
  stage.append(slot, caption, thread, tray, form);

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
  /** The bubble is showing the orb's name on hover or focus, not something it said (`hint`, below). */
  let hinting = false;

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
  /** What the last answer offered, so "yes" or "the second one" can be read as a reply to it (followup.ts). */
  let offered: { readonly choices: readonly Choice[]; readonly probable: boolean } | null = null;
  /**
   * The last question the router could not settle — it asked instead — so a short reply that adds a
   * detail ("in training", "the injury one") can be read together with it.
   */
  let unsettled: string | null = null;
  let menuOpen = false;
  let menuLinks: HTMLAnchorElement[] = [];
  /** Everything in the thread a keyboard can reach — each answer's options and its "Why?" — in reading order. */
  let threadStops: HTMLElement[] = [];
  let typing: HTMLElement | null = null;
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
      (c) => c.kind !== 'unsupported' && fillParams(c.route, here, patterns, hints) === path,
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

  /** A link that also says what is behind it, in the adopter's own words. Still an ordinary link. */
  function card(choice: Choice, className: string, label: string = choice.label): HTMLAnchorElement {
    const a = link(choice, className);
    const name = make('span', 'lead-label');
    name.textContent = label;
    const parts: HTMLElement[] = [name];
    if (choice.detail) {
      const detail = make('span', 'lead-detail');
      detail.textContent = choice.detail;
      parts.push(detail);
    }
    a.replaceChildren(...parts);
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

    // Opened on the last answer, the explanation grows below the fold: the click seemed to do nothing.
    details.addEventListener('toggle', () => {
      if (details.open) (details as Partial<Pick<HTMLElement, 'scrollIntoView'>>).scrollIntoView?.({ block: 'nearest' });
    });

    return [details, summary];
  }

  // ------------------------------------------------------------------ thread --

  /**
   * A conversation is a page, so it is bounded: the greeting and the most recent messages. An
   * assistant left open all day on someone else's page must not grow without limit.
   */
  const MAX_MESSAGES = 60;

  function scrollToEnd(): void {
    thread.scrollTop = thread.scrollHeight;
  }

  /** One message. `content` is built from `textContent` only — nothing a visitor typed is ever markup. */
  function addMessage(kind: 'user' | 'assistant', className: string, content: readonly HTMLElement[]): HTMLElement {
    const message = make('div', `msg ${kind}${className ? ` ${className}` : ''}`);
    const body = make('div', 'msg-body');
    body.append(...content);
    message.append(body);
    thread.append(message);
    while (thread.children.length > MAX_MESSAGES) thread.children[1]!.remove();
    threadStops = threadStops.filter((stop) => thread.contains(stop));
    scrollToEnd();
    return message;
  }

  function addVisitorMessage(text: string, files: readonly Attached[] = []): void {
    const nodes: HTMLElement[] = [];
    if (files.length > 0) {
      const row = make('ul', 'msg-files');
      for (const entry of files) row.append(fileChip(entry));
      nodes.push(row);
    }
    if (text) {
      const p = make('p', 'msg-text');
      p.textContent = text;
      nodes.push(p);
    }
    addMessage('user', '', nodes);
  }

  // ------------------------------------------------------------ attachments --
  //
  // A photo or a file, kept on the device (attach.ts). Nothing here reaches the router, a trace or a
  // model: `ask` sends the router the words and nothing else, and the files go to the page as an event.

  interface Attached {
    readonly file: File;
    readonly item: HTMLLIElement;
    /** The picture, once the browser has drawn it; the file's icon until then, and always for a document. */
    thumb: HTMLCanvasElement | null;
  }
  let attached: Attached[] = [];

  /** A line in the status region that goes away by itself. */
  const notice = (message: string): void => {
    setCaption(message);
    later(() => {
      if (caption.textContent === message) setCaption('');
    }, 3200);
  };

  const rejection = (why: Rejection): string =>
    why === 'too-many'
      ? words.attachTooMany(LIMITS.files)
      : why === 'too-large'
        ? words.attachTooLarge(LIMITS.bytes / (1024 * 1024))
        : why === 'empty'
          ? words.attachEmpty
          : words.attachUnsupported;

  /** The icon a file has until — and unless — there is a picture of it. */
  function fileGlyph(file: File): HTMLSpanElement {
    const box = make('span', 'attach-icon');
    box.setAttribute('aria-hidden', 'true');
    box.append(glyph(ICON_FILE));
    const dot = file.name.lastIndexOf('.');
    const extension = dot > 0 ? file.name.slice(dot + 1, dot + 5).toUpperCase() : '';
    if (extension) {
      const label = make('span', 'attach-ext');
      label.textContent = extension;
      box.append(label);
    }
    return box;
  }

  /** A file as it appears in the visitor's own message: its picture or icon, and its name. */
  function fileChip(entry: Attached): HTMLLIElement {
    const chip = make('li', 'msg-file');
    chip.dataset.kind = kindOf(entry.file);
    const name = make('span', entry.thumb ? 'sr-only' : 'msg-file-name');
    name.textContent = safeName(entry.file.name);
    chip.append(entry.thumb ?? fileGlyph(entry.file), name);
    return chip;
  }

  function reflectTray(): void {
    tray.hidden = attached.length === 0;
    screen.dataset.attaching = attached.length > 0 ? 'true' : 'false';
  }

  function dropAttached(entry: Attached): void {
    attached = attached.filter((other) => other !== entry);
    entry.item.remove();
    reflectTray();
    setCaption(attached.length > 0 ? words.attachedFiles(attached.length) : '');
  }

  function clearAttached(): void {
    for (const entry of attached) entry.item.remove();
    attached = [];
    reflectTray();
  }

  function addToTray(file: File): Attached {
    const shown = safeName(file.name);
    const item = make('li', 'attach-item');
    item.dataset.kind = kindOf(file);
    const thumb = make('span', 'attach-thumb');
    thumb.setAttribute('aria-hidden', 'true');
    thumb.append(fileGlyph(file));
    const name = make('span', 'attach-name');
    name.textContent = shown;
    const size = make('span', 'attach-size');
    size.textContent = sizeText(file.size);
    const meta = make('span', 'attach-meta');
    meta.append(name, size);
    const remove = make('button', 'attach-x');
    remove.type = 'button';
    const removeLabel = make('span', 'sr-only');
    removeLabel.textContent = words.removeFile(shown);
    remove.append(removeLabel, glyph(ICON_REMOVE));
    item.append(thumb, meta, remove);
    tray.append(item);

    const entry: Attached = { file, item, thumb: null };
    remove.addEventListener('click', () => dropAttached(entry));
    if (view) {
      void thumbnail(file, doc, view as Window & typeof globalThis).then((canvas) => {
        // Taken back, or sent, before the picture was ready: nothing to draw it on.
        if (!canvas || destroyed || !attached.includes(entry)) return;
        canvas.className = 'attach-canvas';
        entry.thumb = canvas;
        thumb.replaceChildren(canvas);
      });
    }
    return entry;
  }

  /** Chosen, pasted or dropped: every way in is judged by the same limits. */
  function attachFiles(list: ArrayLike<File> | null | undefined): void {
    if (!list || destroyed || !canAttach) return;
    let added = 0;
    let refused: Rejection | null = null;
    for (const file of Array.from(list)) {
      const why = checkAttachment(file, attached.length);
      if (why) {
        refused ??= why;
        continue;
      }
      attached.push(addToTray(file));
      added++;
    }
    reflectTray();
    if (refused) notice(rejection(refused));
    else if (added > 0) setCaption(words.attachedFiles(attached.length));
  }

  /** Three dots while it works out an answer. Decorative: the thread is `aria-busy` and the caption says so. */
  function showTyping(): void {
    dropTyping();
    const dots = make('span', 'dots');
    for (let i = 0; i < 3; i++) dots.append(make('span'));
    typing = addMessage('assistant', 'typing', [dots]);
    typing.setAttribute('aria-hidden', 'true');
  }

  function dropTyping(): void {
    typing?.remove();
    typing = null;
  }

  function showAnswer(shown: View, trace: TurnTrace | null): void {
    dropTyping();
    const nodes: HTMLElement[] = [];
    const title = make('p', 'title');
    title.textContent = shown.title;
    nodes.push(title);
    if (shown.body) {
      const body = make('p', 'body');
      body.textContent = shown.body;
      nodes.push(body);
    }
    const stops: HTMLElement[] = [];
    const [first, ...rest] = shown.choices;
    // The likely one is offered as a card of its own — what it is, and what it is for — with the
    // rest introduced as alternatives. It is still an ordinary link: a tap takes it, nothing else does.
    if (shown.probable && first) {
      const lead = card(first, 'chip lead', words.open(first.label));
      stops.push(lead);
      nodes.push(lead);
      if (rest.length > 0) {
        const or = make('p', 'or');
        or.textContent = words.orElse;
        nodes.push(or);
      }
    }
    // A place that says what it is for is a card, so someone who has never seen the app can tell two
    // names apart; one that does not is a plain link, and nothing is invented for it.
    const alternatives = (shown.probable ? rest : shown.choices).map((c) => (c.detail ? card(c, 'chip card') : link(c, 'chip')));
    if (alternatives.length > 0) {
      const list = make('ul', 'chips');
      list.append(...listItems(alternatives));
      nodes.push(list);
      stops.push(...alternatives);
    }
    // What became of anything they attached: passed to the app, or kept on their device.
    if (shown.note) {
      const note = make('p', 'hint note');
      note.textContent = shown.note;
      nodes.push(note);
    }
    // An answer that was a guess ends by saying how to get a better one — say more, in your own words —
    // and a refusal by saying what can be done instead. Neither is a dead end.
    const next = shown.tone === 'choose' ? words.notThat : shown.tone === 'limit' ? words.limitNext : null;
    if (next) {
      const hint = make('p', 'hint');
      hint.textContent = next;
      nodes.push(hint);
    }
    // One quiet row of what can be done with the answer: copy it, and see why it was given. Both stay
    // reachable by keyboard; neither is a row of its own, which is what made every answer tall.
    const tools = make('div', 'msg-tools');
    if (canCopy) {
      const copy = make('button', 'tool copy');
      copy.type = 'button';
      copy.textContent = words.copy;
      const text = [shown.title, shown.body, ...shown.choices.map((c) => `${c.label} — ${c.route}`)].filter(Boolean).join('\n');
      copy.addEventListener('click', () => void copyText(text));
      tools.append(copy);
      stops.push(copy);
    }
    if (trace) {
      const [details, summary] = whyFor(trace);
      tools.append(details);
      stops.push(summary);
    }
    if (tools.children.length > 0) nodes.push(tools);
    threadStops.push(...stops);
    addMessage('assistant', '', nodes).dataset.tone = shown.tone;
  }

  const canCopy = typeof view?.navigator?.clipboard?.writeText === 'function';

  /** Copy an answer as plain text, and say whether it worked in the status line. */
  async function copyText(text: string): Promise<void> {
    let said = words.copied;
    try {
      await view!.navigator.clipboard.writeText(text);
    } catch {
      said = words.copyFailed;
    }
    setCaption(said);
    later(() => {
      if (caption.textContent === said) setCaption('');
    }, 1600);
  }

  /** Back to the greeting. Whatever was still being worked out is no longer wanted, and is dropped when it arrives. */
  function startOver(): void {
    latest++;
    stopSpeaking();
    dropTyping();
    thread.replaceChildren(intro);
    threadStops = [];
    thread.removeAttribute('aria-busy');
    setCaption('');
    input.value = '';
    clearAttached();
    asked.length = 0;
    recalling = -1;
    offered = null;
    unsettled = null;
    screen.dataset.conversation = 'false';
    restartButton.hidden = true;
    liquid.setState('idle');
    liquid.setLevel(0);
    place();
    input.focus();
  }

  /** What was asked this session, for the arrow keys. */
  const asked: string[] = [];
  let recalling = -1;

  // -------------------------------------------------------------------- menu --

  /**
   * Where a lost visitor could begin: the app's own main navigation, in its own words, restricted to
   * places the assistant can say what they are for. Empty on a page with no navigation of its own.
   */
  function startingPoints(): Choice[] {
    const found = adopterNav(doc as unknown as NavRoot, {
      base: view?.location.href ?? 'http://localhost/',
      currentPath: currentPath(),
      exclude: host,
    });
    const out: Choice[] = [];
    for (const item of found) {
      if (out.length === 3) break;
      if (item.current || out.some((o) => isSamePlace(o.route, item.href))) continue;
      const capability = capabilityAt(item.href);
      if (!capability) continue;
      const detail = gist(capability.explanation);
      out.push({ label: item.label, route: item.href, ...(detail ? { detail } : {}) });
    }
    return out;
  }

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
        : suggestionsFor(assistant.registry, currentPath(), Infinity, hints).map((c) => ({ label: c.label, href: c.route, current: false }));
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
    hinting = false;
    bubble.removeAttribute('aria-hidden');
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
    // What it says on arrival is news, and is announced: never left marked as a hover hint.
    hinting = false;
    bubble.removeAttribute('aria-hidden');
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
    // What was attached when they sent it. A message can be only files.
    const sending = attached;
    if ((!utterance && sending.length === 0) || destroyed) return null;
    const filesOnly = utterance === '';
    const command = utterance && sending.length === 0 ? commandFor(utterance, pageLang) : null;
    if (command && runCommand(command)) {
      input.value = '';
      return null;
    }
    // Small talk is answered, not routed (chat.ts): a router handed "hi" refuses it, and a visitor greeted
    // with a refusal has learned the assistant is not for them. A leading greeting is let go, and what
    // follows it is the question.
    // …but first, a reply to what the last answer offered ("yes", "the second one", "neither") is read as
    // that (followup.ts). "Yes" on its own is small talk, and was answered as such.
    const replied = utterance && sending.length === 0 && offered ? followUpFor(utterance) : null;
    const reply = replied && offered ? followUpView(replied, offered, words) : null;
    const talk = utterance && !reply ? smalltalkFor(utterance, pageLang) : null;
    const chatty = talk !== null && talk.rest === '';
    // Nothing to wait for when there is nothing to work out.
    const instant = chatty || filesOnly || reply !== null;
    open();
    closeMenu(false);
    stopSpeaking();
    const mine = ++latest;
    busyTurn = mine;
    setBusy(true);
    try {
      // The screen stops being a landing page and becomes a conversation; the orb moves to its
      // smaller seat at the top, and is placed again now that the layout has changed.
      const first = screen.dataset.conversation !== 'true';
      screen.dataset.conversation = 'true';
      restartButton.hidden = false;
      if (first) place();
      addVisitorMessage(utterance, sending);
      // Handed to the page, and only to the page: the router below is given the words and nothing else,
      // and nothing attached is ever sent anywhere by the assistant.
      const handed =
        sending.length > 0 && view
          ? offerFiles(view as Window & typeof globalThis, { files: sending.map((entry) => entry.file), utterance, route: currentPath() })
          : false;
      attached = [];
      for (const entry of sending) entry.item.remove();
      reflectTray();
      input.value = '';
      if (utterance && asked[asked.length - 1] !== utterance) asked.push(utterance);
      recalling = -1;
      thread.setAttribute('aria-busy', 'true');
      // No dots, no "Looking…" for small talk, or for a message that is only a file.
      if (!instant) {
        setCaption(words.thinking);
        showTyping();
        liquid.setState('thinking');
      }

      let shown: View;
      let trace: TurnTrace | null = null;
      try {
        const where = currentPath();
        if (filesOnly) {
          shown = attachmentView(handed, words);
        } else if (reply) {
          shown = reply;
        } else if (talk && chatty) {
          const starts = talk.kind === 'help' || talk.kind === 'thisPage' ? startingPoints() : [];
          shown = smalltalkView(talk.kind, assistant.registry, where, words, starts, hints);
        } else {
          const question = talk ? talk.rest : utterance;
          trace = await assistant.route(question, { route: where });
          // A short reply to a question the router asked about is most likely a detail of that question
          // ("the injury one", "no treino"). Read the two together, and take that reading only when it
          // settles what neither did alone. A refusal is never overturned this way: a new request for
          // something the app cannot do stays refused, whatever came before it.
          if (unsettled && trace.outcome === 'clarify' && question.split(/\s+/).length <= SHORT_REPLY_WORDS) {
            const together = await assistant.route(`${unsettled} ${question}`, { route: where });
            if (together.outcome === 'execute') trace = together;
          }
          if (mine === latest) unsettled = trace.outcome === 'clarify' ? trace.utterance || question : null;
          // Where to begin is only needed when nothing matched, so the page's navigation is read only then.
          const nothingMatched = trace.outcome === 'clarify' && trace.candidates.every((c) => c.score <= 0);
          shown = present(trace, assistant.registry, where, words, nothingMatched ? startingPoints() : [], hints);
        }
        // Whatever was asked, the visitor is told what became of what they attached.
        if (sending.length > 0 && !filesOnly) shown = { ...shown, note: handed ? words.attachHanded : words.attachKept };
      } catch {
        trace = null;
        shown = { tone: 'unsure', title: words.error, body: null, destination: null, choices: [] };
      }
      if (destroyed || mine !== latest) return shown;

      thread.removeAttribute('aria-busy');
      setCaption('');
      showAnswer(shown, trace);
      // What this answer offered is what a "yes" or "the second one" next would mean. Going somewhere, or
      // talking about something else, ends the question that was open; "neither" keeps it open.
      offered = !shown.destination && shown.choices.length > 0 ? { choices: shown.choices, probable: shown.probable === true } : null;
      if (shown.destination || (chatty && !reply) || filesOnly) unsettled = null;

      if (shown.title === words.error) {
        liquid.setState('error');
        later(() => {
          if (mine === latest) liquid.setState('idle');
        }, 1600);
        return shown;
      }

      // A title that already ends a sentence ("Hi! How can I help?") is not given a second full stop.
      lastSaid = [shown.title, shown.body].filter(Boolean).join(/[.!?:…]$/.test(shown.title) ? ' ' : '. ');
      await say(lastSaid, readAloud);
      if (destroyed || mine !== latest) return shown;
      if (shown.destination) {
        // A reply ("yes", "the second one") has no trace of its own: the place it chose names itself.
        const destination = trace?.capabilityId ? assistant.registry.byId.get(trace.capabilityId) : capabilityAt(shown.destination);
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
  // A stranger sees a globe in a corner and nothing saying what it is. Pointed at, or reached by keyboard,
  // the docked orb says it in the bubble it already speaks in — unless that bubble is saying something
  // else. Hidden from screen readers while it does: the orb's own name already says it to them.
  const hint = (show: boolean): void => {
    if (show) {
      if (mode !== 'docked' || bubble.dataset.show === 'true') return;
      hinting = true;
      bubble.textContent = words.label;
      bubble.setAttribute('aria-hidden', 'true');
      bubble.dataset.show = 'true';
    } else if (hinting) {
      hinting = false;
      bubble.dataset.show = 'false';
      bubble.removeAttribute('aria-hidden');
    }
  };
  orb.addEventListener('pointerenter', (event) => {
    if ((event as PointerEvent).pointerType !== 'touch') hint(true);
  });
  orb.addEventListener('pointerleave', () => hint(false));
  orb.addEventListener('focus', () => {
    if (orb.matches?.(':focus-visible') !== false) hint(true);
  });
  orb.addEventListener('blur', () => hint(false));
  menuButton.addEventListener('click', () => {
    if (menuOpen) closeMenu(true);
    else openMenu();
  });
  drawerClose.addEventListener('click', () => closeMenu(true));
  scrim.addEventListener('click', () => closeMenu(true));
  closeButton.addEventListener('click', close);
  restartButton.addEventListener('click', startOver);
  // Up and down walk back through what was asked, as any chat does — but only from an empty composer or
  // one already showing a recalled question, so it never overwrites something being typed.
  input.addEventListener('keydown', (event) => {
    const e = event as KeyboardEvent;
    if ((e.key !== 'ArrowUp' && e.key !== 'ArrowDown') || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    if (asked.length === 0) return;
    if (input.value !== '' && !(recalling !== -1 && input.value === asked[recalling])) return;
    if (e.key === 'ArrowDown' && recalling === -1) return;
    e.preventDefault();
    if (e.key === 'ArrowUp') recalling = recalling === -1 ? asked.length - 1 : Math.max(0, recalling - 1);
    else recalling = recalling + 1 >= asked.length ? -1 : recalling + 1;
    input.value = recalling === -1 ? '' : asked[recalling]!;
  });
  soundButton.addEventListener('click', () => {
    readAloud = !readAloud;
    saveChoice(READ_ALOUD_KEY, readAloud);
    reflectSound();
    if (!readAloud) stopSpeaking();
  });
  mic.addEventListener('click', toggleVoice);
  // A photo or a file: chosen with the paperclip or the camera, pasted into the box, or dropped on the screen.
  // Every way in is judged by the same limits, because `accept` on a picker is only a hint.
  const openPicker = (control: HTMLInputElement): void => {
    if (typeof control.click === 'function') control.click();
  };
  attachButton.addEventListener('click', () => openPicker(filePicker));
  cameraButton.addEventListener('click', () => openPicker(cameraPicker));
  for (const control of [filePicker, cameraPicker]) {
    control.addEventListener('change', () => {
      const chosen = Array.from(control.files ?? []);
      control.value = ''; // so choosing the same photo again is a change
      attachFiles(chosen);
    });
  }
  input.addEventListener('paste', (event) => {
    const pasted = (event as ClipboardEvent).clipboardData?.files;
    if (!canAttach || !pasted || pasted.length === 0) return; // pasting text is left alone
    event.preventDefault();
    attachFiles(Array.from(pasted));
  });
  const carriesFiles = (event: Event): boolean => canAttach && Array.from((event as DragEvent).dataTransfer?.types ?? []).includes('Files');
  screen.addEventListener('dragover', (event) => {
    if (!carriesFiles(event)) return;
    event.preventDefault();
    screen.dataset.dropping = 'true';
  });
  screen.addEventListener('dragleave', () => {
    screen.dataset.dropping = 'false';
  });
  screen.addEventListener('drop', (event) => {
    if (!carriesFiles(event)) return;
    event.preventDefault();
    screen.dataset.dropping = 'false';
    attachFiles(Array.from((event as DragEvent).dataTransfer?.files ?? []));
  });
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
          ...(restartButton.hidden ? [] : [restartButton]),
          ...(soundButton.hidden ? [] : [soundButton]),
          closeButton,
          ...threadStops,
          ...(attachButton.hidden ? [] : [attachButton]),
          ...(cameraButton.hidden ? [] : [cameraButton]),
          input,
          ...(mic.hidden ? [] : [mic]),
          send,
        ];
    // Only the two ends wrap. A control this list does not name (a file chip's remove button) is -1,
    // and is left to the browser's own order — `<= 0` once sent Shift+Tab from the paperclip to Send.
    const at = stops.indexOf(root.activeElement as HTMLElement);
    if (e.shiftKey && at === 0) {
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
      attached = [];
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
