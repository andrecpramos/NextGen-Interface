import { useEffect, useRef, useState, type JSX } from 'react';

import { chooseDockSide, type DockSide } from './dock.ts';
import { Sphere } from './Sphere.tsx';
import type { SphereState } from './types.ts';

/**
 * The blob: `Sphere` given a place to stand.
 *
 * Centered on first paint — the "I'm here" moment a floating launcher needs —
 * then docked to whichever edge `chooseDockSide` finds emptier. Docking
 * happens once, on the first thing that looks like navigation
 * (`dockTrigger` changing from its initial value) or after `dockAfterMs` of
 * nothing happening, whichever comes first — not on every render, because
 * re-measuring on every navigation would make the launcher visibly hunt for
 * a home instead of settling into one.
 *
 * `dockSide` lets a consumer force a side when it already knows the answer —
 * `preview-mobile`, for instance, has no adopter DOM to measure against and
 * exposes the choice as a toggle instead.
 *
 * This component only positions and reports a tap; it renders no panel of
 * its own (`packages/ui/README.md`: "widgets render, they do not decide") —
 * `expanded`/`onToggle` are for whatever the consumer shows next to it.
 */
export interface BlobProps {
  readonly state: SphereState;
  readonly expanded: boolean;
  readonly onToggle: () => void;
  /** Force a side, or find the emptier one. Default `'auto'`. */
  readonly dockSide?: 'auto' | DockSide;
  /** Dock immediately the first time this value changes after mount — the current route, say. */
  readonly dockTrigger?: unknown;
  /** ms centered before docking if `dockTrigger` never changes. Default 1200. */
  readonly dockAfterMs?: number;
  readonly label?: string;
  readonly className?: string;
}

export function Blob({
  state,
  expanded,
  onToggle,
  dockSide = 'auto',
  dockTrigger,
  dockAfterMs = 1200,
  label = 'Assistant',
  className,
}: BlobProps): JSX.Element {
  const [docked, setDocked] = useState(false);
  const [side, setSide] = useState<DockSide>(dockSide === 'auto' ? 'right' : dockSide);
  const dockedRef = useRef(false);
  const initialTrigger = useRef(dockTrigger);

  function dock(): void {
    if (dockedRef.current) return;
    dockedRef.current = true;
    if (dockSide === 'auto') {
      setSide(
        chooseDockSide({
          innerWidth: window.innerWidth,
          innerHeight: window.innerHeight,
          elementsFromPoint: (x, y) => document.elementsFromPoint(x, y),
        }),
      );
    } else {
      setSide(dockSide);
    }
    setDocked(true);
  }

  useEffect(() => {
    const timer = window.setTimeout(dock, dockAfterMs);
    return () => window.clearTimeout(timer);
    // Runs once: docking is a one-way transition, not something that should
    // reschedule as props change around it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (dockTrigger !== initialTrigger.current) dock();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dockTrigger]);

  return (
    <button
      type="button"
      className={['ngx-blob', className].filter(Boolean).join(' ')}
      data-docked={docked}
      data-side={side}
      aria-expanded={expanded}
      aria-label={label}
      onClick={() => {
        dock();
        onToggle();
      }}
    >
      <Sphere state={state} size={56} />
    </button>
  );
}
