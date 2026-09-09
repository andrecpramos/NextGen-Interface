#!/usr/bin/env node
// Rule 14: thresholds are CALIBRATED per encoder, never hand-set and never
// copied between encoders.
//
// The rule had no gate. `pnpm router:calibrate` writes its recommendation to
// packages/core-intent/eval/scorecards/thresholds-<kind>.json, and nothing at
// run time reads that file -- the operating point actually used is a literal in
// packages/core-intent/src/config.ts, transcribed by hand. So the one edit the
// rule exists to forbid (nudging tauHigh until a failing case passes) is also
// the one edit nothing notices.
//
// This compares the two and fails when they disagree. It does not re-run the
// sweep: calibration needs the golden set and, for the ollama encoder, a live
// embedding server, neither of which belongs in a fast gate. It only asserts
// that what ships is what the last sweep recommended.
//
// Deliberately NOT compared:
//   topK  -- a model knob, not an encoder one (WP-01). The sweep does not emit it.
//   The `alternatives` array -- informational; `recommended` is the decision.

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// new URL(...).pathname keeps a trailing slash and, on Windows, a leading one
// before the drive letter -- normalise both, same as check-import-boundaries.
const ROOT = new URL('../..', import.meta.url).pathname
  .replace(/^\/([A-Za-z]:)/, '$1')
  .replace(/\/$/, '');
const CARDS = join(ROOT, 'packages', 'core-intent', 'eval', 'scorecards');

// The fields the sweep actually decides. boundaryMargin is included because it
// was itself a calibration fix (see the comment above THRESHOLD_PROFILES) and
// is exactly the kind of number that gets nudged by hand.
const CALIBRATED = ['tauHigh', 'delta', 'tauFloor', 'boundaryMargin'];

// Transcription is exact by design; the epsilon only absorbs float
// representation, never a deliberate edit. 0.44 vs 0.436 is 4e-3 and fails.
const EPS = 1e-9;

// pathToFileURL, not the bare path: on Windows an absolute path starts with a
// drive letter, which the ESM loader reads as an unsupported "c:" URL scheme.
const { thresholdsFor, THRESHOLD_PROFILES } = await import(
  pathToFileURL(join(ROOT, 'packages', 'core-intent', 'src', 'config.ts')).href
);

const problems = [];
const checked = [];

const cardFor = (kind) => join(CARDS, `thresholds-${kind}.json`);

for (const kind of Object.keys(THRESHOLD_PROFILES)) {
  const card = cardFor(kind);
  if (!existsSync(card)) {
    problems.push(
      `  ${kind}: no calibration on record.\n` +
        `      config.ts ships a profile for "${kind}" but ${card.slice(ROOT.length + 1)} does not exist.\n` +
        `      Run: pnpm router:calibrate  (or node eval/calibrate.js --embedder=${kind})`,
    );
    continue;
  }

  const sweep = JSON.parse(readFileSync(card, 'utf8'));
  const recommended = sweep.recommended ?? {};
  const shipped = thresholdsFor(kind);
  const drifted = [];

  for (const field of CALIBRATED) {
    const want = recommended[field];
    const have = shipped[field];
    if (want === undefined) continue; // the sweep does not decide this one
    if (typeof have !== 'number' || Math.abs(have - want) > EPS) {
      drifted.push(`${field}: config.ts has ${have}, the sweep recommends ${want}`);
    }
  }

  if (drifted.length > 0) {
    problems.push(
      `  ${kind}: shipped thresholds do not match the calibration.\n` +
        drifted.map((d) => `      ${d}`).join('\n') +
        `\n      Calibrated at ${sweep.calibratedAt ?? 'unknown'}.` +
        `\n      Either transcribe the recommendation into THRESHOLD_PROFILES.${kind},` +
        `\n      or re-run the sweep if the registry or golden set changed:` +
        `\n        pnpm router:inspect     # look at the distributions first` +
        `\n        pnpm router:calibrate`,
    );
  } else {
    checked.push(kind);
  }
}

// A calibration file with no profile is the other direction of the same drift:
// someone calibrated an encoder the router cannot actually be run with.
if (existsSync(CARDS)) {
  const orphans = readdirSync(CARDS)
    .map((f) => f.match(/^thresholds-(.+)\.json$/)?.[1])
    .filter((k) => k && !(k in THRESHOLD_PROFILES));
  for (const kind of orphans) {
    problems.push(
      `  ${kind}: calibrated, but config.ts has no THRESHOLD_PROFILES entry for it.\n` +
        `      Either add the profile or delete the stale scorecard.`,
    );
  }
}

if (problems.length > 0) {
  console.error('\nRule 14 VIOLATED — shipped thresholds are not the calibrated ones.\n');
  console.error(problems.join('\n\n'));
  console.error(
    '\n  Thresholds are calibrated against the whole golden set, per encoder, never' +
      '\n  hand-set and never copied between encoders. Hand-tuning has cost accuracy' +
      '\n  three times here (FINDINGS 1 and 11). If a case is failing, differentiate' +
      '\n  the overlapping capability descriptions -- do not move the threshold.\n',
  );
  process.exit(1);
}

console.log(
  `  Rule 14 OK — ${checked.length} encoder profile(s) match their calibration (${checked.join(', ')}).`,
);
