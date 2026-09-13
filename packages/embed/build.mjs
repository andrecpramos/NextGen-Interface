// WP-29 — build the script-tag artefact.
//
// One file, `dist/nextgen.js`, that defines `window.NextGen` when loaded with a
// plain <script src>. No module system, no bundler on the adopter's side, no
// framework. That is Ladder C3's whole point: the adopters it exists for are the
// ones with no build step to add a package to.
//
//   node build.mjs          -> dist/nextgen.js  the script tag
//                              dist/index.js    the same code as an ES module
//
// Declarations are emitted separately, by `tsc -p tsconfig.build.json`.

import { build } from 'esbuild';
import { gzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const entry = fileURLToPath(new URL('./src/index.ts', import.meta.url));
const script = fileURLToPath(new URL('./dist/nextgen.js', import.meta.url));
const esm = fileURLToPath(new URL('./dist/index.js', import.meta.url));

const common = {
  entryPoints: [entry],
  bundle: true,
  // A browser target, deliberately. If anything in the routing path reaches for
  // `node:fs` or `node:crypto`, esbuild fails here rather than an adopter's page
  // failing at load — the same property WP-24's no-network test holds, at the
  // other end of the pipeline.
  platform: 'browser',
  target: 'es2020',
  legalComments: 'none',
};

await build({ ...common, format: 'iife', globalName: 'NextGen', minify: true, outfile: script });

// For a single-page app that installs the package and wants
// `import { start } from '@nextgen/embed'` with its own router's `navigate`.
//
// Self-contained on purpose. `@nextgen/core-intent`'s root entry reaches `node:fs`,
// and leaving the workspace packages for the adopter's bundler to resolve again
// would hand them lessons.md L11 — a browser build that breaks on a Node import.
// Not minified: their bundler minifies, and a readable stack trace is worth more.
await build({ ...common, format: 'esm', outfile: esm });

for (const out of [script, esm]) {
  const bytes = readFileSync(out);
  console.log(`dist/${basename(out).padEnd(11)} ${(bytes.length / 1024).toFixed(1)}KB raw, ${(gzipSync(bytes).length / 1024).toFixed(1)}KB gzipped`);
}
