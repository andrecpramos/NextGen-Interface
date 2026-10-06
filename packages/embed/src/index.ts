// @nextgen/embed — Ladder C3: the navigation layer as one script tag.
//
//   <script src="/nextgen/nextgen.js" data-nextgen-role="PARENT" defer></script>
//
// The script tag starts itself from its own attributes (script-tag.ts), so a page
// needs no inline script and it works under a strict Content-Security-Policy.
// From a module instead: `import { start } from '@nextgen/embed'`.
//
// `start` loads the role's bundle and mounts the assistant layer (assistant.ts):
// an orb at the edge of the page that opens into a full-screen assistant.
// `mount` is the plain chat box (widget.ts) for a page that wants it inline.
// `load` gives the router alone, for a page that draws its own interface.
//
// For an application with no build step — the adopter C2's npm package cannot
// reach. It routes with stages 1 and 2 only, from the registry and index the
// generator emitted, so it needs no model server and makes no network call
// except fetching those three static files from the adopter's own origin.
//
// Everything here is a thin shell over code that is already measured:
// `registryFromIndex` (210/210 decision parity with the server path) and
// the guided-step resolver (degrades to text rather than mispointing).
// This file adds no routing behaviour of its own, on purpose — a second
// implementation would be a second thing to keep in step.

import { HashingEmbedder, indexFor, mergeRegistryFiles, registryFromIndex, route as routeTurn } from '@nextgen/core-intent/browser';
import type { Registry, RegistryFile, ShippedIndex, Thresholds, TurnTrace } from '@nextgen/core-intent/browser';
import type { GuidedStep } from '@nextgen/core-capability';

// The guided-step resolver. It lived in packages/ui, beside React components a
// script tag must never drag in, and moved here when that package was removed.
import { resolveSteps, type AnchorRoot, type ResolvedStep } from './anchor.ts';

import { mountAssistant, type AssistantOptions, type MountedAssistant } from './assistant.ts';
import { announceFailure, StartError } from './errors.ts';
import { SameOriginLlmRuntime, type Stage3Config, type Stage3Fetch } from './stage3.ts';

export type { Stage3Config, Stage3Fetch } from './stage3.ts';
export { ERROR_EVENT, StartError, type ErrorDetail, type StartFailure } from './errors.ts';

/** What the generator wrote for one role, as the adopter serves it. */
export interface Bundle {
  readonly registry: RegistryFile;
  /**
   * The vectors the build shipped. Optional: without it they are computed from the registry
   * (`indexFor`, the function the build writes them with), which is how a merged registry for a user
   * with several roles is indexed.
   */
  readonly index?: ShippedIndex;
  readonly thresholds: Thresholds;
  /**
   * Present only when `nextgen build --stage3 <path>` turned it on (ADR-017).
   * Absent: a turn stages 1–2 cannot settle ends in a clarifying question, exactly as it
   * always has. `load()` reads this from the bundle's own thresholds file; passing it here
   * directly is for a caller that already has the bundle in memory.
   */
  readonly stage3?: Stage3Config;
}

export interface Assistant {
  /** Route one utterance. Synchronous in effect; returns the full turn record. */
  route(utterance: string, context?: { readonly route?: string; readonly today?: string }): Promise<TurnTrace>;
  /** Guided steps for a capability, resolved against a page. Text survives a missing anchor. */
  steps(capabilityId: string, root: AnchorRoot): ResolvedStep[];
  readonly capabilities: number;
  /** The registry this assistant routes against: what the chat box presents turns with. */
  readonly registry: Registry;
}

/** The most of a question the router reads. The composer stops at this too. */
export const MAX_QUESTION = 500;

/**
 * Build an assistant from a bundle already in memory. No I/O at all — until a turn reaches stage 3,
 * when the bundle turned it on, and then through `options.stage3Fetch` when given.
 */
export function create(bundle: Bundle, options: Pick<LoadOptions, 'stage3Fetch'> = {}): Assistant {
  const registry: Registry = registryFromIndex(bundle.registry, bundle.index ?? indexFor(bundle.registry));

  // One encoder, fitted to THIS registry's documents and shared with nothing —
  // A shared, re-fitted encoder once produced a twelvefold scoring error here. The hashing encoder
  // directly, not `makeEmbedder`: that pulls a model server's client into a script tag that never uses one.
  //
  // Fitted when the page is idle, or at the first question if that comes sooner — never while the
  // adopter's page is still loading (ADR-029). On a large app the fit is the one piece of start-up work
  // that grows with the number of screens.
  const embedder = new HashingEmbedder();
  let fitted = false;
  const fit = (): void => {
    if (fitted) return;
    fitted = true;
    embedder.fit(registry.documents);
  };
  const idle = (globalThis as { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number }).requestIdleCallback;
  if (typeof idle === 'function') idle(fit, { timeout: 3000 });

  // Constructed once, not per turn: `SameOriginLlmRuntime`'s constructor is where the
  // origin check happens, and it never throws — a bad or off-origin config makes this
  // permanently unavailable, and every turn then degrades exactly like an absent
  // transport (unchanged since bundle.stage3 is absent by
  // default). `undefined` here, not merely `useStage3: false`, so a caller poking at
  // internals sees "there is no runtime" rather than "there is one and it is switched off".
  const runtime = bundle.stage3 ? new SameOriginLlmRuntime(bundle.stage3, options.stage3Fetch) : undefined;

  return {
    capabilities: registry.capabilities.length,
    registry,
    route(utterance, context = {}) {
      fit();
      return routeTurn(
        // A question is a sentence, not a document: whatever is pasted, the router reads a bounded part
        // of it, so no input can make a turn slow on the adopter's page.
        utterance.slice(0, MAX_QUESTION),
        {
          route: context.route ?? '/',
          today: context.today ?? new Date().toISOString().slice(0, 10),
        },
        {
          registry,
          embedder,
          thresholds: bundle.thresholds,
          useStage3: runtime !== undefined,
          runtime,
          ...(bundle.stage3?.model !== undefined ? { model: bundle.stage3.model } : {}),
        },
      );
    },
    steps(capabilityId, root) {
      const steps: readonly GuidedStep[] = registry.byId.get(capabilityId)?.steps ?? [];
      return resolveSteps(steps, root);
    },
  };
}

/**
 * Fetch one role's bundle from the adopter's own origin and build an assistant.
 *
 * Three same-origin static files, the only requests this script ever makes **before a
 * turn is asked**. The adopter decides the path and serves them; nothing is fetched from
 * anywhere else, which is what keeps Rule 8 true for C3 exactly as it is for C2.
 *
 * A fourth, later request is now possible: if `thresholds.hashing.json` carries a
 * `stage3` field, a turn stages 1–2 cannot settle POSTs to it — still same-origin, still
 * only when a turn actually needs it (ADR-017). Nothing changes for a bundle
 * built without `--stage3`: the field is absent, `create()` never constructs a runtime,
 * and the three fetches above stay the only network this script ever does.
 */
export async function load(basePath: string, role: string | readonly string[], options: LoadOptions = {}): Promise<Assistant> {
  const base = basePath.replace(/\/+$/, '');
  // The registry decides what visitors are shown and where they are sent, so it comes from this site or
  // not at all (Rule 8, ADR-029) — unless the adopter hands in their own `fetch`, and with it the choice.
  if (!options.fetch && typeof location !== 'undefined') {
    let origin: string | null = null;
    try {
      origin = new URL(`${base}/`, location.href).origin;
    } catch {
      origin = null;
    }
    if (origin !== location.origin) {
      throw new StartError('bundle-unavailable', `refusing to load the bundle from ${base}: it must be served from this site (${location.origin})`);
    }
  }
  const fetchFile = options.fetch ?? ((url: string) => fetch(url));
  const get = async <T>(file: string): Promise<T> => {
    let response: Response;
    try {
      response = await fetchFile(`${base}/${file}`);
    } catch (error) {
      throw new StartError('bundle-unavailable', `could not load ${base}/${file}: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!response.ok) {
      throw new StartError(
        'bundle-unavailable',
        `could not load ${base}/${file} (${response.status})${response.status === 404 ? ' — is it served there? A server started before the files or endpoint existed must be restarted' : ''}`,
      );
    }
    try {
      return (await response.json()) as T;
    } catch {
      throw new StartError('bundle-invalid', `${base}/${file} is not JSON — is the path serving the app's page instead?`);
    }
  };
  // A user who holds several roles (a teacher who is also a parent) is served each role's registry — the
  // server decides which, from the session — and gets their union. Its index is computed, never the
  // roles' indexes concatenated: each lives in its own vector space (`mergeRegistryFiles`, `indexFor`).
  const roles = [...new Set(typeof role === 'string' ? [role] : role)];
  if (roles.length === 0) throw new StartError('mount-failed', 'no role was given');
  const single = roles.length === 1;
  const [registries, index, thresholds] = await Promise.all([
    Promise.all(roles.map((r) => get<RegistryFile>(`registry.${r}.json`))),
    single ? get<ShippedIndex>(`index.${roles[0]}.json`) : Promise.resolve(undefined),
    get<{ thresholds: Thresholds; stage3?: Stage3Config }>('thresholds.hashing.json'),
  ]);
  try {
    return create(
      {
        registry: mergeRegistryFiles(registries),
        ...(index ? { index } : {}),
        thresholds: thresholds.thresholds,
        ...(thresholds.stage3 ? { stage3: thresholds.stage3 } : {}),
      },
      options.stage3Fetch ? { stage3Fetch: options.stage3Fetch } : {},
    );
  } catch (error) {
    throw new StartError('bundle-invalid', error instanceof Error ? error.message : String(error));
  }
}

export interface LoadOptions {
  /**
   * How to fetch the three files. Default: the page's own `fetch`, with no credentials beyond cookies.
   * For an app whose API wants a token — a single-page app with a Bearer token in memory — pass its own
   * authenticated client: `(url) => fetch(url, { headers: { Authorization: \`Bearer ${token}\` } })`.
   */
  readonly fetch?: (url: string) => Promise<Response>;
  /**
   * How to send a stage-3 request, when the build turned stage 3 on: the app's own authenticated
   * client, so the endpoint that calls a model can require a signed-in user. Default: the page's
   * `fetch`, which carries cookies and nothing else. It receives the URL and a full `RequestInit`
   * (method, headers, body, signal) and must pass them all on:
   * `(url, init) => api.fetch(url, { ...init, headers: { ...init.headers, Authorization: \`Bearer ${token}\` } })`.
   * The URL is always on this site: the widget checks that before this is called.
   * Separate from `fetch`, which is handed only a URL and would turn this POST into a GET.
   */
  readonly stage3Fetch?: Stage3Fetch;
}


export { present, wordsFor, fillParams, isSamePlace, searchChoice, DECIDE, WORDS, type Choice, type Decide, type Tone, type View, type Words } from './present.ts';
export { mount, adoptStyles, offerMove, NAVIGATE_EVENT, type MountOptions, type Mounted, type NavigateDetail, type Routable } from './widget.ts';
export { mountAssistant, LEARN_EVENT, TURN_EVENT, COMPANION_EVENT, type AssistantOptions, type Companion, type CompanionRequest, type CompanionTour, type CompanionTurn, type Lesson, type MountedAssistant } from './assistant.ts';

/** A corner named by `data-nextgen-position`. Only its side is used: the orb rests at the bottom. */
export type Corner = 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';

export const CORNERS: readonly Corner[] = ['bottom-right', 'bottom-left', 'top-right', 'top-left'];

export interface StartOptions extends AssistantOptions, LoadOptions {
  /** Mount inside this element instead of the page's body. The assistant still covers the page. */
  readonly target?: Element;
  /**
   * Which side the orb rests on: a left corner docks it left, a right corner right.
   * Without one it takes the emptier side. An explicit `dockSide` wins.
   */
  readonly position?: Corner;
}

/**
 * One line to put the assistant on a page: load this role's bundle, then mount the
 * assistant layer, which positions itself over the page. In a single-page app, pass
 * `options.navigate` — or listen for `nextgen:navigate` — so moving does not reload
 * the page.
 *
 * Rejects with a `StartError` when it cannot start, and announces that on the window as
 * `nextgen:error` first, with a `reason` — so a caller that forgets to catch still leaves a
 * trace. The script tag's own start-up catches it and warns, because it has no caller (script-tag.ts).
 */
export async function start(basePath: string, role: string | readonly string[], options: StartOptions = {}): Promise<MountedAssistant> {
  try {
    const assistant = await load(basePath, role, options);
    await bodyReady();
    const cornerSide = options.position ? (options.position.endsWith('left') ? 'left' : 'right') : 'auto';
    return mountAssistant(options.target ?? document.body, assistant, { ...options, dockSide: options.dockSide ?? cornerSide });
  } catch (error) {
    throw announceFailure(error);
  }
}

/** A script in <head> without `defer` runs before <body> exists. */
function bodyReady(): Promise<void> {
  if (document.body) return Promise.resolve();
  return new Promise((resolve) => document.addEventListener('DOMContentLoaded', () => resolve(), { once: true }));
}
