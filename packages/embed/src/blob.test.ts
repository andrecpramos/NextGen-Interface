import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Registry, TurnTrace } from '@nextgen/core-intent/browser';

import { mountBlob, type Routable } from './blob.ts';

/**
 * The blob, driven through a small fake DOM — the same fake as widget.test.ts
 * (opening the blob mounts the real chat box, so its fake DOM needs must be
 * met too), plus what the blob itself reads: `elementsFromPoint` for docking,
 * `dataset`/`style` for the attributes and inline positioning it sets, and a
 * fake `window` for its timers and `location.assign`. `chooseDockSide` itself
 * is tested on its own in packages/ui/src/dock.test.ts — this file only
 * checks that the blob wires it up and reacts to the result.
 */

type Listener = (event: { preventDefault(): void; key?: string }) => void;

class FakeElement {
  readonly children: FakeElement[] = [];
  readonly attributes = new Map<string, string>();
  readonly listeners = new Map<string, Listener[]>();
  shadowRoot: FakeElement | null = null;
  parent: FakeElement | null = null;
  style = { cssText: '' };
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
  fire(type: string, extra: { key?: string } = {}): void {
    for (const listener of this.listeners.get(type) ?? []) listener({ ...extra, preventDefault: () => {} });
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
  get dataset(): Record<string, string | undefined> {
    const el = this;
    return new Proxy({} as Record<string, string | undefined>, {
      get: (_t, prop: string) => el.getAttribute(`data-${prop}`) ?? undefined,
      set: (_t, prop: string, value: string) => (el.setAttribute(`data-${prop}`, value), true),
    });
  }
}

class FakeDocument {
  readonly documentElement: FakeElement;
  activeElement: FakeElement | null = null;
  defaultView: FakeWindow | null = null;
  /** Overridden per test to simulate a fixed sidebar occupying an edge. */
  elementsFromPoint: (x: number, y: number) => { tagName: string }[] = () => [];
  constructor(lang: string) {
    this.documentElement = new FakeElement('html', this);
    this.documentElement.setAttribute('lang', lang);
  }
  createElement(tag: string): FakeElement {
    return new FakeElement(tag, this);
  }
}

class FakeWindow {
  innerWidth = 1200;
  innerHeight = 800;
  readonly moved: string[] = [];
  location = { assign: (route: string) => void this.moved.push(route) };
  setTimeout(fn: () => void, ms: number): ReturnType<typeof setTimeout> {
    return setTimeout(fn, ms);
  }
  clearTimeout(id: ReturnType<typeof setTimeout>): void {
    clearTimeout(id);
  }
}

const registry = { capabilities: [], byId: new Map(), boundaryIds: new Set() } as unknown as Registry;

function assistantReturning(...traces: Partial<TurnTrace>[]): Routable {
  let i = 0;
  return {
    registry,
    async route(): Promise<TurnTrace> {
      const next = traces[Math.min(i++, traces.length - 1)]!;
      return { outcome: 'execute', capabilityId: null, candidates: [], explanationRequest: false, ...next } as TurnTrace;
    },
  };
}

function setup(assistant: Routable, options: Parameters<typeof mountBlob>[2] = {}) {
  const doc = new FakeDocument('en');
  doc.defaultView = new FakeWindow();
  const target = doc.createElement('body');
  const mounted = mountBlob(target as unknown as Element, assistant, options);
  const host = target.children[0]!;
  const button = host.find((el) => el.tagName === 'button')!;
  return { doc, target, host, button, mounted, window: doc.defaultView! };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('the blob — mounting', () => {
  it('lives in a shadow root, centered, collapsed, and labelled', () => {
    const { host, button } = setup(assistantReturning({}));
    expect(host.shadowRoot).not.toBeNull();
    expect(button.dataset.docked).toBe('false');
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(button.getAttribute('aria-label')).toBe('Ask where to go');
  });
});

describe('the blob — docking', () => {
  it('docks after the timeout when nothing navigates first', () => {
    const { button } = setup(assistantReturning({}), { dockAfterMs: 1000 });
    vi.advanceTimersByTime(999);
    expect(button.dataset.docked).toBe('false');
    vi.advanceTimersByTime(1);
    expect(button.dataset.docked).toBe('true');
  });

  it('docks immediately on the first tap, not at the timeout', () => {
    const { button } = setup(assistantReturning({}), { dockAfterMs: 5000 });
    button.fire('click'); // opens the chat box, and should dock right away
    expect(button.dataset.docked).toBe('true');
  });

  it('a navigation reached through the opened chat box still moves the page', async () => {
    const caps = [{ id: 'calendar.overview', kind: 'navigate', route: '/calendar', title: 'Calendar', explanation: null }];
    const reg = { capabilities: caps, byId: new Map(caps.map((c) => [c.id, c])), boundaryIds: new Set() } as unknown as Registry;
    const assistant: Routable = {
      registry: reg,
      route: async () => ({ outcome: 'execute', capabilityId: 'calendar.overview', candidates: [], explanationRequest: false }) as unknown as TurnTrace,
    };
    const moves: string[] = [];
    const { button, target } = setup(assistant, { navigate: (r) => moves.push(r), currentPath: () => '/home' });

    button.fire('click');
    const input = target.find((el) => el.tagName === 'input')!;
    const form = target.find((el) => el.tagName === 'form')!;
    input.value = 'onde vou?';
    form.fire('submit');
    await Promise.resolve();
    await Promise.resolve();

    expect(moves).toEqual(['/calendar']);
  });

  it('picks the side chooseDockSide reports, not a fixed default', () => {
    const doc = new FakeDocument('en');
    doc.defaultView = new FakeWindow();
    doc.elementsFromPoint = (x) => (x > 1180 ? [{ tagName: 'NAV' }] : [{ tagName: 'BODY' }]);
    const target = doc.createElement('body');
    const mounted = mountBlob(target as unknown as Element, assistantReturning({}), { dockAfterMs: 100 });
    const button = target.children[0]!.find((el) => el.tagName === 'button')!;
    vi.advanceTimersByTime(100);
    expect(button.dataset.side).toBe('left'); // the right edge is occupied
    mounted.destroy();
  });

  it('a forced dockSide overrides the heuristic', () => {
    const doc = new FakeDocument('en');
    doc.defaultView = new FakeWindow();
    doc.elementsFromPoint = () => []; // both edges empty — the heuristic would say 'right'
    const target = doc.createElement('body');
    const mounted = mountBlob(target as unknown as Element, assistantReturning({}), { dockAfterMs: 50, dockSide: 'left' });
    const button = target.children[0]!.find((el) => el.tagName === 'button')!;
    vi.advanceTimersByTime(50);
    expect(button.dataset.side).toBe('left');
    mounted.destroy();
  });
});

describe('the blob — opening and closing the chat box', () => {
  it('opens the chat box on the first tap, and reports it in aria-expanded', () => {
    const { target, button } = setup(assistantReturning({}));
    button.fire('click');
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(target.find((el) => el.getAttribute('role') === 'search')).toBeTruthy();
  });

  it('closes on the second tap, removing the panel', () => {
    const { target, button } = setup(assistantReturning({}));
    button.fire('click');
    button.fire('click');
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(target.find((el) => el.getAttribute('role') === 'search')).toBeUndefined();
  });

  it('marks itself thinking while a turn is in flight, and idle once it resolves', async () => {
    let release: (t: TurnTrace) => void = () => {};
    const slow: Routable = {
      registry,
      route: () => new Promise<TurnTrace>((resolve) => (release = resolve)),
    };
    const { target, button } = setup(slow);
    button.fire('click');
    const input = target.find((el) => el.tagName === 'input')!;
    const form = target.find((el) => el.tagName === 'form')!;
    input.value = 'onde vou?';
    form.fire('submit');
    expect(button.dataset.state).toBe('thinking');
    release({ outcome: 'execute', capabilityId: null, candidates: [], explanationRequest: false } as unknown as TurnTrace);
    await Promise.resolve();
    await Promise.resolve();
    expect(button.dataset.state).toBe('idle');
  });
});

describe('the blob — destroy', () => {
  it('removes itself and stops the pending dock timer', () => {
    const { target, button, mounted } = setup(assistantReturning({}), { dockAfterMs: 1000 });
    mounted.destroy();
    expect(target.children).toHaveLength(0);
    vi.advanceTimersByTime(2000);
    // If the timer had survived, this would have docked — it should not have.
    expect(button.dataset.docked).toBe('false');
  });
});
