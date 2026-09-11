'use client';

import { useEffect, useRef, useState, type JSX } from 'react';
import { useRouter } from 'next/navigation';

import {
  Answer,
  Composer,
  ConfirmationCard,
  NavDrawer,
  Sphere,
  SphereStatus,
} from '@nextgen/ui';

import { useAssistant, type Turn } from '@/lib/store';
import { destinationFor, isSamePlace } from '@/lib/navigation';

/**
 * The assistant surface.
 *
 * One column, and nothing beside it. The conversation is the product, so it
 * gets the whole stage — the navigation ADR-005 requires lives off-canvas
 * behind a single control, which is the ADR's own prescription ("secondary in
 * placement and visual weight", "not the thing the app opens on") taken at
 * face value rather than split into a rail that costs 232px forever.
 *
 * **The sphere never leaves.** It starts large and centred, then moves to the
 * crown once there is something to read. It is one continuous object across
 * that transition, not two components swapping — which is what makes it read
 * as the system's state rather than a loading widget.
 */
export function Assistant(): JSX.Element {
  const {
    session, turns, state, detail, cancellable, input, pending, drawerOpen, error,
    listening, amplitude, voiceReply,
    bootstrap, setInput, send, navigate, upload, toggleVoice, setVoiceReply, approve, cancelConfirmation, abort,
    setDrawer, setTheme,
  } = useAssistant();

  const router = useRouter();
  const [dark, setDark] = useState(true);
  const [busy, setBusy] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => { void bootstrap(); }, [bootstrap]);

  useEffect(() => {
    setDark(document.documentElement.getAttribute('data-theme') !== 'light');
  }, []);

  // Follow the conversation. `smooth` is skipped under reduced motion because
  // scroll is motion too, and it is the kind that causes actual nausea.
  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    bottomRef.current?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'end' });
  }, [turns, pending]);

  /**
   * WP-35: a `navigate` turn moves the browser.
   *
   * The engine has resolved routes since WP-03 and every response has carried
   * one — and nothing ever read it, which is PLAN.md §3's "engine built, surface
   * missing". For a navigation product that was the main event.
   *
   * `router.push`, not `location.assign`: it goes through the app's own router,
   * so the destination stays reachable by every ordinary means and the back
   * button still works. **Rule 7 is preserved by construction** — this drives
   * the same navigation a menu would, rather than replacing it.
   *
   * Keyed on the newest turn's id so a re-render cannot move anyone twice, and
   * `isSamePlace` skips a push that would only give the back button a step that
   * goes nowhere.
   */
  const latest = turns[turns.length - 1];
  const latestId = latest?.id ?? null;
  const movedFor = useRef<string | null>(null);

  useEffect(() => {
    if (!latest?.response || latestId === null || movedFor.current === latestId) return;
    const destination = destinationFor(latest.response);
    movedFor.current = latestId;
    if (destination && !isSamePlace(destination, window.location.pathname)) {
      router.push(destination);
    }
  }, [latest, latestId, router]);

  const empty = turns.length === 0;
  const thinking = state === 'thinking' || state === 'acting';

  function toggleTheme(): void {
    const next = !dark;
    setDark(next);
    setTheme(next);
  }

  async function handleApprove(params: Record<string, string>): Promise<void> {
    setBusy(true);
    await approve(params);
    setBusy(false);
  }

  return (
    <div className="shell">
      <header className="statusbar">
        <button
          type="button"
          className="ngx-btn ngx-btn--quiet ngx-btn--icon"
          onClick={() => setDrawer(true)}
          aria-label="Open menu"
          aria-expanded={drawerOpen}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               strokeWidth="1.7" strokeLinecap="round" aria-hidden="true">
            <path d="M4 7h16M4 12h16M4 17h10" />
          </svg>
        </button>

        <span className="statusbar__spacer" />

        {/*
          The one piece of status worth a permanent place: whether the model is
          actually there. ADR-008 — without it the router drops to its
          deterministic stages, which changes what the app can do, so it is not
          decoration. Everything else that used to sit here was.
        */}
        {session && (
          <span
            className="statusbar__engine"
            title={session.status.offline
              ? 'No model running. Stages 1-2 only — deterministic matching.'
              : `Running ${session.status.model} locally.`}
          >
            <span
              className="statusbar__dot"
              data-offline={session.status.offline || undefined}
              aria-hidden="true"
            />
            {session.status.offline ? 'no model' : 'local'}
          </span>
        )}

        <button
          type="button"
          className="ngx-btn ngx-btn--quiet ngx-btn--icon"
          onClick={() => setVoiceReply(!voiceReply)}
          aria-pressed={voiceReply}
          title={voiceReply ? 'Answers are read aloud — tap to mute' : 'Answers are silent — tap to hear them'}
          aria-label={voiceReply ? 'Mute spoken answers' : 'Read answers aloud'}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M4 9v6h4l5 4V5L8 9H4Z" />
            {voiceReply
              ? <path d="M17.5 8.5a5 5 0 0 1 0 7M20 6a9 9 0 0 1 0 12" />
              : <path d="M17 9l5 5M22 9l-5 5" />}
          </svg>
        </button>

        <button
          type="button"
          className="ngx-btn ngx-btn--quiet ngx-btn--icon"
          onClick={toggleTheme}
          aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}
        >
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               strokeWidth="1.7" strokeLinecap="round" aria-hidden="true">
            {dark
              ? <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
              : <>
                  <circle cx="12" cy="12" r="4.2" />
                  <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
                </>}
          </svg>
        </button>
      </header>

      <main className="stage">
        <div className="scroll">
          <div className="column">
            {empty ? (
              <div className="opening">
                <Sphere state={state} size={180} amplitude={amplitude} />
                <h1 className="opening__prompt">What can I help with?</h1>
                <SphereStatus state={state} {...(detail ? { detail } : {})} />
              </div>
            ) : (
              <div className="crown">
                <Sphere state={state} size={40} amplitude={amplitude} />
                <SphereStatus state={state} {...(detail ? { detail } : {})} />
                {cancellable && thinking && (
                  <button type="button" className="chip" onClick={abort}>cancel</button>
                )}
              </div>
            )}

            {error && (
              <div className="banner" role="alert">
                <span>{error}</span>
              </div>
            )}

            <div className="ngx-stream">
              {turns.map((turn) => (
                <TurnBlock
                  key={turn.id}
                  turn={turn}
                  onSuggest={(text) => void send(text)}
                />
              ))}

              {pending && (
                <div className="ngx-turn">
                  <ConfirmationCard
                    confirm={pending.confirm}
                    busy={busy}
                    onConfirm={(params) => void handleApprove(params)}
                    onCancel={cancelConfirmation}
                  />
                </div>
              )}
            </div>

            <div ref={bottomRef} style={{ height: 1 }} />
          </div>
        </div>

        <div className="dock">
          <div className="column">
            <Composer
              value={input}
              onChange={setInput}
              onSubmit={() => void send(input)}
              onUpload={(file) => void upload(file)}
              onVoice={() => void toggleVoice()}
              listening={listening}
              disabled={thinking || listening || state === 'transcribing'}
              autoFocus
            />
          </div>
        </div>
      </main>

      <NavDrawer
        open={drawerOpen}
        items={session?.nav ?? []}
        onClose={() => setDrawer(false)}
        onSelect={(item) => void navigate(item.capabilityId, item.label)}
      />
    </div>
  );
}

/**
 * One turn: what was said, and what came back.
 *
 * The four decision types are rendered differently on purpose. A refusal is not
 * an error and must not look like one — a *declared* limit is the system
 * working correctly, and saying so is more useful than an apology.
 */
function TurnBlock({
  turn,
  onSuggest,
}: {
  readonly turn: Turn;
  readonly onSuggest: (text: string) => void;
}): JSX.Element {
  const response = turn.response;

  return (
    <article className="ngx-turn">
      {/*
        A menu tap is not something the user said, so it is not rendered as
        speech. Same turn, same trace, different provenance — and the trace
        records which it was.
      */}
      <p className={turn.picked ? 'picked' : 'ngx-said'}>
        {turn.picked && <span aria-hidden="true">→ </span>}
        {turn.said}
      </p>

      {turn.error && (
        <div className="banner" role="alert" style={{ marginTop: 'calc(var(--u) * 2)' }}>
          <span>{turn.error}</span>
        </div>
      )}

      {response && (
        <div style={{ marginTop: 'calc(var(--u) * 2.5)' }}>
          {response.kind === 'execute' && response.answer && (
            <Answer answer={response.answer} />
          )}

          {response.kind === 'clarify' && response.clarify && (
            <div className="clarify">
              <p className="clarify__q">{response.clarify.question}</p>
              {response.clarify.options.length > 0 && (
                <div className="clarify__options">
                  {response.clarify.options.map((option) => (
                    <button key={option} type="button" className="chip" onClick={() => onSuggest(option)}>
                      {option}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {response.kind === 'refuse' && response.refuse && (
            <Answer answer={{ caption: response.refuse.reason, tone: 'attention' }}>
              <span className="ngx-badge ngx-badge--attention">
                {response.refuse.declared ? 'declared limit' : 'unclassified'}
              </span>
            </Answer>
          )}

          {response.kind === 'confirm' && !turn.outcome && (
            <p className="ngx-mono" style={{ color: 'var(--attention)' }}>
              waiting for confirmation
            </p>
          )}

          {turn.outcome && (
            <div style={{ marginTop: 'calc(var(--u) * 2)' }}>
              <Answer answer={turn.outcome} />
            </div>
          )}
        </div>
      )}
    </article>
  );
}
