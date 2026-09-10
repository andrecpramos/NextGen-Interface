#!/usr/bin/env node
// WP-26: a package an adopter installs must actually be importable.
//
// This failure mode is quiet in the worst way. A package with a wrong `files`
// list, a `main` pointing at a path that is not published, or a subpath export
// that was never built **installs without error** and then throws on the
// adopter's first import — in their build, not ours.
//
// It is also exactly what this repo shipped until 2026-09-11. Every package was
// `private: true` with `main: ./src/index.ts`, so an adopter could not consume
// them at all: Node refuses to strip types inside `node_modules`
// (ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING). That was found by packing the
// tarballs and installing them in a scratch directory — which is what this gate
// automates the cheap half of.
//
// WHAT IT CHECKS, for every package that is not `private`
//   1. `files` is declared. Without it npm publishes everything, including src
//      and tests, which is a different bug but still one.
//   2. `main`, `types` and every `exports` target resolves to a real file.
//   3. Every one of those targets sits under a path `files` actually includes —
//      a target outside `files` is present locally and absent once published,
//      which is the hardest version of this to debug.
//   4. No published entry point is a `.ts` file.
//
// WHAT IT CANNOT CHECK: that the built JavaScript is correct. Only running it
// does that, and `eval/fut-app` does.

import { readdirSync, existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('../..', import.meta.url).pathname
  .replace(/^\/([A-Za-z]:)/, '$1')
  .replace(/\/$/, '');

const readJson = (p) => {
  const t = readFileSync(p, 'utf8');
  return JSON.parse(t.charCodeAt(0) === 0xfeff ? t.slice(1) : t);
};

/** Collect every path an `exports` map points at, however nested. */
function targets(node, out = []) {
  if (typeof node === 'string') out.push(node);
  else if (node && typeof node === 'object') for (const v of Object.values(node)) targets(v, out);
  return out;
}

const problems = [];
let checked = 0;
let publishable = 0;

for (const name of readdirSync(join(ROOT, 'packages'))) {
  const dir = join(ROOT, 'packages', name);
  const manifestPath = join(dir, 'package.json');
  if (!existsSync(manifestPath)) continue;
  checked++;

  const pkg = readJson(manifestPath);
  if (pkg.private) continue; // not sold, not checked
  publishable++;

  const say = (msg) => problems.push(`${pkg.name}: ${msg}`);

  const files = pkg.files;
  if (!Array.isArray(files) || files.length === 0) {
    say('no `files` list — publishing would ship src/ and tests');
    continue;
  }

  const entries = [
    ...(pkg.main ? [pkg.main] : []),
    ...(pkg.types ? [pkg.types] : []),
    ...targets(pkg.exports),
  ];

  if (entries.length === 0) say('declares no entry point at all');

  for (const entry of new Set(entries)) {
    const rel = entry.replace(/^\.\//, '');

    if (rel.endsWith('.ts') && !rel.endsWith('.d.ts')) {
      say(`entry "${entry}" is TypeScript source — Node refuses to strip types inside node_modules`);
    }

    const included = files.some((f) => {
      const base = f.replace(/^\.\//, '').replace(/\/$/, '');
      return rel === base || rel.startsWith(`${base}/`);
    });
    if (!included) {
      say(`entry "${entry}" is not covered by \`files\` (${files.join(', ')}) — present locally, missing once published`);
    }

    const full = join(dir, rel);
    if (!existsSync(full) || !statSync(full).isFile()) {
      say(`entry "${entry}" does not exist — run \`pnpm -r build\` before publishing`);
    }
  }
}

if (problems.length > 0) {
  console.error(`\n  Packaging FAILED — ${problems.length} problem(s) across ${publishable} publishable package(s).\n`);
  for (const p of problems) console.error(`    ${p}`);
  console.error(`
  An adopter installs these. A wrong entry point installs cleanly and throws on
  their first import, in their build rather than ours.

  If a package is not meant to be installed, mark it \`"private": true\` and this
  gate will leave it alone.
`);
  process.exit(1);
}

console.log(
  `  Packaging OK — ${publishable} publishable package(s) of ${checked}, every entry point built and shipped.`,
);
