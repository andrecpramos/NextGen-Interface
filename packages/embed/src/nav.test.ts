import { describe, expect, it } from 'vitest';

import { adopterNav, type NavRoot } from './nav.ts';
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
