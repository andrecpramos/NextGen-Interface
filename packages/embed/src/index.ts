// @nextgen/embed — Ladder C3 (WP-29): the navigation layer as one script tag.
//
//   <script src="/nextgen/nextgen.js" data-nextgen-role="PARENT" defer></script>
//
// The script tag starts itself from its own attributes (script-tag.ts), so a page
// needs no inline script and it works under a strict Content-Security-Policy.
// From a module instead: `import { start } from '@nextgen/embed'`.
//
// `start` loads the role's bundle and mounts the assistant layer (assistant.ts):
// a liquid orb at the edge of the page that opens into a full-screen assistant.
// `mount` is the plain chat box (widget.ts, WP-41) for a page that wants it inline.
// `load` gives the router alone, for a page that draws its own interface.
//
// For an application with no build step — the adopter C2's npm package cannot
// reach. It routes with stages 1 and 2 only, from the registry and index the
// generator emitted, so it needs no model server and makes no network call
// except fetching those three static files from the adopter's own origin.
//
// Everything here is a thin shell over code that is already measured:
// `registryFromIndex` (WP-24, 210/210 decision parity with the server path) and
// the guided-step resolver (WP-27, degrades to text rather than mispointing).
// This file adds no routing behaviour of its own, on purpose — a second
// implementation would be a second thing to keep in step.

import { registryFromIndex, makeEmbedder, route as routeTurn } from '@nextgen/core-intent/browser';
import type { Registry, RegistryFile, ShippedIndex, Thresholds, TurnTrace } from '@nextgen/core-intent/browser';
import type { GuidedStep } from '@nextgen/core-capability';

// The guided-step resolver (WP-27). It lived in packages/ui, beside React components a
// script tag must never drag in, and moved here when that package was removed.
import { resolveSteps, type AnchorRoot, type ResolvedStep } from './anchor.ts';

import { mountAssistant, type AssistantOptions, type MountedAssistant } from './assistant.ts';
import { SameOriginLlmRuntime, type Stage3Config } from './stage3.ts';

export type { Stage3Config } from './stage3.ts';

/** What the generator wrote for one role, as the adopter serves it. */
export interface Bundle {
  readonly registry: RegistryFile;
  readonly index: ShippedIndex;
  readonly thresholds: Thresholds;
  /**
   * Present only when `nextgen build --stage3 <path>` turned it on (ADR-017, WP-52).
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

/** Build an assistant from a bundle already in memory. No I/O at all. */
export function create(bundle: Bundle): Assistant {
  const registry: Registry = registryFromIndex(bundle.registry, bundle.index);

  // One encoder, fitted to THIS registry's documents and shared with nothing —
  // lessons.md L10 is what a shared, re-fitted encoder cost this project once.
  const embedder = makeEmbedder('hashing');
  embedder.fit?.(registry.documents);

  // Constructed once, not per turn: `SameOriginLlmRuntime`'s constructor is where the
  // origin check happens, and it never throws — a bad or off-origin config makes this
  // permanently unavailable, and every turn then degrades exactly like an absent
  // transport (WP-24's acceptance item, unchanged since bundle.stage3 is absent by
  // default). `undefined` here, not merely `useStage3: false`, so a caller poking at
  // internals sees "there is no runtime" rather than "there is one and it is switched off".
  const runtime = bundle.stage3 ? new SameOriginLlmRuntime(bundle.stage3) : undefined;

  return {
    capabilities: registry.capabilities.length,
    registry,
    route(utterance, context = {}) {
      return routeTurn(
        utterance,
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
 * only when a turn actually needs it (WP-52, ADR-017). Nothing changes for a bundle
 * built without `--stage3`: the field is absent, `create()` never constructs a runtime,
 * and the three fetches above stay the only network this script ever does.
 */
export async function load(basePath: string, role: string): Promise<Assistant> {
  const base = basePath.replace(/\/+$/, '');
  const get = async <T>(file: string): Promise<T> => {
    const response = await fetch(`${base}/${file}`);
    if (!response.ok) throw new Error(`NextGen: could not load ${base}/${file} (${response.status})`);
    return (await response.json()) as T;
  };
  const [registry, index, thresholds] = await Promise.all([
    get<RegistryFile>(`registry.${role}.json`),
    get<ShippedIndex>(`index.${role}.json`),
    get<{ thresholds: Thresholds; stage3?: Stage3Config }>('thresholds.hashing.json'),
  ]);
  return create({
    registry,
    index,
    thresholds: thresholds.thresholds,
    ...(thresholds.stage3 ? { stage3: thresholds.stage3 } : {}),
  });
}

export { present, wordsFor, fillParams, isSamePlace, WORDS, type Choice, type Tone, type View, type Words } from './present.ts';
export { mount, adoptStyles, offerMove, NAVIGATE_EVENT, type MountOptions, type Mounted, type NavigateDetail, type Routable } from './widget.ts';
export { mountAssistant, type AssistantOptions, type MountedAssistant } from './assistant.ts';

/** A corner named by `data-nextgen-position`. Only its side is used: the orb rests at the bottom. */
export type Corner = 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';

export const CORNERS: readonly Corner[] = ['bottom-right', 'bottom-left', 'top-right', 'top-left'];

export interface StartOptions extends AssistantOptions {
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
 * Rejects when the bundle cannot be loaded. The script tag's own start-up catches
 * that and warns instead, because it has no caller (script-tag.ts).
 */
export async function start(basePath: string, role: string, options: StartOptions = {}): Promise<MountedAssistant> {
  const assistant = await load(basePath, role);
  await bodyReady();
  const cornerSide = options.position ? (options.position.endsWith('left') ? 'left' : 'right') : 'auto';
  return mountAssistant(options.target ?? document.body, assistant, { ...options, dockSide: options.dockSide ?? cornerSide });
}

/** A script in <head> without `defer` runs before <body> exists. */
function bodyReady(): Promise<void> {
  if (document.body) return Promise.resolve();
  return new Promise((resolve) => document.addEventListener('DOMContentLoaded', () => resolve(), { once: true }));
}
