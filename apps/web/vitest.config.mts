import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * `apps/web` had no tests at all until WP-22, which is why this config did not exist.
 *
 * The single alias is the only thing standing between the web layer's pure functions
 * and being testable: they declare `import 'server-only'`, a marker Next injects and
 * that does not resolve outside it. See `test/server-only.stub.ts`.
 */
export default defineConfig({
  resolve: {
    alias: {
      'server-only': fileURLToPath(new URL('./test/server-only.stub.ts', import.meta.url)),
    },
  },
});
