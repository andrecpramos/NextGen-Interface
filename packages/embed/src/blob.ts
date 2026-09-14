// The blob: a small, always-on affordance that finds empty space and stays
// out of the way until asked for.
//
// Centered on first paint, then docked to whichever edge `chooseDockSide`
// (packages/ui) finds emptier — once, on the first `navigate()` call or
// after a short timeout, whichever comes first. Tapping it opens the
// existing chat box (widget.ts) anchored beside it; this file duplicates
// none of that logic, it only decides where to stand, when to get out of
// the way, and when to open what already exists.
//
// Shadow DOM, for the same two reasons as the chat box: the host's
// stylesheet cannot break this, and this cannot break the host's. Colour
// reads the host's own declared token when it has one (`--nextgen-accent` on
// `:root`, which inherits into the shadow tree the way any custom property
// does) and this file's own default otherwise — "adapt to what is there, or
// fall back," expressed as one `var(--nextgen-accent, …)`, never a
// dependency on the host's cascade either way. That is the same isolation
// guarantee the chat box already relies on, just extended from a rule to a
// value.

import { chooseDockSide } from '../../ui/src/dock.ts';

import { wordsFor } from './present.ts';
import { mount, type MountOptions, type Mounted, type Routable } from './widget.ts';

export type { Routable } from './widget.ts';

export interface BlobMountOptions extends MountOptions {
  /** Force a side, or find the emptier one. Default `'auto'`. */
  readonly dockSide?: 'auto' | 'left' | 'right';
  /** ms centered before docking, if `navigate()` is never called first. Default 1200. */
  readonly dockAfterMs?: number;
}

export interface MountedBlob {
  readonly host: HTMLElement;
  destroy(): void;
}

const DEFAULT_ACCENT_DARK = '#79c0ce';
const DEFAULT_ACCENT_LIGHT = '#1f6e7e';

const CSS = `
:host {
  all: initial;
  color-scheme: light dark;
  --_default-accent: ${DEFAULT_ACCENT_DARK};
}
@media (prefers-color-scheme: light) { :host { --_default-accent: ${DEFAULT_ACCENT_LIGHT}; } }

button.blob {
  all: unset;
  box-sizing: border-box;
  position: fixed;
  top: 50%; left: 50%;
  transform: translate(-50%, -50%);
  z-index: 2147483000;
  width: 56px; height: 56px;
  min-width: 48px; min-height: 48px;
  border-radius: 999px;
  display: grid;
  place-items: center;
  cursor: pointer;
  background: Canvas;
  border: 1px solid GrayText;
  box-shadow: 0 8px 24px -8px rgb(0 0 0 / 0.35);
  transition: top 300ms cubic-bezier(.32,.72,0,1), left 300ms cubic-bezier(.32,.72,0,1),
              right 300ms cubic-bezier(.32,.72,0,1), transform 300ms cubic-bezier(.32,.72,0,1);
}
button.blob[data-docked="true"][data-side="right"] { left: auto; right: 16px; top: 50%; transform: translateY(-50%); }
button.blob[data-docked="true"][data-side="left"]  { left: 16px; top: 50%; transform: translateY(-50%); }

.core {
  width: 26px; height: 26px;
  border-radius: 999px;
  background: var(--nextgen-accent, var(--_default-accent));
  opacity: 0.85;
  animation: nextgen-breathe 5.2s cubic-bezier(.65,0,.35,1) infinite;
}
button.blob[data-state="thinking"] .core { animation: nextgen-spin 1.9s linear infinite; }
@keyframes nextgen-breathe { 0%, 100% { transform: scale(1); opacity: .78; } 50% { transform: scale(1.08); opacity: .95; } }
@keyframes nextgen-spin { to { transform: rotate(360deg); } }

button.blob:focus-visible { outline: 3px solid Highlight; outline-offset: 3px; }
@media (forced-colors: active) { .core { background: ButtonText; } }
@media (prefers-reduced-motion: reduce) { button.blob, .core { transition: none !important; animation: none !important; } }
`;

function panelStyle(side: 'left' | 'right'): string {
  const edge = side === 'right' ? 'right:16px;' : 'left:16px;';
  return `position:fixed;bottom:84px;${edge}z-index:2147483000;max-width:24rem;`;
}

/**
 * Mount the blob. `target` is usually `document.body` directly — the button
 * it draws is `position: fixed` on its own, unlike the chat box, which needs
 * a positioned wrapper (see `start()` in `index.ts`).
 */
export function mountBlob(target: Element, assistant: Routable, options: BlobMountOptions = {}): MountedBlob {
  const doc = target.ownerDocument;
  const view = doc.defaultView;
  const words = wordsFor(options.lang ?? doc.documentElement?.getAttribute('lang'));

  const host = doc.createElement('div');
  host.setAttribute('data-nextgen-blob', '');
  const root = host.attachShadow({ mode: 'open' });

  const style = doc.createElement('style');
  style.textContent = CSS;
  const button = doc.createElement('button');
  button.type = 'button';
  button.className = 'blob';
  button.dataset.docked = 'false';
  button.dataset.side = 'right';
  button.dataset.state = 'idle';
  button.setAttribute('aria-expanded', 'false');
  button.setAttribute('aria-label', words.label);
  const core = doc.createElement('span');
  core.className = 'core';
  core.setAttribute('aria-hidden', 'true');
  button.append(core);
  root.append(style, button);
  target.append(host);

  let docked = false;
  function dock(): void {
    if (docked) return;
    docked = true;
    const side: 'left' | 'right' =
      options.dockSide === 'left' || options.dockSide === 'right'
        ? options.dockSide
        : view
          ? chooseDockSide({
              innerWidth: view.innerWidth,
              innerHeight: view.innerHeight,
              elementsFromPoint: (x, y) => doc.elementsFromPoint(x, y),
            })
          : 'right';
    button.dataset.side = side;
    button.dataset.docked = 'true';
  }

  const timer = view?.setTimeout(dock, options.dockAfterMs ?? 1200);

  const navigate = options.navigate ?? ((route: string) => view?.location.assign(route));
  const wrappedNavigate = (route: string): void => {
    dock();
    navigate(route);
  };

  // Tracks whether a turn is in flight, purely to switch the blob's own
  // idle/thinking mark — the chat box already has its own aria-busy result
  // region, unaffected by this.
  let inFlight = 0;
  const trackedAssistant: Routable = {
    registry: assistant.registry,
    async route(utterance, context) {
      inFlight++;
      button.dataset.state = 'thinking';
      try {
        return await assistant.route(utterance, context);
      } finally {
        inFlight--;
        if (inFlight === 0) button.dataset.state = 'idle';
      }
    },
  };

  let chatBox: Mounted | null = null;
  let panel: HTMLElement | null = null;

  function openChatBox(): void {
    if (chatBox) return;
    panel = doc.createElement('div');
    panel.style.cssText = panelStyle(button.dataset.side === 'left' ? 'left' : 'right');
    target.append(panel);
    chatBox = mount(panel, trackedAssistant, { ...options, navigate: wrappedNavigate });
    button.setAttribute('aria-expanded', 'true');
  }

  function closeChatBox(): void {
    chatBox?.destroy();
    chatBox = null;
    panel?.remove();
    panel = null;
    button.setAttribute('aria-expanded', 'false');
  }

  button.addEventListener('click', () => {
    dock();
    if (chatBox) closeChatBox();
    else openChatBox();
  });

  return {
    host,
    destroy(): void {
      if (timer !== undefined) view?.clearTimeout(timer);
      closeChatBox();
      host.remove();
    },
  };
}
