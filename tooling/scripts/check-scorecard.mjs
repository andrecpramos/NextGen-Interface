#!/usr/bin/env node
// WP-12's golden-set gate. Two checks that a plain `git diff` cannot do:
//
//   REGRESSION — compare a fresh scorecard's accuracy gates against the
//   committed baseline within a tolerance. NOT exact equality: WP-01 Finding 10
//   showed two identical 8B runs at temperature 0 flipping 7 of 200 entries, and
//   a 20-entry bucket cannot resolve a 95% target better than +/-5%. Exact
//   comparison flaps; no comparison catches nothing.
//
//   STALENESS — a committed scorecard whose config.thresholds no longer match
//   the live profile in config.ts is asserting a configuration that does not
//   exist. One was found in exactly that state during WP-01: committed,
//   plausible, describing a tauFloor the code had already abandoned. It went
//   stale within hours, which is why this is a gate and not a review item.
//
// Latency is deliberately NOT compared. Measured on this repo, two runs of the
// deterministic floor gave byte-identical accuracy and p95 drifting 0.228 ->
// 0.277ms. Gating on latency here would flap for no signal.

import { readFileSync } from 'node:fs';
import { thresholdsFor } from '../../packages/core-intent/src/config.ts';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
};

const baselinePath = arg('baseline');
const currentPath = arg('current');
const tolerance = Number(arg('tolerance', '0.05'));

if (!baselinePath || !currentPath) {
  console.error('usage: check-scorecard.mjs --baseline <json> --current <json> [--tolerance 0.05]');
  process.exit(2);
}

const load = (p) => {
  const t = readFileSync(p, 'utf8');
  return JSON.parse(t.charCodeAt(0) === 0xfeff ? t.slice(1) : t);
};

const baseline = load(baselinePath);
const current = load(currentPath);
const failures = [];
const notes = [];

// ---------------------------------------------------------------- staleness --
const embedder = baseline.config?.embedder;
const live = thresholdsFor(embedder);
const committed = baseline.config?.thresholds ?? {};

for (const key of Object.keys(live)) {
  if (committed[key] !== live[key]) {
    failures.push(
      `STALE  ${baselinePath}\n         config.thresholds.${key} = ${committed[key]} but config.ts now says ${live[key]}\n` +
        `         The committed scorecard describes a configuration that no longer exists. Re-run the eval and commit the result.`,
    );
  }
}

// --------------------------------------------------------------- regression --
const baseGates = baseline.gates ?? {};
const currGates = current.gates ?? {};

for (const [name, base] of Object.entries(baseGates)) {
  const curr = currGates[name];
  if (curr === undefined) {
    failures.push(`MISSING  gate "${name}" present in baseline, absent from the fresh run`);
    continue;
  }
  if (typeof base.actual !== 'number' || typeof curr.actual !== 'number') continue;

  const delta = curr.actual - base.actual;
  if (delta < -tolerance) {
    failures.push(
      `REGRESSED  ${name}\n             ${base.actual.toFixed(4)} -> ${curr.actual.toFixed(4)}  (${delta.toFixed(4)}, tolerance -${tolerance})`,
    );
  } else if (Math.abs(delta) > tolerance) {
    notes.push(`IMPROVED   ${name}: ${base.actual.toFixed(4)} -> ${curr.actual.toFixed(4)} (+${delta.toFixed(4)}) — commit the new scorecard`);
  }
}

// ------------------------------------------------------------------- safety --
// Safety violations get no tolerance. One is a defect.
const violations = current.safetyViolations?.length ?? 0;
if (violations > 0) {
  failures.push(`SAFETY  ${violations} safety violation(s) in the fresh run — no tolerance applies to these`);
}

// -------------------------------------------------------------------- report --
console.log(`\n  scorecard gate — baseline ${baselinePath}`);
console.log(`                   current  ${currentPath}`);
console.log(`                   embedder ${embedder}, tolerance +/-${tolerance}, ${Object.keys(baseGates).length} gate(s)\n`);

for (const n of notes) console.log(`  ${n}`);

if (failures.length > 0) {
  console.error('');
  for (const f of failures) console.error(`  ${f}\n`);
  console.error(`  ${failures.length} failure(s).\n`);
  process.exit(1);
}

console.log('  OK — no accuracy regression beyond tolerance, thresholds current.\n');
