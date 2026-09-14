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
  const all = [...Array.from(root.querySelectorAll('nav')), ...Array.from(root.querySelectorAll('[role="navigation"]'))];
  let best: NavLink[] = [];
  let bestScore = 0;
  all.forEach((nav, index) => {
    if (all.indexOf(nav) !== index) return;
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
