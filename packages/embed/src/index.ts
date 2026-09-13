// @nextgen/embed — Ladder C3 (WP-29): the navigation layer as one script tag.
//
//   <script src="/nextgen/nextgen.js" data-nextgen-role="PARENT" defer></script>
//
// The script tag starts itself from its own attributes (script-tag.ts), so a page
// needs no inline script and it works under a strict Content-Security-Policy.
// From a module instead: `import { start } from '@nextgen/embed'`.
//
// `start` loads the role's bundle and mounts the chat box (widget.ts, WP-41).
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

import { mount, type MountOptions, type Mounted } from './widget.ts';

/** What the generator wrote for one role, as the adopter serves it. */
export interface Bundle {
  readonly registry: RegistryFile;
  readonly index: ShippedIndex;
  readonly thresholds: Thresholds;
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
        // No stage-3 transport: a turn stages 1 and 2 cannot settle ends in a
        // clarifying question, never in a guess (WP-24's third acceptance item).
        { registry, embedder, thresholds: bundle.thresholds, useStage3: false },
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
 * Three same-origin static files, the only requests this script ever makes. The
 * adopter decides the path and serves them; nothing is fetched from anywhere
 * else, which is what keeps Rule 8 true for C3 exactly as it is for C2.
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
    get<{ thresholds: Thresholds }>('thresholds.hashing.json'),
  ]);
  return create({ registry, index, thresholds: thresholds.thresholds });
}

export { present, wordsFor, fillParams, isSamePlace, WORDS, type Choice, type Tone, type View, type Words } from './present.ts';
export { mount, NAVIGATE_EVENT, type MountOptions, type Mounted, type NavigateDetail, type Routable } from './widget.ts';

/** Where `start` fixes the chat box when no `target` is given. */
export type Corner = 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';

/**
 * Set through the CSSOM (`style.cssText`), which a strict `style-src` does not
 * govern — measured alongside the stylesheet in widget.ts. An allowlist, so a
 * value read from an HTML attribute never becomes CSS.
 */
const CORNER_CSS: Readonly<Record<Corner, string>> = {
  'bottom-right': 'bottom:16px;right:16px;',
  'bottom-left': 'bottom:16px;left:16px;',
  'top-right': 'top:16px;right:16px;',
  'top-left': 'top:16px;left:16px;',
};

export const CORNERS = Object.keys(CORNER_CSS) as readonly Corner[];

export interface StartOptions extends MountOptions {
  /** Mount inside this element instead of a fixed corner of the page. */
  readonly target?: Element;
  /** Which corner, when there is no `target`. Default `bottom-right`. */
  readonly position?: Corner;
}

/**
 * One line to put the assistant on a page: load this role's bundle, then mount
 * the chat box, in `options.target` if one is given and otherwise fixed to a
 * corner of the page. In a single-page app, pass `options.navigate` — or listen
 * for `nextgen:navigate` — so moving does not reload the page.
 *
 * Rejects when the bundle cannot be loaded. The script tag's own start-up catches
 * that and warns instead, because it has no caller (script-tag.ts).
 */
export async function start(basePath: string, role: string, options: StartOptions = {}): Promise<Mounted> {
  const assistant = await load(basePath, role);
  await bodyReady();
  let target = options.target;
  if (!target) {
    const corner = document.createElement('div');
    corner.style.cssText = `position:fixed;${CORNER_CSS[options.position ?? 'bottom-right'] ?? CORNER_CSS['bottom-right']}z-index:2147483000;`;
    document.body.append(corner);
    target = corner;
  }
  return mount(target, assistant, options);
}

/** A script in <head> without `defer` runs before <body> exists. */
function bodyReady(): Promise<void> {
  if (document.body) return Promise.resolve();
  return new Promise((resolve) => document.addEventListener('DOMContentLoaded', () => resolve(), { once: true }));
}
