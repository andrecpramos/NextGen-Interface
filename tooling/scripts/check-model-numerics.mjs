#!/usr/bin/env node
// Rule 2: the model never computes a number the user sees.
//
// WHY THIS SHAPE, AND NOT THE ONE THE REGISTER ASKED FOR
//
// critical-infrastructure.md proposed closing Rule 2 with "a test asserting
// arithmetic origin on the render path". Checked against the tree on
// 2026-09-10, that test cannot be written: **no user-visible number is rendered
// anywhere in this repository.** `apps/web/lib/render.ts` is the only producer
// of an `AnswerView`, and its single `rows` construction sets `value: ''`.
// `formatMoney` has no consumer outside `data` and its own tests.
// `AnswerRow.bar` is never produced by anything.
//
// So the rule is not currently violable through rendering, and a test written
// against that path would assert over an empty set — a gate that passes
// vacuously, which this repo already has two recorded instances of.
//
// What IS writable is the check that fires the moment such a path is built, and
// it guards the actual failure mode: **letting the model return the figure.**
// A model that never emits a number cannot compute one the user sees, whatever
// the render path later does with its output.
//
// WHAT THIS CHECKS
//   Every JsonSchema handed to `.complete()` — inline, or via a named constant
//   in the same file. Any property declared `type: 'number'` is a number the
//   model produces, and must be justified in the source:
//       // rule2-ok: <why this number is never shown to a user>
//
// WHAT THIS DOES NOT CHECK
//   Arithmetic performed on model output by our own code, or a number the model
//   emits inside a string field. The first needs the render path to exist before
//   it can be tested; the second is why `merge()`'s schema description tells the
//   model never to alter a number from how its source stated it, which is
//   instruction rather than mechanism, and is honestly recorded as such.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';

const ROOT = new URL('../..', import.meta.url).pathname
  .replace(/^\/([A-Za-z]:)/, '$1')
  .replace(/\/$/, '');

const OPT_OUT = /rule2-ok:/;

const walk = (dir) => {
  let out = [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === 'dist' || e.name === 'generated') continue;
      out = out.concat(walk(p));
    } else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) {
      out.push(p);
    }
  }
  return out;
};

const roots = [];
for (const group of ['packages', 'apps']) {
  const base = join(ROOT, group);
  let dirs;
  try {
    dirs = readdirSync(base, { withFileTypes: true });
  } catch {
    continue;
  }
  for (const d of dirs) if (d.isDirectory()) roots.push(join(base, d.name));
}

/** The initializer of `const <name> = ...` anywhere in this file. */
function resolveLocal(sf, name) {
  let found = null;
  const visit = (node) => {
    if (
      !found &&
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === name &&
      node.initializer
    ) {
      found = node.initializer;
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

const violations = [];
let checked = 0;

for (const file of roots.flatMap(walk)) {
  const text = readFileSync(file, 'utf8');
  if (!text.includes('complete')) continue;

  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);

  const visit = (node) => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const name = ts.isPropertyAccessExpression(callee) ? callee.name.text : null;

      if (name === 'complete') {
        const arg = node.arguments[0];
        if (arg && ts.isObjectLiteralExpression(arg)) {
          const prop = arg.properties.find(
            (p) =>
              (ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)) &&
              ts.isIdentifier(p.name) &&
              p.name.text === 'schema',
          );
          if (prop) {
            // Same shorthand trap the Rule 15 gate shipped with and had to fix:
            // `{ schema }` is as common as `schema:` and a check that only sees
            // one of them reports success over half the sites.
            let expr = ts.isPropertyAssignment(prop) ? prop.initializer : null;
            if (!expr && ts.isShorthandPropertyAssignment(prop)) {
              expr = resolveLocal(sf, prop.name.text);
            } else if (expr && ts.isIdentifier(expr)) {
              expr = resolveLocal(sf, expr.text) ?? expr;
            }
            if (expr) {
              checked++;
              const src = expr.getText(sf);
              const numeric = /type:\s*['"]number['"]/.test(src);
              const declStart = expr.getStart(sf);
              const context = text.slice(Math.max(0, declStart - 800), expr.getEnd());
              if (numeric && !OPT_OUT.test(context)) {
                const { line } = sf.getLineAndCharacterOfPosition(declStart);
                violations.push({
                  file: file.slice(ROOT.length + 1).replace(/\\/g, '/'),
                  line: line + 1,
                });
              }
            }
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(sf);
}

if (violations.length > 0) {
  console.error(`\n  Rule 2 FAILED — ${violations.length} model output schema(s) declare a number.\n`);
  for (const v of violations) console.error(`    ${v.file}:${v.line}`);
  console.error(`
  A number the model returns is a number the model computed. Have code compute
  it — the query engine sums, money.ts does the arithmetic — and let the model
  choose the capability and read values out of the utterance, nothing more.

  If this number is genuinely never shown to a user, say so in the source:
      // rule2-ok: <reason>
`);
  process.exit(1);
}

console.log(`  Rule 2 OK — ${checked} model output schema(s), no unjustified numerics.`);
