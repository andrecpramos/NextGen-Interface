import { useEffect, useState, type JSX } from 'react';

import type { ConfirmView } from './types.ts';

/**
 * The confirmation card (ADR-004).
 *
 * Three things about it are load-bearing, and none is cosmetic:
 *
 *  1. It shows the **parsed parameters, not the utterance**. "Add €12 to Food,
 *     today" is checkable; "you said add twelve euros for food" is not. A
 *     misheard twelve-versus-twenty is caught here or it is not caught at all.
 *  2. Every field is **editable in place**. Fixing one wrong category must not
 *     require restating the sentence — that is the difference between a
 *     correction and a re-do.
 *  3. It reports **where each value came from**. A value a deterministic
 *     resolver produced and a value the model guessed carry different weight,
 *     and the user is entitled to know which is which before approving a write.
 *
 * The edits go back to the server as values, and the dispatcher re-applies
 * policy to them. Nothing here is trusted; this is a form, not an authority.
 */

export interface ConfirmationCardProps {
  readonly confirm: ConfirmView;
  readonly onConfirm: (params: Record<string, string>) => void;
  readonly onCancel: () => void;
  readonly busy?: boolean;
}

export function ConfirmationCard({
  confirm,
  onConfirm,
  onCancel,
  busy = false,
}: ConfirmationCardProps): JSX.Element {
  const [edits, setEdits] = useState<Record<string, string>>(() =>
    Object.fromEntries(confirm.params.map((p) => [p.name, p.display])),
  );

  // A new decision is a new card. Without this, edits from the previous turn
  // would bleed into the next confirmation — which is exactly the class of bug
  // this card exists to prevent.
  useEffect(() => {
    setEdits(Object.fromEntries(confirm.params.map((p) => [p.name, p.display])));
  }, [confirm]);

  const titleId = `ngx-confirm-${confirm.capabilityId.replace(/\W/g, '-')}`;

  return (
    <section
      className={`ngx-confirm${confirm.destructive ? ' ngx-confirm--destructive' : ''}`}
      role="group"
      aria-labelledby={titleId}
    >
      <p className="ngx-confirm__kicker ngx-label" style={{ color: 'inherit' }}>
        {confirm.destructive ? (
          <>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M12 9v5" /><path d="M12 17.5v.01" />
              <path d="M10.3 3.9 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
            </svg>
            Destructive
          </>
        ) : (
          'Confirm'
        )}
      </p>

      <h2 className="ngx-confirm__title" id={titleId}>{confirm.title}</h2>
      <p className="ngx-confirm__note">
        {confirm.destructive
          ? 'Check these before it runs. It can be undone from the journal afterwards.'
          : 'This is what I understood. Correct anything that is wrong, then confirm.'}
      </p>

      <div className="ngx-fields">
        {confirm.params.map((param) => {
          const inputId = `${titleId}-${param.name}`;
          return (
            <div className="ngx-field" key={param.name}>
              <label className="ngx-field__name" htmlFor={inputId}>{param.name}</label>
              <input
                id={inputId}
                className="ngx-field__input ngx-figure"
                value={edits[param.name] ?? ''}
                readOnly={!param.editable}
                onChange={(e) => setEdits((prev) => ({ ...prev, [param.name]: e.target.value }))}
                aria-describedby={`${inputId}-src`}
              />
              <span className="ngx-field__source ngx-mono" id={`${inputId}-src`}
                    style={{ color: param.source === 'model' ? 'var(--attention)' : 'var(--text-3)' }}>
                {param.source === 'deterministic' ? 'parsed by rule'
                  : param.source === 'context' ? 'from context'
                    : 'read by model'}
              </span>
            </div>
          );
        })}
      </div>

      <div className="ngx-confirm__actions">
        <button type="button" className="ngx-btn ngx-btn--quiet" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button
          type="button"
          className="ngx-btn ngx-btn--primary"
          onClick={() => onConfirm(edits)}
          disabled={busy}
          style={confirm.destructive
            ? { background: 'var(--danger)', color: 'var(--text-on-accent)' }
            : undefined}
        >
          {busy ? 'Working…' : confirm.destructive ? 'Delete' : 'Confirm'}
        </button>
      </div>
    </section>
  );
}
