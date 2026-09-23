import { describe, expect, it } from 'vitest';

import type { Registry, TurnTrace } from '@nextgen/core-intent/browser';

import { mount, type Routable } from './widget.ts';

/**
 * The chat box, driven through a small fake DOM.
 *
 * There is no DOM library in this repository, and the widget only needs a few
 * DOM calls, so the fake implements exactly those. That is also a check that the
 * widget stays small: a call this fake lacks is a call the test rejects.
 * The decisions themselves are tested in present.test.ts; this file checks the
 * drawing, the accessibility attributes, and the wiring.
 */

type Listener = (event: { preventDefault(): void; key?: string }) => void;

class FakeElement {
  readonly children: FakeElement[] = [];
  readonly attributes = new Map<string, string>();
  readonly listeners = new Map<string, Listener[]>();
  shadowRoot: FakeElement | null = null;
  parent: FakeElement | null = null;
  ownText = '';
  readonly tagName: string;
  readonly ownerDocument: FakeDocument;
  [property: string]: unknown;

  constructor(tagName: string, ownerDocument: FakeDocument) {
    this.tagName = tagName;
    this.ownerDocument = ownerDocument;
  }

  get textContent(): string {
    return this.ownText + this.children.map((c) => c.textContent).join('');
  }
  set textContent(value: string) {
    this.ownText = value;
    this.children.length = 0;
  }
  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }
  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }
  removeAttribute(name: string): void {
    this.attributes.delete(name);
  }
  append(...nodes: FakeElement[]): void {
    for (const node of nodes) {
      node.parent = this;
      this.children.push(node);
    }
  }
  replaceChildren(...nodes: FakeElement[]): void {
    this.children.length = 0;
    this.ownText = '';
    this.append(...nodes);
  }
  remove(): void {
    if (!this.parent) return;
    this.parent.children.splice(this.parent.children.indexOf(this), 1);
    this.parent = null;
  }
  attachShadow(): FakeElement {
    this.shadowRoot = new FakeElement('#shadow-root', this.ownerDocument);
    return this.shadowRoot;
  }
  addEventListener(type: string, listener: Listener): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  fire(type: string, extra: { key?: string } = {}): { prevented: boolean } {
    const outcome = { prevented: false };
    for (const listener of this.listeners.get(type) ?? []) {
      listener({ ...extra, preventDefault: () => void (outcome.prevented = true) });
    }
    return outcome;
  }
  contains(node: FakeElement | null): boolean {
    if (!node) return false;
    if (node === this) return true;
    return this.children.some((child) => child.contains(node));
  }
  focus(): void {
    this.ownerDocument.activeElement = this;
  }
  /** As a real shadow root reports it: the focused node, but only if it is ours. */
  get activeElement(): FakeElement | null {
    const active = this.ownerDocument.activeElement;
    return active && this.contains(active) ? active : null;
  }
  find(predicate: (el: FakeElement) => boolean): FakeElement | undefined {
    for (const child of [...this.children, ...(this.shadowRoot ? [this.shadowRoot] : [])]) {
      if (predicate(child)) return child;
      const deeper = child.find(predicate);
      if (deeper) return deeper;
    }
    return undefined;
  }
}

class FakeDocument {
  readonly documentElement: FakeElement;
  readonly defaultView = null;
  activeElement: FakeElement | null = null;
  constructor(lang: string) {
    this.documentElement = new FakeElement('html', this);
    this.documentElement.setAttribute('lang', lang);
  }
  createElement(tag: string): FakeElement {
    return new FakeElement(tag, this);
  }
}

const caps = [
  { id: 'calendar.overview', kind: 'navigate', route: '/calendar', title: 'Calendário', explanation: 'Treinos e jogos por dia.' },
  { id: 'squad.list', kind: 'navigate', route: '/squad', title: 'Plantel', explanation: 'Todos os jogadores.' },
];
const registry = { capabilities: caps, byId: new Map(caps.map((c) => [c.id, c])), boundaryIds: new Set() } as unknown as Registry;

function assistantReturning(...traces: Partial<TurnTrace>[]): Routable & { asked: { utterance: string; route?: string }[] } {
  const asked: { utterance: string; route?: string }[] = [];
  let i = 0;
  return {
    registry,
    asked,
    async route(utterance, context) {
      asked.push({ utterance, ...(context?.route ? { route: context.route } : {}) });
      const next = traces[Math.min(i++, traces.length - 1)]!;
      return { outcome: 'execute', capabilityId: null, candidates: [], explanationRequest: false, ...next } as TurnTrace;
    },
  };
}

function setup(assistant: Routable, lang = 'pt-PT') {
  const doc = new FakeDocument(lang);
  const target = doc.createElement('body');
  const moves: string[] = [];
  const mounted = mount(target as unknown as Element, assistant, {
    navigate: (route) => void moves.push(route),
    currentPath: () => '/home',
  });
  const host = target.children[0]!;
  const by = (tag: string) => host.find((el) => el.tagName === tag)!;
  return { doc, target, host, moves, mounted, form: by('form'), input: by('input'), result: host.find((el) => el.getAttribute('role') === 'status')! };
}

describe('the chat box — structure and accessibility', () => {
  it('lives in a shadow root, as a labelled search form with an announced result', () => {
    const { host, form, input, result } = setup(assistantReturning({}));
    expect(host.shadowRoot).not.toBeNull();
    expect(form.getAttribute('role')).toBe('search');
    const label = host.find((el) => el.tagName === 'label')!;
    expect(label.getAttribute('for')).toBe(input.id);
    expect(label.textContent).toBe('Pergunte para onde quer ir'); // <html lang="pt-PT">
    expect(result.getAttribute('aria-live')).toBe('polite');
  });

  it('speaks English on an English page', () => {
    const { host } = setup(assistantReturning({}), 'en');
    expect(host.find((el) => el.tagName === 'label')!.textContent).toBe('Ask where to go');
  });
});

describe('the chat box — a turn', () => {
  it('routes from the current page, says where it is going, and moves', async () => {
    const assistant = assistantReturning({ capabilityId: 'calendar.overview' });
    const { form, input, result, moves } = setup(assistant);
    input.value = '  onde vejo o calendário ';
    expect(form.fire('submit').prevented).toBe(true);
    await new Promise((r) => setTimeout(r, 0));

    expect(assistant.asked).toEqual([{ utterance: 'onde vejo o calendário', route: '/home' }]);
    expect(result.textContent).toContain('A abrir Calendário');
    // Where it is going, and nothing more (ADR-030).
    expect(result.textContent).not.toContain('Treinos e jogos por dia.');
    expect(result.getAttribute('aria-busy')).toBeNull();
    expect(moves).toEqual(['/calendar']);
  });

  it('offers choices as real links, and follows one through the router supplied', async () => {
    const { mounted, host, moves } = setup(
      assistantReturning({
        outcome: 'clarify',
        candidates: [
          { capabilityId: 'calendar.overview', score: 0.5 },
          { capabilityId: 'squad.list', score: 0.4 },
        ],
      }),
    );
    await mounted.ask('jogos');
    const links: FakeElement[] = [];
    host.find((el) => (el.tagName === 'a' && links.push(el), false));
    expect(links.map((a) => a.href)).toEqual(['/calendar', '/squad']);
    expect(moves).toEqual([]); // a clarify moves nothing until the user picks
    expect(links[1]!.fire('click').prevented).toBe(true);
    expect(moves).toEqual(['/squad']);
  });

  it('keeps the user\'s place when a new answer removes the link they were on', async () => {
    // WP-45, found by the axe run and not by anyone reading this code: submit a
    // question, tab into the previous answer while it is still in flight, and
    // `replaceChildren` deletes the focused link. Focus then falls to the
    // document body — a screen-reader user is silently returned to the top of
    // the host page. Focus belongs in the input, ready for the next question.
    const { mounted, host, input, doc } = setup(
      assistantReturning({
        outcome: 'clarify',
        candidates: [
          { capabilityId: 'calendar.overview', score: 0.5 },
          { capabilityId: 'squad.list', score: 0.4 },
        ],
      }),
    );
    await mounted.ask('jogos');
    const link = host.find((el) => el.tagName === 'a')!;
    link.focus();
    expect(host.shadowRoot!.activeElement).toBe(link);

    await mounted.ask('jogos outra vez');
    expect(doc.activeElement).toBe(input);
    expect(host.shadowRoot!.activeElement).toBe(input);
  });

  it('leaves focus alone when the user was not inside the answer', async () => {
    // The other half: a widget that seizes focus on every answer is its own
    // accessibility bug. If the user is reading elsewhere on the page, the
    // answer is announced by the live region and nothing moves.
    const { mounted, doc, target } = setup(assistantReturning({ capabilityId: 'calendar.overview' }));
    const elsewhere = doc.createElement('a');
    target.append(elsewhere);
    elsewhere.focus();
    await mounted.ask('onde vejo o calendário');
    expect(doc.activeElement).toBe(elsewhere);
  });

  it('ignores an empty question', async () => {
    const assistant = assistantReturning({});
    const { mounted } = setup(assistant);
    expect(await mounted.ask('   ')).toBeNull();
    expect(assistant.asked).toEqual([]);
  });

  it('lets a newer question win over an older one that answers late', async () => {
    let release: () => void = () => {};
    const slow: Routable = {
      registry,
      route: (utterance) =>
        new Promise<TurnTrace>((resolve) => {
          const trace = { outcome: 'execute', capabilityId: utterance === 'first' ? 'squad.list' : 'calendar.overview', candidates: [], explanationRequest: false } as unknown as TurnTrace;
          if (utterance === 'first') release = () => resolve(trace);
          else resolve(trace);
        }),
    };
    const { mounted, result, moves } = setup(slow);
    const first = mounted.ask('first');
    await mounted.ask('second');
    release();
    await first;
    expect(result.textContent).toContain('Calendário');
    expect(moves).toEqual(['/calendar']);
  });

  it('says something went wrong, and moves nothing, when routing throws', async () => {
    const broken: Routable = { registry, route: () => Promise.reject(new Error('boom')) };
    const { mounted, result, moves } = setup(broken);
    await mounted.ask('anything');
    expect(result.textContent).toContain('Nada foi alterado');
    expect(moves).toEqual([]);
  });

  it('clears on Escape, and removes itself cleanly', async () => {
    const { mounted, input, result, target } = setup(assistantReturning({ capabilityId: 'calendar.overview' }));
    await mounted.ask('calendário');
    input.value = 'x';
    input.fire('keydown', { key: 'Escape' });
    expect(input.value).toBe('');
    expect(result.children).toHaveLength(0);
    mounted.destroy();
    expect(target.children).toHaveLength(0);
  });
});

describe('the chat box under a strict Content-Security-Policy', () => {
  // The policy itself is enforced only by a real browser: tooling/scripts/check-csp.mjs.
  // These pin the choices that make the widget survive one.

  /** A page whose window these tests can script: the fake document has none by default. */
  function withWindow(view: Record<string, unknown>, lang = 'pt-PT'): FakeDocument {
    const doc = new FakeDocument(lang);
    (doc as unknown as { defaultView: unknown }).defaultView = view;
    return doc;
  }

  it('styles itself with a constructed stylesheet where the browser has one, and adds no <style>', () => {
    class FakeSheet {
      text = '';
      replaceSync(css: string): void {
        this.text = css;
      }
    }
    const doc = withWindow({ CSSStyleSheet: FakeSheet, location: { pathname: '/home', assign: () => {} } });
    const create = doc.createElement.bind(doc);
    doc.createElement = (tag: string) => {
      const element = create(tag);
      if (tag === 'div') {
        const attach = element.attachShadow.bind(element);
        element.attachShadow = () => Object.assign(attach(), { adoptedStyleSheets: [] as FakeSheet[] });
      }
      return element;
    };
    const target = create('body');
    mount(target as unknown as Element, assistantReturning({}), { currentPath: () => '/home' });

    const root = target.children[0]!.shadowRoot!;
    const sheets = root.adoptedStyleSheets as FakeSheet[];
    expect(sheets).toHaveLength(1);
    expect(sheets[0]!.text).toContain('min-height: 48px');
    expect(root.find((el) => el.tagName === 'style')).toBeUndefined();
  });

  it('falls back to a <style> element only where it cannot construct a stylesheet', () => {
    const { host } = setup(assistantReturning({}));
    expect(host.find((el) => el.tagName === 'style')?.textContent).toContain('min-height: 48px');
  });

  it('without a router, offers each move to the page first, and reloads only if nothing takes it', async () => {
    const offered: string[] = [];
    const assigned: string[] = [];
    let pageTakesIt = true;
    class FakeCustomEvent {
      defaultPrevented = false;
      readonly type: string;
      readonly init: { detail: { route: string }; cancelable: boolean };
      constructor(type: string, init: { detail: { route: string }; cancelable: boolean }) {
        this.type = type;
        this.init = init;
      }
      get detail(): { route: string } {
        return this.init.detail;
      }
      preventDefault(): void {
        if (this.init.cancelable) this.defaultPrevented = true;
      }
    }
    const doc = withWindow({
      CustomEvent: FakeCustomEvent,
      location: { pathname: '/home', assign: (route: string) => void assigned.push(route) },
      dispatchEvent(event: FakeCustomEvent) {
        offered.push(`${event.type} ${event.detail.route}`);
        if (pageTakesIt) event.preventDefault();
        return !event.defaultPrevented;
      },
    });
    const target = doc.createElement('body');
    const mounted = mount(target as unknown as Element, assistantReturning({ capabilityId: 'calendar.overview' }, { capabilityId: 'squad.list' }), {
      currentPath: () => '/home',
    });

    await mounted.ask('calendário');
    expect(offered).toEqual(['nextgen:navigate /calendar']);
    expect(assigned).toEqual([]); // the page's router took it: no reload

    pageTakesIt = false;
    await mounted.ask('plantel');
    expect(offered).toEqual(['nextgen:navigate /calendar', 'nextgen:navigate /squad']);
    expect(assigned).toEqual(['/squad']); // nothing took it: an ordinary navigation
  });

  it('leaves a modified click to the browser: a new tab is not the router\'s job', async () => {
    const { mounted, host, moves } = setup(
      assistantReturning({ outcome: 'clarify', candidates: [{ capabilityId: 'calendar.overview', score: 0.5 }] }),
    );
    await mounted.ask('jogos');
    const link = host.find((el) => el.tagName === 'a')!;
    expect(link.fire('click', { ctrlKey: true } as { key?: string }).prevented).toBe(false);
    expect(moves).toEqual([]);
    expect(link.fire('click').prevented).toBe(true);
    expect(moves).toEqual(['/calendar']);
  });

  it('with neither a router nor a page that takes the move, a link is just a link', async () => {
    const doc = new FakeDocument('pt-PT');
    const target = doc.createElement('body');
    const mounted = mount(
      target as unknown as Element,
      assistantReturning({ outcome: 'clarify', candidates: [{ capabilityId: 'squad.list', score: 0.5 }] }),
      { currentPath: () => '/home' },
    );
    await mounted.ask('plantel');
    const link = target.find((el) => el.tagName === 'a')!;
    expect(link.fire('click').prevented).toBe(false);
  });
});
