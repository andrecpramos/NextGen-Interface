// WP-46 — the shipped browser artefacts must follow their inputs.
//
// eval/fut-app/generated/ holds what an adopter's browser receives: per
// registry, a registry, a precomputed index and a calibrated threshold file. The
// index and the thresholds are DERIVED. They depend on the registry, the encoder,
// capabilityDocument() and normalize(). On 2026-09-11, a one-line change to
// normalize() left ten shipped indexes and two threshold profiles stale, and CI
// stayed green. Only a manual parity run noticed. That is lessons.md L6 again: a
// check that nobody runs is not a gate.
//
// Three checks. Each is an existing script, run exactly as a person would run it,
// so the gate cannot drift from the code that builds the artefacts:
//   1. rebuild-indexes.mjs --check       each shipped index equals a fresh rebuild
//   2. calibrate-registries.mjs --check  the shipped thresholds equal a fresh sweep (Rule 14)
//   3. verify-browser-parity.mjs         the shipped index makes the server's decision, turn by turn
//
// The first two are exact. The third is behavioural. It is the one that would
// still catch a drift that the first two were written not to see.
//
//   node tooling/scripts/check-derived-artefacts.mjs

import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const CHECKS = [
  { name: 'shipped indexes match a fresh rebuild', args: ['eval/fut-app/rebuild-indexes.mjs', '--check'] },
  {
    name: 'per-registry thresholds match a fresh calibration (Rule 14)',
    args: ['eval/fut-app/calibrate-registries.mjs', '--embedder', 'hashing', '--check'],
  },
  { name: 'the shipped index reproduces the server decision on every turn', args: ['eval/fut-app/verify-browser-parity.mjs'] },
];

let failed = 0;
for (const check of CHECKS) {
  const run = spawnSync(process.execPath, ['--experimental-strip-types', ...check.args], { cwd: ROOT, encoding: 'utf8' });
  const ok = run.status === 0;
  console.log(`  ${ok ? 'OK  ' : 'FAIL'}  ${check.name}`);
  if (!ok) {
    failed++;
    const tail = `${run.stdout ?? ''}${run.stderr ?? ''}`.trim().split('\n').slice(-14);
    for (const line of tail) console.log(`          ${line}`);
  }
}

if (failed > 0) {
  console.log(`
  Derived artefacts are STALE — ${failed} of ${CHECKS.length} check(s) failed.

  Something upstream of eval/fut-app/generated/ changed: normalize(), the encoder,
  capabilityDocument(), or a registry. Regenerate, in this order, and commit the
  result together with the change that caused it:

    node --experimental-strip-types eval/fut-app/rebuild-indexes.mjs
    node --experimental-strip-types eval/fut-app/calibrate-registries.mjs --embedder hashing
    node tooling/scripts/check-derived-artefacts.mjs

  Never edit these files by hand. They are measurements, and a hand-edit makes
  every number built on them fiction (Rule 14).`);
  process.exit(1);
}

console.log('\n  Derived artefacts OK — indexes, thresholds and browser decisions all match their inputs.');
