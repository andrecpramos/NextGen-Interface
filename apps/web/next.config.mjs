import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * The workspace packages ship TypeScript source, not builds — `main` points at
 * `src/index.ts` everywhere. That is deliberate (one source of truth, no stale
 * dist), and it means Next has to compile them rather than treat them as
 * pre-built dependencies.
 *
 * `@nextgen/ui` is the only one that reaches the browser. The rest are pulled
 * in exclusively by route handlers under `app/api/*`, because the engine binds
 * `node:sqlite` and a local Ollama socket — it runs on the server or it does
 * not run at all.
 *
 * @type {import('next').NextConfig}
 */
const nextConfig = {
  // Next otherwise walks up and finds an unrelated lockfile in the home
  // directory. The workspace root is two levels up, and nowhere else.
  outputFileTracingRoot: resolve(here, '..', '..'),
  transpilePackages: [
    '@nextgen/ui',
    '@nextgen/cli',
    '@nextgen/core-capability',
    '@nextgen/core-dispatch',
    '@nextgen/core-inference',
    '@nextgen/core-intent',
    '@nextgen/core-trace',
    '@nextgen/core-voice',
    '@nextgen/data',
    '@nextgen/domain-modules',
  ],
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
