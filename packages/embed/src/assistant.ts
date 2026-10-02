// The assistant layer — what `start()` puts on an adopter's page.
//
// The orb waits, small, at the emptier edge. Tapped, it opens a chat panel in that corner — the
// page stays in view and usable beside it — with the orb at the top of the panel, a greeting and a
// composer. Expanded, the same panel fills the screen, except for the app's own navigation, which
// stays where it is (nav.ts `navFrame`, ADR-026). On the adopter's landing route it opens by itself.
//
// It looks like the app it sits on (theme.ts): the page's background, text,
// typeface, brand colour and the shape of its buttons and fields, read from what
// the page renders. It has no navigation of its own: the app's is always in view.
//
// When a turn resolves to a destination the browser moves at once — never after the answer has
// been read aloud — and the panel stays open beside the new page. When the registry declares steps
// for that screen (WP-27), the panel gives way to a guide that walks the visitor through it,
// highlighting each field.
//
// When the app already has an assistant of its own — a model-backed chat, a guided tour — it is
// merged in rather than competed with (ADR-026, `companion`): what this one cannot place goes to it,
// its answer appears in this conversation under its own name, and one button opens it whole.
//
// It mounts what this project calls the AI interface, rung A1: navigate, explain,
// guide, and "why" — every answer carries a disclosure rendered from its own turn
// record (Rule 9), never model prose. Voice is hands-free once the visitor turns it
// on, and on the device or absent (voice.ts, Rule 8).
//
// Shadow DOM, as the chat box: the host's stylesheet cannot reach in and this
// cannot leak out. Every destination is a real link (Rule 7). The panel is a dialog: focus moves
// in and Escape closes it, returning focus to the orb. Only expanded is it modal, keeping Tab in.

import type { GuidedStep } from '@nextgen/core-capability';
import { isMashing, type TurnTrace } from '@nextgen/core-intent/browser';

import { planAct, taskOf, type ActNode, type ActRoot, type Task } from './act.ts';
import { resolveSteps, type AnchorNode, type AnchorRoot, type ResolvedStep } from './anchor.ts';
import { ACCEPT, checkAttachment, kindOf, LIMITS, offerFiles, safeName, sizeText, thumbnail, type Rejection } from './attach.ts';
import { smalltalkFor } from './chat.ts';
import { commandFor, type Command } from './commands.ts';
import { followUpFor } from './followup.ts';
import { BEAM_CSS, beamVariables, createBeam } from './beam.ts';
import { chooseDockSide, type DockSide } from './dock.ts';
import { createLiquid } from './liquid.ts';
import { adopterNav, navFrame, type FrameRoot, type NavRoot } from './nav.ts';
import { attachmentView, barelyMatched, DECIDE, displayLanguage, fillParams, inLanguage, safeRoute, followUpView, gist, isSamePlace, present, searchChoice, smalltalkView, wordsFor, type Choice, type Decide, type ParamHints, type View, type Words } from './present.ts';
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
import { serverRecognition, serverVoiceEnv, type TranscribeOptions } from './server-voice.ts';
import { adoptStyles, offerMove, type MountOptions, type Routable } from './widget.ts';

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export interface AssistantOptions extends MountOptions {
  /** Force the edge the orb waits on, or find the emptier one. Default `'auto'`. */
  readonly dockSide?: 'auto' | DockSide;
  /**
   * The routes where the assistant opens by itself on arrival. Default `['/']`; `[]` for none.
   * In an app whose `/` is a public page, name the page a signed-in user lands on (`/dashboard`).
   */
  readonly home?: readonly string[];
  /**
   * How far the orb and the panel keep from the screen's bottom corner, in CSS pixels. Default 20 each.
   * Raise `y` to sit above the app's own floating button or account menu.
   */
  readonly inset?: { readonly x?: number; readonly y?: number };
  /** The app's own assistant or tour, merged in rather than competed with (ADR-026). */
  readonly companion?: Companion;
  /**
   * How readily it moves the browser (ADR-027): `'confirm'` asks before every move, `'balanced'` (default)
   * moves when the router decided, `'eager'` also moves when one place is plainly ahead.
   */
  readonly decide?: Decide;
  /**
   * Once there, what it does with the control that starts what was asked (ADR-031): `'open'` (default)
   * presses it when it can only open something and points at it otherwise; `'point'` only points; `'off'`
   * does neither. It never types, and never presses anything that commits, removes or pays.
   */
  readonly act?: 'open' | 'point' | 'off';
  /**
   * The app's own search, for what no screen matches: a path with `{query}` where the words go —
   * `'/search?q={query}'`. Offered first when nothing matched. Must be a path on this app.
   */
  readonly search?: string;
  /**
   * CSS selector for the app's main navigation, when it is not a `<nav>`, `[role="navigation"]` or
   * `<aside>` — a `div` sidebar. Read for places to begin, and left uncovered by the full screen.
   */
  readonly navigation?: string;
  /**
   * What a visitor taught it (ADR-027): every time a question it could not settle was settled by them —
   * a place picked, "neither", or nothing matching at all. Also a `nextgen:learn` event on the window.
   * The page decides whether to keep any of it; `scan.mjs teach` turns a log of them into knowledge.
   */
  readonly onLearn?: (lesson: Lesson) => void;
  /** Where the arrival note survives a full page load. Default `sessionStorage`; `null` keeps nothing. */
  readonly storage?: Store | null;
  /** Where the visitor's own choices live — hands-free listening, answers read aloud. Default `localStorage`. */
  readonly preferences?: Store | null;
  /** Offer voice at all. Default `true`; it only appears where the browser supports it. */
  readonly voice?: boolean;
  /**
   * Offer to attach a photo or a file. Default: on when a `companion` can answer (`companion.ask`),
   * which is where the files go; otherwise off, because a button that goes nowhere is a dead end
   * (ADR-024 addendum, ADR-026). Without a companion, what is attached goes to the page as a
   * `nextgen:attach` event and to nothing else: say `true` once the page listens for it.
   */
  readonly attach?: boolean;
  /** The browser's voice APIs. A seam for tests; the default reads them from the page. */
  readonly voiceEnv?: VoiceEnv | null;
  /**
   * Speech-to-text on the app's own server (ADR-037): `{ path: '/api/transcribe' }`, a path on this site
   * taking an OpenAI-style `/v1/audio/transcriptions` form and answering `{ text }`. What a visitor says is
   * recorded, sent there and nowhere else, and voice then works in every browser — most have no on-device
   * recogniser for most languages. A path on another site is refused. Without it, voice is on-device only.
   * `fetch`: the app's authenticated client, as `stage3Fetch`.
   */
  readonly transcribe?: TranscribeOptions;
}

/** The event a page listens for to learn what visitors taught the assistant (ADR-027). */
export const LEARN_EVENT = 'nextgen:learn';

/** Each routed turn's record, `{ trace }`, for the adopter: why it did what it did (ADR-030, Rule 9). */
export const TURN_EVENT = 'nextgen:turn';

/** Each question handed to the app's own assistant, `CompanionTurn` (ADR-038): the record of a turn no router decided. */
export const COMPANION_EVENT = 'nextgen:companion';

/**
 * One thing a visitor taught the assistant: a question it could not settle, and how it was settled.
 * The visitor's own words — so it goes only to the page, as an event and to `onLearn`, and nowhere
 * else. A log of these is what `scan.mjs teach` reads.
 */
export interface Lesson {
  /** What the visitor asked, as they asked it. */
  readonly question: string;
  /** Where it should have gone: the place they picked. `null` when nothing fitted. */
  readonly route: string | null;
  /** `chose` — they picked a place it offered; `rejected` — "neither"; `unplaced` — nothing matched at all. */
  readonly how: 'chose' | 'rejected' | 'unplaced';
  /** The page they asked from. */
  readonly from: string;
  /** What it offered, in order. */
  readonly offered: readonly string[];
}

/** What the visitor asked, as it is handed to the app's own assistant. */
export interface CompanionRequest {
  readonly text: string;
  /** What they attached. Handed over as it is; this assistant never reads or sends it anywhere else. */
  readonly files: readonly File[];
  /** The page they asked from. */
  readonly route: string;
}

/**
 * The app's own assistant — a model-backed chat, a guided tour — so a visitor meets one entry point,
 * not two, and loses nothing either had (ADR-026). Every member is optional.
 */
export interface Companion {
  /** Its name, as the app calls it: shown under what it answers and on the button that opens it. */
  readonly name?: string;
  /**
   * Answer what this assistant cannot place: a question about the app's data, a question that matches no
   * screen, a topic the registry says is outside the app — and anything the visitor attaches. Resolve to
   * the answer as plain text, or to `null` to leave the turn to this assistant. A declared limit on
   * *acting* (a payment, changing a record) is never handed over: it stays refused.
   */
  ask?(request: CompanionRequest): Promise<string | null | undefined>;
  /**
   * The app's own rule for what its assistant should take (ADR-038): a change it can prepare for this user,
   * a question of fact ("how many goals did we score"). Called before this assistant routes a question at
   * all — no screen scoring, no model — and `true` sends the question to `ask`. Must be cheap and
   * synchronous: it runs on every question typed. Needs `ask`; ignored without it.
   */
  handOver?(text: string, context: { readonly route: string }): boolean;
  /** Open the app's own assistant, whole: its history, its new-chat button, everything it has. */
  open?(): void;
  /**
   * Start the app's own guided tour, for the page the visitor is on — or, with `id`, the one they picked
   * from `tours`. Return `false` when it has none for it.
   */
  tour?(route: string, id?: string): boolean | void;
  /**
   * The tours the app offers the visitor on the page they are on, listed under the panel's Tutorials option
   * to pick from (ADR-033). Also what "tutorial" shows when there is more than one. At most 12 are shown.
   */
  tours?(route: string): readonly CompanionTour[];
  /**
   * CSS selectors for the app's own launchers — its chat button, its tour prompt — hidden while this
   * assistant runs, so there is one entry point. Shown again by `destroy()`.
   */
  readonly hide?: readonly string[];
}

/** One of the app's guided tours, as the Tutorials option lists it. */
export interface CompanionTour {
  /** Handed back to `tour(route, id)` when the visitor picks it. */
  readonly id: string;
  /** Its name, in the page's language: the app translates it. */
  readonly title: string;
  /** One short line under the name — "Completed", "In progress", "New". Optional. */
  readonly note?: string;
}

/** A list, not a catalogue: the Tutorials option shows at most this many of the app's tours. */
const MAX_TOURS = 12;

export interface MountedAssistant {
  readonly host: HTMLElement;
  /** Open the panel. `{ expanded: true }` opens it full screen. */
  open(options?: { readonly expanded?: boolean }): void;
  close(): void;
  /** Ask programmatically; resolves to what was shown. */
  ask(utterance: string): Promise<View | null>;
  /**
   * The app switched language without a reload, and does not say so on `<html lang>`: tell it here
   * (`"en"`, `"pt-PT"`). With no `lang` option, `<html lang>` is followed without being asked.
   */
  setLanguage(lang: string): void;
  /**
   * The app changed page without this assistant moving it — its own navigation — or what its tours say
   * changed (one was finished): read them again. Cheap, and a no-op unless the tours are showing.
   */
  refresh(): void;
  /**
   * The app's own UI needs the corner — its assistant's panel, a confirmation card, a tour (ADR-038). This
   * one closes and hides, orb included, until `comeBack()`. Found in a real browser: the open panel covered
   * the app assistant's composer, so its microphone and send button could not be tapped.
   */
  stepAside(): void;
  /** Show it again after `stepAside()`, open if it was open. */
  comeBack(): void;
  destroy(): void;
}

/** What `nextgen:companion` carries: a question the app's own assistant was asked (ADR-038). */
export interface CompanionTurn {
  readonly utterance: string;
  /** `'rule'`: the app's `handOver` claimed it. `'unplaced'`: this assistant could not place it. */
  readonly handedOverBy: 'rule' | 'unplaced';
  readonly latencyMs: number;
  /** Whether the app's assistant answered it; `false` when it declined, and this assistant answered instead. */
  readonly answered: boolean;
}

/** A question the router could not settle, and what was offered for it: the context of a `Lesson`. */
interface Asked {
  readonly question: string;
  readonly from: string;
  readonly offered: readonly string[];
}

interface Arrival {
  readonly title: string;
  readonly side: DockSide;
  readonly at: number;
  readonly capabilityId: string | null;
  /** What to start there (ADR-031): the question's content words, never the question itself. */
  readonly task?: Task;
}

/** How long a page that is still drawing is given to show the control a task needs (act.ts): ~3 s in all. */
const ACT_RETRIES_MS = [250, 500, 900, 1500];

const STAGE = 320;
/** The canvas is wider than the liquid in it — the glow spills past the slot the layout reserves. */
const STAGE_OVERSCAN = 1.6;
const DOCK = 92;
const EDGE = 20;
/** Below this width a sidebar is a drawer, not a frame: the full-screen panel covers everything. */
const FRAME_MIN_WIDTH = 640;
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
  position: fixed; z-index: 2147483000;
  color-scheme: var(--ng-scheme, dark); color: var(--ng-text, #e6e9ee);
  font: 400 15px/1.5 var(--ng-font, ui-sans-serif, -apple-system, "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif);
  -webkit-font-smoothing: antialiased;
  opacity: 0; visibility: hidden;
  transition: opacity 320ms cubic-bezier(.32,.72,0,1), transform 420ms cubic-bezier(.22,1,.36,1), visibility 0s linear 320ms;
}
.screen[data-open="true"] { opacity: 1; visibility: visible; transition-delay: 0s; }
/* Closed, nothing in it animates: the composer's breathing light would otherwise run all day, unseen. */
.screen[data-open="false"] *, .screen[data-open="false"] *::before, .screen[data-open="false"] *::after { animation-play-state: paused !important; }
/* The panel: a chat in the orb's corner, the page beside it still in view and still usable. */
.screen[data-size="compact"] {
  right: var(--ng-inset-x, 20px); bottom: var(--ng-inset-y, 20px);
  width: min(420px, calc(100vw - 2 * var(--ng-inset-x, 20px)));
  height: min(660px, calc(100vh - 2 * var(--ng-inset-y, 20px)));
  height: min(660px, calc(100dvh - 2 * var(--ng-inset-y, 20px)));
  border-radius: 26px; overflow: hidden; transform-origin: 100% 100%; transform: translateY(14px) scale(.97);
  box-shadow: inset 0 0 0 1px var(--ng-border, rgb(255 255 255 / .1)), 0 16px 40px -18px var(--ng-shadow, rgb(0 0 0 / .6));
}
.screen[data-size="compact"][data-side="left"] { right: auto; left: var(--ng-inset-x, 20px); transform-origin: 0 100%; }
.screen[data-size="compact"][data-open="true"] { transform: none; }
/* Expanded: the whole screen, except the app's own navigation, which stays where it is (navFrame). */
.screen[data-size="full"] { inset: var(--ng-frame-top, 0px) 0 0 var(--ng-frame-left, 0px); }
/* Behind the conversation: the page itself, blurred and veiled in its own background colour. No light
   is thrown on it (ADR-035): it is one more surface of the app. */
.backdrop {
  position: absolute; inset: 0;
  background: var(--ng-veil, rgb(24 28 34 / .72));
  -webkit-backdrop-filter: blur(22px);
  backdrop-filter: blur(22px);
}
.screen[data-size="compact"] .backdrop {
  background: var(--ng-panel, rgb(30 34 41 / .97));
  -webkit-backdrop-filter: blur(28px);
  backdrop-filter: blur(28px);
}
.controls { position: absolute; top: 16px; z-index: 2; display: flex; gap: 4px; }
.screen[data-size="compact"] .controls { top: 10px; gap: 2px; }
.screen[data-size="compact"] .controls .icon { min-width: 44px; min-height: 44px; }
/* The corner controls: plain icon buttons, as the app's own toolbars have. */
.controls .icon { background: transparent; box-shadow: none; }
.controls .icon:hover { background: var(--ng-hover, rgb(255 255 255 / .06)); }
.controls-start { left: 16px; }
.controls-end { right: 16px; }
.screen[data-size="compact"] .controls-start { left: 10px; }
.screen[data-size="compact"] .controls-end { right: 10px; }
.expand[aria-pressed="true"] .glyph-expand, .expand[aria-pressed="false"] .glyph-collapse { display: none; }

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
.screen[data-size="compact"] .stage { gap: 12px; padding: 64px 12px calc(12px + env(safe-area-inset-bottom, 0px)); }
.screen[data-size="compact"][data-conversation="true"] .stage { gap: 6px; padding-top: 12px; }
.screen[data-size="compact"] .slot { width: min(112px, 18vh); }
/* A chat panel's composer lives at its bottom edge, where the eye looks for it — before the first question
   too. The orb and the greeting sit centred in the space above it (ADR-035), not dropped onto it. */
.screen[data-size="compact"][data-conversation="false"] .slot { margin-top: auto; }
.screen[data-size="compact"][data-conversation="false"] .thread { margin-bottom: auto; }
.screen[data-size="compact"][data-conversation="true"] .slot { width: 44px; }
.screen[data-size="compact"][data-conversation="false"] .greeting { font-size: 1.25rem; }
.screen[data-size="compact"] .greeting-hint { font-size: .875rem; }
.caption {
  margin: 6px 0 0; min-height: 1rem; max-width: 36rem; text-align: center;
  font-size: .6875rem; font-weight: 600; letter-spacing: .14em; text-transform: uppercase; color: var(--ng-muted, #848d99);
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
/* Messages are flat fills, not blurred glass: dozens of them scrolling, each with its own backdrop filter,
   would stutter a phone. */
.msg.user .msg-body {
  background: var(--ng-accent-soft, rgb(121 192 206 / .16));
  color: var(--ng-text, #e6e9ee); border-bottom-right-radius: 6px;
}
.msg.assistant .msg-body {
  background: var(--ng-raised, #171b21); border-bottom-left-radius: 6px;
  box-shadow: inset 0 0 0 1px var(--ng-border, rgb(255 255 255 / .1));
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
.dots span { width: 6px; height: 6px; border-radius: 50%; background: var(--ng-muted, #848d99); opacity: .6; animation: nextgen-dot 1.2s ease-in-out infinite both; }
.dots span:nth-child(2) { animation-delay: .15s; }
.dots span:nth-child(3) { animation-delay: .3s; }
@keyframes nextgen-dot { 0%, 60%, 100% { opacity: .3; transform: translateY(0); } 30% { opacity: 1; transform: translateY(-3px); } }

.title { margin: 0; font-size: .9375rem; font-weight: 600; letter-spacing: -.005em; }
.body { margin: 4px 0 0; font-size: .875rem; color: var(--ng-muted, #9aa3af); }
.chips { list-style: none; margin: 12px -8px -6px; padding: 6px 0 0; display: grid; grid-template-columns: minmax(0, 1fr); gap: 2px; border-top: 1px solid var(--ng-border, rgb(255 255 255 / .09)); }
.chips > li { min-width: 0; }
.chip {
  display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 48px; padding: 0 12px;
  border-radius: 12px; color: var(--ng-accent-text, #79c0ce); font-weight: 500; text-decoration: none;
  transition: background-color 160ms ease;
}
.chip::after { content: "→"; content: "→" / ""; color: var(--ng-muted, #848d99); transition: transform 180ms ease, color 180ms ease; }
.chip:hover { background: var(--ng-hover, rgb(255 255 255 / .06)); }
.chip:hover::after { transform: translateX(3px); color: var(--ng-accent, #79c0ce); }

/* The likely one: a card of its own, above the alternatives. */
.chip.lead {
  flex-direction: column; align-items: stretch; justify-content: flex-start; gap: 3px; min-height: 0;
  margin: 12px 0 0; padding: 12px 14px; border-radius: 14px;
  background: var(--ng-accent-soft, rgb(121 192 206 / .16));
  box-shadow: inset 1px 1px 0 var(--ng-edge-hi, rgb(255 255 255 / .26)), inset 0 0 0 1px var(--ng-accent-line, rgb(121 192 206 / .28)), 0 10px 26px -16px var(--ng-glow, rgb(121 192 206 / .5));
  transition: box-shadow 160ms ease, background-color 160ms ease;
}
.chip.lead::after { content: none; }
.chip.lead:hover { box-shadow: inset 1px 1px 0 var(--ng-edge-hi, rgb(255 255 255 / .26)), inset 0 0 0 1px var(--ng-accent, #79c0ce), 0 12px 30px -14px var(--ng-glow, rgb(121 192 206 / .5)); }
.lead-label { display: flex; align-items: center; justify-content: space-between; gap: 12px; font-weight: 600; }
.lead-label::after { content: "→"; content: "→" / ""; transition: transform 180ms ease; }
.chip.lead:hover .lead-label::after { transform: translateX(3px); }
.lead-detail { font-size: .8125rem; font-weight: 400; color: var(--ng-muted, #9aa3af); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
/* Any other place that says what it is for: the same two lines, quieter. */
.chip.card {
  flex-direction: column; align-items: stretch; justify-content: flex-start; gap: 3px; min-height: 0; padding: 10px 12px;
  box-shadow: inset 1px 1px 0 var(--ng-edge-lo, rgb(255 255 255 / .04));
}
.chip.card:hover { box-shadow: inset 1px 1px 0 var(--ng-edge-hi, rgb(255 255 255 / .26)); }
.chip.card::after { content: none; }
.chip.card:hover .lead-label::after { transform: translateX(3px); }
/* What became of an attachment. */
.hint { margin: 14px 0 0; font-size: .75rem; color: var(--ng-muted, #848d99); }

/* Beneath an answer only what a visitor is owed: who wrote it, when it was not this assistant. */
.msg-tools { display: flex; flex-wrap: wrap; align-items: center; gap: 0 2px; margin: 6px -10px -8px; }
.tool {
  display: inline-flex; align-items: center; min-height: 44px; margin: 0; padding: 0 12px; border: 0; border-radius: 12px; background: transparent;
  color: var(--ng-muted, #9aa3af); font: inherit; font-size: .75rem; cursor: pointer;
  transition: background-color 160ms ease, color 160ms ease;
}
.tool:hover { color: var(--ng-text, #e6e9ee); background: var(--ng-hover, rgb(255 255 255 / .06)); }

.composer {
  width: min(720px, 100%); display: flex; align-items: center; gap: 2px; margin: 6px 0 0;
  /* Round, whatever the page's own fields are (ADR-035 addendum): a chat box reads as one. */
  padding: 4px; border-radius: 999px;
  background: var(--ng-field, #1b2027);
  box-shadow: inset 0 0 0 1px var(--ng-border, rgb(255 255 255 / .1));
  transition: box-shadow 200ms ease;
}
.composer:focus-within {
  /* A focused field, as the app shows one: its accent as the border, no halo (ADR-035). */
  box-shadow: inset 0 0 0 1px var(--ng-accent, #79c0ce);
}
.composer input {
  flex: 1; min-width: 0; min-height: 48px; margin: 0; padding: 0 8px 0 18px; border: 0; outline: 0;
  background: transparent; color: var(--ng-text, #e6e9ee); font: inherit; font-size: 1rem;
}
.composer input::placeholder { color: var(--ng-muted, #848d99); }

/* What is waiting to be sent, above the box: small glass chips, each with its own way out. */
.tray {
  list-style: none; margin: 0; padding: 2px; width: min(720px, 100%);
  display: flex; gap: 8px; overflow-x: auto; overscroll-behavior: contain; scrollbar-width: none;
}
.tray::-webkit-scrollbar { display: none; }
.attach-item {
  flex: none; display: flex; align-items: center; gap: 10px; max-width: 250px; padding: 6px 2px 6px 6px; border-radius: 18px;
  background: var(--ng-glass-strong, rgb(23 27 33 / .82));
  -webkit-backdrop-filter: blur(16px); backdrop-filter: blur(16px);
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
.attach-size { font-size: .6875rem; color: var(--ng-muted, #848d99); }
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
/* The primary actions are the host's accent, filled — shaded only faintly, with no bright rim and no sweep of
   light, so they read as the app's own buttons (ADR-034). */
.send .glyph,
.mic[aria-pressed="true"] .glyph,
.pill.primary {
  color: var(--ng-on-accent, #07171b); border: 1px solid transparent; overflow: hidden;
  background:
    linear-gradient(180deg, var(--ng-metal-hi, #86c6d3), var(--ng-metal-lo, #6fb2bf)) padding-box;
  box-shadow: 0 1px 2px var(--ng-shadow, rgb(0 0 0 / .3));
}
.send .glyph, .mic[aria-pressed="true"] .glyph { width: 38px; height: 38px; border-radius: 50%; }
/* Inside the round box, its buttons are round too. */
.composer .icon { border-radius: 999px; }
.send:hover, .mic[aria-pressed="true"]:hover { background: transparent; }
.sound[aria-pressed="false"] .glyph::after {
  content: ''; position: absolute; left: 50%; top: 50%; width: 24px; height: 2px; margin: -1px 0 0 -12px;
  border-radius: 1px; background: currentColor; transform: rotate(-45deg);
}

:focus-visible { outline: 2px solid var(--ng-accent, #79c0ce); outline-offset: 2px; }

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

.guide {
  position: fixed; z-index: 2147483001; margin: 0;
  background: var(--ng-glass-strong, rgb(23 27 33 / .82)); color: var(--ng-text, #e6e9ee);
  -webkit-backdrop-filter: blur(20px); backdrop-filter: blur(20px);
  box-shadow: inset 1px 1px 0 var(--ng-edge-hi, rgb(255 255 255 / .26)), inset -1px -1px 0 var(--ng-edge-lo, rgb(255 255 255 / .04)), 0 18px 44px -14px var(--ng-shadow, rgb(0 0 0 / .65));
  font: 500 14px/1.4 var(--ng-font, ui-sans-serif, -apple-system, "Segoe UI", system-ui, sans-serif);
}

.guide { bottom: calc(var(--ng-inset-y, 20px) + 104px); width: min(340px, calc(100vw - 40px)); padding: 16px; border-radius: 18px; }
.guide[data-side="right"] { right: var(--ng-inset-x, 20px); }
.guide[data-side="left"]  { left: var(--ng-inset-x, 20px); }
/* Where an answer came from, when the app's own assistant wrote it (ADR-026). */
.from { order: 2; margin: 0 12px; font-size: .75rem; color: var(--ng-muted, #848d99); }
.msg[data-tone="answer"] .body { margin: 0; font-size: .9375rem; color: var(--ng-text, #e6e9ee); white-space: pre-line; }
.guide-title { margin: 0; font-weight: 600; }
.guide-count { margin: 2px 0 8px; font-size: .6875rem; font-weight: 600; letter-spacing: .12em; text-transform: uppercase; color: var(--ng-muted, #848d99); }
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

/* The panel's options (ADR-033): the app's assistant and its tours, named, just above the composer. */
/* The panel's two views (ADR-035): a segmented switch just above the composer, always one tap back. */
.tabs {
  width: min(720px, 100%); display: flex; gap: 4px; margin: 8px 0 0; padding: 4px;
  border-radius: 14px; background: var(--ng-hover, rgb(255 255 255 / .06));
}
.tabs[hidden] { display: none; }
.tab {
  flex: 1 1 0; display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-height: 44px;
  margin: 0; padding: 0 12px; border: 0; border-radius: 10px; background: transparent; color: var(--ng-muted, #9aa3af);
  font: inherit; font-size: .8125rem; font-weight: 500; cursor: pointer; transition: background-color 160ms ease, color 160ms ease;
}
.tab .glyph { display: inline-flex; }
.tab .glyph svg { width: 16px; height: 16px; }
.tab:hover { color: var(--ng-text, #e6e9ee); }
.tab[aria-selected="true"] {
  background: var(--ng-raised, #171b21); color: var(--ng-text, #e6e9ee);
  box-shadow: inset 0 0 0 1px var(--ng-border, rgb(255 255 255 / .1));
}
.tab[aria-selected="true"] .glyph { color: var(--ng-accent-text, #79c0ce); }

/* The tours: the page's own, in the space the conversation has, and scrolling like it. */
.tours-view {
  flex: 1 1 auto; min-height: 0; width: min(720px, 100%); overflow-y: auto; overscroll-behavior: contain;
  padding: 12px 2px 4px; scrollbar-width: thin; scrollbar-color: var(--ng-border, rgb(255 255 255 / .16)) transparent;
}
.tours-view[hidden], .tours-where[hidden], .tours-list[hidden], .tours-empty[hidden] { display: none; }
.screen[data-view="tours"] .thread, .screen[data-view="tours"] .caption { display: none; }
.tours-heading { margin: 0 4px; font-size: 1rem; font-weight: 600; }
.tours-where { margin: 2px 4px 0; font-size: .8125rem; color: var(--ng-muted, #9aa3af); }
.tours-list { list-style: none; margin: 14px 0 0; padding: 0; display: grid; gap: 8px; }
.tour-item {
  width: 100%; display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 2px 12px;
  min-height: 56px; margin: 0; padding: 10px 14px; border: 0; border-radius: 12px; cursor: pointer; text-align: start;
  background: var(--ng-raised, #171b21); color: var(--ng-text, #e6e9ee); font: inherit;
  box-shadow: inset 0 0 0 1px var(--ng-border, rgb(255 255 255 / .1)); transition: background-color 160ms ease, box-shadow 160ms ease;
}
.tour-item:hover { background: var(--ng-hover-strong, #20262e); box-shadow: inset 0 0 0 1px var(--ng-accent-line, rgb(121 192 206 / .34)); }
.tour-name { grid-column: 1; font-size: .9375rem; font-weight: 600; overflow-wrap: anywhere; }
.tour-note { grid-column: 1; font-size: .75rem; color: var(--ng-muted, #9aa3af); }
.tour-go { grid-column: 2; grid-row: 1 / span 2; color: var(--ng-accent-text, #79c0ce); transition: transform 180ms ease; }
.tour-item:hover .tour-go { transform: translateX(3px); }
.tours-empty { margin: 28px 12px 0; text-align: center; font-size: .875rem; color: var(--ng-muted, #9aa3af); }

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
  .composer, .guide, .controls .icon, .pill, .tab[aria-selected="true"], .msg.assistant .msg-body { background: var(--ng-raised, #171b21); }
  .backdrop, .screen[data-size="compact"] .backdrop { background: var(--ng-backdrop, rgb(8 9 12)); }
}
/* A phone: four buttons and a box in one row must still be four 44px targets and a box you can type in.
   The panel is a sheet across the bottom: a 420px card in a 390px screen would only be clipped. */
@media (max-width: 480px) {
  .screen[data-size="compact"], .screen[data-size="compact"][data-side="left"] {
    left: 8px; right: 8px; bottom: 8px; width: auto; height: min(86vh, 660px); height: min(86dvh, 660px);
  }
  .composer { gap: 0; }
  .composer .icon { min-width: 44px; min-height: 44px; }
  .composer input { padding: 0 6px 0 14px; }
  .attach-name { max-width: 96px; }
}
@media (prefers-reduced-transparency: reduce) {
  .attach-item { background: var(--ng-raised, #171b21); -webkit-backdrop-filter: none; backdrop-filter: none; }
  .composer, .guide, .controls .icon, .pill, .tab[aria-selected="true"], .msg.assistant .msg-body { background: var(--ng-raised, #171b21); -webkit-backdrop-filter: none; backdrop-filter: none; }
  .backdrop, .screen[data-size="compact"] .backdrop { background: var(--ng-backdrop, rgb(8 9 12)); -webkit-backdrop-filter: none; backdrop-filter: none; }
}
@media (forced-colors: active) {
  .backdrop, .screen[data-size="compact"] .backdrop { background: Canvas; -webkit-backdrop-filter: none; backdrop-filter: none; }
  .screen[data-size="compact"] { border: 1px solid CanvasText; }
  .composer, .msg-body, .guide, .pill, .tab, .tour-item, .controls .icon, .attach-item { background: Canvas; color: CanvasText; border: 1px solid CanvasText; box-shadow: none; -webkit-backdrop-filter: none; backdrop-filter: none; }
  .chip, .chip.lead, .chip.card { color: LinkText; box-shadow: none; }
    .send .glyph, .mic[aria-pressed="true"] .glyph, .pill.primary { background: Highlight; color: HighlightText; box-shadow: none; }
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
const ICON_EXPAND = svg('<path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7"/>');
const ICON_COLLAPSE = svg('<path d="M20 10h-6V4M4 14h6v6M14 10l7-7M10 14l-7 7"/>');
const ICON_CHAT = svg('<path d="M5 5h14v10H9l-4 4z"/><path d="M9 9.5h6M9 12h4"/>');
const ICON_TOUR = svg('<path d="M6 21V4"/><path d="M6 4h11l-2.5 4.5L17 13H6"/>');
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
  // One language on screen, the page's (ADR-030): the assistant's words and the app's, both in it. An
  // adopter's `lang` wins; otherwise `<html lang>`, followed as it changes (`setLanguage`, below).
  let pageLang = options.lang ?? doc.documentElement?.getAttribute('lang');
  let shownIn = displayLanguage(pageLang, assistant.registry);
  let words: Words = { ...wordsFor(shownIn), ...options.words };
  /** The registry as the visitor reads it: its names and descriptions in `shownIn`. The router keeps its own. */
  let seen = inLanguage(assistant.registry, shownIn);
  // What the page knows that its URL may not say: the locale an i18n router prefixes routes with, for the
  // pages of its default language (`localePrefix: 'as-needed'`). Only ever a fallback (fillParams).
  let hints: ParamHints = { locale: pageLang ?? undefined };
  let lang = speechLang(shownIn);
  const currentPath = options.currentPath ?? (() => view?.location.pathname ?? '/');
  /**
   * Move the browser: the adopter's router, else the page if it takes `nextgen:navigate`
   * (a strict Content-Security-Policy leaves a script-tag page no other way to pass one),
   * else `location.assign`. True when the move happened without unloading this page.
   */
  const go = (route: string): boolean => {
    // The last gate before the browser moves: only a path on this site (present.ts `safeRoute`).
    if (!safeRoute(route)) return true;
    if (options.navigate) {
      options.navigate(route);
      if (viewing === 'tours') later(renderTours, 0);
      return true;
    }
    if (view && offerMove(view, route)) return true;
    view?.location.assign(route);
    return false;
  };
  const storage = options.storage !== undefined ? options.storage : browserStore(view, 'sessionStorage');
  const preferences = options.preferences !== undefined ? options.preferences : browserStore(view, 'localStorage');
  const homes = (options.home ?? ['/']).filter((route) => safeRoute(route) !== null);
  const insetX = Math.max(0, options.inset?.x ?? EDGE);
  const insetY = Math.max(0, options.inset?.y ?? EDGE);
  const companion = options.companion ?? null;
  const companionName = companion?.name?.trim() || words.companion;
  const decide: Decide = options.decide && DECIDE.includes(options.decide) ? options.decide : 'balanced';
  const acting = options.act === 'point' || options.act === 'off' ? options.act : 'open';
  const navigation = options.navigation?.trim() || null;
  const reducedMotion = Boolean(view?.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
  const pageVoice = options.voice === false ? null : options.voiceEnv !== undefined ? options.voiceEnv : view ? voiceEnv(view) : null;
  // The app's own speech-to-text (ADR-037): where the browser has no on-device recogniser — most browsers,
  // for most languages — what is said goes to this site's endpoint, and never to a speech vendor.
  const serverRecogniser = pageVoice && options.transcribe && view ? serverRecognition(options.transcribe, serverVoiceEnv(view)) : null;
  const env = pageVoice && serverRecogniser ? { ...pageVoice, Recognition: serverRecogniser } : pageVoice;
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
  /** One of the panel's two views, as a tab: an icon and a visible name (ADR-035). */
  const tabButton = (name: string, text: string, icon: string): HTMLButtonElement => {
    const button = make('button', `tab ${name}`);
    button.type = 'button';
    button.id = `nextgen-tab-${name}`;
    button.setAttribute('role', 'tab');
    const label = make('span', 'tab-label');
    label.textContent = text;
    button.append(glyph(icon), label);
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
  // A panel beside the page is not modal; expanded, it is (`setExpanded`).
  screen.setAttribute('aria-modal', 'false');
  screen.setAttribute('aria-labelledby', 'nextgen-greeting');
  screen.setAttribute('aria-describedby', 'nextgen-greeting-hint');
  screen.setAttribute('inert', '');
  screen.dataset.open = 'false';
  screen.dataset.size = 'compact';
  const backdrop = make('div', 'backdrop');

  // No navigation of our own: the app's is always in view beside the panel, and beside it expanded.
  const startControls = make('div', 'controls controls-start');
  const expandButton = make('button', 'icon expand');
  expandButton.type = 'button';
  const expandLabel = make('span', 'sr-only');
  expandLabel.textContent = words.expand;
  const expandGlyph = glyph(ICON_EXPAND);
  expandGlyph.className = 'glyph glyph-expand';
  const collapseGlyph = glyph(ICON_COLLAPSE);
  collapseGlyph.className = 'glyph glyph-collapse';
  expandButton.append(expandLabel, expandGlyph, collapseGlyph);
  expandButton.setAttribute('aria-pressed', 'false');
  startControls.append(expandButton);
  // The app's own assistant, whole — its history, its new chat, whatever else it has (ADR-026).
  const companionButton = iconButton('companion', words.openCompanion(companionName), ICON_CHAT);
  companionButton.hidden = typeof companion?.open !== 'function';
  startControls.append(companionButton);
  // Two views of one panel (ADR-035): the conversation, and the app's tours for the page the visitor is on.
  // Tabs, so the way back to the conversation is always one tap away, and the conversation is kept meanwhile.
  const viewTabs = make('div', 'tabs');
  viewTabs.setAttribute('role', 'tablist');
  viewTabs.setAttribute('aria-label', words.views);
  const chatTab = tabButton('chat', words.chat, ICON_CHAT);
  chatTab.setAttribute('aria-controls', 'nextgen-thread');
  const toursTab = tabButton('tours', words.tutorials, ICON_TOUR);
  toursTab.setAttribute('aria-controls', 'nextgen-tours');
  viewTabs.append(chatTab, toursTab);
  viewTabs.hidden = typeof companion?.tours !== 'function';
  // The tours view: what this page offers, read again whenever the page changes (`renderTours`).
  const toursView = make('section', 'tours-view');
  toursView.id = 'nextgen-tours';
  toursView.setAttribute('role', 'tabpanel');
  toursView.setAttribute('aria-labelledby', 'nextgen-tab-tours');
  toursView.hidden = true;
  const toursHeading = make('h3', 'tours-heading');
  const toursWhere = make('p', 'tours-where');
  const toursList = make('ul', 'tours-list');
  const toursEmpty = make('p', 'tours-empty');
  toursView.append(toursHeading, toursWhere, toursList, toursEmpty);
  const endControls = make('div', 'controls controls-end');
  const soundButton = iconButton('sound', words.readAloud, ICON_SOUND);
  soundButton.hidden = !canSpeak;
  const closeButton = iconButton('close', words.close, ICON_CLOSE);
  // Always there: a visitor who wants a clean slate should not have to find out when one is offered.
  const restartButton = iconButton('restart', words.startOver, ICON_RESTART);
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
  thread.id = 'nextgen-thread';
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
  // A question, not a document (index.ts `MAX_QUESTION`): the box stops where the router would.
  input.maxLength = 500;
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
  // Somewhere for a file to go: the page said it takes one, or the app's own assistant can answer about it.
  const canAttach = options.attach ?? typeof companion?.ask === 'function';
  const coarse = Boolean(view?.matchMedia?.('(pointer: coarse)').matches);
  attachButton.hidden = !canAttach;
  cameraButton.hidden = !canAttach || !coarse;
  // The box shares its row with four buttons in a narrow panel: ask in fewer words rather than be clipped.
  // Expanded, there is room for the whole sentence (`setExpanded`).
  input.placeholder = words.composerShort;
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
  stage.append(slot, caption, thread, toursView, tray, viewTabs, form);

  screen.append(backdrop, startControls, endControls, stage);

  const orb = make('button', 'orb');
  orb.type = 'button';
  orb.setAttribute('aria-label', words.openAssistant);
  orb.setAttribute('aria-expanded', 'false');
  orb.dataset.ready = 'false';
  const canvas = make('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  orb.append(canvas);

  // What the docked orb says — "You are on Calendar" after a full page load — is for a screen reader
  // only. Nothing is written beside the orb: the orb's glow is the sign on screen.
  const bubble = make('p', 'bubble sr-only');
  bubble.setAttribute('role', 'status');
  bubble.setAttribute('aria-live', 'polite');

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
  host.style.setProperty('--ng-inset-x', `${insetX}px`);
  host.style.setProperty('--ng-inset-y', `${insetY}px`);

  // The app's own launchers, while this one runs: one entry point, not two (ADR-026). A constructed sheet
  // on the page, so it also covers a launcher the app renders later, and survives a strict `style-src`;
  // only well-formed selectors are kept, so one typo cannot hide the whole page or throw.
  const hidden = (companion?.hide ?? []).filter((selector) => {
    // A selector, and nothing a stylesheet would read as more than one: a brace, a semicolon, an at-rule
    // or a comment would let one entry write any CSS into the adopter's page (ADR-029).
    if (typeof selector !== 'string' || selector.trim() === '' || selector.length > 200 || /[{};@<]|\/\*|\\/.test(selector)) return false;
    try {
      if (typeof doc.querySelector === 'function') doc.querySelector(selector);
      return true;
    } catch {
      return false;
    }
  });
  let hideSheet: CSSStyleSheet | null = null;
  let hideStyle: HTMLStyleElement | null = null;
  if (hidden.length > 0) {
    const rule = `${hidden.join(', ')} { display: none !important; }`;
    const Sheet = view?.CSSStyleSheet;
    if (Sheet && 'adoptedStyleSheets' in doc && typeof Sheet.prototype.replaceSync === 'function') {
      hideSheet = new Sheet();
      hideSheet.replaceSync(rule);
      doc.adoptedStyleSheets = [...doc.adoptedStyleSheets, hideSheet];
    } else if (doc.head) {
      hideStyle = make('style');
      hideStyle.textContent = rule;
      doc.head.append(hideStyle);
    }
  }

  // ------------------------------------------------------------------ state --

  let mode: 'docked' | 'stage' = 'docked';
  /** The panel fills the screen (all but the app's own navigation) rather than its corner. */
  let expanded = false;
  let side: DockSide = 'right';
  let latest = 0;
  let busyTurn = 0;
  let busy = false;
  let savedOverflow: string | null = null;
  let handsFree = canListen && readChoice(HANDS_FREE_KEY, false);
  // Silent until asked: a navigation aid that talks unbidden is a surprise in an office or a physio room.
  // Hands-free conversation is spoken whatever this says (`aloud`): that visitor has asked for voice.
  let readAloud = readChoice(READ_ALOUD_KEY, false);
  let conversation: Conversation | null = null;
  let startingConversation = false;
  let toldToType = false;
  let speaking: Speaking | null = null;
  let transcription: Transcription = 'unavailable';
  let detection: Promise<Transcription> | null = null;
  let lastSaid = '';
  /** What the last answer offered, so "yes" or "the second one" can be read as a reply to it (followup.ts). */
  let offered: { readonly choices: readonly Choice[]; readonly probable: boolean; readonly asked: Asked | null } | null = null;
  /**
   * The last question the router could not settle — it asked instead — so a short reply that adds a
   * detail ("in training", "the injury one") can be read together with it.
   */
  let unsettled: string | null = null;
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
      x = side === 'right' ? w - insetX - DOCK / 2 : insetX + DOCK / 2;
      y = h - insetY - DOCK / 2;
    }
    orb.style.setProperty('--x', `${(x - size / 2).toFixed(1)}px`);
    orb.style.setProperty('--y', `${(y - size / 2).toFixed(1)}px`);
    orb.style.setProperty('--s', (size / STAGE).toFixed(4));
    // Drawn at the size it is shown: docked, a twelfth of the pixels (liquid.ts `setResolution`).
    liquid.setResolution(size);
    orb.dataset.mode = mode;
    orb.dataset.side = side;
    screen.dataset.side = side;
    guidePanel.dataset.side = side;
  }

  /**
   * Expanded, the panel leaves the app's own navigation in view (nav.ts `navFrame`): a sidebar on the
   * left, a bar across the top. Measured each time it expands — a sidebar can collapse — and never on a
   * narrow screen, where a sidebar is a drawer and the whole screen is the better panel.
   */
  function frame(): void {
    const narrow = !view || view.innerWidth < FRAME_MIN_WIDTH;
    const found = narrow
      ? { left: 0, top: 0 }
      : navFrame(doc as unknown as FrameRoot, { innerWidth: view.innerWidth, innerHeight: view.innerHeight }, host, navigation);
    screen.style.setProperty('--ng-frame-left', `${found.left}px`);
    screen.style.setProperty('--ng-frame-top', `${found.top}px`);
  }

  /** Corner panel or full screen. Full screen is modal: the page underneath cannot be reached. */
  function setExpanded(value: boolean): void {
    expanded = value;
    if (expanded) frame();
    screen.dataset.size = expanded ? 'full' : 'compact';
    screen.setAttribute('aria-modal', String(expanded));
    expandButton.setAttribute('aria-pressed', String(expanded));
    expandLabel.textContent = expanded ? words.collapse : words.expand;
    // The panel's box is narrow: ask in fewer words rather than be clipped mid-sentence.
    input.placeholder = expanded && !(coarse && canAttach) ? words.composer : words.composerShort;
    lockScroll(expanded && mode === 'stage');
    place();
    // Placed again once the layout has settled, as when it opens.
    later(() => {
      if (mode === 'stage') place();
    }, 30);
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
    return seen.capabilities.find(
      (c) => c.kind !== 'unsupported' && fillParams(c.route, here, patterns, hints) === path,
    );
  }

  /** Tell the page what a visitor taught (ADR-027): to `onLearn`, and as `nextgen:learn`. Never elsewhere. */
  function learn(lesson: Lesson): void {
    try {
      options.onLearn?.(lesson);
    } catch {
      // the page's handler failing is not the visitor's problem
    }
    const Event = view?.CustomEvent;
    if (view && typeof Event === 'function') {
      try {
        view.dispatchEvent(new Event<Lesson>(LEARN_EVENT, { detail: lesson }));
      } catch {
        // no event target: nothing to tell
      }
    }
  }

  /**
   * `asked`: the question this link answers, when it is one the router could not settle. Following it
   * is the visitor settling it — a lesson (`learn`). A new tab counts: it is still their pick.
   */
  function link(choice: Choice, className: string, asked: Asked | null = null): HTMLAnchorElement {
    const a = make('a', className);
    // Only a path on this site becomes an href (answers are filtered before this; this is the backstop).
    a.href = safeRoute(choice.route) ?? '#';
    a.textContent = choice.label;
    a.addEventListener('click', (event) => {
      const e = event as MouseEvent;
      if (asked && !e.defaultPrevented) learn({ question: asked.question, route: choice.route, how: 'chose', from: asked.from, offered: asked.offered });
      // A modified click keeps its ordinary meaning: a new tab, a new window.
      if (e.defaultPrevented || e.button > 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      const capability = capabilityAt(choice.route);
      const title = capability?.title ?? choice.label;
      // What the question asked to start comes along: the place was chosen for it (ADR-031).
      const task = asked ? taskFor(asked.question, capability?.id, title) : null;
      // Already there: the page is right behind the screen.
      if (isSamePlace(choice.route, currentPath())) {
        if (task && perform(task, capability?.id ?? null)) return;
        return dock(true);
      }
      void travel(choice.route, title, capability?.id ?? null, task);
    });
    return a;
  }

  /** A link that also says what is behind it, in the adopter's own words. Still an ordinary link. */
  function card(choice: Choice, className: string, label: string = choice.label, asked: Asked | null = null): HTMLAnchorElement {
    const a = link(choice, className, asked);
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

  function listItems(links: readonly HTMLElement[]): HTMLLIElement[] {
    return links.map((a) => {
      const li = make('li');
      li.append(a);
      return li;
    });
  }

  /**
   * Why it did what it did — for the adopter, not the visitor (ADR-030). Rule 9 still holds: every routed
   * turn has its record, and "why" is answered from it, never from a model narrating itself. What changed
   * is who reads it. The visitor wanted the answer, not its mechanics, so the record goes to the page as
   * `nextgen:turn` — `decidedAt`, the candidates and their scores, what the validator removed — where the
   * adopter can log it, inspect it, or build their own "why". Nothing reaches the page it did not have:
   * the question is what the visitor typed into it.
   */
  function record(trace: TurnTrace): void {
    if (!view) return;
    try {
      view.dispatchEvent(new (view as Window & typeof globalThis).CustomEvent(TURN_EVENT, { detail: { trace } }));
    } catch {
      // a page that cannot take the event loses nothing the visitor sees
    }
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

  /** `asked`: the question this answer offers places for, when the router could not settle it — a tap on one is a lesson. */
  function showAnswer(shown: View, trace: TurnTrace | null, asked: Asked | null = null): void {
    dropTyping();
    const nodes: HTMLElement[] = [];
    // An answer from the app's own assistant is all body: its words, as it wrote them, as plain text.
    if (shown.title) {
      const title = make('p', 'title');
      title.textContent = shown.title;
      nodes.push(title);
    }
    if (shown.body) {
      const body = make('p', 'body');
      body.textContent = shown.body;
      nodes.push(body);
    }
    const stops: HTMLElement[] = [];
    const [first, ...rest] = shown.choices;
    // The likely one is offered as a card of its own — what it is, and what it is for. It is still an
    // ordinary link: a tap takes it, and so does "yes" (followup.ts); nothing else does.
    if (shown.probable && first) {
      const lead = card(first, 'chip lead', words.open(first.label), asked);
      stops.push(lead);
      nodes.push(lead);
    }
    // A place that says what it is for is a card, so someone who has never seen the app can tell two
    // names apart; one that does not is a plain link, and nothing is invented for it.
    const alternatives = (shown.probable ? rest : shown.choices).map((c) => (c.detail ? card(c, 'chip card', c.label, asked) : link(c, 'chip', asked)));
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
    // A refusal that points nowhere still ends with a way on: never a dead end. One short line — and it
    // is the only hint left (ADR-030): no "not what you meant?", no "why?".
    if (shown.tone === 'limit' && shown.choices.length === 0 && shown.body !== words.limitFallback) {
      const hint = make('p', 'hint');
      hint.textContent = words.limitNext;
      nodes.push(hint);
    }
    const tools = make('div', 'msg-tools');
    // Words someone else's assistant wrote may be worth keeping; "Opening Calendar" is not.
    if (canCopy && shown.from) {
      const copy = make('button', 'tool copy');
      copy.type = 'button';
      copy.textContent = words.copy;
      const text = [shown.title, shown.body].filter(Boolean).join('\n');
      copy.addEventListener('click', () => void copyText(text));
      tools.append(copy);
      stops.push(copy);
    }
    // This assistant did not decide it, and cannot explain it (Rule 9). It says who did.
    if (shown.from) {
      const from = make('p', 'from');
      from.textContent = words.answeredBy(shown.from);
      tools.append(from);
    }
    // A model decided or wrote it: the visitor is told, in one line (ADR-017).
    if (trace && (trace.decidedAt === 'llm' || trace.prose)) {
      const from = make('p', 'from');
      from.textContent = words.byModel;
      tools.append(from);
    }
    if (tools.children.length > 0) nodes.push(tools);
    if (trace) record(trace);
    threadStops.push(...stops);
    addMessage('assistant', '', nodes).dataset.tone = shown.tone;
  }

  /** The app's tours for the page the visitor is on, as it lists them; nothing when it cannot say. */
  function toursHere(): CompanionTour[] {
    if (typeof companion?.tours !== 'function') return [];
    try {
      const listed = companion.tours(currentPath());
      if (!Array.isArray(listed)) return [];
      return listed
        .filter((t): t is CompanionTour => typeof t?.id === 'string' && t.id !== '' && typeof t.title === 'string' && t.title.trim() !== '')
        .slice(0, MAX_TOURS);
    } catch {
      return [];
    }
  }

  // ------------------------------------------------------------------ views --

  /** Which of the panel's two views is showing (ADR-035). The conversation is kept while tours show. */
  let viewing: 'chat' | 'tours' = 'chat';
  /** The tour buttons now in the tours view, for the keyboard. */
  let tourStops: HTMLElement[] = [];

  /** A tour, as a row to press: its name, where the visitor left it, and an arrow. It starts it. */
  function tourButton(tour: CompanionTour): HTMLButtonElement {
    const button = make('button', 'tour-item');
    button.type = 'button';
    button.dataset.tour = tour.id;
    const name = make('span', 'tour-name');
    name.textContent = tour.title;
    button.append(name);
    if (tour.note?.trim()) {
      const note = make('span', 'tour-note');
      note.textContent = tour.note.trim();
      button.append(note);
    }
    const go = make('span', 'tour-go');
    go.setAttribute('aria-hidden', 'true');
    go.textContent = '→';
    button.append(go);
    button.addEventListener('click', () => {
      dock(false);
      if (companion?.tour?.(currentPath(), tour.id) === false) notice(words.noTours);
    });
    return button;
  }

  /**
   * The tours view, for the page the visitor is on now. Read again on every call — the page may have
   * changed since (`refresh`), and so may where they left each tour. A button that had focus keeps it.
   */
  function renderTours(): void {
    const focused = root.activeElement as HTMLElement | null;
    const hadFocus = focused ? toursList.contains(focused) : false;
    const focusedTour = hadFocus ? focused?.dataset.tour : undefined;
    const tours = toursHere();
    const page = capabilityAt(currentPath());
    toursHeading.textContent = words.toursTitle;
    toursWhere.textContent = page ? words.toursOn(page.title) : '';
    toursWhere.hidden = !page;
    tourStops = tours.map(tourButton);
    toursList.replaceChildren(...listItems(tourStops));
    toursList.hidden = tourStops.length === 0;
    toursEmpty.textContent = words.noTours;
    toursEmpty.hidden = tourStops.length > 0;
    if (hadFocus) (tourStops.find((b) => b.dataset.tour === focusedTour) ?? tourStops[0] ?? toursTab).focus();
  }

  /** Where the keyboard starts in the view showing: the first tour, or the composer. */
  function viewStart(): HTMLElement {
    return viewing === 'tours' ? (tourStops[0] ?? toursTab) : input;
  }

  /**
   * Show the conversation or the tours. The tours take the conversation's layout — the orb small at the
   * top — and going back restores whichever the conversation had: the greeting, or the thread.
   */
  function setView(next: 'chat' | 'tours', moveFocus = true): void {
    if (next === 'tours' && viewTabs.hidden) return;
    viewing = next;
    screen.dataset.view = next;
    for (const [tab, on] of [[chatTab, next === 'chat'], [toursTab, next === 'tours']] as const) {
      tab.setAttribute('aria-selected', String(on));
      tab.tabIndex = on ? 0 : -1;
    }
    toursView.hidden = next !== 'tours';
    if (next === 'tours') renderTours();
    screen.dataset.conversation = next === 'tours' || thread.children.length > 1 ? 'true' : 'false';
    place();
    if (moveFocus) viewStart().focus();
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
    if (viewing === 'tours') setView('chat', false);
    thread.removeAttribute('aria-busy');
    setCaption('');
    input.value = '';
    clearAttached();
    asked.length = 0;
    recalling = -1;
    offered = null;
    unsettled = null;
    screen.dataset.conversation = 'false';
    liquid.setState('idle');
    liquid.setLevel(0);
    place();
    input.focus();
  }

  /** What was asked this session, for the arrow keys. */
  const asked: string[] = [];
  let recalling = -1;

  // --------------------------------------------------------- where to begin --

  /**
   * Where a lost visitor could begin: the app's own main navigation, in its own words, restricted to
   * places the assistant can say what they are for. Empty on a page with no navigation of its own.
   */
  function startingPoints(): Choice[] {
    const found = adopterNav(doc as unknown as NavRoot, {
      base: view?.location.href ?? 'http://localhost/',
      currentPath: currentPath(),
      exclude: host,
      selector: navigation,
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

  // ------------------------------------------------------------ open / close --

  /**
   * `fromTap`: opened by the visitor's own tap, which is the only time a browser will fetch a speech pack.
   * `full`: open it expanded, or expand it if it is already open.
   */
  function open(fromTap = false, full = false): void {
    if (destroyed) return;
    if (mode === 'stage') {
      if (full && !expanded) setExpanded(true);
      return;
    }
    applyTheme();
    endGuide();
    mode = 'stage';
    screen.removeAttribute('inert');
    screen.dataset.open = 'true';
    orb.setAttribute('aria-expanded', 'true');
    orb.setAttribute('aria-hidden', 'true');
    orb.tabIndex = -1;
    liquid.setBacking(0);
    liquid.setState('idle');
    setExpanded(full);
    later(() => {
      if (mode !== 'stage') return;
      place();
      viewStart().focus();
    }, 30);
    if (handsFree) void startConversation(fromTap);
  }

  function dock(returnFocus: boolean, toSide?: DockSide): void {
    if (destroyed || mode === 'docked') return;
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
    liquid.setBacking(1);
    liquid.setState('idle');
    // Next time it opens it is the panel again; the scroll lock goes with the full screen.
    setExpanded(false);
    if (returnFocus) orb.focus();
  }

  const close = (): void => dock(true);
  /** Set while the app's own UI has the corner (`stepAside`, ADR-038): whether to reopen on `comeBack`. */
  let aside: { readonly wasOpen: boolean } | null = null;

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
        // Read back from storage: a task is only ever a few short words, or it is not a task.
        const t = a.task as Partial<Task> | undefined;
        const few = (list: unknown): list is string[] =>
          Array.isArray(list) && list.length <= 12 && list.every((w) => typeof w === 'string' && w.length <= 40);
        const task =
          t && typeof t.start === 'boolean' && few(t.words) && (t.place === undefined || few(t.place))
            ? { words: t.words, start: t.start, ...(t.place ? { place: t.place } : {}) }
            : null;
        return {
          title: a.title,
          side: a.side,
          at: a.at as number,
          capabilityId: typeof a.capabilityId === 'string' ? a.capabilityId : null,
          ...(task ? { task } : {}),
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
    // Brought here to start something: open it, or point at it (ADR-031). The page may still be drawing.
    if (arrival.task && perform(arrival.task, arrival.capabilityId)) return;
    // Steps are written in the app's first language only: read in another, there are none (ADR-030).
    const steps = arrival.capabilityId && seen === assistant.registry ? (assistant.registry.byId.get(arrival.capabilityId)?.steps ?? []) : [];
    if (steps.length > 0) {
      // The guide points at the page, so the panel makes way for it.
      dock(false);
      return startGuide(steps, arrival.title);
    }
    // With the panel open, the answer that brought them here already said where they are.
    if (mode === 'stage') return;
    // After a full page load: announced, and shown only as the orb's glow — no words beside it.
    bubble.textContent = words.here(arrival.title);
    liquid.setState('speaking');
    liquid.setLevel(0.7);
    later(() => {
      liquid.setLevel(0);
      if (mode === 'docked') liquid.setState('idle');
    }, 1200);
    later(() => {
      if (bubble.textContent === words.here(arrival.title)) bubble.textContent = '';
    }, 4500);
  }

  /**
   * Move now. The answer that said where is already in the thread, and nothing waits for it to be read
   * aloud or for an animation: "Opening Calendar" followed by nothing reads as broken. The panel stays open
   * beside the new page — the corner panel, if it was expanded, so the page can be seen — and the
   * conversation carries on there.
   */
  function travel(route: string, title: string, capabilityId: string | null, task: Task | null = null): void {
    if (destroyed || !safeRoute(route)) return;
    if (mode === 'stage' && expanded) setExpanded(false);
    const to = mode === 'stage' ? side : resolveSide();
    try {
      const note: Arrival = { title, side: to, at: Date.now(), capabilityId, ...(task && acting !== 'off' ? { task } : {}) };
      storage?.setItem(ARRIVAL_KEY, JSON.stringify(note));
    } catch {
      // storage refused: the next page simply will not greet
    }
    // A single-page app moved without unloading us, so act on the new page once it has drawn.
    if (go(route)) {
      later(() => {
        if (onHome() && mode === 'docked') {
          forget();
          open();
          return;
        }
        const note = recall();
        if (note) arrive(note);
      }, 320);
    }
  }

  // --------------------------------------------------------------------- act --

  /**
   * The task in a question, for the screen it leads to (ADR-031): that screen by every name the app gives
   * it — its own, and each translation (ADR-030) — so "announcement" finds "Novo anúncio"; and the app's
   * glossary, so what people say finds what the app calls it.
   */
  function taskFor(question: string, capabilityId: string | null | undefined, fallback: string): Task {
    const capability = capabilityId ? assistant.registry.byId.get(capabilityId) : undefined;
    const names = capability ? [capability.title, ...Object.values(capability.translations ?? {}).map((t) => t.title)] : [fallback];
    return taskOf(question, names, assistant.registry.context?.glossary ?? []);
  }

  /** On screen: a real page reports boxes for it. A page that cannot say (a test's) counts it as shown. */
  const shownOnPage = (el: ActNode): boolean => {
    const rects = (el as unknown as { getClientRects?: () => ArrayLike<unknown> }).getClientRects;
    return typeof rects !== 'function' || rects.call(el).length > 0;
  };

  /**
   * Start what was asked, on this page (ADR-031, act.ts): press the control that opens it when it can only
   * open something, or point at it when it might do something. The panel makes way either way, so what
   * opens can be seen. True when there is something to do here — at once, or once the page has drawn it.
   */
  function perform(task: Task, capabilityId: string | null, attempt = 0): boolean {
    if (destroyed || acting === 'off') return false;
    const declared = capabilityId ? (assistant.registry.byId.get(capabilityId)?.opens ?? []) : [];
    const plan = planAct(task, doc as unknown as ActRoot, declared, shownOnPage);
    if (plan.act === 'none') {
      // A single-page app draws after it moves: look again, briefly, before giving up quietly.
      if (plan.reason === 'nothing' && attempt < ACT_RETRIES_MS.length) {
        later(() => void perform(task, capabilityId, attempt + 1), ACT_RETRIES_MS[attempt]!);
      }
      return attempt > 0;
    }
    const element = plan.control.element as unknown as HTMLElement;
    endGuide();
    dock(false);
    if (plan.act === 'press' && acting === 'open') {
      element.click();
      bubble.textContent = words.opened(plan.control.name);
      // A tab was only the way in: what to start may be inside it.
      if (plan.control.evidence === 'tab' && task.start) later(() => void perform(task, capabilityId, ACT_RETRIES_MS.length - 1), 350);
      return true;
    }
    point(element, plan.control.name);
    return true;
  }

  /** Show the visitor the control to press, and say so: the guide's ring and card, one step. */
  function point(element: HTMLElement, name: string): void {
    endGuide();
    guide = [{ text: words.tapToStart(name), element: element as unknown as AnchorNode, result: { status: 'matched', element: element as unknown as AnchorNode, via: 'label' } }];
    guideAt = 0;
    guideTitle.textContent = name;
    guidePanel.dataset.side = side;
    guidePanel.hidden = false;
    showStep();
    // Pressed: the pointing is done.
    element.addEventListener?.('click', () => endGuide(), { once: true });
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
    // One step is not a sequence: no "Step 1 of 1".
    guideCount.textContent = guide.length > 1 ? words.guideStep(guideAt + 1, guide.length) : '';
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
        // Say why, every time (ADR-037): a silent failure left visitors unsure the microphone worked at all.
        onTranscriptionError: (code) => {
          if (busy) return;
          if (code === 'not-allowed') setCaption(words.micDenied);
          else if (code === 'audio-capture') setCaption(words.voiceNoMic);
          else if (code === 'network' || code === 'service-not-allowed') setCaption(words.voiceServiceDown);
        },
        onTranscribing: () => {
          if (!busy) setCaption(words.transcribing);
        },
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
      case 'tour': {
        // The app's own tour first (ADR-026); else the steps this page declares; else it is a question.
        const here = currentPath();
        // More than one to choose from: the visitor picks, in the tours view (ADR-033, ADR-035).
        if (toursHere().length > 1) {
          open();
          setView('tours');
          return true;
        }
        if (typeof companion?.tour === 'function') {
          dock(false);
          if (companion.tour(here) !== false) return true;
        }
        const page = capabilityAt(here);
        if (!page?.steps?.length) return false;
        dock(false);
        startGuide(page.steps, page.title);
        return true;
      }
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
        travel(home, capability?.title ?? home, capability?.id ?? null);
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

  /**
   * The app's own assistant, asked (ADR-026). Its answer as this conversation shows it — its words, under
   * its name — or `null` to keep the turn: it declined, said nothing, or failed. Its failure is not the
   * visitor's problem; this assistant answers instead, as it would have without it.
   */
  async function consult(text: string, files: readonly File[], route: string): Promise<View | null> {
    if (typeof companion?.ask !== 'function') return null;
    try {
      const said = await companion.ask({ text, files, route });
      const answer = typeof said === 'string' ? said.trim() : '';
      if (!answer) return null;
      return { tone: 'answer', title: '', body: answer, destination: null, choices: [], from: companionName };
    } catch {
      return null;
    }
  }

  /** The app's rule claims this question for its own assistant (ADR-038). Its failure keeps the question here. */
  function handsOver(text: string, route: string): boolean {
    if (typeof companion?.handOver !== 'function' || typeof companion.ask !== 'function') return false;
    // Mashing is nobody's question (ADR-039): not worth the app's rule, nor its model.
    if (isMashing(text, assistant.registry)) return false;
    try {
      return companion.handOver(text, { route }) === true;
    } catch {
      return false;
    }
  }

  /** `nextgen:companion`: what the app's assistant was asked, and why — the record of a turn no router decided. */
  function announceCompanion(utterance: string, handedOverBy: CompanionTurn['handedOverBy'], started: number, answered: boolean): void {
    if (!view) return;
    const detail: CompanionTurn = { utterance, handedOverBy, latencyMs: Math.round(performance.now() - started), answered };
    try {
      view.dispatchEvent(new (view as Window & typeof globalThis).CustomEvent(COMPANION_EVENT, { detail }));
    } catch {
      // a page that cannot take the event loses nothing the visitor sees
    }
  }

  /**
   * What this assistant cannot place, and the app's own might: a question that matched nothing, or a topic
   * the registry says is outside the app. Never a declared limit on *acting* — a payment, changing a record
   * — and never one that already points somewhere: those stay this assistant's answer.
   */
  function forCompanion(trace: TurnTrace): boolean {
    if (nothingPlaced(trace)) return true;
    const capability = trace.capabilityId ? assistant.registry.byId.get(trace.capabilityId) : undefined;
    return capability?.kind === 'unsupported' && capability.refuses !== 'action' && (capability.helpAt ?? []).length === 0;
  }

  /**
   * Nothing in the app matched: no screen is even a likely one (`barelyMatched` — every score below the
   * likely-one floor), or the router found it outside the app with no limit to name. What the app's
   * search and its own assistant are for, and a question worth teaching (`learn`).
   */
  function nothingPlaced(trace: TurnTrace): boolean {
    // Keyboard mashing is not a question nothing matched: nothing to search, hand over or learn (ADR-039).
    if (trace.mashing) return false;
    if (trace.outcome === 'clarify') return barelyMatched(trace.candidates);
    return trace.outcome === 'out_of_scope' && !trace.capabilityId;
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
    // A message with a file is about the file: the app's own assistant, when there is one, is asked about it.
    const files = sending.map((entry) => entry.file);
    const filesToCompanion = files.length > 0 && typeof companion?.ask === 'function';
    // Nothing to wait for when there is nothing to work out.
    const instant = !filesToCompanion && (chatty || filesOnly || reply !== null);
    // A question asked from the tours view is a conversation again.
    if (viewing === 'tours') setView('chat', false);
    open();
    stopSpeaking();
    const mine = ++latest;
    busyTurn = mine;
    setBusy(true);
    try {
      // The screen stops being a landing page and becomes a conversation; the orb moves to its
      // smaller seat at the top, and is placed again now that the layout has changed.
      const first = screen.dataset.conversation !== 'true';
      screen.dataset.conversation = 'true';
      if (first) place();
      addVisitorMessage(utterance, sending);
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
      /** The question this answer's places are for, when the router could not settle it (`learn`). */
      let unsettledHere: Asked | null = null;
      /** What was asked to be done, for the page it leads to (ADR-031): this question, or the one a reply answers. */
      let taskFrom: string | null = null;
      try {
        const where = currentPath();
        const companionAnswer = filesToCompanion ? await consult(utterance, files, where) : null;
        // The app's own rule, before any routing (ADR-038, Rule 18): what its assistant can do for this user
        // goes straight to it — no screen scoring, no model of ours. Declined, and it is routed as usual.
        const routing = !companionAnswer && !filesOnly && !reply && !(talk && chatty);
        const question0 = talk ? talk.rest : utterance;
        const ruleStarted = performance.now();
        const claimed = routing && handsOver(question0, where);
        const byRule = claimed ? await consult(question0, [], where) : null;
        if (claimed) announceCompanion(question0, 'rule', ruleStarted, byRule !== null);
        // Otherwise handed to the page, and only to the page: the router below is given the words and
        // nothing else, and nothing attached is ever sent anywhere by this assistant.
        const handed =
          files.length > 0 && !companionAnswer && view
            ? offerFiles(view as Window & typeof globalThis, { files, utterance, route: where })
            : false;
        if (companionAnswer) {
          shown = companionAnswer;
        } else if (filesOnly) {
          shown = attachmentView(handed, words);
        } else if (reply) {
          shown = reply;
          // The visitor settled a question the router could not: that is a lesson (ADR-027). "Which one?"
          // settles nothing yet, and keeps the question open for the next reply.
          const was = offered?.asked ?? null;
          taskFrom = was?.question ?? null;
          if (was && reply.destination) learn({ question: was.question, route: reply.destination, how: 'chose', from: was.from, offered: was.offered });
          else if (was && replied?.kind === 'reject') learn({ question: was.question, route: null, how: 'rejected', from: was.from, offered: was.offered });
          else if (was) unsettledHere = was;
        } else if (talk && chatty) {
          const starts = talk.kind === 'help' || talk.kind === 'thisPage' ? startingPoints() : [];
          shown = smalltalkView(talk.kind, seen, where, words, starts, hints);
        } else if (byRule) {
          shown = byRule;
        } else {
          const question = talk ? talk.rest : utterance;
          taskFrom = question;
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
          // What this assistant cannot place goes to the app's own, when there is one; the answer below
          // stands if it declines (ADR-026).
          const unplacedStarted = performance.now();
          const toCompanion = forCompanion(trace) && typeof companion?.ask === 'function';
          const placed = toCompanion ? await consult(question, [], where) : null;
          if (toCompanion) announceCompanion(question, 'unplaced', unplacedStarted, placed !== null);
          shown = placed ?? present(trace, seen, where, words, nothingMatched ? startingPoints() : [], hints, decide);
          const unplaced = nothingPlaced(trace);
          // What no screen matched may be content — a person, a post, a product — and the app's own search
          // is the honest answer to that (ADR-027). Offered first, before any place to begin.
          const search = !placed && unplaced ? searchChoice(options.search, question, words) : null;
          // Faint matches are not a question worth asking — "X, or Y?" about two unrelated screens — so the
          // answer says it is not sure, and offers the search first, then whatever came closest.
          if (search) shown = { tone: 'unsure', title: words.unsureHelp, body: null, destination: null, choices: [search, ...shown.choices].slice(0, 3) };
          // A question nothing in the app matched is worth knowing about, whoever answered it.
          if (unplaced) learn({ question, route: null, how: 'unplaced', from: where, offered: shown.choices.map((c) => c.route) });
          // Places offered for a question the router could not settle: a tap on one is the visitor teaching it.
          if (!placed && !shown.destination && shown.choices.length > 0 && trace.outcome === 'clarify') {
            unsettledHere = { question, from: where, offered: shown.choices.map((c) => c.route) };
          }
          // Its answer is not this router's decision, so it carries no "Why?" from this router (Rule 9).
          if (placed) trace = null;
        }
        // Whatever was asked, the visitor is told what became of what they attached.
        if (companionAnswer) shown = { ...shown, note: words.attachToCompanion(companionName) };
        else if (sending.length > 0 && !filesOnly) shown = { ...shown, note: handed ? words.attachHanded : words.attachKept };
      } catch {
        trace = null;
        shown = { tone: 'unsure', title: words.error, body: null, destination: null, choices: [] };
      }
      if (destroyed || mine !== latest) return shown;

      // The likely place is this very page, and the question asked to start something that is on it: not
      // "Open Announcements?" to someone already there — start it here (ADR-031).
      let startHere: { task: Task; capabilityId: string | null } | null = null;
      const likely = shown.probable && shown.choices.length === 1 ? shown.choices[0] : undefined;
      if (likely && taskFrom && acting !== 'off' && isSamePlace(likely.route, currentPath())) {
        const capability = capabilityAt(likely.route);
        const task = taskFor(taskFrom, capability?.id, likely.label);
        const declared = capability ? (assistant.registry.byId.get(capability.id)?.opens ?? []) : [];
        if (task.start && planAct(task, doc as unknown as ActRoot, declared, shownOnPage).act !== 'none') {
          startHere = { task, capabilityId: capability?.id ?? null };
          shown = { tone: 'explain', title: words.alreadyHere(capability?.title ?? likely.label), body: null, destination: null, choices: [] };
        }
      }

      // Every place it offers, and the one it moves to, is a path on this site — whatever the registry,
      // the URL or an option said (present.ts `safeRoute`). A place that is not is simply not offered.
      shown = {
        ...shown,
        choices: shown.choices.filter((c) => safeRoute(c.route) !== null),
        destination: shown.destination && safeRoute(shown.destination),
      };

      thread.removeAttribute('aria-busy');
      setCaption('');
      showAnswer(shown, trace, unsettledHere);
      // What this answer offered is what a "yes" or "the second one" next would mean. Going somewhere, or
      // talking about something else, ends the question that was open; "neither" keeps it open.
      offered = !shown.destination && shown.choices.length > 0 ? { choices: shown.choices, probable: shown.probable === true, asked: unsettledHere } : null;
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
      // Spoken only when asked for: the read-aloud button, or a hands-free conversation, which is spoken.
      const speech = say(lastSaid, readAloud || conversation !== null);
      if (shown.destination) {
        // At once: the move never waits for the answer to be read out (travel).
        // A reply ("yes", "the second one") has no trace of its own: the place it chose names itself.
        const destination = trace?.capabilityId ? seen.byId.get(trace.capabilityId) : capabilityAt(shown.destination);
        const title = destination?.title ?? shown.title;
        travel(shown.destination, title, destination?.id ?? null, taskFrom ? taskFor(taskFrom, destination?.id, title) : null);
      } else if (startHere) {
        perform(startHere.task, startHere.capabilityId);
      } else if (trace && taskFrom && !trace.explanationRequest && trace.outcome === 'execute') {
        // Already on the screen it is about: start it here (ADR-031).
        const here = trace.capabilityId ? seen.byId.get(trace.capabilityId) : undefined;
        const at = here?.route ? fillParams(here.route, currentPath(), patterns, hints) : null;
        if (here && at && isSamePlace(at, currentPath())) perform(taskFor(taskFrom, here.id, here.title), here.id);
      }
      // Still busy while it speaks, so a hands-free microphone never hears it.
      await speech;
      if (!destroyed && mine === latest && mode === 'stage') liquid.setState('idle');
      return shown;
    } finally {
      if (busyTurn === mine) setBusy(false);
    }
  }

  // ------------------------------------------------------------------ events --

  screen.dataset.view = 'chat';
  chatTab.setAttribute('aria-selected', 'true');
  toursTab.setAttribute('aria-selected', 'false');
  toursTab.tabIndex = -1;

  orb.addEventListener('click', () => {
    if (mode === 'docked') open(true);
    else toggleVoice();
  });
  // Gone still at rest (liquid.ts), it moves again the moment someone reaches for it.
  orb.addEventListener('pointerenter', () => liquid.wake());
  orb.addEventListener('focus', () => liquid.wake());
  expandButton.addEventListener('click', () => setExpanded(!expanded));
  companionButton.addEventListener('click', () => {
    // Theirs, whole. This panel steps aside rather than sit on top of it.
    dock(false);
    companion?.open?.();
  });
  chatTab.addEventListener('click', () => setView('chat'));
  toursTab.addEventListener('click', () => setView('tours'));
  // The arrow keys move between the two tabs, as in any tab list.
  viewTabs.addEventListener('keydown', (event) => {
    const e = event as KeyboardEvent;
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    const next = e.key === 'Home' ? 'chat' : e.key === 'End' ? 'tours' : viewing === 'chat' ? 'tours' : 'chat';
    setView(next, false);
    (next === 'chat' ? chatTab : toursTab).focus();
  });
  // Typing is talking: reaching for the composer from the tours goes back to the conversation.
  input.addEventListener('focus', () => {
    if (viewing === 'tours') setView('chat', false);
  });
  // A page that moves with the browser's own history: the tours follow it.
  const onHistory = (): void => {
    if (viewing === 'tours') renderTours();
  };
  view?.addEventListener('popstate', onHistory);
  closeButton.addEventListener('click', close);
  restartButton.addEventListener('click', startOver);
  // Expanded, the only part of the page left uncovered is its navigation. Reaching for it means the
  // visitor wants the page back: the panel returns to its corner, and the click goes through.
  const onPagePointer = (event: Event): void => {
    if (mode !== 'stage' || !expanded) return;
    const target = event.target as Node | null;
    if (target && host.contains(target)) return;
    setExpanded(false);
  };
  view?.addEventListener('pointerdown', onPagePointer, true);
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
      // From the tours, Escape is "back to the conversation"; from the conversation, it closes.
      if (viewing === 'tours') setView('chat');
      else close();
      return;
    }
    // Only a modal keeps Tab in. The corner panel sits beside the page, and Tab walks on into it.
    if (e.key !== 'Tab' || !expanded) return;
    const stops: HTMLElement[] = [
      expandButton,
      ...(companionButton.hidden ? [] : [companionButton]),
      restartButton,
      ...(soundButton.hidden ? [] : [soundButton]),
      closeButton,
      ...(viewing === 'chat' ? threadStops : tourStops),
      ...(viewTabs.hidden ? [] : [viewing === 'chat' ? chatTab : toursTab]),
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

  // --------------------------------------------------------------- language --

  /** Every label set once at build, in the language shown now: again when that language changes. */
  function relabel(): void {
    const name = (button: HTMLElement, text: string): void => {
      // Its first child is the screen-reader name (`iconButton`).
      button.children[0]!.textContent = text;
    };
    name(companionButton, words.openCompanion(companionName));
    // A tab's name is on show, beside its icon (`tabButton`).
    chatTab.children[1]!.textContent = words.chat;
    toursTab.children[1]!.textContent = words.tutorials;
    viewTabs.setAttribute('aria-label', words.views);
    if (viewing === 'tours') renderTours();
    name(soundButton, words.readAloud);
    name(closeButton, words.close);
    name(restartButton, words.startOver);
    name(mic, words.listen);
    name(send, words.submit);
    name(attachButton, words.attach);
    name(cameraButton, words.attachCamera);
    greeting.textContent = words.greeting;
    greetingHint.textContent = words.greetingHint;
    label.textContent = words.label;
    tray.setAttribute('aria-label', words.attach);
    orb.setAttribute('aria-label', words.openAssistant);
    guidePanel.setAttribute('aria-label', words.guideLabel);
    guideBack.textContent = words.guideBack;
    guideNext.textContent = words.guideNext;
    guideDone.textContent = words.guideDone;
    setExpanded(expanded);
  }

  /**
   * The app switched language (ADR-030): the assistant follows, labels and all. What is already in the
   * thread stays as it was said; everything from here on is in the new language.
   */
  function setLanguage(next: string | null | undefined): void {
    if (destroyed || !next || next === pageLang) return;
    pageLang = next;
    shownIn = displayLanguage(pageLang, assistant.registry);
    words = { ...wordsFor(shownIn), ...options.words };
    seen = inLanguage(assistant.registry, shownIn);
    hints = { locale: pageLang };
    lang = speechLang(shownIn);
    relabel();
  }

  // An adopter who set `lang` decides it (and calls `setLanguage`); otherwise `<html lang>` does, live.
  const MutationObserverCtor = (view as (Window & typeof globalThis) | null)?.MutationObserver;
  const langWatch =
    options.lang === undefined && MutationObserverCtor && doc.documentElement
      ? new MutationObserverCtor(() => setLanguage(doc.documentElement.getAttribute('lang')))
      : null;
  langWatch?.observe(doc.documentElement, { attributes: true, attributeFilter: ['lang'] });

  return {
    host,
    open: (how) => open(false, how?.expanded === true),
    close,
    ask: (utterance) => ask(utterance),
    setLanguage,
    refresh() {
      if (!destroyed && viewing === 'tours') renderTours();
    },
    stepAside() {
      if (destroyed || aside) return;
      aside = { wasOpen: mode === 'stage' };
      if (mode === 'stage') dock(false);
      // Hidden outright, orb included: the app's own panel sits in the same corner.
      host.style.setProperty('display', 'none', 'important');
    },
    comeBack() {
      if (destroyed || !aside) return;
      const { wasOpen } = aside;
      aside = null;
      host.style.removeProperty('display');
      if (wasOpen) open(false);
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      view?.removeEventListener('popstate', onHistory);
      langWatch?.disconnect();
      stopConversation();
      stopSpeaking();
      guide = [];
      ringTarget = null;
      attached = [];
      for (const id of timers) view?.clearTimeout(id);
      timers.clear();
      view?.removeEventListener('resize', onResize);
      view?.removeEventListener('scroll', onScroll, true);
      view?.removeEventListener('pointerdown', onPagePointer, true);
      // The app's own launchers come back.
      if (hideSheet) doc.adoptedStyleSheets = doc.adoptedStyleSheets.filter((sheet) => sheet !== hideSheet);
      hideStyle?.remove();
      lockScroll(false);
      liquid.destroy();
      host.remove();
    },
  };
}
