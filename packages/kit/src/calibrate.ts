import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { HashingEmbedder } from '@nextgen/core-intent';
import { loadRegistry } from '@nextgen/core-intent';
import {
  measure,
  scoreTurns,
  splitByRoute,
  splitSizes,
  sweep,
  toThresholds,
  type CalibrationEntry,
  type Scorer,
} from '@nextgen/core-intent/calibrate';

import { BUNDLE_DIR, CALIBRATION_FILE, stripBom } from './paths.ts';

/**
 * `nextgen calibrate`: Rule 14 for an application this repository has never seen.
 *
 * Thresholds are a property of the encoder AND the capability surface. The
 * profile the kit ships was calibrated against a 7-screen reference app; on a
 * 145-screen one it accepts almost nothing, which reads as "the router is
 * broken" and is really "the threshold belongs to a different registry". So an
 * adopter with a real application needs their own.
 *
 * **This command requires a golden set the adopter wrote**, and deliberately
 * offers no way to calibrate from the generator's own examples. That is not an
 * oversight — it was measured on `fut-app`, where both kinds of data exist, and
 * the decision rule was written before the run
 * (`eval/fut-app/experiment-self-calibration.mjs`):
 *
 * | arm | settled | accepts right | wrongly refused |
 * |---|---|---|---|
 * | default profile | 17 | 5 of 7 | 1 of 105 |
 * | calibrated on a real golden set | 10 | 1 of 1 | 0 |
 * | calibrated on its own examples | 15 | 2 of 3 | **7 of 105** |
 * | own examples, leave-one-out | 12 | none accepted | 1 of 105 |
 *
 * Calibrating on the generator's examples made the engine **wrongly refuse seven
 * real requests** — telling users the application cannot do things it can, which
 * is the error the whole sweep is constrained to avoid. A command that offered
 * it would be offering a worse outcome than doing nothing, in a wrapper that
 * looks like diligence.
 *
 * The sweep itself is `@nextgen/core-intent/calibrate`, shared with this repo's
 * own calibration script so there is exactly one implementation of Rule 14.
 */

/** Below this the sweep is fitting noise, and a held-out split cannot be believed. */
const MINIMUM_ENTRIES = 20;

export interface GoldenTurn {
  readonly utterance: string;
  /** The screen this should reach. `null` (or absent) means it should be refused. */
  readonly route?: string | null;
  /** Which role's registry answers this turn. Optional for a single-role app. */
  readonly role?: string;
  readonly id?: string;
}

export interface CalibrateResult {
  readonly file: string;
  readonly entries: number;
  readonly calibrationEntries: number;
  readonly heldOutEntries: number;
  readonly destinations: number;
  readonly thresholds: ReturnType<typeof toThresholds>;
  readonly heldOut: ReturnType<typeof measure>;
  readonly warnings: readonly string[];
  readonly text: string;
}

function readGolden(file: string): GoldenTurn[] {
  const raw = stripBom(readFileSync(file, 'utf8'));
  const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean);
  // Accept both a JSON array and JSONL. An adopter writing their first golden
  // set should not have to discover which one this wanted from a parse error.
  if (lines[0]?.startsWith('[')) return JSON.parse(raw) as GoldenTurn[];
  return lines.map((line, i) => {
    try {
      return JSON.parse(line) as GoldenTurn;
    } catch {
      throw new Error(`${file}: line ${i + 1} is not valid JSON. One turn per line, or a single JSON array.`);
    }
  });
}

export async function calibrate(kitDir: string, goldenFile: string): Promise<CalibrateResult> {
  const kit = resolve(kitDir);
  const bundle = join(kit, BUNDLE_DIR);
  if (!existsSync(bundle)) {
    throw new Error(`No ${BUNDLE_DIR}/ in ${kit}. Run \`nextgen build ${kitDir}\` first: calibration needs the registries.`);
  }

  const golden = readGolden(resolve(goldenFile));
  if (golden.length === 0) throw new Error(`${goldenFile} is empty.`);

  const registryFiles = readdirSync(bundle).filter((f) => /^registry\..+\.json$/.test(f));
  if (registryFiles.length === 0) throw new Error(`No registry.*.json in ${bundle}. Run \`nextgen build\` first.`);
  const roles = registryFiles.map((f) => f.replace(/^registry\.(.+)\.json$/, '$1'));

  // One embedder per registry. A shared, re-fitted encoder leaves every registry
  // but the last holding vectors from a vocabulary that no longer exists — this
  // repository has paid for that once already (lessons.md L10).
  const scorers = new Map<string, Scorer>();
  for (const role of roles) {
    // `HashingEmbedder` directly rather than `makeEmbedder('hashing')`, and the reason is
    // the artefact rather than the API: `makeEmbedder` branches on a string, so a bundler
    // cannot prove the Ollama branch unreachable and ships its HTTP client into
    // `adapter/scan.mjs`. Naming the encoder that is actually wanted keeps the copied
    // folder free of any client for a remote host (ADR-018 D-6). The sweep has always
    // been hashing-only: a calibration must be reproducible with nothing installed.
    const embedder = new HashingEmbedder();
    scorers.set(role, { registry: await loadRegistry(join(bundle, `registry.${role}.json`), embedder), embedder });
  }

  const warnings: string[] = [];
  const only = roles.length === 1 ? roles[0]! : null;
  const entries: CalibrationEntry[] = [];
  const unknownRoles = new Set<string>();

  for (const [i, turn] of golden.entries()) {
    if (!turn.utterance?.trim()) throw new Error(`${goldenFile}: turn ${i + 1} has no "utterance".`);
    const role = turn.role ?? only;
    if (!role) {
      throw new Error(
        `${goldenFile}: turn ${i + 1} has no "role", and this app has ${roles.length} of them ` +
          `(${roles.join(', ')}). A turn has to say whose registry answers it.`,
      );
    }
    if (!scorers.has(role)) {
      unknownRoles.add(role);
      continue;
    }
    entries.push({
      id: turn.id ?? `turn-${i + 1}`,
      utterance: turn.utterance.trim(),
      expectRoute: turn.route ?? null,
      registryKey: role,
    });
  }

  if (unknownRoles.size > 0) {
    warnings.push(
      `Ignored turns for ${[...unknownRoles].join(', ')}: no such registry was built. ` +
        `The app's roles are ${roles.join(', ')}.`,
    );
  }

  if (entries.length < MINIMUM_ENTRIES) {
    throw new Error(
      `Only ${entries.length} usable turn(s); calibration needs at least ${MINIMUM_ENTRIES}.\n` +
        '  A sweep over a handful of turns fits noise, and the held-out numbers that would\n' +
        '  tell you so are themselves too small to believe. Keep the default profile until\n' +
        '  you have more — `nextgen doctor` says plainly that it is not yours.',
    );
  }

  const scored = await scoreTurns(entries, (role) => scorers.get(role!)!);
  const isCalibration = splitByRoute(entries);
  const calibrationSet = scored.filter((r) => isCalibration(r.entry));
  const heldOut = scored.filter((r) => !isCalibration(r.entry));
  const { destinations, calibrationDestinations } = splitSizes(entries);

  if (heldOut.length === 0) {
    throw new Error(
      'Every turn landed in the calibration split, so there is nothing held out to check the\n' +
        '  result against. That happens when the golden set covers very few destinations.\n' +
        '  Add turns for more screens.',
    );
  }

  const swept = sweep(calibrationSet);
  const thresholds = toThresholds(swept);
  const heldOutReport = measure(heldOut, swept);

  if (swept.acceptedInDomain === 0) {
    warnings.push(
      'The sweep found no operating point that accepts anything at 100% precision, so stage 2 ' +
        'will settle only refusals. That is a property of the registry, not a bug: screens that ' +
        'read alike cannot be told apart by similarity alone.',
    );
  }
  if (swept.refusedOutOfScope === 0) {
    warnings.push(
      'No margin was found that refuses anything without also refusing real requests, so these ' +
        'thresholds NEVER refuse: an out-of-scope question becomes a clarifying question instead ' +
        'of a stated limit. Usually this means the golden set has too few out-of-scope turns, or ' +
        'the app declares no boundaries for them to match. Check the "unsupported" entries in ' +
        'your registry before accepting this.',
    );
  }
  if (heldOutReport.precision !== null && heldOutReport.precision < 1) {
    warnings.push(
      `The sweep guarantees 100% precision on the turns it calibrated against, but on the held-out ` +
        `turns it is ${(100 * heldOutReport.precision).toFixed(1)}% — it sends some users to the wrong ` +
        'screen confidently. That gap is what the held-out split exists to show; the calibration ' +
        'number alone would have looked perfect.',
    );
  }
  if (heldOutReport.wronglyRefused > 0) {
    warnings.push(
      `On the held-out turns these thresholds wrongly refuse ${(100 * heldOutReport.wronglyRefused).toFixed(1)}% of ` +
        'real requests. The sweep forbids that on the calibration split, so seeing it here means the ' +
        'golden set is too small or too narrow to generalise. Treat the result with suspicion.',
    );
  }

  const file = join(kit, CALIBRATION_FILE);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(
    file,
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        encoder: 'hashing',
        source: resolve(goldenFile),
        method:
          'Swept by @nextgen/core-intent/calibrate against the golden set above, split by ' +
          'destination 40/60. boundaryMargin maximises out-of-scope refusal subject to zero ' +
          'in-domain refusals; actionBoundaryMargin (ADR-015) does the same under the identical ' +
          'constraint; tauHigh/delta maximise stage-2 accepts subject to 100% precision. ' +
          'Never hand-set (Rule 14).',
        entries: entries.length,
        heldOut: heldOutReport,
        thresholds,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );

  const pct = (x: number | null): string => (x === null ? '—' : `${(100 * x).toFixed(1)}%`);
  const lines = [
    '',
    `  ${entries.length} turn(s) across ${roles.length} role(s), ${destinations} destination(s).`,
    `  Split by destination: ${calibrationSet.length} to calibrate on (${calibrationDestinations} destinations), ${heldOut.length} held out.`,
    '',
    `  tauHigh ${thresholds.tauHigh}   delta ${thresholds.delta}   boundaryMargin ${thresholds.boundaryMargin}   actionBoundaryMargin ${thresholds.actionBoundaryMargin}`,
    '',
    '  On the HELD-OUT turns — never optimised against, so this is the real number:',
    `    settled without a model:   ${pct(heldOutReport.settled)}`,
    `    of the routable, accepted: ${pct(heldOutReport.accepted)}`,
    `    of those, right screen:    ${pct(heldOutReport.precision)}`,
    `    out-of-scope refused:      ${pct(heldOutReport.outOfScopeRefused)}`,
    `    real requests refused:     ${pct(heldOutReport.wronglyRefused)}`,
    '',
    ...warnings.flatMap((w) => [`  ! ${w}`, '']),
    `  Wrote ${file}`,
    `  It is used from the next \`nextgen build ${kitDir}\` onward — build again, then doctor.`,
    '',
  ];

  return {
    file,
    entries: entries.length,
    calibrationEntries: calibrationSet.length,
    heldOutEntries: heldOut.length,
    destinations,
    thresholds,
    heldOut: heldOutReport,
    warnings,
    text: lines.join('\n'),
  };
}
