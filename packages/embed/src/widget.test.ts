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
    expect(result.textContent).toContain('Treinos e jogos por dia.');
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
