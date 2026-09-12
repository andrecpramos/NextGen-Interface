// The chat box: the smallest surface that makes the script tag usable.
//
// A labelled search form, a result that screen readers hear, and links a user can
// follow. The decisions are all in present.ts; this file only draws them.
//
// - Shadow DOM, so the host app's stylesheet cannot break the widget and the
//   widget's cannot break the app (WP-35's "survives the host's CSS").
// - System colours (Canvas, CanvasText, LinkText, Highlight), so it follows the
//   user's light, dark or forced-colours setting without knowing the host's theme.
// - 48px targets, a visible focus ring, `role="search"`, and an `aria-live`
//   result. Focus returns to the input when an answer replaces what the user was
//   standing on, and is left alone otherwise (`showResult`, below).
//   Audited by tooling/scripts/check-accessibility.mjs, which is where that focus
//   rule came from - it was claimed here before it was true. Still not verified
//   with a screen reader: eval/a11y/NVDA-CHECKLIST.md is the owner's pass (WP-45).
// - Choices are real `<a href>` links. Every destination stays reachable without
//   the assistant, by keyboard, middle-click or copy (Rule 7).

import type { Registry, TurnTrace } from '@nextgen/core-intent/browser';

import { present, wordsFor, type View, type Words } from './present.ts';

/** What the widget needs from an assistant: to route a turn, and the registry it routed against. */
export interface Routable {
  route(utterance: string, context?: { readonly route?: string; readonly today?: string }): Promise<TurnTrace>;
  readonly registry: Registry;
}

export interface MountOptions {
  /**
   * How to move the browser. The default is `location.assign`, which is correct
   * everywhere but reloads a single-page app. Pass your router to avoid that:
   * `{ navigate: (to) => router.navigate(to) }`.
   */
  readonly navigate?: (route: string) => void;
  /** The page's language, which decides the widget's words. Default: `<html lang>`. */
  readonly lang?: string;
  readonly words?: Partial<Words>;
  /** The current path. Default: `location.pathname`. */
  readonly currentPath?: () => string;
}

export interface Mounted {
  readonly host: HTMLElement;
  /** Ask programmatically; resolves to what was shown. */
  ask(utterance: string): Promise<View | null>;
  destroy(): void;
}

const CSS = `
:host { all: initial; display: block; color-scheme: light dark; font: 16px/1.5 system-ui, sans-serif; }
section { background: Canvas; color: CanvasText; border: 1px solid GrayText; border-radius: 12px;
  padding: 12px; max-width: 24rem; box-shadow: 0 4px 16px rgb(0 0 0 / 0.2); }
form { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin: 0; }
label { flex-basis: 100%; font-weight: 600; }
input { flex: 1 1 12rem; min-height: 48px; padding: 0 12px; font: inherit; color: CanvasText;
  background: Canvas; border: 1px solid GrayText; border-radius: 8px; }
button { min-height: 48px; min-width: 48px; padding: 0 16px; font: inherit; border-radius: 8px;
  border: 1px solid ButtonText; background: ButtonFace; color: ButtonText; cursor: pointer; }
:focus-visible { outline: 3px solid Highlight; outline-offset: 2px; }
.result:empty { display: none; }
.result { margin-top: 12px; }
.title { font-weight: 600; margin: 0 0 4px; }
.body { margin: 0 0 8px; }
ul { list-style: none; padding: 0; margin: 0; display: grid; gap: 4px; }
a { display: inline-flex; align-items: center; min-height: 48px; color: LinkText; }
@media (prefers-reduced-motion: reduce) { * { transition: none !important; animation: none !important; } }
`;

export function mount(target: Element, assistant: Routable, options: MountOptions = {}): Mounted {
  const doc = target.ownerDocument;
  const view = doc.defaultView;
  const words: Words = { ...wordsFor(options.lang ?? doc.documentElement?.getAttribute('lang')), ...options.words };
  const currentPath = options.currentPath ?? (() => view?.location.pathname ?? '/');
  const navigate = options.navigate ?? ((route: string) => view?.location.assign(route));

  const host = doc.createElement('div');
  host.setAttribute('data-nextgen', '');
  const root = host.attachShadow({ mode: 'open' });

  const style = doc.createElement('style');
  style.textContent = CSS;
  const section = doc.createElement('section');
  section.setAttribute('aria-label', words.label);
  const form = doc.createElement('form');
  form.setAttribute('role', 'search');
  const label = doc.createElement('label');
  label.setAttribute('for', 'nextgen-q');
  label.textContent = words.label;
  const input = doc.createElement('input');
  input.id = 'nextgen-q';
  input.type = 'text';
  input.autocomplete = 'off';
  input.placeholder = words.placeholder;
  input.setAttribute('enterkeyhint', 'go');
  const button = doc.createElement('button');
  button.type = 'submit';
  button.textContent = words.submit;
  const result = doc.createElement('div');
  result.className = 'result';
  result.setAttribute('role', 'status');
  result.setAttribute('aria-live', 'polite');

  form.append(label, input, button);
  section.append(form, result);
  root.append(style, section);
  target.append(host);

  const paragraph = (className: string, text: string): HTMLElement => {
    const p = doc.createElement('p');
    p.className = className;
    p.textContent = text;
    return p;
  };

  /**
   * Replace the answer without dropping the user's place (WP-45).
   *
   * A keyboard or screen-reader user can be standing on a link from the last
   * answer when the next one lands — submit a question, tab into the results
   * while it is still in flight, and the slower the device the wider that window
   * is. `replaceChildren` then removes the focused element, and focus falls to
   * the document body: the user is silently returned to the top of the host
   * page, mid-sentence. Put them back in the input, which is where the widget's
   * design says focus belongs anyway.
   */
  const showResult = (...nodes: readonly Node[]): void => {
    const active = root.activeElement;
    const wasInside = active !== null && result.contains(active);
    result.replaceChildren(...nodes);
    if (wasInside) input.focus();
  };

  function render(shown: View): void {
    const nodes: HTMLElement[] = [paragraph('title', shown.title)];
    if (shown.body) nodes.push(paragraph('body', shown.body));
    if (shown.choices.length > 0) {
      const list = doc.createElement('ul');
      for (const choice of shown.choices) {
        const item = doc.createElement('li');
        const a = doc.createElement('a');
        a.href = choice.route;
        a.textContent = choice.label;
        // With a router supplied, follow the link without a reload. Without one, the
        // link is an ordinary link, which is always correct.
        if (options.navigate) {
          a.addEventListener('click', (event) => {
            event.preventDefault();
            navigate(choice.route);
          });
        }
        item.append(a);
        list.append(item);
      }
      nodes.push(list);
    }
    result.setAttribute('data-tone', shown.tone);
    showResult(...nodes);
  }

  // A newer question wins, even if an older one resolves after it.
  let latest = 0;

  async function ask(text: string): Promise<View | null> {
    const utterance = text.trim();
    if (!utterance) return null;
    const mine = ++latest;
    result.setAttribute('aria-busy', 'true');
    showResult(paragraph('body', words.thinking));

    let shown: View;
    try {
      const where = currentPath();
      const trace = await assistant.route(utterance, { route: where });
      shown = present(trace, assistant.registry, where, words);
    } catch {
      shown = { tone: 'unsure', title: words.error, body: null, destination: null, choices: [] };
    }
    if (mine !== latest) return shown;

    result.removeAttribute('aria-busy');
    render(shown);
    if (shown.destination) navigate(shown.destination);
    return shown;
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void ask(input.value);
  });
  input.addEventListener('keydown', (event) => {
    if ((event as KeyboardEvent).key === 'Escape') {
      input.value = '';
      showResult();
    }
  });

  return { host, ask, destroy: () => host.remove() };
}
