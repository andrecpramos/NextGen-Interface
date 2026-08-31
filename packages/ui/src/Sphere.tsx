import type { CSSProperties, JSX } from 'react';

import { SPHERE_LABELS, type SphereState } from './types.ts';

/**
 * The sphere.
 *
 * One indicator for what the system is doing, and the only place in the UI
 * where motion carries meaning. Everything drawn below is geometry the state
 * changes the *shape* of — a bracket appears, a ring breaks, bars rise — so
 * that the states survive both colour blindness and `prefers-reduced-motion`,
 * where the animation is simply switched off and the form has to do all the
 * work on its own.
 *
 * Colour is the second channel, never the first:
 *   accent (teal)   — the system is doing something
 *   attention (amber) — it has stopped, and is waiting on you
 *   danger          — it failed
 */

export interface SphereProps {
  readonly state: SphereState;
  /** Rendered size in px. The sphere shrinks once a conversation is underway. */
  readonly size?: number;
  /** 0..1 mic amplitude. Only read in `listening`. */
  readonly amplitude?: number;
  readonly className?: string;
}

function strokeFor(state: SphereState): string {
  switch (state) {
    case 'confirming': return 'var(--attention)';
    case 'error':      return 'var(--danger)';
    case 'idle':       return 'var(--text-2)';
    default:           return 'var(--accent)';
  }
}

/** 48 ticks around the rim. The machined detail that makes it an instrument. */
const TICKS = Array.from({ length: 48 }, (_, i) => i * (360 / 48));

export function Sphere({ state, size = 148, amplitude = 0, className }: SphereProps): JSX.Element {
  const stroke = strokeFor(state);
  const label = SPHERE_LABELS[state];

  // `listening` is the one state driven by live data rather than a keyframe:
  // the ring tracks the mic, because a listening indicator that does not react
  // to your voice does not tell you the mic is actually open.
  const liveScale = state === 'listening' ? 1 + Math.min(1, Math.max(0, amplitude)) * 0.14 : 1;

  const style = { '--sphere-size': `${size}px`, color: stroke } as CSSProperties;

  return (
    <div
      className={['ngx-sphere', className].filter(Boolean).join(' ')}
      data-state={state}
      style={style}
      role="img"
      aria-label={`Assistant status: ${label}`}
    >
      <svg className="ngx-sphere__svg" viewBox="0 0 100 100" aria-hidden="true" focusable="false">
        <defs>
          <radialGradient id="ngx-core" cx="38%" cy="32%" r="72%">
            <stop offset="0%"   stopColor="currentColor" stopOpacity="0.34" />
            <stop offset="55%"  stopColor="currentColor" stopOpacity="0.12" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0.03" />
          </radialGradient>
        </defs>

        {/* Waves: amplitude (listening), ripple (transcribing), pulse (acting). */}
        <g className="ngx-sphere__waves">
          <circle className="ngx-sphere__wave ngx-sphere__wave--a" cx="50" cy="50" r="38"
                  fill="none" stroke="currentColor" strokeWidth="0.8" opacity="0" />
          <circle className="ngx-sphere__wave ngx-sphere__wave--b" cx="50" cy="50" r="38"
                  fill="none" stroke="currentColor" strokeWidth="0.8" opacity="0" />
          <circle className="ngx-sphere__wave ngx-sphere__wave--c" cx="50" cy="50" r="38"
                  fill="none" stroke="currentColor" strokeWidth="0.8" opacity="0" />
        </g>

        {/* Rim. In `error` it is visibly broken — the form, not just the hue. */}
        <circle
          className="ngx-sphere__ring"
          cx="50" cy="50" r="44"
          stroke="currentColor"
          strokeWidth={state === 'error' ? 1 : 0.7}
          strokeOpacity={state === 'idle' ? 0.28 : 0.5}
          strokeDasharray={state === 'error' ? '34 14' : undefined}
        />

        {/* Ticks. Drift slowly at idle, faster while routing. */}
        <g className="ngx-sphere__ticks" opacity={state === 'error' ? 0.15 : 0.34}>
          {TICKS.map((deg, i) => (
            <line
              key={deg}
              x1="50" y1="8" x2="50" y2={i % 4 === 0 ? 12.5 : 10.5}
              stroke="currentColor"
              strokeWidth={i % 4 === 0 ? 0.8 : 0.45}
              transform={`rotate(${deg} 50 50)`}
            />
          ))}
        </g>

        {/* Inner dashed ring — depth, at rest. */}
        <circle
          className="ngx-sphere__ring"
          cx="50" cy="50" r="33"
          stroke="currentColor" strokeWidth="0.5" strokeOpacity="0.28"
          strokeDasharray="2 5"
        />

        {/* Core. */}
        <g className="ngx-sphere__core" style={{ transform: `scale(${liveScale})` }}>
          <circle cx="50" cy="50" r="27" fill="url(#ngx-core)" />
          <circle cx="50" cy="50" r="27" fill="none" stroke="currentColor"
                  strokeWidth="0.6" strokeOpacity="0.45" />
        </g>

        {/* thinking: one body in orbit. Nothing else in the set orbits. */}
        {state === 'thinking' && (
          <g className="ngx-sphere__orbit">
            <circle cx="50" cy="6" r="2.6" fill="currentColor" />
            <circle cx="50" cy="6" r="5.5" fill="none" stroke="currentColor"
                    strokeWidth="0.5" strokeOpacity="0.4" />
          </g>
        )}

        {/*
          confirming: four corner brackets, perfectly still.
          This is the shape that separates "waiting on you" from "busy". If a
          user reads this as a spinner they will wait instead of answering,
          which is the single most expensive misread in the whole interface.
        */}
        {state === 'confirming' && (
          <g className="ngx-sphere__bracket" stroke="currentColor" strokeWidth="1.4"
             fill="none" strokeLinecap="square">
            <path d="M26 38 V26 H38" />
            <path d="M62 26 H74 V38" />
            <path d="M74 62 V74 H62" />
            <path d="M38 74 H26 V62" />
          </g>
        )}

        {/* speaking: four bands, synced to output. */}
        {state === 'speaking' && (
          <g className="ngx-sphere__bars" fill="currentColor">
            <rect className="ngx-sphere__bar ngx-sphere__bar--a" x="40" y="42" width="2.6" height="16" rx="1.3" style={{ transformOrigin: '41px 50px' }} />
            <rect className="ngx-sphere__bar ngx-sphere__bar--b" x="46" y="42" width="2.6" height="16" rx="1.3" style={{ transformOrigin: '47px 50px' }} />
            <rect className="ngx-sphere__bar ngx-sphere__bar--c" x="52" y="42" width="2.6" height="16" rx="1.3" style={{ transformOrigin: '53px 50px' }} />
            <rect className="ngx-sphere__bar ngx-sphere__bar--d" x="58" y="42" width="2.6" height="16" rx="1.3" style={{ transformOrigin: '59px 50px' }} />
          </g>
        )}

        {/* error: a struck-through core. Muted, flat, unmistakably not working. */}
        {state === 'error' && (
          <line x1="38" y1="62" x2="62" y2="38" stroke="currentColor"
                strokeWidth="1.4" strokeLinecap="round" opacity="0.8" />
        )}
      </svg>
    </div>
  );
}

/**
 * The sphere's state as text.
 *
 * A live region, because a state change that is only visible is not a state
 * change for a screen-reader user. `detail` carries the latency-perception
 * line: past a second, say what is happening — a labelled wait feels far
 * shorter than a blank one.
 */
export function SphereStatus({
  state,
  detail,
}: {
  readonly state: SphereState;
  readonly detail?: string;
}): JSX.Element {
  const tone =
    state === 'confirming' ? 'attention'
      : state === 'error' ? 'error'
        : state === 'idle' ? 'neutral'
          : 'accent';

  return (
    <p className="ngx-sphere-status" data-tone={tone} aria-live="polite">
      <span className="ngx-sphere-status__dot" aria-hidden="true" />
      <span>{detail ?? SPHERE_LABELS[state]}</span>
    </p>
  );
}
