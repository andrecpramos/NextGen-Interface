import { describe, expect, it } from 'vitest';

import { adopterNav, navFrame, type FrameNode, type FrameRoot, type NavRoot } from './nav.ts';
import { FakeDocument, type FakeElement } from './test-support/fake-dom.ts';

/**
 * The menu offers the adopter's own navigation. These pages are built the way real
 * apps are: a header nav, a sidebar, a footer, links in several spellings.
 */

function node(doc: FakeDocument, tag: string, attrs: Record<string, string> = {}, children: FakeElement[] = []): FakeElement {
  const el = doc.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, value);
  el.append(...children);
  return el;
}

function link(doc: FakeDocument, href: string, text: string, attrs: Record<string, string> = {}): FakeElement {
  const a = node(doc, 'a', { href, ...attrs });
  a.textContent = text;
  return a;
}

const read = (doc: FakeDocument, currentPath = '/home', exclude: FakeElement | null = null) =>
  adopterNav(doc as unknown as NavRoot, { base: `http://club.test${currentPath}`, currentPath, exclude });

describe('adopterNav', () => {
  it("reads the app's main navigation, in its order, marking where the user is", () => {
    const doc = new FakeDocument();
    doc.body.append(
      node(doc, 'header', {}, [
        node(doc, 'nav', { 'aria-label': 'Main' }, [
          link(doc, '/home', 'Home'),
          link(doc, 'calendar', 'Calendar'),
          link(doc, '/squad?tab=all', 'Squad', { 'aria-current': 'page' }),
        ]),
      ]),
      node(doc, 'aside', {}, [
        node(doc, 'nav', {}, [link(doc, '/a', 'A'), link(doc, '/b', 'B'), link(doc, '/c', 'C'), link(doc, '/d', 'D')]),
      ]),
      node(doc, 'footer', {}, [node(doc, 'nav', { 'aria-label': 'Main footer' }, [link(doc, '/terms', 'Terms'), link(doc, '/privacy', 'Privacy')])]),
    );
    expect(read(doc)).toEqual([
      { label: 'Home', href: '/home', current: true },
      { label: 'Calendar', href: '/calendar', current: false },
      { label: 'Squad', href: '/squad?tab=all', current: true },
    ]);
  });

  it('without a named one, takes the navigation with the most links', () => {
    const doc = new FakeDocument();
    doc.body.append(
      node(doc, 'nav', {}, [link(doc, '/a', 'A'), link(doc, '/b', 'B')]),
      node(doc, 'div', { role: 'navigation' }, [link(doc, '/c', 'C'), link(doc, '/d', 'D'), link(doc, '/e', 'E')]),
    );
    expect(read(doc).map((l) => l.href)).toEqual(['/c', '/d', '/e']);
  });

  it('leaves out other sites, in-page anchors, other schemes, empty labels and repeats', () => {
    const doc = new FakeDocument();
    doc.body.append(
      node(doc, 'nav', {}, [
        link(doc, '/x', 'X'),
        link(doc, 'https://elsewhere.test/y', 'Elsewhere'),
        link(doc, '#top', 'Top'),
        link(doc, 'mailto:club@club.test', 'Mail'),
        link(doc, 'javascript:void(0)', 'Script'),
        link(doc, '/x', 'X again'),
        link(doc, '/empty', '   '),
        link(doc, '/w', '', { 'aria-label': 'Workouts' }),
      ]),
    );
    expect(read(doc)).toEqual([
      { label: 'X', href: '/x', current: false },
      { label: 'Workouts', href: '/w', current: false },
    ]);
  });

  it('a navigation with fewer than two links is not the navigation', () => {
    const doc = new FakeDocument();
    doc.body.append(node(doc, 'nav', { 'aria-label': 'Main' }, [link(doc, '/', 'Logo')]));
    expect(read(doc)).toEqual([]);
  });

  it('never reads the assistant’s own layer', () => {
    const doc = new FakeDocument();
    const layer = node(doc, 'div', {}, [node(doc, 'nav', {}, [link(doc, '/a', 'A'), link(doc, '/b', 'B')])]);
    doc.body.append(layer);
    expect(read(doc, '/home', layer)).toEqual([]);
  });
});

/**
 * Where the app's navigation sits, so the full-screen assistant leaves it in view (ADR-026). Plain
 * boxes stand in for a laid-out page: `parentElement` and `getBoundingClientRect` are all it reads.
 */
describe('navFrame', () => {
  interface Box {
    left: number;
    top: number;
    width: number;
    height: number;
  }
  const el = (box: Box, parentElement: FrameNode | null = null): FrameNode => ({ getBoundingClientRect: () => box, parentElement });
  const page = (byTag: Record<string, FrameNode[]>): FrameRoot => ({
    querySelectorAll: (selector) => byTag[selector] ?? [],
  });
  const viewport = { innerWidth: 1440, innerHeight: 900 };

  it('finds a sidebar against the left edge, widened to the container that also holds its account menu', () => {
    const sidebar = el({ left: 0, top: 0, width: 264, height: 900 });
    // The <nav> is only the list of links, not the whole sidebar.
    const nav = el({ left: 0, top: 64, width: 248, height: 520 }, sidebar);
    expect(navFrame(page({ nav: [nav] }), viewport)).toEqual({ left: 264, top: 0 });
  });

  it('finds a bar across the top', () => {
    const header = el({ left: 0, top: 0, width: 1440, height: 64 });
    expect(navFrame(page({ '[role="navigation"]': [header] }), viewport)).toEqual({ left: 0, top: 64 });
  });

  it('finds both, a sidebar beside a bar', () => {
    const sidebar = el({ left: 0, top: 0, width: 240, height: 900 });
    const bar = el({ left: 240, top: 0, width: 1200, height: 56 });
    expect(navFrame(page({ aside: [sidebar], nav: [bar] }), viewport)).toEqual({ left: 240, top: 56 });
  });

  it('frames nothing for a navigation in the page’s flow, a hidden one, or its own layer', () => {
    const inFlow = el({ left: 320, top: 400, width: 600, height: 48 });
    const hidden = el({ left: 0, top: 0, width: 0, height: 0 });
    const wide = el({ left: 0, top: 0, width: 900, height: 900 });
    const ours = el({ left: 0, top: 0, width: 240, height: 900 });
    const frame = navFrame(page({ nav: [inFlow, hidden, wide, ours] }), viewport, { contains: (node: never) => node === ours });
    expect(frame).toEqual({ left: 0, top: 0 });
  });

  it('frames nothing for a short list of links that merely starts at the left edge', () => {
    const shortNav = el({ left: 0, top: 300, width: 200, height: 160 });
    expect(navFrame(page({ nav: [shortNav] }), viewport)).toEqual({ left: 0, top: 0 });
  });
});
