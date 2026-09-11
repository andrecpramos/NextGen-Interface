#!/usr/bin/env node
// Rule 15: content that reaches a prompt is untrusted and must be fenced.
//
// Rule 15 was this repo's #1 enforcement gap until 2026-09-10, and it was open
// for a specific reason worth not repeating: six declaration sites carried the
// comment "UNTRUSTED — fence before this reaches a prompt" and there was no
// fence function to call. A rule with no mechanism is obeyed until someone is
// in a hurry.
//
// The fences exist now. This gate is what keeps them applied as the codebase
// grows, because the failure mode is not someone removing a fence — it is
// someone adding the fifth prompt-building site and not knowing the rule.
//
// WHAT THIS CHECKS
//   Every `.complete({ ... })` call outside core-inference and outside tests.
//   If its `prompt:` interpolates anything at all, the prompt expression must
//   mention `fence(`, `redactTag(` or `UNTRUSTED_NOTICE`.
//
// WHAT THIS DOES NOT CHECK, and cannot
//   That the RIGHT value was fenced. Fencing legitimately happens upstream —
//   `shortlistJudge` builds a fenced `listing` on one line and interpolates the
//   variable on another — so a syntactic gate can see that fencing happened
//   near a prompt, not that it covered every untrusted input. Reading for that
//   is the boundary-auditor agent's job.
//
//   Stated plainly because critical-infrastructure.md's own standard is that a
//   gate which passes vacuously is worse than no gate: it buys confidence it
//   has not earned. This one is a tripwire against forgetting, not a proof.
//
// An intentional exception is declared in the source, next to the call:
//   // rule15-ok: <why this prompt needs no fence>

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';

const ROOT = new URL('../..', import.meta.url).pathname
  .replace(/^\/([A-Za-z]:)/, '$1')
  .replace(/\/$/, '');

/** The package that DEFINES the fences and the runtime interface. */
const EXEMPT_PACKAGES = new Set(['core-inference']);

const FENCED = /\bfence\s*\(|\bredactTag\s*\(|\bUNTRUSTED_NOTICE\b/;
const OPT_OUT = /rule15-ok:/;

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

const sourceRoots = [];
for (const group of ['packages', 'apps']) {
  const base = join(ROOT, group);
  let dirs;
  try {
    dirs = readdirSync(base, { withFileTypes: true });
  } catch {
    continue;
  }
  for (const d of dirs) {
    if (!d.isDirectory()) continue;
    if (group === 'packages' && EXEMPT_PACKAGES.has(d.name)) continue;
    sourceRoots.push(join(base, d.name));
  }
}

/**
 * The initializer of a `const <name> = ...` declared anywhere in this file.
 *
 * Deliberately file-scoped rather than scope-aware. A prompt assembled in one
 * function and sent in another is exactly the shape that hides an unfenced
 * value, so widening the search errs toward looking at more source, not less;
 * and a second `prompt` binding in the same file would be found by the first
 * match, which is a reason to keep prompt-building functions short.
 */
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

for (const file of sourceRoots.flatMap(walk)) {
  const text = readFileSync(file, 'utf8');
  // Cheap pre-filter: most files never build a prompt.
  if (!text.includes('prompt')) continue;

  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);

  const visit = (node) => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const name = ts.isPropertyAccessExpression(callee) ? callee.name.text : null;

      if (name === 'complete') {
        const arg = node.arguments[0];
        if (arg && ts.isObjectLiteralExpression(arg)) {
          const promptProp = arg.properties.find(
            (p) =>
              (ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)) &&
              ts.isIdentifier(p.name) &&
              p.name.text === 'prompt',
          );
          if (promptProp) {
            checked++;
            // `{ prompt }` shorthand is not a lesser case — it is how the
            // stage-3 router writes it, which is the single highest-traffic
            // prompt in the system. The first draft of this gate handled only
            // `prompt:` and so reported "OK" while never looking at it. That is
            // the vacuous pass critical-infrastructure.md calls worse than no
            // gate, found by counting the sites the gate claimed to have
            // checked against the sites that exist.
            const expr = ts.isPropertyAssignment(promptProp)
              ? promptProp.initializer
              : resolveLocal(sf, promptProp.name.text) ?? promptProp.name;
            const src = expr.getText(sf);
            // A prompt built only from string literals carries no caller input.
            const interpolates = /\$\{|\+/.test(src) || !ts.isStringLiteral(expr);
            const nearby = text.slice(
              Math.max(0, node.getStart(sf) - 600),
              node.getEnd(sf),
            );
            if (interpolates && !FENCED.test(src) && !OPT_OUT.test(nearby)) {
              const { line } = sf.getLineAndCharacterOfPosition(promptProp.getStart(sf));
              violations.push({
                file: file.slice(ROOT.length + 1).replace(/\\/g, '/'),
                line: line + 1,
                snippet: src.replace(/\s+/g, ' ').slice(0, 90),
              });
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
  console.error(`\n  Rule 15 FAILED — ${violations.length} prompt(s) interpolate unfenced input.\n`);
  for (const v of violations) {
    console.error(`    ${v.file}:${v.line}`);
    console.error(`      prompt: ${v.snippet}`);
  }
  console.error(`
  Every value a prompt interpolates is attacker-reachable somewhere upstream.
  Wrap it: fence('what this is', value) from @nextgen/core-inference, or
  redactTag('tagname', value) if the prompt already delimits with tags.

  If this prompt genuinely needs no fence, say why in the source:
      // rule15-ok: <reason>
`);
  process.exit(1);
}

console.log(`  Rule 15 OK — ${checked} prompt site(s), all fenced or literal.`);
