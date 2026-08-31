import type { JSX, ReactNode } from 'react';

import type { TraceView } from './types.ts';

/**
 * The trace panel — "why did you do that?"
 *
 * Rule 9: explainability is a record, never model narration. Every line below
 * is rendered from `TurnTrace` fields that are ids, enums, numbers, or text
 * the *user* said. The model's own account of itself is not stored anywhere in
 * the system, so it cannot be displayed here even by accident.
 *
 * The candidates list is the heart of it: what else it considered, and how
 * close. A routing decision you cannot see the runners-up for is not
 * explainable, it is just asserted.
 */

export interface TracePanelProps {
  readonly trace: TraceView;
  readonly onClose: () => void;
}

function Section({
  title,
  children,
}: {
  readonly title: string;
  readonly children: ReactNode;
}): JSX.Element {
  return (
    <section className="ngx-trace__section">
      <h3 className="ngx-label">{title}</h3>
      {children}
    </section>
  );
}

function Bullets({ items }: { readonly items: readonly string[] }): JSX.Element {
  return (
    <ul className="ngx-trace__list">
      {items.map((item, i) => (
        <li className="ngx-trace__item" key={`${item}-${i}`}>
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

export function TracePanel({ trace, onClose }: TracePanelProps): JSX.Element {
  const top = trace.candidates[0]?.score ?? 1;

  return (
    <aside className="ngx-trace" aria-label="Explanation of this turn">
      <header className="ngx-trace__head">
        <div>
          <p className="ngx-label">Why</p>
          <p className="ngx-mono" style={{ color: 'var(--text-3)' }}>{trace.turnId}</p>
        </div>
        <button type="button" className="ngx-btn ngx-btn--quiet ngx-btn--icon"
                onClick={onClose} aria-label="Close explanation">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      </header>

      <div className="ngx-trace__body">
        <p className="ngx-trace__headline">{trace.headline}</p>

        <div style={{ display: 'flex', gap: 'var(--u)', flexWrap: 'wrap' }}>
          <span className={`ngx-badge${trace.local ? ' ngx-badge--accent' : ''}`}>
            {trace.local ? 'fully on-device' : 'used a model'}
          </span>
          <span className="ngx-badge">decided at: {trace.decidedAt}</span>
          <span className="ngx-badge">{trace.timing}</span>
        </div>

        {trace.steps.length > 0 && (
          <Section title="What it did"><Bullets items={trace.steps} /></Section>
        )}

        {trace.candidates.length > 0 && (
          <Section title="What else it considered">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'calc(var(--u) * 1.5)' }}>
              {trace.candidates.map((c) => (
                <div
                  key={c.capabilityId}
                  className={`ngx-cand${c.capabilityId === trace.chosen ? ' ngx-cand--chosen' : ''}`}
                >
                  <span className="ngx-cand__id">{c.capabilityId}</span>
                  <span className="ngx-cand__score">{c.score.toFixed(2)}</span>
                  <div className="ngx-cand__track">
                    <div
                      className="ngx-cand__fill"
                      style={{ width: `${Math.max(2, Math.min(100, (c.score / (top || 1)) * 100))}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </Section>
        )}

        {trace.values.length > 0 && (
          <Section title="Values it resolved"><Bullets items={trace.values} /></Section>
        )}

        {trace.dataUsed.length > 0 && (
          <Section title="Data it read"><Bullets items={trace.dataUsed} /></Section>
        )}

        {trace.notes.length > 0 && (
          <details className="ngx-trace__tech">
            <summary className="ngx-label">Technical detail</summary>
            <ul className="ngx-trace__list">
              {trace.notes.map((note, i) => (
                <li className="ngx-trace__item" key={`${note}-${i}`}>
                  <span className="ngx-mono">{note}</span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </aside>
  );
}
