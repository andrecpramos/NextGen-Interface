// ADR-020 — an extracted rule's `source` is a promise: "<file>:<line>" names
// exactly where in the adopter's own tree that rule came from. Nothing else about the
// rule is checkable against the adopter's source (the statement is generated text, in
// their own words about their own control) — the pointer is the whole contract, and this
// is the thing that proves it holds, rather than trusting that it does.
//
// Runs the real generator against `packages/generator/fixtures/tiny-app` — the same
// fixture `pages.test.ts` and `field-rules.test.ts` read — and, for every rule in every
// shipped capability, opens the file the rule names and reads the exact line. Then, the
// same way `check-adapter.mjs` and `check-stage3.mjs` prove their own properties: made to
// fail on purpose, by asking the same resolver about a line far past a real file's end,
// to prove a moved or wrong pointer is actually caught rather than silently accepted.
//
//   node tooling/scripts/check-rule-provenance.mjs

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const toFileUrl = (path) => `file:///${path.replaceAll('\\', '/')}`;

const failures = [];
const check = (ok, line) => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${line}`);
  if (!ok) failures.push(line);
};

const { generate } = await import(toFileUrl(join(ROOT, 'packages/generator/src/generate.ts')));
const { FIXTURE_CONFIG } = await import(toFileUrl(join(ROOT, 'packages/generator/src/fixture-app.ts')));

// No model: this is a CI gate, and ADR-011 keeps CI model-free. Rule extraction does not
// touch prose at all, so nothing about what this checks depends on that choice.
const output = await generate({ config: FIXTURE_CONFIG });
const rules = output.master.flatMap((c) => c.rules ?? []);

check(rules.length > 0, `the fixture app produced at least one extracted rule (found ${rules.length})`);

/** `<file>:<line>` -> that line's own trimmed text, or `null` when it does not resolve. */
function resolveSource(source, appRoot) {
  const at = source.lastIndexOf(':');
  if (at < 0) return null;
  const file = source.slice(0, at);
  const line = Number(source.slice(at + 1));
  if (!Number.isInteger(line) || line < 1) return null;
  let text;
  try {
    text = readFileSync(join(appRoot, file), 'utf8');
  } catch {
    return null;
  }
  const lines = text.split('\n');
  return line <= lines.length ? (lines[line - 1] ?? '').trim() : null;
}

for (const rule of rules) {
  const resolved = resolveSource(rule.source, FIXTURE_CONFIG.appRoot);
  check(Boolean(resolved), `"${rule.field}" — ${rule.source} resolves to a real, non-blank line ("${resolved ?? ''}")`);
}

const [sample] = rules;
if (sample) {
  const [file] = sample.source.split(':');
  const corrupted = resolveSource(`${file}:999999`, FIXTURE_CONFIG.appRoot);
  check(corrupted === null, 'a source pointing past the end of its file is correctly reported as unresolved (proves this check has teeth)');
}

if (failures.length > 0) {
  console.error(`\n  Rule provenance FAILED — ${failures.length} check(s).\n`);
  console.error("  An extracted rule's source no longer resolves to the line it names. Either the");
  console.error('  page moved and the shipped registry is stale — rebuild it — or the extractor');
  console.error('  itself computed a wrong line; see packages/generator/src/field-rules.ts.\n');
  process.exit(1);
}

console.log(`\n  Rule provenance OK — ${rules.length} extracted rule(s), every source resolves (ADR-020).`);
