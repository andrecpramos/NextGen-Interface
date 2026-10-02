// The stage-3 transport for the script tag (WP-52, ADR-017).
//
// Stages 1 and 2 always work with no model and no network — that stays true whether or
// not this file is ever reached. What this adds is what happens to a turn stages 1–2
// could not settle, when the adopter's build turned stage 3 on: instead of a clarifying
// question, the utterance and up to three candidates go to a path on **the page's own
// origin**, and the adopter's own server decides which model answers.
//
// The one property this file exists to hold: **it will POST to no origin other than the
// page's.** Not "by default" — structurally. The constructor resolves the configured path
// against the page's own location and, if the result is not same-origin, the runtime is
// permanently unavailable rather than refusing to construct. `LlmRuntime.complete` must
// never throw (core-inference/src/types.ts) — an adopter's malformed bundle degrades the
// same way an unreachable server does, to today's clarifying question, not to a crashed
// assistant.

import type { CompletionRequest, CompletionResult, LlmRuntime } from '@nextgen/core-intent/browser';

/** What a built bundle carries when the adopter turned stage 3 on. Absent: it is off. */
export interface Stage3Config {
  /**
   * Where to POST, resolved against the page the widget is mounted on.
   *
   * A relative or absolute-path string (`stage3`, `/api/nextgen-stage3`) always resolves
   * same-origin and is the expected shape. A full URL is accepted too, but is checked
   * exactly the same way — and rejected if its origin differs, which is the whole point.
   */
  readonly path: string;
  /** Forwarded as `CompletionRequest.model`; the adopter's proxy decides what it means. */
  readonly model?: string;
  readonly timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 8000;

/**
 * How the POST is sent: the page's `fetch`, or the adopter's own authenticated client. A single-page
 * app that keeps a bearer token in memory cannot authenticate a bare `fetch`, and an endpoint that
 * calls a model should not be left open because of it. It is handed only the URL this file already
 * resolved and checked same-origin — it can sign the request, never choose where it goes.
 */
export type Stage3Fetch = (url: string, init: RequestInit) => Promise<Response>;

/**
 * The two fields this file reads off `location` — named locally rather than typed as the
 * DOM `Location` interface. Every other file in this package can assume DOM lib; this one
 * is imported for its *type* by `packages/kit` (a Node CLI with no DOM lib at all, so it
 * can write `bundle/thresholds.hashing.json`'s `stage3` field with the same shape this
 * file reads back). A bare `location` identifier here would force DOM lib on anything
 * that so much as resolves this file for its exports, which is exactly the transitive
 * leak that made `kit`'s typecheck fail the first time this was written — `kit` now
 * declares its own copy of `Stage3Config` instead, but this file stays DOM-lib-free on
 * its own merits: the property under test is narrow, and typing it narrowly says so.
 */
interface PageLocation {
  readonly href: string;
  readonly origin: string;
}

function pageLocation(): PageLocation | undefined {
  return (globalThis as { location?: PageLocation }).location;
}

export class SameOriginLlmRuntime implements LlmRuntime {
  readonly name: string;
  readonly #url: URL | null;
  readonly #blockedReason: string | null;
  readonly #model: string | undefined;
  readonly #timeoutMs: number;
  readonly #fetch: Stage3Fetch;

  constructor(config: Stage3Config, send?: Stage3Fetch) {
    this.#model = config.model;
    this.#timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.#fetch = send ?? ((url, init) => fetch(url, init));
    this.name = config.model ? `stage3:${config.model}` : 'stage3';

    // Absent only outside a real page — a Node harness, a sandboxed test context
    // (embed.test.ts runs the built bundle with no `location` at all, on purpose: "no
    // network, no fetch even defined"). Those contexts never construct this class with a
    // real config, but the guard is here rather than assumed, exactly like the existing
    // `typeof process !== 'undefined'` guards elsewhere in this codebase for the same
    // reason: a module-scope crash on a page that lacks one global breaks every visitor.
    const location = pageLocation();
    if (location === undefined) {
      this.#url = null;
      this.#blockedReason = 'no page origin to resolve the stage-3 path against';
      return;
    }

    let resolved: URL;
    try {
      resolved = new URL(config.path, location.href);
    } catch {
      this.#url = null;
      this.#blockedReason = `stage3 path is not a valid URL or path: ${config.path}`;
      return;
    }

    if (resolved.origin !== location.origin) {
      // Not a warning — this is the one thing ADR-017 says must never happen. Refusing
      // silently here, rather than surfacing a scarier error to the visitor, is the same
      // choice `LlmRuntime`'s contract makes for every other unreachable-server case: a
      // bad config degrades exactly like a down server, to a clarifying question.
      this.#url = null;
      this.#blockedReason = `stage3 path resolved off-origin (page is ${location.origin}, path resolved to ${resolved.origin}) — refused`;
      return;
    }

    this.#url = resolved;
    this.#blockedReason = null;
  }

  async isAvailable(): Promise<boolean> {
    if (this.#url === null) return false;
    try {
      // HEAD first: cheaper than a full completion, and the recipe proxy answers it.
      // A proxy that only implements POST still degrades correctly — isAvailable() is
      // advisory (used to decide whether to *offer* model-dependent affordances), never
      // load-bearing for whether a turn can be answered.
      const res = await this.#fetch(this.#url.href, { method: 'HEAD', signal: AbortSignal.timeout(2000) });
      return res.ok;
    } catch {
      return false;
    }
  }

  async complete<T>(request: CompletionRequest): Promise<CompletionResult<T>> {
    const started = performance.now();

    if (this.#url === null) {
      return { value: null, latencyMs: 0, parseFailed: false, unavailable: this.#blockedReason ?? 'stage3 unavailable' };
    }

    let res: Response;
    try {
      res = await this.#fetch(this.#url.href, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          system: request.system,
          prompt: request.prompt,
          schema: request.schema,
          model: request.model ?? this.#model,
          // Whether a reasoning model may reason first. The proxy passes it to its model (Ollama's
          // `think`); a proxy that ignores it still works, only slower on a reasoning model.
          ...(request.think !== undefined ? { think: request.think } : {}),
          ...(request.images && request.images.length > 0 ? { images: request.images } : {}),
        }),
        signal: AbortSignal.timeout(request.timeoutMs ?? this.#timeoutMs),
      });
    } catch (err) {
      // Network failure, timeout, or the adopter's server is simply not there yet. This is
      // the ordinary case ADR-017 point 3 names: "a timeout, an unreachable path … degrades
      // to the clarifying question a visitor gets today."
      return {
        value: null,
        latencyMs: performance.now() - started,
        parseFailed: false,
        unavailable: err instanceof Error ? err.message : String(err),
      };
    }

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return {
        value: null,
        latencyMs: performance.now() - started,
        parseFailed: false,
        unavailable: `stage3 responded ${res.status}: ${body.slice(0, 200)}`,
      };
    }

    const latencyMs = performance.now() - started;
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      return { value: null, latencyMs, parseFailed: true };
    }

    // The reference proxy contract: the adopter's server returns the model's answer
    // already parsed to JSON (their choice of model, their choice of how they call it —
    // this transport does not assume Ollama's or anyone else's wire shape on the far
    // side). What crosses back into this codebase is exactly the schema-shaped object
    // `stage3()` in core-intent asked for.
    return { value: body as T, latencyMs, parseFailed: false };
  }
}
