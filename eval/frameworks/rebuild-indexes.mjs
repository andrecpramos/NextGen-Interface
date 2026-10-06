// Rebuild the shipped embedding indexes from the registries already in
// `generated/` — no access to the application's source.
//
// An index is a function of (registry, encoder). When the encoder changes and the
// registry does not — as when `normalize()` started stripping sentence
// punctuation — the vectors are stale and `verify-browser-parity.mjs` fails. The
// generator would fix that too, but it re-reads the application; this touches
// only what the generator already wrote.
//
//   node --experimental-strip-types eval/frameworks/rebuild-indexes.mjs           # rewrite them
//   node --experimental-strip-types eval/frameworks/rebuild-indexes.mjs --check   # are they current?
//
// `--check` rebuilds into a temporary folder and compares the result with what is
// shipped, ignoring `generatedAt`. It uses the same `writeIndexes` the generator
// uses, so the check cannot drift from the build.

import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { writeIndexes } from '../../packages/generator/src/emit.ts';

import { appDir } from './app-dir.mjs';
const GEN = join(appDir(), 'generated');
const CHECK = process.argv.includes('--check');

const registries = new Map();
for (const name of readdirSync(GEN).sort()) {
  const match = /^registry\.(.+)\.json$/.exec(name);
  if (match) registries.set(match[1], JSON.parse(readFileSync(join(GEN, name), 'utf8')));
}

if (!CHECK) {
  // writeIndexes fits a fresh encoder per registry.
  const written = await writeIndexes(GEN, registries, 'hashing');
  console.log(`rebuilt ${written.length} index file(s): ${written.join(', ')}`);
} else {
  const scratch = mkdtempSync(join(tmpdir(), 'nextgen-index-'));
  try {
    const written = await writeIndexes(scratch, registries, 'hashing');
    const content = (file) => {
      const index = JSON.parse(readFileSync(file, 'utf8'));
      delete index.generatedAt;
      return JSON.stringify(index);
    };
    const stale = written.filter((name) => !existsSync(join(GEN, name)) || content(join(GEN, name)) !== content(join(scratch, name)));
    if (stale.length > 0) {
      console.log(`${stale.length} of ${written.length} shipped index(es) do not match a fresh rebuild: ${stale.join(', ')}`);
      console.log('Regenerate: node --experimental-strip-types eval/frameworks/rebuild-indexes.mjs');
      process.exitCode = 1;
    } else {
      console.log(`${written.length} shipped index(es) match a fresh rebuild`);
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}
