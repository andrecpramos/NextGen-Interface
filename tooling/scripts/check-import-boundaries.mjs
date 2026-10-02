#!/usr/bin/env node
// Rule 1: packages/core-* depends only on other packages/core-*.
//
// The engine — registry contract, router, model runtimes — must know nothing about any
// particular application, and it sits BELOW everything that reads or serves one: the
// generator reads an app's source, embed runs in its page, kit drives both. If `core-*` could
// import any of those, the engine would be one refactor away from learning about an app.
//
// Until ADR-021 this gate refused an import of a `domain-*` package. ADR-018 deleted both
// domain packages, and the gate went on reporting "clean of domain imports" against a tree
// containing none — it could not fail for the reason it existed (critical-infrastructure.md
// §2). What survives the deletion, and what a gate can still fail on, is the layering.
//
// Checks both directions of the same rule:
//   1. declared — core-*/package.json must not depend on a non-core @nextgen package
//   2. actual   — no import specifier in core-*/src reaches a non-core package, whether by
//                 name (`@nextgen/generator`) or by a relative path out of the package
// A package.json can be clean while a stray deep import is not, and vice versa.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

// new URL(...).pathname keeps a trailing slash and, on Windows, a leading one
// before the drive letter. Normalise both so slicing paths for display is exact.
const ROOT = new URL('../..', import.meta.url).pathname
  .replace(/^\/([A-Za-z]:)/, '$1')
  .replace(/\/$/, '');
const PACKAGES = join(ROOT, 'packages');
const violations = [];

// Several package.json files here were written by PowerShell and carry a UTF-8
// BOM, which JSON.parse rejects outright. Strip it rather than trust encoding.
const readJson = (p) => {
  const t = readFileSync(p, 'utf8');
  return JSON.parse(t.charCodeAt(0) === 0xfeff ? t.slice(1) : t);
};

const cores = readdirSync(PACKAGES).filter((d) => d.startsWith('core-'));

const walk = (dir) => {
  let out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === 'dist') continue;
      out = out.concat(walk(p));
    } else if (/\.(ts|tsx|js|mjs)$/.test(e.name)) {
      out.push(p);
    }
  }
  return out;
};

/** A `@nextgen/<name>` specifier or dependency that is not a core package. */
const isNonCoreScoped = (spec) => /^@nextgen\/(?!core-)/.test(spec);

/** The package directory a relative specifier lands in, if it leaves `pkgDir` for another one. */
function escapesInto(file, spec, pkgDir) {
  if (!spec.startsWith('.')) return null;
  const target = resolve(dirname(file), spec);
  const rel = relative(PACKAGES, target);
  if (rel.startsWith('..') || rel === '') return null;
  const owner = rel.split(sep)[0];
  return join(PACKAGES, owner) === pkgDir ? null : owner;
}

for (const pkg of cores) {
  const dir = join(PACKAGES, pkg);

  // 1. declared dependencies
  const manifest = readJson(join(dir, 'package.json'));
  for (const field of ['dependencies', 'devDependencies', 'peerDependencies']) {
    for (const dep of Object.keys(manifest[field] ?? {})) {
      if (isNonCoreScoped(dep)) violations.push(`${pkg}/package.json  ${field} -> ${dep}`);
    }
  }

  // 2. actual import specifiers
  const src = join(dir, 'src');
  if (!existsSync(src) || !statSync(src).isDirectory()) continue;
  for (const file of walk(src)) {
    const text = readFileSync(file, 'utf8');
    const re = /(?:from|import|require)\s*\(?\s*['"]([^'"]+)['"]/g;
    let m;
    while ((m = re.exec(text)) !== null) {
      const spec = m[1];
      const owner = escapesInto(file, spec, dir);
      if (isNonCoreScoped(spec) || (owner !== null && !owner.startsWith('core-'))) {
        const line = text.slice(0, m.index).split('\n').length;
        violations.push(`${file.slice(ROOT.length + 1)}:${line}  imports "${spec}"`);
      }
    }
  }
}

if (violations.length > 0) {
  console.error('\n  Rule 1 VIOLATED — packages/core-* may depend only on other core-* packages.\n');
  for (const v of violations) console.error(`    ${v}`);
  console.error(
    `\n  ${violations.length} violation(s). The engine sits below the generator, the widget and the kit;` +
      '\n  if it needs something they hold, the fix is a callback or a registration on the core side.\n' +
      '  See ADR-021 and README.md, "Structure".\n',
  );
  process.exit(1);
}

console.log(`  Rule 1 OK — ${cores.length} core package(s) depend only on other core packages.`);
