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
import { builtinModules } from 'node:module';
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

const BUILTINS = new Set(builtinModules.flatMap((m) => [m, `node:${m}`]));

/** Every .js / .mjs / .cjs file under the entries `files` publishes. */
function publishedJs(dir, files) {
  const out = [];
  const walk = (path) => {
    if (!existsSync(path)) return;
    if (statSync(path).isDirectory()) {
      for (const entry of readdirSync(path)) if (entry !== 'node_modules') walk(join(path, entry));
    } else if (/\.(m|c)?js$/.test(path)) {
      out.push(path);
    }
  };
  for (const f of files) walk(join(dir, f.replace(/^\.\//, '')));
  return out;
}

/**
 * Specifiers a runtime will actually resolve: static imports and re-exports at
 * the start of a statement, dynamic `import('x')`, and `require('x')`. Anchored
 * to statements rather than any quoted string after the word "from", which an
 * earlier ad-hoc scan did — it reported the refusal reason 'off-domain' as a
 * package, and a minified bundle's punctuation as another.
 */
function bareImports(text) {
  const found = new Set();
  const patterns = [
    /^\s*(?:import|export)\s[^'";]*?\bfrom\s*['"]([^'"]+)['"]/gm,
    /^\s*import\s*['"]([^'"]+)['"]/gm,
    /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) if (!/^[./]/.test(match[1])) found.add(match[1]);
  }
  return found;
}

/** `@scope/name/sub` → `@scope/name`, `name/sub` → `name`, `node:fs` kept; not a package name → null. */
function packageName(specifier) {
  if (specifier.startsWith('node:')) return specifier;
  const match = /^(@[a-z0-9][\w.~-]*\/[a-z0-9][\w.~-]*|[a-z0-9][\w.~-]*)(?:\/|$)/i.exec(specifier);
  return match ? match[1] : null;
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

  // Check the manifest as PUBLISHED, not as the workspace sees it. pnpm overlays
  // `publishConfig` onto the package when it packs, so inside the workspace a
  // package can point at `src/*.ts` — which Next, vitest, tsc and Node all resolve
  // — while the tarball an adopter installs points at `dist/`. The first attempt
  // at WP-26 repointed the workspace itself at `dist/`, and every in-repo consumer
  // then silently ran stale builds after any source edit, and CI typechecked
  // against types that did not exist yet on a fresh clone.
  const published = { ...pkg, ...(pkg.publishConfig ?? {}) };
  const entries = [
    ...(published.main ? [published.main] : []),
    ...(published.types ? [published.types] : []),
    ...targets(published.exports),
    // A `bin` is an entry point too, and the one an adopter hits first. The kit's
    // pointed at TypeScript source until it was made installable.
    ...(typeof published.bin === 'string' ? [published.bin] : Object.values(published.bin ?? {})),
  ];

  if (entries.length === 0) say('declares no entry point at all');

  for (const entry of new Set(entries)) {
    const rel = entry.replace(/^\.\//, '');

    if (rel.endsWith('.ts') && !rel.endsWith('.d.ts')) {
      say(`entry "${entry}" is TypeScript source — Node refuses to strip types inside node_modules`);
    }

    // npm ships package.json whatever `files` says, so exporting it (which lets a
    // consumer `require.resolve('<pkg>/package.json')`) is always covered. Flagging
    // it was this gate's own false positive, found the day the kit first exported it.
    const included =
      rel === 'package.json' ||
      files.some((f) => {
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

  // Every bare import in the published JavaScript must be a declared dependency.
  //
  // The failure a manifest check cannot see and an adopter hits first. The
  // generator parsed source with `typescript` at run time while declaring it a
  // devDependency: inside this workspace it resolved from the root, so every test
  // passed, and once installed from a tarball every `nextgen` command threw
  // ERR_MODULE_NOT_FOUND — `init` included, because the CLI imports the build
  // module up front. check-install.mjs proves the whole path by running it; this
  // catches the commonest cause in a second, with no network.
  const declared = new Set([
    ...Object.keys(published.dependencies ?? {}),
    ...Object.keys(published.peerDependencies ?? {}),
    ...Object.keys(published.optionalDependencies ?? {}),
    pkg.name,
  ]);
  const undeclared = new Map();
  for (const file of publishedJs(dir, files)) {
    for (const specifier of bareImports(readFileSync(file, 'utf8'))) {
      const name = packageName(specifier);
      if (!name || declared.has(name) || BUILTINS.has(name)) continue;
      if (!undeclared.has(name)) undeclared.set(name, file.slice(dir.length + 1).split('\\').join('/'));
    }
  }
  for (const [name, file] of undeclared) {
    const where = pkg.devDependencies?.[name] ? ' It is a devDependency, which an install does not bring.' : '';
    say(`imports "${name}" at run time (${file}) but does not declare it in dependencies.${where} It resolves inside this workspace and throws once installed`);
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
