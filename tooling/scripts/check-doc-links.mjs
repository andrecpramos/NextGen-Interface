#!/usr/bin/env node
// Verifies that every relative markdown link in the repo resolves to a file that
// exists.
//
// This gate exists because documentation links were previously ungated: nothing
// caught a link to a file that had been moved or deleted, so a knowledge base
// could rot into a set of 404s while every other gate stayed green. It was added
// after the .ai/ -> .claude/ migration, which moved 39 files and rewrote 209
// references -- exactly the operation that silently breaks links.
//
// Only checks relative links. External URLs, anchors and mailto: are ignored
// because verifying them needs the network and produces flaky failures.
//
// Exit 1 on any broken link, naming file:line and the target.

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative, resolve } from 'node:path';

const ROOT = process.cwd();
const SKIP = /(^|\/)(node_modules|\.git|dist|\.next|\.turbo|coverage)(\/|$)/;

// sdlc-kit/templates/ is excluded on purpose. Its links are written to resolve
// at the template's DESTINATION (.claude/sdlc/agent-workflow.md links to
// ../hooks/guard-git.mjs), not at its location inside the kit. Checking them
// here would report ~11 permanent failures and train everyone to ignore this
// gate -- the exact failure mode a noisy check produces.
const TEMPLATES = /^sdlc-kit\/templates\//;

const files = [];
const walk = (dir) => {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const rel = relative(ROOT, full).replace(/\\/g, '/');
    if (SKIP.test(rel)) continue;
    if (statSync(full).isDirectory()) walk(full);
    else if (rel.endsWith('.md')) files.push(rel);
  }
};
walk(ROOT);

// [text](target) — target captured up to the closing paren or a whitespace title.
const LINK = /\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;

const broken = [];
let checked = 0;

for (const file of files) {
  if (TEMPLATES.test(file)) continue;
  const lines = readFileSync(join(ROOT, file), 'utf8').split('\n');

  lines.forEach((line, i) => {
    // A link inside a fenced code block is usually illustrative, not a real
    // reference. Cheap heuristic: skip indented code and template placeholders.
    if (/^\s{4,}/.test(line)) return;

    for (const m of line.matchAll(LINK)) {
      const raw = m[1];
      if (/^(https?:|mailto:|#|<)/.test(raw)) continue;
      if (raw.includes('{{')) continue; // template placeholder, not a path

      const target = raw.split('#')[0];
      if (!target) continue;

      checked++;
      const abs = resolve(ROOT, dirname(file), target);
      if (!existsSync(abs)) {
        broken.push({ file, line: i + 1, target: raw });
      }
    }
  });
}

if (broken.length) {
  console.error(`\n  Broken documentation links: ${broken.length} of ${checked} checked\n`);
  for (const b of broken) {
    console.error(`  ${b.file}:${b.line}`);
    console.error(`    -> ${b.target}`);
  }
  console.error('');
  process.exit(1);
}

console.log(`  Doc links OK — ${checked} relative link(s) across ${files.length} file(s) all resolve.`);
