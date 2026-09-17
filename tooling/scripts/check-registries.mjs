// Rule 10, and every other structural rule `validateRegistry` holds.
//
// Until ADR-018 this ran as `pnpm registry:check` -> `domain-modules registry:build
// --check`: validation was a side effect of building a domain package. Both domain
// packages are now deleted, so the rule kept its library
// (`core-capability/src/validate.ts`) and lost the thing that ran it. A rule with no
// runner is a written rule, and this repo's own standard for a written rule is that it
// is obeyed until someone is in a hurry.
//
// So: find every registry committed to this tree and validate all of them. Discovery is
// by glob rather than by list, because a list is a second place to forget.
//
//   node tooling/scripts/check-registries.mjs
//
// Exit 1 on any error. Warnings print and do not fail, matching validateRegistry's own
// distinction between the two.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { validateRegistry } from '../../packages/core-capability/src/validate.ts';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

// Where registries legitimately live. `review/` and `master.json` are deliberately
// excluded: a master carries a `roles` annotation that a shipped RegistryFile must not
// have (ADR-014), so validating it here would assert the wrong shape.
//
// `ground-truth.registry.json` is excluded and must stay excluded: it is WP-31's
// hand-written answer key, scored *against*, not shipped. It has its own runner,
// `eval/fut-app/verify.mjs`, which applies validateRegistry plus WP-31's own acceptance
// checks. That runner currently reports FAIL — WP-36 added the `explanation` requirement
// after the key was written — and excluding the file here neither causes nor hides that;
// see the note in GROUND_TRUTH.md.
const ROOTS = ['eval', 'packages/core-intent/eval', 'adapter'];
const IS_REGISTRY = /^(registry\.[A-Z_]+\.json|registry\.json|fixture-registry\.json)$/;

function* walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return; // a root that does not exist yet (adapter/, before the first build)
  }
  for (const entry of entries) {
    if (entry === 'node_modules' || entry === 'review') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (IS_REGISTRY.test(entry)) yield full;
  }
}

const found = ROOTS.flatMap((r) => [...walk(join(ROOT, r))]).sort();

if (found.length === 0) {
  console.error('FAIL  no registry found under: ' + ROOTS.join(', '));
  console.error('      Either the globs are wrong or this tree has no registry to check.');
  console.error('      A gate that finds nothing must fail: it has passed vacuously twice before.');
  process.exit(1);
}

let errors = 0;
let warnings = 0;

for (const path of found) {
  const shown = relative(ROOT, path).replace(/\\/g, '/');
  let registry;
  try {
    registry = JSON.parse(readFileSync(path, 'utf8').replace(/^﻿/, ''));
  } catch (cause) {
    console.error(`FAIL  ${shown}\n      not valid JSON: ${cause.message}`);
    errors += 1;
    continue;
  }

  const result = validateRegistry(registry);
  const count = (registry.capabilities ?? []).length;

  for (const warning of result.warnings ?? []) {
    console.warn(`warn  ${shown}  ${warning.code ?? ''} ${warning.message ?? warning}`);
    warnings += 1;
  }
  for (const error of result.errors ?? []) {
    console.error(`FAIL  ${shown}  ${error.code ?? ''} ${error.message ?? error}`);
    errors += 1;
  }
  if ((result.errors ?? []).length === 0) console.log(`ok    ${shown}  ${count} capabilities`);
}

console.log(`\n${found.length} registries, ${errors} error(s), ${warnings} warning(s)`);
process.exit(errors > 0 ? 1 : 0);
