import { useEffect, useRef, type JSX, type KeyboardEvent } from 'react';

/**
 * The composer.
 *
 * Text is never the fallback path — ui-guidelines: "Voice is never the only
 * path. Text input is always present and equally capable." So this is the
 * primary control, and the mic sits beside it rather than in front of it.
 *
 * The mic is rendered disabled until `onVoice` is supplied. Voice is WP-13;
 * a button that looks live and does nothing is worse than one that says so.
 */

export interface ComposerProps {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly onSubmit: () => void;
  readonly disabled?: boolean;
  readonly placeholder?: string;
  /** Wire this when voice lands. Absent = mic disabled, and labelled as such. */
  readonly onVoice?: () => void;
  readonly listening?: boolean;
  readonly autoFocus?: boolean;
  /** A photo or document to remember. Separate from voice — always present, no MVP gate. */
  readonly onUpload?: (file: File) => void;
}

export function Composer({
  value,
  onChange,
  onSubmit,
  disabled = false,
  placeholder = 'Ask anything…',
  onVoice,
  listening = false,
  autoFocus = false,
  onUpload,
}: ComposerProps): JSX.Element {
  const ref = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Grow with the content rather than scrolling inside a fixed box: at 200%
  // text the fixed box is the thing that clips.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [autoFocus]);

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    // Enter sends; Shift+Enter is a newline. IME composition must never send.
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      if (!disabled && value.trim()) onSubmit();
    }
  }

  return (
    <div>
      <div className="ngx-composer">
        <label className="ngx-sr-only" htmlFor="ngx-composer-input">
          Ask the assistant
        </label>
        <textarea
          id="ngx-composer-input"
          ref={ref}
          className="ngx-composer__input"
          rows={1}
          value={value}
          disabled={disabled}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          aria-describedby="ngx-composer-hint"
        />

        <input
          ref={fileRef}
          type="file"
          className="ngx-sr-only"
          accept="image/*,.pdf,.docx,.txt,.md"
          disabled={disabled || !onUpload}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file && onUpload) onUpload(file);
            e.target.value = '';
          }}
        />
        <button
          type="button"
          className="ngx-btn ngx-btn--quiet ngx-btn--icon"
          onClick={() => fileRef.current?.click()}
          disabled={disabled || !onUpload}
          title="Remember a photo or document"
          aria-label="Upload a photo or document to remember"
        >
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M21.44 11.05 12.25 20.24a5.5 5.5 0 0 1-7.78-7.78l9.19-9.19a3.5 3.5 0 0 1 4.95 4.95l-9.19 9.19a1.5 1.5 0 0 1-2.12-2.12l8.49-8.49" />
          </svg>
        </button>

        <button
          type="button"
          className="ngx-btn ngx-btn--quiet ngx-btn--icon"
          onClick={onVoice}
          disabled={!onVoice}
          aria-pressed={onVoice ? listening : undefined}
          title={onVoice ? 'Speak' : 'Voice input arrives with MVP 2'}
          aria-label={onVoice ? (listening ? 'Stop listening' : 'Speak') : 'Voice input — not available yet'}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
            <rect x="9" y="3" width="6" height="11" rx="3" />
            <path d="M5 11a7 7 0 0 0 14 0" />
            <path d="M12 18v3" />
          </svg>
        </button>

        <button
          type="button"
          className="ngx-btn ngx-btn--primary ngx-btn--icon"
          onClick={onSubmit}
          disabled={disabled || !value.trim()}
          aria-label="Send"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 19V5" />
            <path d="m5 12 7-7 7 7" />
          </svg>
        </button>
      </div>

      {/*
        The keyboard contract still has to be announced, but it does not have to
        be printed under the box forever. Sighted users learn Enter once; screen
        reader users need it every time, and `aria-describedby` gives it to them
        without spending a line of the interface on it.
      */}
      <p className="ngx-sr-only" id="ngx-composer-hint">
        Press Enter to send, Shift plus Enter for a new line.
      </p>
    </div>
  );
}
