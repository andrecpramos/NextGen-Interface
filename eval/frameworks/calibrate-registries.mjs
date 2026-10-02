// Rule 14 — thresholds are calibrated per encoder AND per registry, never
// hand-set and never carried across.
//
// The shipped `hashing` profile (tauHigh 0.436) was calibrated for the frozen
// 7-capability fixture (`core-intent/eval/fixture-registry.json`): English, a
// hand-written golden set. Applied unchanged to a generated registry an order of
// magnitude larger, in another language, it accepts nothing at all — every turn falls under the bar and degrades to a clarify,
// which reads as "the router is broken" and is really "the threshold belongs to
// a different registry". PLAN.md §6 has this lesson twice already, at both ends
// of the scale.
//
// **The sweep itself now lives in `core-intent/src/calibrate.ts`** (WP-41). It
// used to live here, and a third copy was about to be written for the drop-in
// kit; two copies of a calibration sweep is how Rule 14 drifts. This file is now
// what it always should have been — the part that is specific to one fixture app:
// which golden set, which role registries, and where the thresholds are written.
//
// SPLIT: calibration sees 40% of the destinations, and the held-out 60% is
// reported but never optimised against. Splitting by ROUTE, not by entry, so
// that no screen has questions on both sides — otherwise a threshold tuned on
// "o que é o centro clínico" would be validated on "para que serve o centro
// clínico", which is the same question twice.
//
//   node --experimental-strip-types eval/frameworks/calibrate-registries.mjs [--embedder hashing] [--check]
//
// `--check` (WP-46) writes nothing. It compares the freshly swept thresholds with
// the shipped file's, and exits 1 if they differ. Only the operating point is
// compared, not the timestamp and not the report numbers around it: Rule 14 is
// about the thresholds a browser actually uses.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { makeEmbedder } from '../../packages/core-intent/src/embedder.ts';
import { loadRegistry } from '../../packages/core-intent/src/registry.ts';
import {
  measure,
  scoreTurns,
  splitByRoute,
  splitSizes,
  sweep,
  toThresholds,
  tradeOffCurve,
} from '../../packages/core-intent/src/calibrate.ts';

import { appDir, appName } from './app-dir.mjs';
const HERE = appDir();
const flag = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
};
const EMBEDDER = flag('embedder', 'hashing');

const golden = readFileSync(join(HERE, 'golden-set.jsonl'), 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((line) => JSON.parse(line));

const roles = [...new Set(golden.map((e) => e.role))];
const loaded = new Map();
for (const role of roles) {
  // One embedder per registry — HashingEmbedder's fit() is destructive state.
  // See load-registries.mjs for what a shared instance cost.
  const embedder = makeEmbedder(EMBEDDER);
  const registry = await loadRegistry(join(HERE, 'generated', `registry.${role}.json`), embedder);
  loaded.set(role, { registry, embedder });
}

// The fixture app's golden set, in the shape the shared sweep takes: a role is just the
// key that says which registry scores this turn.
const entries = golden.map((e) => ({
  id: e.id,
  utterance: e.utterance,
  expectRoute: e.expect.route ?? null,
  registryKey: e.role,
}));

const scored = await scoreTurns(entries, (role) => loaded.get(role));
const isCalibration = splitByRoute(entries);
const calibrationSet = scored.filter((r) => isCalibration(r.entry));
const heldOut = scored.filter((r) => !isCalibration(r.entry));
const { destinations, calibrationDestinations } = splitSizes(entries);

console.log(`${entries.length} entries · embedder ${EMBEDDER}`);
console.log(`  calibration split: ${calibrationSet.length} (${calibrationDestinations}/${destinations} destinations)`);
console.log(`  held out:          ${heldOut.length}\n`);

const swept = sweep(calibrationSet);

console.log(
  `boundaryMargin ${swept.boundaryMargin} — refuses ${swept.refusedOutOfScope}/${swept.outOfScopeEntries} ` +
  'out-of-scope, 0 in-domain wrongly refused',
);
console.log(
  `actionBoundaryMargin ${swept.actionBoundaryMargin} — under the identical zero-false-refusal constraint ` +
  `(${swept.carryingActionVerb}/${calibrationSet.length} utterances carry an action verb)`,
);
console.log(
  `tauHigh ${swept.tauHigh}, delta ${swept.delta} — accepts ${swept.acceptedInDomain}/${swept.inDomainEntries} ` +
  'routable turns at 100% precision\n',
);

function show(label, rows) {
  const r = measure(rows, swept);
  const pct = (x) => (x === null ? '—' : `${(100 * x).toFixed(1)}%`);
  console.log(label);
  console.log(`  settled by stage 2:        ${pct(r.settled)}`);
  console.log(`  routable accepted:         ${pct(r.accepted)}`);
  console.log(`  of those, right screen:    ${pct(r.precision)}`);
  console.log(`  out-of-scope refused:      ${pct(r.outOfScopeRefused)}`);
  console.log(`  in-domain wrongly refused: ${pct(r.wronglyRefused)}`);
  return r;
}

const calibrationReport = show('calibration split (optimised against — expect it to flatter):', calibrationSet);
console.log();
const heldOutReport = show('HELD-OUT split (never optimised against — this is the real number):', heldOut);

// ------------------------------------------------- the trade-off curve ---
//
// One operating point hides the shape of the problem. The shipped profile was
// calibrated at 100% precision against a 7-capability registry, where that cost
// almost nothing; at 145 capabilities it costs nearly all the coverage.

console.log('\n=== precision / coverage trade-off, measured on the held-out split ===\n');
console.log('  precision floor │ tauHigh  delta │ accepted (held out)  actual precision');
console.log('  ────────────────┼────────────────┼──────────────────────────────────────');

const curve = tradeOffCurve(calibrationSet, heldOut, swept.boundaryMargin);
for (const point of curve) {
  if (!point.feasible) {
    console.log(`  ${String(point.precisionFloor).padEnd(15)} │ none            │ —`);
    continue;
  }
  console.log(
    `  ${String(point.precisionFloor).padEnd(15)} │ ${String(point.tauHigh).padEnd(8)} ${String(point.delta).padEnd(5)} │ ` +
      `${`${(100 * point.heldOutAccepted).toFixed(1)}%`.padEnd(7)}  ` +
      `${point.heldOutPrecision === null ? '—' : `${(100 * point.heldOutPrecision).toFixed(1)}%`}`,
  );
}

const output = {
  generatedAt: new Date().toISOString(),
  encoder: EMBEDDER,
  registry: `eval/frameworks/${appName(HERE)}/generated`,
  method:
    'Swept against the fixture app’s golden set, split by destination 40/60. boundaryMargin maximises ' +
    'out-of-scope refusal subject to zero in-domain refusals; actionBoundaryMargin (ADR-015) ' +
    'does the same for utterances carrying an action verb, under the identical zero-false-refusal ' +
    'constraint and never above boundaryMargin; tauHigh/delta maximise stage-2 ' +
    'accepts subject to 100% precision. Never hand-set (Rule 14). The sweep is ' +
    'core-intent/src/calibrate.ts, shared with the drop-in kit so there is one implementation.',
  thresholds: toThresholds(swept),
  calibration: calibrationReport,
  heldOut: heldOutReport,
  // The curve matters more than the point: at 145 capabilities there is no
  // operating point that is both free and right, and one row cannot show that.
  curve,
};

const file = join(HERE, 'generated', `thresholds.${EMBEDDER}.json`);
if (process.argv.includes('--check')) {
  const shipped = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')).thresholds : null;
  if (JSON.stringify(shipped) !== JSON.stringify(output.thresholds)) {
    console.log(`\n  STALE: ${file}`);
    console.log(`    shipped:    ${JSON.stringify(shipped)}`);
    console.log(`    calibrated: ${JSON.stringify(output.thresholds)}`);
    console.log('  Regenerate: node --experimental-strip-types eval/frameworks/calibrate-registries.mjs --embedder hashing');
    process.exitCode = 1;
  } else {
    console.log(`\n  shipped thresholds match a fresh calibration (${file})`);
  }
} else {
  writeFileSync(file, JSON.stringify(output, null, 2) + '\n', 'utf8');
  console.log(`\n  wrote ${file}`);
}
