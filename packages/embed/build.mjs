// WP-29 — build the script-tag artefact.
//
// One file, `dist/nextgen.js`, that defines `window.NextGen` when loaded with a
// plain <script src>. No module system, no bundler on the adopter's side, no
// framework. That is Ladder C3's whole point: the adopters it exists for are the
// ones with no build step to add a package to.
//
//   node build.mjs          -> dist/nextgen.js  the script tag
//
// `tooling/scripts/build-adapter.mjs` copies this file, byte for byte, to
// `adapter/runtime/nextgen.js`. Until ADR-021 this also wrote `dist/index.js`, the same code
// as an ES module for `import { start } from '@nextgen/embed'`; nothing was ever installable
// after the tarballs went, so nothing read it.

import { build } from 'esbuild';
import { gzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('./dist/nextgen.js', import.meta.url));

// The script tag starts itself from its own data-nextgen-* attributes
// (src/script-tag.ts), so a page needs no inline script.
await build({
  entryPoints: [fileURLToPath(new URL('./src/script-tag.ts', import.meta.url))],
  bundle: true,
  // A browser target, deliberately. If anything in the routing path reaches for
  // `node:fs` or `node:crypto`, esbuild fails here rather than an adopter's page
  // failing at load — the same property WP-24's no-network test holds, at the
  // other end of the pipeline.
  platform: 'browser',
  target: 'es2020',
  legalComments: 'none',
  format: 'iife',
  globalName: 'NextGen',
  minify: true,
  outfile: script,
});

const bytes = readFileSync(script);
console.log(`dist/${basename(script).padEnd(11)} ${(bytes.length / 1024).toFixed(1)}KB raw, ${(gzipSync(bytes).length / 1024).toFixed(1)}KB gzipped`);
