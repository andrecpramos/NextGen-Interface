import 'server-only';

import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { FinanceApp, type TurnResult } from '@nextgen/cli';
import { OllamaLlmRuntime } from '@nextgen/core-inference';
import type { Decision } from '@nextgen/core-dispatch';

/**
 * The engine, server-side.
 *
 * `FinanceApp` is the composition root from `apps/cli`. This module does not
 * reimplement it — WP-09's whole premise is that the CLI is a surface, not a
 * prototype, so the web app is a second surface over the identical assembly.
 *
 * Three things live here that a CLI never needs:
 *
 *  1. **A singleton.** The database is in-memory and the registry embeds 27
 *     capabilities on load. Rebuilding that per request would be both slow and
 *     wrong — the second request would not see the first request's writes.
 *  2. **Survival across HMR.** Next re-evaluates modules on every edit in dev.
 *     Without stashing the instance on `globalThis`, every save would silently
 *     reset the user's data.
 *  3. **The pending-decision table.** See `remember`/`recall` below; this is a
 *     security boundary, not a convenience.
 */

interface EngineCache {
  app: FinanceApp | null;
  starting: Promise<FinanceApp> | null;
  pending: Map<string, Decision>;
  info: EngineInfo;
}

export interface EngineInfo {
  /** True when no LLM is wired: stages 1–2 only. */
  readonly offline: boolean;
  /**
   * True when no part of a turn crosses the network.
   *
   * Computed at boot rather than asserted per turn: today it is always true —
   * an in-memory database and, at most, an Ollama socket on loopback — and if a
   * remote runtime is ever wired up, boot() is the single place that has to
   * say so (ADR-008).
   */
  readonly local: boolean;
  readonly model: string | null;
  readonly embedder: 'hashing' | 'ollama';
  readonly currency: string;
  readonly today: string;
}

const globalRef = globalThis as typeof globalThis & { __nextgenEngine?: EngineCache };

const cache: EngineCache = (globalRef.__nextgenEngine ??= {
  app: null,
  starting: null,
  pending: new Map(),
  info: { offline: true, local: true, model: null, embedder: 'hashing', currency: 'EUR', today: '2026-08-29' },
});

/**
 * Find `registry.json`.
 *
 * `import.meta.dirname` is not usable once a bundler has been through the file,
 * so the path is resolved from the working directory instead — which differs
 * between `next dev` in `apps/web` and a build invoked from the repo root.
 * Both candidates are checked rather than assumed.
 */
function findRegistry(): string {
  const rel = join('packages', 'core-intent', 'eval', 'registry.json');
  const candidates = [
    resolve(process.cwd(), '..', '..', rel), // apps/web  → repo root
    resolve(process.cwd(), rel),             // repo root
  ];
  const found = candidates.find((p) => existsSync(p));
  if (!found) {
    throw new Error(
      `registry.json not found (looked in: ${candidates.join(', ')}). ` +
        'Run `pnpm registry:build` from the repo root.',
    );
  }
  return found;
}

/**
 * Boot the engine.
 *
 * Ollama is probed rather than assumed. ADR-008 says the device is the source
 * of truth and nothing on the critical path requires the network — so when the
 * model is not there the app does not fail, it drops to the deterministic
 * stages and says so in the status bar. A degraded router is a real product;
 * an error page is not.
 */
async function boot(): Promise<FinanceApp> {
  const model = process.env.NEXTGEN_MODEL ?? 'qwen2.5:1.5b';
  const available = await new OllamaLlmRuntime({ model }).isAvailable().catch(() => false);

  const app = await FinanceApp.create({
    registryPath: findRegistry(),
    embedder: available ? 'ollama' : 'hashing',
    noModel: !available,
    model,
  });

  cache.info = {
    offline: !available,
    local: true, // Ollama is on loopback; the database never leaves the process.
    model: available ? model : null,
    embedder: available ? 'ollama' : 'hashing',
    currency: app.currency,
    today: app.snapshot().today,
  };

  return app;
}

export async function getEngine(): Promise<FinanceApp> {
  if (cache.app) return cache.app;
  // Concurrent first requests must not each build a registry. The in-flight
  // promise is the lock.
  cache.starting ??= boot().then((app) => {
    cache.app = app;
    cache.starting = null;
    return app;
  });
  return cache.starting;
}

export function engineInfo(): EngineInfo {
  return cache.info;
}

/**
 * Hold a `confirm` decision server-side until the user approves it.
 *
 * The client never gets to hand back a decision object. If it did, a page
 * could approve a write the router never produced — capability id and all —
 * and the entire asymmetry ADR-004 is built on ("everything the model
 * influences arrives as data, everything that happens next is decided by
 * code") would be undone by the transport layer.
 *
 * What the client may send back is *values* for the parameters it was shown.
 * Those are merged into the remembered decision and re-approved through the
 * dispatcher, which applies policy to them exactly as it did the first time.
 */
export function remember(turnId: string, decision: Decision): void {
  cache.pending.set(turnId, decision);
  // A pending confirmation is not a session. Keep the table small; an
  // unanswered card is a cancelled one.
  if (cache.pending.size > 32) {
    const oldest = cache.pending.keys().next().value;
    if (oldest !== undefined) cache.pending.delete(oldest);
  }
}

export function recall(turnId: string): Decision | undefined {
  return cache.pending.get(turnId);
}

export function forget(turnId: string): void {
  cache.pending.delete(turnId);
}

export type { TurnResult };
