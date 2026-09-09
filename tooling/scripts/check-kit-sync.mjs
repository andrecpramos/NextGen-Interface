#!/usr/bin/env node
// The hooks in .claude/hooks/ and sdlc-kit/runtime/hooks/ must be byte-identical.
//
// Why this gate exists: an earlier version of the kit shipped a whole .claude/
// payload as files to copy. Within one session of use, 10 of its 18 files had
// diverged -- every divergence a legitimate per-repo adaptation. The conclusion
// was that skills, agents and commands must be GENERATED per repo, not copied.
//
// Hooks are the one exception. They are entirely config-driven, so they really
// are identical in every repo, and copying them is correct. That makes drift
// between the two copies a defect rather than an adaptation -- and this gate is
// what makes the distinction enforceable instead of merely stated.
//
// Exit 1 on any difference, naming the file and which side is newer.

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const INSTALLED = '.claude/hooks';
const CANONICAL = 'sdlc-kit/runtime/hooks';

if (!existsSync(CANONICAL)) {
  console.log('  Kit sync skipped — sdlc-kit/runtime/hooks not present.');
  process.exit(0);
}

const hooks = readdirSync(CANONICAL).filter((f) => f.endsWith('.mjs'));
const problems = [];

for (const hook of hooks) {
  const a = join(INSTALLED, hook);
  const b = join(CANONICAL, hook);

  if (!existsSync(a)) {
    problems.push(`${hook}: missing from ${INSTALLED}`);
    continue;
  }

  const left = readFileSync(a, 'utf8');
  const right = readFileSync(b, 'utf8');
  if (left === right) continue;

  const newer =
    statSync(a).mtimeMs > statSync(b).mtimeMs
      ? `${INSTALLED}/${hook} is newer`
      : `${CANONICAL}/${hook} is newer`;
  problems.push(`${hook}: differs — ${newer}`);
}

if (problems.length) {
  console.error(`\n  Hook copies have diverged (${problems.length}):\n`);
  for (const p of problems) console.error(`    ${p}`);
  console.error(
    `\n  Hooks are config-driven and must be identical in both places.\n` +
      `  Copy the correct version over the other, then re-run:\n` +
      `    cp ${CANONICAL}/<hook>.mjs ${INSTALLED}/<hook>.mjs\n`,
  );
  process.exit(1);
}

console.log(`  Kit sync OK — ${hooks.length} hook(s) identical in both locations.`);
