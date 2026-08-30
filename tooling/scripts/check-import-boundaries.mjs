#!/usr/bin/env node
// Rule 1: packages/core-* never imports a domain. Domains register INTO the
// engine; the engine must not know they exist. This is the architectural
// invariant the whole "how little code does domain #2 need" thesis rests on,
// so it gets a gate rather than a code review.
//
// Checks both directions of the same rule:
//   1. declared  — core-*/package.json must not depend on @nextgen/domain-*
//   2. actual    — no import specifier in core-*/src resolves to a domain
// A package.json can be clean while a stray deep import is not, and vice versa.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

// new URL(...).pathname keeps a trailing slash and, on Windows, a leading one
// before the drive letter. Normalise both so slicing paths for display is exact.
const ROOT = new URL('../..', import.meta.url).pathname
  .replace(/^\/([A-Za-z]:)/, '$1')
  .replace(/\/$/, '');
const CORE = join(ROOT, 'packages');
const violations = [];

// Several package.json files here were written by PowerShell and carry a UTF-8
// BOM, which JSON.parse rejects outright. Strip it rather than trust encoding.
const readJson = (p) => {
  const t = readFileSync(p, 'utf8');
  return JSON.parse(t.charCodeAt(0) === 0xfeff ? t.slice(1) : t);
};

const cores = readdirSync(CORE).filter((d) => d.startsWith('core-'));

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

for (const pkg of cores) {
  const dir = join(CORE, pkg);

  // 1. declared dependencies
  const manifest = readJson(join(dir, 'package.json'));
  for (const field of ['dependencies', 'devDependencies', 'peerDependencies']) {
    for (const dep of Object.keys(manifest[field] ?? {})) {
      if (/^@nextgen\/domain-/.test(dep)) {
        violations.push(`${pkg}/package.json  ${field} -> ${dep}`);
      }
    }
  }

  // 2. actual import specifiers
  const src = join(dir, 'src');
  try {
    if (!statSync(src).isDirectory()) continue;
  } catch {
    continue;
  }
  for (const file of walk(src)) {
    const text = readFileSync(file, 'utf8');
    const re = /(?:from|import|require)\s*\(?\s*['"]([^'"]+)['"]/g;
    let m;
    while ((m = re.exec(text)) !== null) {
      const spec = m[1];
      if (/@nextgen\/domain-/.test(spec) || /(^|\/)domain-[a-z]/.test(spec)) {
        const line = text.slice(0, m.index).split('\n').length;
        violations.push(`${file.slice(ROOT.length + 1)}:${line}  imports "${spec}"`);
      }
    }
  }
}

if (violations.length > 0) {
  console.error('\n  Rule 1 VIOLATED — packages/core-* must not import a domain.\n');
  for (const v of violations) console.error(`    ${v}`);
  console.error(`\n  ${violations.length} violation(s). Domains register into the engine; see .ai/architecture.md.\n`);
  process.exit(1);
}

console.log(`  Rule 1 OK — ${cores.length} core package(s) clean of domain imports.`);
