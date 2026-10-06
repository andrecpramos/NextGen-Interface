// Failing to start, out loud.
//
// Found in a real integration: a backend that returned 404 left the page with no orb, no message and
// nothing in the console, and the developer concluded the product did not work. So every failure to start
// is announced on the window as `nextgen:error`, with a reason a page can act on — whichever way the
// assistant was started — and `start()` rejects with the same reason.

/** Why the assistant did not start — the `reason` of a `nextgen:error` event. */
export type StartFailure = 'bundle-unavailable' | 'bundle-invalid' | 'mount-failed';

/** The event a page listens for to learn that the assistant did not start, and why. */
export const ERROR_EVENT = 'nextgen:error';

export interface ErrorDetail {
  readonly reason: StartFailure;
  readonly message: string;
}

/** A failure to start, with the reason a page can act on. What `start()` rejects with. */
export class StartError extends Error {
  readonly reason: StartFailure;
  constructor(reason: StartFailure, message: string) {
    super(`NextGen: ${message}`);
    this.name = 'StartError';
    this.reason = reason;
  }
}

/** Announce `error` on the window as `nextgen:error`, and return it as a `StartError`. */
export function announceFailure(error: unknown): StartError {
  const failure = error instanceof StartError ? error : new StartError('mount-failed', error instanceof Error ? error.message : String(error));
  if (typeof window !== 'undefined' && typeof window.CustomEvent === 'function') {
    window.dispatchEvent(new window.CustomEvent<ErrorDetail>(ERROR_EVENT, { detail: { reason: failure.reason, message: failure.message } }));
  }
  return failure;
}
