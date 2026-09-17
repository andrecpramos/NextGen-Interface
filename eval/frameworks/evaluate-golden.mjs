// Run the golden set through the cascade, against the GENERATED role-scoped
// registries, and compare with the CommandPalette baseline recorded on each
// entry.
//
// Matching is **by route, never by capability id**. WP-31's ground truth and
// WP-25's generator name their capabilities independently, and an id is an
// implementation detail: what a user cares about is arriving at the right
// screen. Comparing ids would score the generator on whether it guessed the
// same names a person chose.
//
//   node --experimental-strip-types eval/fut-app/evaluate-golden.mjs [--stage3 llama3.1:8b] [--embedder hashing]
//
// With no --stage3 the run is the model-free floor: stages 1+2 only, no network,
// which is the number the whole cost argument rests on (business-case §5).

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { makeEmbedder } from '../../packages/core-intent/src/embedder.ts';
import { loadRegistry } from '../../packages/core-intent/src/registry.ts';
import { route as routeTurn } from '../../packages/core-intent/src/cascade.ts';
import { thresholdsFor, OUTCOME, STAGE } from '../../packages/core-intent/src/config.ts';

import { appDir } from './app-dir.mjs';
const HERE = appDir();
const flag = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
};

const EMBEDDER = flag('embedder', 'hashing');
const STAGE3_MODEL = flag('stage3', null);

/**
 * `--no-stage1` — isolate what stage 1 is actually worth (WP-38 lever 1).
 *
 * Adding triggers does TWO things, and reporting their sum as "the lever" would
 * be a confounded measurement of exactly the kind PLAN.md's acceptance forbids:
 *
 *   1. it switches stage 1 on, and
 *   2. it changes every stage-2 score, because `capabilityDocument()` embeds a
 *      capability's triggers along with its title and description.
 *
 * This empties the loaded trigger index and leaves the documents and vectors
 * exactly as generated. The difference between a run with and without it is
 * stage 1's contribution alone; the difference between this run and the
 * no-trigger baseline is what the richer document bought.
 */
const NO_STAGE1 = process.argv.includes('--no-stage1');
const CONTEXT = { route: '/', today: '2026-09-10' };

const entries = readFileSync(join(HERE, 'golden-set.jsonl'), 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((line) => JSON.parse(line));


// Rule 14: use the thresholds calibrated for THIS registry when they exist. The
// shipped profile belongs to `domain-modules` — 7 capabilities, English — and
// carrying it across is the exact mistake the rule was written about.
const calibratedFile = join(HERE, 'generated', `thresholds.${EMBEDDER}.json`);
const calibrated = existsSync(calibratedFile)
  ? JSON.parse(readFileSync(calibratedFile, 'utf8')).thresholds
  : null;
const thresholds = calibrated ?? thresholdsFor(EMBEDDER);
if (calibrated) console.log(`thresholds: calibrated for this registry — ${JSON.stringify(calibrated)}`);
else console.log(`thresholds: SHIPPED profile for ${EMBEDDER} — not calibrated for this registry (Rule 14)`);
// `eval/` is not a workspace package, so the runtime is reached by path and only
// when it is actually wanted — a model-free run must not need it to exist.
const runtime = STAGE3_MODEL
  ? new (await import('../../packages/core-inference/src/index.ts')).OllamaLlmRuntime()
  : undefined;

// One registry per role (ADR-014), so one loaded router per role.
const roles = [...new Set(entries.map((e) => e.role))];
const registries = new Map();
for (const role of roles) {
  // Rule: one embedder per registry. HashingEmbedder's fit() replaces its
  // vocabulary, so a shared instance leaves nine of ten registries holding
  // vectors from a space that no longer exists. See load-registries.mjs.
  const embedder = makeEmbedder(EMBEDDER);
  const registry = await loadRegistry(join(HERE, 'generated', `registry.${role}.json`), embedder);
  // Documents and vectors are already built at this point, so emptying the index
  // removes stage 1 without touching what stage 2 scores against.
  if (NO_STAGE1) registry.triggerIndex.clear();
  registries.set(role, {
    registry,
    embedder,
    routeOf: new Map(registry.capabilities.map((c) => [c.id, c.route])),
  });
}

const results = [];
for (const entry of entries) {
  const loaded = registries.get(entry.role);
  const started = performance.now();
  const trace = await routeTurn(entry.utterance, CONTEXT, {
    registry: loaded.registry,
    embedder: loaded.embedder,
    thresholds,
    useStage3: Boolean(runtime),
    runtime,
    model: STAGE3_MODEL ?? undefined,
  });
  const elapsed = performance.now() - started;

  const chosenRoute = trace.capabilityId ? (loaded.routeOf.get(trace.capabilityId) ?? null) : null;
  const expectedRoute = entry.expect.route ?? null;
  const correct = expectedRoute
    ? trace.outcome === OUTCOME.EXECUTE && chosenRoute === expectedRoute
    : trace.outcome === OUTCOME.OUT_OF_SCOPE;

  results.push({
    ...entry,
    got: { outcome: trace.outcome, capability: trace.capabilityId, route: chosenRoute, stage: trace.decidedAt },
    correct,
    modelFree: trace.decidedAt !== STAGE.LLM,
    ms: elapsed,
  });
}

const pct = (a, b) => (b === 0 ? '—' : `${((100 * a) / b).toFixed(1)}%`);
const share = (subset, predicate) => pct(subset.filter(predicate).length, subset.length);

const inScope = results.filter((r) => r.expect.route);
const outOfScope = results.filter((r) => !r.expect.route);

console.log(`golden set: ${results.length} entries · embedder ${EMBEDDER} · stage 3 ${STAGE3_MODEL ?? 'DISABLED (model-free floor)'}\n`);

console.log('=== The three numbers ===');
// "Decided without a model call" counts a clarify, and a clarify is not a
// resolution — it is the turn handed back to the user. The number the cost
// argument actually rests on is how often the cascade *settles the turn
// correctly* for free: a right destination, or a correct refusal.
const modelFree = results.filter((r) => r.modelFree);
const settledFree = results.filter((r) => r.modelFree && r.correct);
console.log(`  1. settled CORRECTLY, no model call: ${pct(settledFree.length, results.length)}  (${settledFree.length}/${results.length})  ← the economics`);
console.log(`     (decided without a model call at all, including clarifies: ${pct(modelFree.length, results.length)})`);
console.log(`  2. top-1 on the right screen:  ${share(inScope, (r) => r.correct)}  (${inScope.filter((r) => r.correct).length}/${inScope.length})`);
const paletteFound = inScope.filter((r) => r.palette && r.palette.rank !== null);
console.log(`  3. CommandPalette baseline:    ${pct(paletteFound.length, inScope.length)}  (${paletteFound.length}/${inScope.length} offered the right screen at all)`);

console.log('\n=== Buckets ===');
for (const bucket of ['navigate', 'explain', 'out_of_scope']) {
  const subset = results.filter((r) => r.bucket === bucket);
  if (subset.length === 0) continue;
  const label = bucket === 'out_of_scope' ? 'refused' : 'right screen';
  console.log(`  ${bucket.padEnd(13)} ${String(subset.length).padStart(3)} entries · ${label} ${share(subset, (r) => r.correct)} · model-free ${share(subset, (r) => r.modelFree)}`);
}

console.log('\n=== By language ===');
for (const language of ['pt-PT', 'en']) {
  const subset = inScope.filter((r) => r.language === language);
  const palette = subset.filter((r) => r.palette && r.palette.rank !== null);
  console.log(`  ${language.padEnd(6)} ${String(subset.length).padStart(3)} · assistant ${share(subset, (r) => r.correct)} · palette ${pct(palette.length, subset.length)}`);
}

console.log('\n=== By role ===');
for (const role of roles.sort()) {
  const subset = inScope.filter((r) => r.role === role);
  if (subset.length === 0) continue;
  const palette = subset.filter((r) => r.palette && r.palette.rank !== null);
  console.log(`  ${role.padEnd(13)} ${String(subset.length).padStart(3)} · assistant ${share(subset, (r) => r.correct)} · palette ${pct(palette.length, subset.length)}`);
}

console.log('\n=== Out of scope ===');
console.log(`  refused:            ${share(outOfScope, (r) => r.correct)}`);
console.log(`  refused model-free: ${share(outOfScope, (r) => r.correct && r.modelFree)}`);
console.log(`  wrongly executed:   ${share(outOfScope, (r) => r.got.outcome === OUTCOME.EXECUTE)}`);

const wronglyRefused = inScope.filter((r) => r.got.outcome === OUTCOME.OUT_OF_SCOPE);
console.log(`\n  in-scope turns wrongly refused: ${wronglyRefused.length}/${inScope.length} = ${pct(wronglyRefused.length, inScope.length)}`);

const sorted = results.map((r) => r.ms).sort((a, b) => a - b);
const percentile = (p) => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] ?? 0;
console.log(`\n=== Latency ===\n  p50 ${percentile(50).toFixed(1)}ms · p95 ${percentile(95).toFixed(1)}ms`);

const stages = {};
for (const r of results) stages[r.got.stage] = (stages[r.got.stage] ?? 0) + 1;
console.log(`  stages: ${JSON.stringify(stages)}`);

const name = `scorecard-${EMBEDDER}-${STAGE3_MODEL ? STAGE3_MODEL.replace(/[:.]/g, '_') : 'floor'}${NO_STAGE1 ? '-nostage1' : ''}.json`;
const scorecard = {
  generatedAt: new Date().toISOString(),
  embedder: EMBEDDER,
  stage3: STAGE3_MODEL,
  entries: results.length,
  modelFreeRate: modelFree.length / results.length,
  top1: inScope.filter((r) => r.correct).length / inScope.length,
  paletteFound: paletteFound.length / inScope.length,
  outOfScopeRefused: outOfScope.filter((r) => r.correct).length / outOfScope.length,
  inScopeWronglyRefused: wronglyRefused.length / inScope.length,
  latencyP50: percentile(50),
  latencyP95: percentile(95),
  results,
};

/**
 * `--check`: the committed scorecard still describes what this registry does.
 *
 * The model-free floor is deterministic — hashing encoder, no stage 3 — so any
 * change to a description, a trigger, `normalize()` or a threshold moves it, and
 * nothing in CI noticed until now. A top-1 regression across a prompt change cost
 * seven points once already (lessons.md L9).
 *
 * Compared field by field with **timing excluded**: `generatedAt`, the latency
 * percentiles and each entry's `ms` are properties of the machine, not of the
 * router, and gating on them would mean a red build whenever CI was busy. What is
 * compared is every rate and every per-entry decision.
 */
if (process.argv.includes('--check')) {
  const file = join(HERE, name);
  if (!existsSync(file)) {
    console.error(`\n  MISSING: ${name} — run this without --check and commit the result.\n`);
    process.exit(1);
  }
  const strip = (card) => ({
    ...card,
    generatedAt: undefined,
    latencyP50: undefined,
    latencyP95: undefined,
    results: card.results.map((r) => ({ ...r, ms: undefined })),
  });
  const committed = JSON.parse(readFileSync(file, 'utf8'));
  const before = strip(committed);
  const after = strip(scorecard);

  if (JSON.stringify(before) === JSON.stringify(after)) {
    console.log(`\n  ${name} still describes this registry — every rate and every decision matches.\n`);
    process.exit(0);
  }

  console.error(`\n  STALE: ${name}\n`);
  for (const key of ['entries', 'modelFreeRate', 'top1', 'paletteFound', 'outOfScopeRefused', 'inScopeWronglyRefused']) {
    if (before[key] !== after[key]) console.error(`    ${key}: ${before[key]} -> ${after[key]}`);
  }
  const byId = new Map(committed.results.map((r) => [r.id, r]));
  const moved = results.filter((r) => {
    const was = byId.get(r.id);
    return was && (was.correct !== r.correct || was.got.route !== r.got.route || was.got.outcome !== r.got.outcome);
  });
  if (moved.length > 0) {
    console.error(`\n    ${moved.length} turn(s) decided differently, first 10:`);
    for (const r of moved.slice(0, 10)) {
      const was = byId.get(r.id);
      console.error(`      ${r.id}  ${was.got.outcome}:${was.got.route} -> ${r.got.outcome}:${r.got.route}`);
    }
  }
  console.error('\n  If the change was intended, regenerate and commit it in the same commit as the cause:');
  console.error(`    node --experimental-strip-types eval/fut-app/evaluate-golden.mjs --embedder ${EMBEDDER}\n`);
  process.exit(1);
}

writeFileSync(join(HERE, name), JSON.stringify(scorecard, null, 2) + '\n', 'utf8');
console.log(`\n  wrote ${name}`);
