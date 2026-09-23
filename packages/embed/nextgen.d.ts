// Types for `nextgen.js`, the NextGen Interface script tag — the part of its API an app calls.
//
// Copy this file beside your code, or reference it, to type `window.NextGen` (Pilot-A field report,
// 2026-09-23, P2-1: an integrator had to read the minified bundle to find these). It is written by
// hand and held to the real exports by `src/declarations.check.ts`: a change to the widget that this
// file no longer describes fails the widget's own typecheck.

export type Corner = 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';

/** How readily the assistant moves the browser. See AGENTS.md, "Make it smarter, or more careful". */
export type Decide = 'confirm' | 'balanced' | 'eager';

/** Why it did not start — the `reason` of a `nextgen:error` event, and of a rejected `start()`. */
export type StartFailure = 'bundle-unavailable' | 'bundle-invalid' | 'mount-failed';

export interface ErrorDetail {
  readonly reason: StartFailure;
  readonly message: string;
}

/** `start()` rejects with this. */
export declare class StartError extends Error {
  readonly reason: StartFailure;
  constructor(reason: StartFailure, message: string);
}

/** `'nextgen:error'` — announced on `window` whenever it fails to start, however it was started. */
export declare const ERROR_EVENT: 'nextgen:error';
/** `'nextgen:learn'` — announced on `window` for each `Lesson`. */
export declare const LEARN_EVENT: 'nextgen:learn';
/**
 * `'nextgen:turn'` — announced on `window` for each routed turn, `{ trace }`: how it was decided, what it
 * weighed and with what scores. The visitor is not shown this; the adopter can log it or build their own "why".
 */
export declare const TURN_EVENT: 'nextgen:turn';

/** A turn's record, as `nextgen:turn` carries it. The fields most worth reading; the object has more. */
export interface TurnRecord {
  readonly utterance?: string;
  readonly outcome: string;
  readonly capabilityId: string | null;
  readonly decidedAt: string;
  readonly candidates: readonly { readonly capabilityId: string; readonly score: number }[];
}

/** One thing a visitor taught it: a question it could not settle, and how the visitor settled it. */
export interface Lesson {
  readonly question: string;
  readonly route: string | null;
  readonly how: 'chose' | 'rejected' | 'unplaced';
  readonly from: string;
  readonly offered: readonly string[];
}

/** What the visitor asked, handed to the app's own assistant. */
export interface CompanionRequest {
  readonly text: string;
  readonly files: readonly File[];
  readonly route: string;
}

/** The app's own assistant or tour, merged in: one entry point, nothing lost. */
export interface Companion {
  readonly name?: string;
  /** Answer what this assistant cannot place, and anything attached. Resolve to plain text, or null. */
  ask?(request: CompanionRequest): Promise<string | null | undefined>;
  /** Open the app's own assistant, whole. */
  open?(): void;
  /** Start the app's own tour for this page; `false` when it has none. */
  tour?(route: string): boolean | void;
  /** CSS selectors of the app's own launchers, hidden while this one runs. */
  readonly hide?: readonly string[];
}

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export interface StartOptions {
  /** How to fetch the bundle's files — pass the app's authenticated fetch for token auth. */
  readonly fetch?: (url: string) => Promise<Response>;
  /** Move the browser without a page load: the app's router. */
  readonly navigate?: (route: string) => void;
  /** The page's language. Default: `<html lang>`. Portuguese, or English for anything else. */
  readonly lang?: string;
  /** The current path. Default: `location.pathname`. */
  readonly currentPath?: () => string;
  /** Where the panel opens by itself. Default `['/']`. */
  readonly home?: readonly string[];
  /** Mount inside this element instead of `document.body`. */
  readonly target?: Element;
  readonly position?: Corner;
  readonly dockSide?: 'auto' | 'left' | 'right';
  /** Distance of the orb and panel from the corner, in pixels. Default 20 each. */
  readonly inset?: { readonly x?: number; readonly y?: number };
  readonly companion?: Companion;
  readonly decide?: Decide;
  /**
   * Asked to start something, what it does with the control that starts it (ADR-031): `'open'` (default)
   * presses it when it can only open something and points at it otherwise; `'point'` only points; `'off'`
   * neither. It never types, and never presses what saves, sends, pays or deletes.
   */
  readonly act?: 'open' | 'point' | 'off';
  /** The app's own search for what no screen matches: `'/search?q={query}'`. */
  readonly search?: string;
  /** CSS selector for the app's navigation, when it is not a `<nav>`. */
  readonly navigation?: string;
  readonly onLearn?: (lesson: Lesson) => void;
  /** Offer a paperclip. Default: on when `companion.ask` exists, else off. */
  readonly attach?: boolean;
  /** Offer hands-free voice where the browser supports it. Default `true`. */
  readonly voice?: boolean;
  readonly storage?: Store | null;
  readonly preferences?: Store | null;
}

/** What `start()` resolves to. */
export interface MountedAssistant {
  readonly host: HTMLElement;
  /** Open the corner panel, or `{ expanded: true }` for full screen. */
  open(options?: { readonly expanded?: boolean }): void;
  close(): void;
  /** Ask programmatically. */
  ask(utterance: string): Promise<unknown>;
  /** The app switched language without touching `<html lang>`: follow it (`"en"`, `"pt-PT"`). */
  setLanguage(lang: string): void;
  /** Remove it — call on sign-out. */
  destroy(): void;
}

/**
 * Load the bundle for this user's role (or roles) and mount the assistant. Rejects with a `StartError`,
 * after announcing it as `nextgen:error`.
 */
export declare function start(basePath: string, role: string | readonly string[], options?: StartOptions): Promise<MountedAssistant>;

declare global {
  interface Window {
    /** The script tag's global. */
    readonly NextGen: {
      readonly start: typeof start;
      readonly StartError: typeof StartError;
      readonly ERROR_EVENT: typeof ERROR_EVENT;
      readonly LEARN_EVENT: typeof LEARN_EVENT;
    };
  }
  interface WindowEventMap {
    'nextgen:error': CustomEvent<ErrorDetail>;
    'nextgen:learn': CustomEvent<Lesson>;
    'nextgen:turn': CustomEvent<{ readonly trace: TurnRecord }>;
    'nextgen:navigate': CustomEvent<{ readonly route: string }>;
    'nextgen:attach': CustomEvent<{ readonly files: File[]; readonly utterance: string; readonly route: string }>;
  }
}
