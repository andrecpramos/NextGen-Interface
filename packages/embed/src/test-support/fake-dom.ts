// A small fake DOM for driving the assistant layer in tests.
//
// There is no DOM library in this repository (widget.test.ts explains why), so
// this implements exactly the calls the assistant makes. A call this fake lacks
// is a call the test rejects — which is also a check that the layer stays small.

type Listener = (event: FakeEvent) => void;

/** Exactly the selectors the guided-step resolver asks a page for: a tag, `#id`, `[attr]`, `[attr="v"]`. */
export function matchesSelector(el: FakeElement, selector: string): boolean {
  const m = /^([a-zA-Z]*)((?:\[[^\]]+\])*)$|^#([\w-]+)$/.exec(selector.trim());
  if (!m) throw new SyntaxError(`unsupported selector ${selector}`);
  if (m[3]) return el.getAttribute('id') === m[3];
  if (m[1] && el.tagName.toLowerCase() !== m[1].toLowerCase()) return false;
  for (const clause of (m[2] ?? '').match(/\[[^\]]+\]/g) ?? []) {
    const [, attr, value] = /^\[([\w-]+)(?:="([^"]*)")?\]$/.exec(clause) ?? [];
    if (!attr) throw new SyntaxError(`unsupported clause ${clause}`);
    const actual = el.getAttribute(attr);
    if (actual === null) return false;
    if (value !== undefined && actual !== value) return false;
  }
  return true;
}

export interface FakeEvent {
  preventDefault(): void;
  readonly defaultPrevented: boolean;
  readonly key?: string;
  readonly shiftKey?: boolean;
  readonly ctrlKey?: boolean;
  readonly metaKey?: boolean;
  readonly altKey?: boolean;
  readonly button?: number;
}

export class FakeElement {
  readonly children: FakeElement[] = [];
  readonly attributes = new Map<string, string>();
  readonly listeners = new Map<string, Listener[]>();
  readonly style: Record<string, string> & {
    setProperty(name: string, value: string, priority?: string): void;
    removeProperty(name: string): string;
  };
  shadowRoot: FakeElement | null = null;
  parent: FakeElement | null = null;
  ownText = '';
  readonly tagName: string;
  readonly ownerDocument: FakeDocument;
  [property: string]: unknown;

  constructor(tagName: string, ownerDocument: FakeDocument) {
    this.tagName = tagName;
    this.ownerDocument = ownerDocument;
    const style: Record<string, string> = {};
    this.style = Object.assign(style, {
      setProperty: (name: string, value: string) => void (style[name] = value),
      removeProperty: (name: string): string => {
        const was = style[name] ?? '';
        delete style[name];
        return was;
      },
    });
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
  hasAttribute(name: string): boolean {
    return this.attributes.has(name);
  }
  removeAttribute(name: string): void {
    this.attributes.delete(name);
  }
  get dataset(): Record<string, string | undefined> {
    const el = this;
    return new Proxy({} as Record<string, string | undefined>, {
      get: (_t, prop: string) => el.getAttribute(`data-${prop}`) ?? undefined,
      set: (_t, prop: string, value: string) => (el.setAttribute(`data-${prop}`, value), true),
    });
  }
  append(...nodes: FakeElement[]): void {
    for (const node of nodes) {
      node.remove();
      node.parent = this;
      this.children.push(node);
    }
  }
  replaceChildren(...nodes: FakeElement[]): void {
    for (const child of this.children) child.parent = null;
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
    this.shadowRoot.parent = null;
    return this.shadowRoot;
  }
  addEventListener(type: string, listener: Listener): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  removeEventListener(type: string, listener: Listener): void {
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter((l) => l !== listener));
  }
  /** As `HTMLElement.click()`: a click, as if pressed. */
  click(): void {
    this.fire('click');
  }
  fire(type: string, extra: Partial<FakeEvent> = {}): FakeEvent {
    let prevented = false;
    const event: FakeEvent = {
      ...extra,
      preventDefault: () => void (prevented = true),
      get defaultPrevented() {
        return prevented;
      },
    };
    for (const listener of this.listeners.get(type) ?? []) listener(event);
    return event;
  }
  contains(node: FakeElement | null): boolean {
    if (!node) return false;
    if (node === this) return true;
    return [...this.children, ...(this.shadowRoot ? [this.shadowRoot] : [])].some((child) => child.contains(node));
  }
  focus(): void {
    this.ownerDocument.activeElement = this;
  }
  get activeElement(): FakeElement | null {
    const active = this.ownerDocument.activeElement;
    return active && this.contains(active) ? active : null;
  }
  getBoundingClientRect(): { left: number; top: number; width: number; height: number } {
    return { left: 0, top: 0, width: 0, height: 0 };
  }
  find(predicate: (el: FakeElement) => boolean): FakeElement | undefined {
    for (const child of [...this.children, ...(this.shadowRoot ? [this.shadowRoot] : [])]) {
      if (predicate(child)) return child;
      const deeper = child.find(predicate);
      if (deeper) return deeper;
    }
    return undefined;
  }
  findAll(predicate: (el: FakeElement) => boolean): FakeElement[] {
    const out: FakeElement[] = [];
    this.find((el) => (predicate(el) && out.push(el), false));
    return out;
  }
  /** As `document.querySelectorAll` sees it: light DOM only, never inside a shadow root. */
  findLight(predicate: (el: FakeElement) => boolean): FakeElement[] {
    const out: FakeElement[] = [];
    for (const child of this.children) {
      if (predicate(child)) out.push(child);
      out.push(...child.findLight(predicate));
    }
    return out;
  }
  querySelectorAll(selector: string): FakeElement[] {
    return this.findLight((el) => matchesSelector(el, selector));
  }
  closest(selector: string): FakeElement | null {
    for (let el: FakeElement | null = this; el; el = el.parent) {
      if (matchesSelector(el, selector)) return el;
    }
    return null;
  }
}

export class FakeWindow {
  innerWidth = 1200;
  innerHeight = 800;
  readonly moved: string[] = [];
  wentBack = 0;
  history = { length: 2, back: () => void this.wentBack++ };
  readonly listeners = new Map<string, (() => void)[]>();
  // Loopback, deliberately: this file is not a *.test.ts, so check-network-egress.mjs reads it as runtime code.
  location = { pathname: '/home', href: 'http://localhost/home', assign: (route: string) => void this.moved.push(route) };
  setTimeout(fn: () => void, ms: number): number {
    return setTimeout(fn, ms) as unknown as number;
  }
  clearTimeout(id: number): void {
    clearTimeout(id);
  }
  setInterval(fn: () => void, ms: number): number {
    return setInterval(fn, ms) as unknown as number;
  }
  clearInterval(id: number): void {
    clearInterval(id);
  }
  addEventListener(type: string, fn: () => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  removeEventListener(type: string, fn: () => void): void {
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter((l) => l !== fn));
  }
}

export class FakeDocument {
  readonly documentElement: FakeElement;
  readonly body: FakeElement;
  activeElement: FakeElement | null = null;
  defaultView: FakeWindow | null;
  /** Overridden per test to put fixed chrome on one edge. */
  elementsFromPoint: (x: number, y: number) => { tagName: string }[] = () => [];

  constructor(lang = 'en', view: FakeWindow | null = new FakeWindow()) {
    this.defaultView = view;
    this.documentElement = new FakeElement('html', this);
    this.documentElement.setAttribute('lang', lang);
    this.body = new FakeElement('body', this);
    this.documentElement.append(this.body);
  }
  createElement(tag: string): FakeElement {
    return new FakeElement(tag, this);
  }
  querySelectorAll(selector: string): FakeElement[] {
    return this.documentElement.findLight((el) => matchesSelector(el, selector));
  }
  getElementById(id: string): FakeElement | null {
    return this.documentElement.findLight((el) => el.getAttribute('id') === id)[0] ?? null;
  }
}

export class MemoryStorage {
  readonly items = new Map<string, string>();
  getItem(key: string): string | null {
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.items.set(key, value);
  }
  removeItem(key: string): void {
    this.items.delete(key);
  }
}
