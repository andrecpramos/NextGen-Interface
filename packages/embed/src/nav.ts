// The adopter's own navigation, read from their page.
//
// The assistant screen covers the page, so its menu button offers the app's real
// navigation rather than a second one of our own (ADR-013: we do not build a
// parallel navigation for an app that already has one). The links are the
// adopter's, in their order, with their labels; the current page is marked as
// they mark it. Nothing is changed on their page — this only reads it.
//
// Which navigation: a `nav` or `[role="navigation"]` with at least two links,
// outside any footer; one named as the main navigation wins, otherwise the one
// with the most links. Only same-origin http(s) links are kept — never another
// site, an in-page anchor, or a `javascript:` URL.

import { isSamePlace } from './present.ts';

export interface NavLink {
  readonly label: string;
  /** Path, query and hash on the adopter's own origin. */
  readonly href: string;
  readonly current: boolean;
}

export interface NavNode {
  getAttribute(name: string): string | null;
  readonly textContent: string | null;
  querySelectorAll(selector: string): ArrayLike<NavNode>;
  closest?(selector: string): NavNode | null;
}

export interface NavRoot {
  querySelectorAll(selector: string): ArrayLike<NavNode>;
}

export interface NavOptions {
  /** The page's own URL, which relative hrefs resolve against. */
  readonly base: string;
  readonly currentPath: string;
  /** The assistant's own layer, which is never read as the adopter's navigation. */
  readonly exclude?: { contains(node: never): boolean } | null;
  /**
   * The adopter's selector for their navigation, when it is a `div` sidebar with no `nav` or
   * `role="navigation"` — common in apps built from generic components. Replaces the default search.
   */
  readonly selector?: string | null;
}

/** The elements that are navigation: the adopter's selector, else the semantic ones. Never throws. */
function navigations<T>(root: { querySelectorAll(selector: string): ArrayLike<T> }, selector: string | null | undefined, fallback: readonly string[]): T[] {
  const selectors = selector ? [selector] : fallback;
  const out: T[] = [];
  for (const s of selectors) {
    try {
      for (const node of Array.from(root.querySelectorAll(s))) if (!out.includes(node)) out.push(node);
    } catch {
      // an invalid selector from the adopter: nothing found, never an exception in their page
    }
  }
  return out;
}

const MAIN = /\b(main|primary|principal|site|global)\b/i;

function linksIn(nav: NavNode, origin: string, options: NavOptions): NavLink[] {
  const out: NavLink[] = [];
  const seen = new Set<string>();
  for (const a of Array.from(nav.querySelectorAll('a[href]'))) {
    const raw = (a.getAttribute('href') ?? '').trim();
    if (!raw || raw.startsWith('#')) continue;
    let url: URL;
    try {
      url = new URL(raw, options.base);
    } catch {
      continue;
    }
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.origin !== origin) continue;
    const href = `${url.pathname}${url.search}${url.hash}`;
    const label = (a.getAttribute('aria-label') || a.textContent || '').replace(/\s+/g, ' ').trim();
    if (!label || seen.has(href)) continue;
    seen.add(href);
    const aria = a.getAttribute('aria-current');
    out.push({ label, href, current: (aria !== null && aria !== 'false') || isSamePlace(url.pathname, options.currentPath) });
  }
  return out;
}

export function adopterNav(root: NavRoot, options: NavOptions): NavLink[] {
  let origin: string;
  try {
    origin = new URL(options.base).origin;
  } catch {
    return [];
  }
  const all = navigations(root, options.selector, ['nav', '[role="navigation"]']);
  let best: NavLink[] = [];
  let bestScore = 0;
  all.forEach((nav) => {
    if (options.exclude?.contains(nav as never) || nav.closest?.('footer')) return;
    const links = linksIn(nav, origin, options);
    if (links.length < 2) return;
    const score = links.length + (MAIN.test(nav.getAttribute('aria-label') ?? '') ? 1000 : 0);
    if (score > bestScore) {
      best = links;
      bestScore = score;
    }
  });
  return best;
}

// ------------------------------------------------------------------ frame --
//
// Where the adopter's navigation sits on the screen, so the full-screen assistant can leave it in view
// (ADR-026): a sidebar against the left edge, a bar across the top. The assistant covers the rest. Only
// read, never changed; a navigation that is neither — a drawer, a menu in the page's flow — frames nothing.

interface Box {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/** The slice of an element `navFrame` reads. `Element` satisfies it. */
export interface FrameNode {
  getBoundingClientRect(): Box;
  readonly parentElement: FrameNode | null;
}

export interface FrameRoot {
  querySelectorAll(selector: string): ArrayLike<FrameNode>;
}

/** How far in from the left and the top the adopter's own navigation reaches. Zero where it has none. */
export interface Frame {
  readonly left: number;
  readonly top: number;
}

/** A sidebar is at most this share of the width and at least this share of the height; a top bar the reverse. */
const SIDEBAR_MAX_WIDTH = 0.4;
const SIDEBAR_MIN_HEIGHT = 0.5;
const BAR_MAX_HEIGHT = 0.25;
const BAR_MIN_WIDTH = 0.6;
/** Touching an edge, give or take a border. */
const AT_EDGE = 2;

function box(node: FrameNode): Box | null {
  try {
    const r = node.getBoundingClientRect();
    return r.width > 0 && r.height > 0 ? r : null;
  } catch {
    return null;
  }
}

/**
 * The navigation's own `<nav>` is often only its list of links, inside a taller sidebar that also holds
 * the account menu. So each one is widened to the largest ancestor still on the same edge and still
 * the shape of a sidebar (or a bar).
 */
export function navFrame(
  root: FrameRoot,
  viewport: { readonly innerWidth: number; readonly innerHeight: number },
  exclude?: { contains(node: never): boolean } | null,
  selector?: string | null,
): Frame {
  const w = viewport.innerWidth;
  const h = viewport.innerHeight;
  let left = 0;
  let top = 0;
  for (const node of navigations(root, selector, ['nav', '[role="navigation"]', 'aside'])) {
    if (exclude?.contains(node as never)) continue;
    const own = box(node);
    if (!own) continue;
    if (own.left <= AT_EDGE && own.width <= w * SIDEBAR_MAX_WIDTH) {
      let tallest = own;
      for (let up = node.parentElement; up; up = up.parentElement) {
        const r = box(up);
        if (!r || r.left > AT_EDGE || r.width > w * SIDEBAR_MAX_WIDTH) break;
        if (r.height > tallest.height) tallest = r;
      }
      if (tallest.height >= h * SIDEBAR_MIN_HEIGHT) left = Math.max(left, tallest.left + tallest.width);
    }
    if (own.top <= AT_EDGE && own.height <= h * BAR_MAX_HEIGHT) {
      let widest = own;
      for (let up = node.parentElement; up; up = up.parentElement) {
        const r = box(up);
        if (!r || r.top > AT_EDGE || r.height > h * BAR_MAX_HEIGHT) break;
        if (r.width > widest.width) widest = r;
      }
      if (widest.width >= w * BAR_MIN_WIDTH) top = Math.max(top, widest.top + widest.height);
    }
  }
  return { left: Math.round(left), top: Math.round(top) };
}
