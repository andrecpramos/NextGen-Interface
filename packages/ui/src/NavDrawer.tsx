import { useEffect, useRef, type JSX } from 'react';

import type { NavItem } from './types.ts';

/**
 * The drawer.
 *
 * ADR-005 is explicit that a conventional navigation structure exists
 * underneath the assistant and reaches every screen — and equally explicit
 * that it is "secondary in placement and visual weight" and "not the thing the
 * app opens on". A drawer is the shape that satisfies both: it costs nothing
 * in the layout until it is asked for, and when it is asked for it is
 * complete.
 *
 * The list is built from the registry, so it is not a menu anybody maintains.
 * Selecting an item runs the capability **directly** — no router, no model —
 * which is the literal reading of Rule 7: reachable *without* the AI.
 */

export interface NavDrawerProps {
  readonly open: boolean;
  readonly items: readonly NavItem[];
  readonly onSelect: (item: NavItem) => void;
  readonly onClose: () => void;
}

export function NavDrawer({ open, items, onSelect, onClose }: NavDrawerProps): JSX.Element | null {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    // Move focus in, or a keyboard user opens a panel they cannot reach.
    panelRef.current?.querySelector<HTMLElement>('button')?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="ngx-drawer">
      <button type="button" className="ngx-drawer__scrim" aria-label="Close menu" onClick={onClose} />
      <nav className="ngx-drawer__panel" ref={panelRef} aria-label="Go to">
        <div className="ngx-drawer__head">
          <p className="ngx-label">Go to</p>
          <button
            type="button"
            className="ngx-btn ngx-btn--quiet ngx-btn--icon"
            onClick={onClose}
            aria-label="Close menu"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <ul className="ngx-drawer__list">
          {items.map((item) => (
            <li key={item.capabilityId}>
              <button type="button" className="ngx-nav" onClick={() => onSelect(item)}>
                <span className="ngx-nav__label">{item.label}</span>
                {item.route && <span className="ngx-nav__route ngx-mono">{item.route}</span>}
              </button>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
