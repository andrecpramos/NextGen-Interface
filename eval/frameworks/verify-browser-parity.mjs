// WP-24: "Browser model-free rate matches the Node figure."
//
// Two paths to the same registry:
//
//   server  — loadRegistry(): read the file, fit an encoder over the corpus,
//             embed all documents at startup.
//   browser — registryFromIndex(): the parsed registry plus the vectors that
//             shipped beside it. No file read, no fit, no network.
//
// If they disagree on a single turn, the shipped index does not describe the
// registry it ships with, and every browser user gets a different assistant from
// the one that was measured. So this compares the DECISION, turn by turn, rather
// than comparing two summary percentages that could match by coincidence.
//
// The query encoder still has to be fitted to the same corpus in both cases —
// that is lessons.md L10, and it is the one thing shipping vectors does NOT
// remove. A browser bundle ships the fitted vocabulary or refits it locally;
// this measures the vectors, which is the part that was in question.
//
//   node --experimental-strip-types eval/fut-app/verify-browser-parity.mjs

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { makeEmbedder } from '../../packages/core-intent/src/embedder.ts';
import { loadRegistry } from '../../packages/core-intent/src/registry.ts';
import { registryFromIndex } from '../../packages/core-intent/src/registry-browser.ts';
import { route as routeTurn } from '../../packages/core-intent/src/cascade.ts';

import { appDir } from './app-dir.mjs';
const HERE = appDir();
const GEN = join(HERE, 'generated');
const CONTEXT = { route: '/', today: '2026-09-10' };

const thresholds = JSON.parse(readFileSync(join(GEN, 'thresholds.hashing.json'), 'utf8')).thresholds;

const entries = readFileSync(join(HERE, 'golden-set.jsonl'), 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((l) => JSON.parse(l));

const roles = [...new Set(entries.map((e) => e.role))];

const server = new Map();
const browser = new Map();

for (const role of roles) {
  // One embedder per registry, both paths. L10.
  const serverEmbedder = makeEmbedder('hashing');
  server.set(role, {
    registry: await loadRegistry(join(GEN, `registry.${role}.json`), serverEmbedder),
    embedder: serverEmbedder,
  });

  const raw = JSON.parse(readFileSync(join(GEN, `registry.${role}.json`), 'utf8'));
  const index = JSON.parse(readFileSync(join(GEN, `index.${role}.json`), 'utf8'));
  const browserRegistry = registryFromIndex(raw, index);
  // The query encoder is fitted from the registry's own documents, which is what
  // a bundle would do. It never touches the server instance.
  const browserEmbedder = makeEmbedder('hashing');
  browserEmbedder.fit(browserRegistry.documents);
  browser.set(role, { registry: browserRegistry, embedder: browserEmbedder });
}

const run = async (side, entry) => {
  const { registry, embedder } = side.get(entry.role);
  return routeTurn(entry.utterance, CONTEXT, { registry, embedder, thresholds, useStage3: false });
};

let same = 0;
const differ = [];

for (const entry of entries) {
  const a = await run(server, entry);
  const b = await run(browser, entry);
  const key = (t) => `${t.outcome}|${t.capabilityId ?? '-'}|${t.decidedAt}`;
  if (key(a) === key(b)) same++;
  else differ.push({ u: entry.utterance, server: key(a), browser: key(b) });
}

const pct = ((100 * same) / entries.length).toFixed(1);
console.log(`turns compared      : ${entries.length}`);
console.log(`identical decision  : ${same} = ${pct}%`);
console.log(`differing           : ${differ.length}`);

if (differ.length > 0) {
  console.log();
  console.log('⚠️ the shipped index does not reproduce the server decision:');
  for (const d of differ.slice(0, 10)) {
    console.log(`  "${d.u.slice(0, 58)}"`);
    console.log(`     server  ${d.server}`);
    console.log(`     browser ${d.browser}`);
  }
  process.exit(1);
}

console.log();
console.log('The shipped index reproduces the server decision on every turn.');
