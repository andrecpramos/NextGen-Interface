// The shipped browser artefacts must follow their inputs.
//
// eval/frameworks/school/generated/ holds what an adopter's browser receives: per
// registry, a registry, a precomputed index and a calibrated threshold file. The
// index and the thresholds are DERIVED. They depend on the registry, the encoder,
// capabilityDocument() and normalize(). On 2026-09-11, a one-line change to
// normalize() left ten shipped indexes and two threshold profiles stale, and CI
// stayed green. Only a manual parity run noticed. A check that nobody runs is
// not a gate.
//
// Four checks. Each is an existing script, run exactly as a person would run it,
// so the gate cannot drift from the code that builds the artefacts:
//   1. rebuild-indexes.mjs --check       each shipped index equals a fresh rebuild
//   2. calibrate-registries.mjs --check  the shipped thresholds equal a fresh sweep (Rule 14)
//   3. verify-browser-parity.mjs         the shipped index makes the server's decision, turn by turn
//   4. check-rule-provenance.mjs         an extracted rule's source resolves to the line it names (ADR-020)
//
// The first two are exact. The third is behavioural. It is the one that would
// still catch a drift that the first two were written not to see. The fourth is a
// different kind of staleness than the other three: not a vector or a threshold going
// out of sync with a registry, but a *rule* going out of sync with the source line it
// claims to come from — ADR-020's own consequence, "an extracted rule points at a line;
// the line moves", made gateable rather than merely stated.
//
//   node tooling/scripts/check-derived-artefacts.mjs

import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const CHECKS = [
  { name: 'shipped indexes match a fresh rebuild', args: ['eval/frameworks/rebuild-indexes.mjs', '--check'] },
  {
    name: 'per-registry thresholds match a fresh calibration (Rule 14)',
    args: ['eval/frameworks/calibrate-registries.mjs', '--embedder', 'hashing', '--check'],
  },
  { name: 'the shipped index reproduces the server decision on every turn', args: ['eval/frameworks/verify-browser-parity.mjs'] },
  { name: "an extracted rule's source resolves to the line it names (ADR-020)", args: ['tooling/scripts/check-rule-provenance.mjs'] },
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

  If check 1, 2 or 3 failed: something upstream of eval/frameworks/school/generated/
  changed — normalize(), the encoder, capabilityDocument(), or a registry. Regenerate,
  in this order, and commit the result together with the change that caused it:

    node --experimental-strip-types eval/frameworks/rebuild-indexes.mjs
    node --experimental-strip-types eval/frameworks/calibrate-registries.mjs --embedder hashing
    node tooling/scripts/check-derived-artefacts.mjs

  Never edit these files by hand. They are measurements, and a hand-edit makes
  every number built on them fiction (Rule 14).

  If check 4 failed: that fix is different in kind and printed above, in its own tail —
  an extracted rule's source no longer resolving is either a moved page (rebuild the
  registry) or a wrong line computed by packages/generator/src/field-rules.ts.`);
  process.exit(1);
}

console.log('\n  Derived artefacts OK — indexes, thresholds and browser decisions all match their inputs.');
