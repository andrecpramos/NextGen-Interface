// WP-29 — build the script-tag artefact.
//
// One file, `dist/nextgen.js`, that defines `window.NextGen` when loaded with a
// plain <script src>. No module system, no bundler on the adopter's side, no
// framework. That is Ladder C3's whole point: the adopters it exists for are the
// ones with no build step to add a package to.
//
//   node build.mjs          -> dist/nextgen.js (+ reports its gzipped size)

import { build } from 'esbuild';
import { gzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const out = fileURLToPath(new URL('./dist/nextgen.js', import.meta.url));

await build({
  entryPoints: [fileURLToPath(new URL('./src/index.ts', import.meta.url))],
  bundle: true,
  format: 'iife',
  globalName: 'NextGen',
  // A browser target, deliberately. If anything in the routing path reaches for
  // `node:fs` or `node:crypto`, esbuild fails here rather than an adopter's page
  // failing at load — the same property WP-24's no-network test holds, at the
  // other end of the pipeline.
  platform: 'browser',
  target: 'es2020',
  minify: true,
  legalComments: 'none',
  outfile: out,
});

const bytes = readFileSync(out);
console.log(`dist/nextgen.js  ${(bytes.length / 1024).toFixed(1)}KB raw, ${(gzipSync(bytes).length / 1024).toFixed(1)}KB gzipped`);
