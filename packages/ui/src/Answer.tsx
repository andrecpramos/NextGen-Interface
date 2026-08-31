import type { JSX, ReactNode } from 'react';

import type { AnswerView, Tone } from './types.ts';

/**
 * A rendered answer.
 *
 * ui-guidelines, and the reason this component exists at all: answers are
 * *rendered, not narrated*. If the answer is a number the number is large; if
 * it is a comparison there is a bar. Speech — when it arrives — is a summary
 * of this, never a substitute for it.
 *
 * Every figure here was computed by code and formatted by code. The model
 * chose which capability to run; it did not produce a single character of what
 * is displayed below (Rule 2).
 */

function toneClass(tone: Tone | undefined): string {
  switch (tone) {
    case 'attention': return 'ngx-answer--attention';
    case 'danger':    return 'ngx-answer--danger';
    default:          return '';
  }
}

export interface AnswerProps {
  readonly answer: AnswerView;
  /** The explainability affordance. Present on every AI-produced answer. */
  readonly onWhy?: () => void;
  readonly children?: ReactNode;
}

export function Answer({ answer, onWhy, children }: AnswerProps): JSX.Element {
  const { headline, caption, rows = [], tone } = answer;

  return (
    <div className={['ngx-answer', toneClass(tone)].filter(Boolean).join(' ')}>
      {headline && <p className="ngx-answer__headline ngx-figure">{headline}</p>}
      {caption && <p className="ngx-answer__caption">{caption}</p>}

      {rows.length > 0 && (
        <div className="ngx-answer__rows">
          {rows.map((row, i) => (
            <div className="ngx-answer__row" key={`${row.label}-${i}`}>
              <span className="ngx-answer__row-label">{row.label}</span>
              <span
                className={[
                  'ngx-answer__row-value',
                  row.tone === 'danger' ? 'ngx-neg' : '',
                  row.tone === 'accent' ? 'ngx-pos' : '',
                ].filter(Boolean).join(' ')}
                style={row.tone === 'danger' ? { color: 'var(--danger)' } : undefined}
              >
                {row.value}
              </span>
              {row.bar !== undefined && (
                // The bar is decoration over a figure that is already printed —
                // so it needs no label of its own, but it must not be the only
                // channel either. It never is: the value is right there.
                <div className="ngx-bar" aria-hidden="true">
                  <div
                    className={`ngx-bar__fill${row.bar > 1 ? ' ngx-bar__fill--over' : ''}`}
                    style={{ width: `${Math.min(100, Math.max(2, row.bar * 100))}%` }}
                  />
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {(onWhy || children) && (
        <div className="ngx-answer__actions">
          {children}
          {onWhy && (
            <button type="button" className="ngx-why" onClick={onWhy}>
              why?
            </button>
          )}
        </div>
      )}
    </div>
  );
}
