import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { THRESHOLD_PROFILES, UNCALIBRATED_BOUNDARY_FLOOR, type Thresholds } from '@nextgen/core-intent/config';
import {
  generate,
  knowledgeGaps,
  loadKnowledge,
  localeFolders,
  localesDirProblem,
  writeIndexes,
  writeOutput,
  type GeneratorConfig,
  type KnowledgeCoverage,
  type SkippedRoute,
} from '@nextgen/generator';

import { knowledgeQuestions } from './knowledge-report.ts';
import { ladder, ladderMarkdown } from './ladder.ts';
import { arg, assertOutsideApp, BUNDLE_DIR, CALIBRATION_FILE, CONFIG_FILE, REVIEW_DIR, self, shown, stripBom } from './paths.ts';

/**
 * The shape of `bundle/thresholds.hashing.json`'s `stage3` field (ADR-017).
 *
 * Declared here rather than imported from `@nextgen/embed`, which owns the runtime that
 * actually reads this back (`SameOriginLlmRuntime` in `embed/src/stage3.ts`). That is a
 * real package boundary, not a shortcut avoided for its own sake: `embed`'s root pulls in
 * DOM-typed browser code (`theme.ts`, `widget.ts`, `voice.ts`), and `kit` is a Node CLI
 * with no DOM lib in its `tsconfig` — importing the type transitively pulled in `Element`,
 * `Window` and a dozen other browser globals kit has no business knowing about. A small,
 * stable wire shape is worth duplicating at a package boundary; `kit.test.ts`'s
 * `--stage3` round trip proves the two sides still agree by actually interoperating,
 * which is a stronger guarantee than a shared type would have been anyway.
 */
export interface Stage3Config {
  readonly path: string;
  readonly model?: string;
  readonly timeoutMs?: number;
}

/**
 * `nextgen build`: the generator, run the way an adopter needs it run.
 *
 * It writes two folders (see paths.ts) and a record of what it did, which
 * `doctor` reads. It adds nothing to the generator's decisions. Every judgement
 * about a route is still made in `@nextgen/generator`, and is measured there.
 */

export interface BuildOptions {
  /** Copy the script tag into the bundle. Default true. */
  readonly scriptTag?: boolean;
  readonly onProgress?: (done: number, total: number) => void;
  /**
   * Turn on stage 3 for the bundle this writes (ADR-017). Absent: a turn stages
   * 1–2 cannot settle ends in a clarifying question, exactly as it always has — off is
   * the only default, and nothing except this option can turn it on.
   */
  readonly stage3?: Stage3Config;
}

export interface BuildRecord {
  readonly builtAt: string;
  readonly appRoot: string;
  readonly routesFile: string;
  readonly roles: readonly string[];
  /** Navigable capabilities per role. Boundaries are counted separately. */
  readonly perRole: Readonly<Record<string, number>>;
  readonly capabilities: number;
  readonly boundaries: number;
  /** Rules read from validation schemas and control attributes (ADR-020). */
  readonly rules: number;
  /** Rules inferred from a handler or a disabled condition, shipped because the pattern was exactly recognised (ADR-020). */
  readonly inferredRules: number;
  /** Inferred-tier candidates found but not shipped — read them in review/INFERRED.md. */
  readonly reviewInferred: number;
  readonly skipped: readonly SkippedRoute[];
  /** Role registries that failed `validateRegistry()`, with the report. */
  readonly invalid: readonly string[];
  readonly calibrated: boolean;
  readonly thresholdsSource: string;
  readonly prose: string;
  readonly bundleFiles: readonly string[];
  readonly warnings: readonly string[];
  /** How many locale folders `localesDir` lists, and how many keys a later one defined again (the first was kept). */
  readonly locales?: { readonly folders: number; readonly collisions: number };
  /**
   * What the adopter wrote about their own app (`knowledge.json`), and how much of the app it
   * covers. The gaps themselves are in review/KNOWLEDGE-GAPS.md, as questions.
   */
  readonly knowledge: {
    readonly found: boolean;
    readonly path: string | null;
    readonly coverage: KnowledgeCoverage;
    readonly gaps: number;
  };
  /** `null` when this bundle was built without `--stage3` — the default, and what most reviews will see. */
  readonly stage3: { readonly path: string; readonly model: string | null; readonly timeoutMs?: number } | null;
}

/** How long the widget waits for a stage-3 answer when the build does not say (embed/src/stage3.ts). */
export const STAGE3_DEFAULT_TIMEOUT_MS = 8000;
/**
 * The bounds on `--stage3-timeout`. Below a second no model answers; above thirty seconds the visitor
 * has given up long before the answer arrives, and a clarifying question sooner serves them better.
 */
export const STAGE3_TIMEOUT_BOUNDS = { min: 1000, max: 30_000 } as const;

export function readConfig(kitDir: string): { config: GeneratorConfig; appRoot: string } {
  const file = join(resolve(kitDir), CONFIG_FILE);
  if (!existsSync(file)) {
    throw new Error(`No ${CONFIG_FILE} in ${resolve(kitDir)}. Run "${self()} init <your app folder>" first.`);
  }
  const config = JSON.parse(stripBom(readFileSync(file, 'utf8'))) as GeneratorConfig;
  const locales = localesDirProblem(config.localesDir);
  if (locales) throw new Error(`${file}: ${locales}.`);
  // Relative to the config file, not to wherever the command was run from.
  return { config, appRoot: resolve(dirname(file), config.appRoot) };
}

/** Newest mtime among a directory's own `.ts` source files (its tests excluded). */
function newestSourceMtime(dir: string): number {
  let latest = 0;
  for (const rel of readdirSync(dir, { recursive: true }) as string[]) {
    if (!rel.endsWith('.ts') || rel.endsWith('.test.ts')) continue;
    latest = Math.max(latest, statSync(join(dir, rel)).mtimeMs);
  }
  return latest;
}

/**
 * The script tag: the prebuilt `runtime/nextgen.js` beside `scan.mjs` in the copied folder,
 * or, when the kit runs from source in this workspace, `@nextgen/embed`'s own build.
 *
 * In the workspace the bundle existing is not the same as it being current. It used to be
 * rebuilt only when missing, so a bundle built before a later `embed` change was reused
 * byte for byte, and `doctor` reported nothing wrong — found running the kit against a
 * real application: `dist` was two days older than `src` and exported no `start` at all.
 * It is rebuilt whenever `embed`'s own source is newer than the bundle.
 */
function scriptTagFile(): string {
  // The copied-folder path first (ADR-018). `adapter/` ships `scan.mjs` beside
  // `runtime/nextgen.js` and the adopter has no node_modules at all, so resolving through
  // one throws `Cannot find module '@nextgen/embed/package.json'` — which is exactly what
  // the first end-to-end run of the bundle produced. The widget was then missing from
  // `bundle/`, and `doctor` reported it as a warning rather than a failure, so the folder
  // looked installable and served no assistant.
  //
  // Prebuilt and never rebuilt here: it was compiled when `adapter/` was built, and
  // `build-adapter.mjs --check` is what keeps it current. There is no `embed` source next
  // to it to compare against.
  const sibling = join(dirname(fileURLToPath(import.meta.url)), 'runtime', 'nextgen.js');
  if (existsSync(sibling)) return sibling;

  const require = createRequire(import.meta.url);
  const embedDir = dirname(require.resolve('@nextgen/embed/package.json'));
  const bundle = join(embedDir, 'dist', 'nextgen.js');
  const builder = join(embedDir, 'build.mjs');
  const srcDir = join(embedDir, 'src');
  const canBuild = existsSync(builder) && existsSync(srcDir);

  const current = existsSync(bundle) && !(canBuild && statSync(bundle).mtimeMs < newestSourceMtime(srcDir));
  if (current) return bundle;
  if (!canBuild) {
    throw new Error(`@nextgen/embed has no dist/nextgen.js and cannot build one here (${embedDir}).`);
  }
  execFileSync(process.execPath, [builder], { stdio: 'pipe' });
  return bundle;
}

/**
 * A warning when many of the translation keys the pages use resolve in no locale folder listed (ADR-042),
 * or null. One real app had moved its pages to new packages and the config still listed the old folders,
 * which still existed: the build said "6 locale folders merged", and every title and control of the moved
 * pages came out as nothing. A fifth of the keys, over at least twenty, is not a typo: a folder is missing.
 */
export function untranslatedWarning(keys: { used: number; unresolved: number; namespaces: readonly string[] } | undefined): string | null {
  if (!keys || keys.used < 20 || keys.unresolved / keys.used < 0.2) return null;
  const share = Math.round((100 * keys.unresolved) / keys.used);
  return (
    `${share}% of the translation keys this app's pages use (${keys.unresolved} of ${keys.used}) resolve in no locale folder listed — ` +
    `most of them in: ${keys.namespaces.slice(0, 6).join(', ')}. Those screens are named and described without the app's own words, ` +
    `and their buttons are not read. Is a folder missing from "localesDir" in ${CONFIG_FILE}, or listed from where the app used to keep it?`
  );
}

export async function build(kitDir: string, options: BuildOptions = {}): Promise<BuildRecord> {
  const kit = resolve(kitDir);
  const { config, appRoot } = readConfig(kit);
  assertOutsideApp(kit, appRoot);

  const bundleDir = join(kit, BUNDLE_DIR);
  const reviewDir = join(kit, REVIEW_DIR);
  // The served folder is rebuilt from nothing. A role the app no longer has must
  // not leave its old registry behind, still being served to whoever asks.
  rmSync(bundleDir, { recursive: true, force: true });
  mkdirSync(bundleDir, { recursive: true });
  mkdirSync(reviewDir, { recursive: true });

  // With no model there is no prose to cache: the file could only ever say `{}`.
  // A copy an older kit left behind is removed rather than kept as clutter.
  rmSync(join(reviewDir, 'prose-cache.json'), { force: true });
  // What the adopter wrote about their own app: beside the config, or where the config says.
  const loaded = loadKnowledge(join(kit, CONFIG_FILE), config.knowledge);
  const output = await generate({
    config: { ...config, appRoot },
    knowledge: loaded.knowledge,
    // Descriptions are derived from the app's own labels: nothing installed, no network.
    // There is no model to pass here, and no client for one in this bundle (ADR-018,
    // ADR-021). The generator's own CLI still takes `--model`, for work in this repository.
    model: null,
    ...(options.onProgress ? { onProgress: options.onProgress } : {}),
  });

  // The generator writes registries beside master.json. Only the registries are
  // for a browser, so they move to the served folder, and master.json stays behind.
  const written = writeOutput(reviewDir, appRoot, output);
  for (const file of readdirSync(reviewDir)) {
    if (/^registry\..+\.json$/.test(file)) renameSync(join(reviewDir, file), join(bundleDir, file));
  }
  await writeIndexes(bundleDir, output.registries);

  // Rule 14: thresholds belong to a registry. A calibration the adopter produced
  // wins. Otherwise the shipped profile is used, and says it is not theirs.
  const warnings: string[] = [];
  const folders = localeFolders(config).length;
  const collisions = output.translationCollisions ?? 0;
  if (collisions > 0) {
    warnings.push(
      `${collisions} translation key(s) are defined in more than one of the ${folders} locale folders; the first folder listed was used for each.`,
    );
  }
  const untranslated = untranslatedWarning(output.untranslatedKeys);
  if (untranslated) warnings.push(untranslated);
  for (const problem of loaded.problems) warnings.push(`knowledge.json: ${problem.path ? `${problem.path}: ` : ''}${problem.message}`);
  const calibration = join(kit, CALIBRATION_FILE);
  let thresholds: Thresholds;
  let calibrated = false;
  let thresholdsSource: string;
  if (existsSync(calibration)) {
    thresholds = (JSON.parse(readFileSync(calibration, 'utf8')) as { thresholds: Thresholds }).thresholds;
    calibrated = true;
    thresholdsSource = CALIBRATION_FILE;
  } else {
    // Refusal is the one claim nothing has measured for this app: a limit must clear a floor of its own
    // until a calibration decides (Thresholds.boundaryFloor). The floor is a stand-in, not a setting.
    thresholds = { ...THRESHOLD_PROFILES.hashing, boundaryFloor: UNCALIBRATED_BOUNDARY_FLOOR };
    thresholdsSource =
      `the default hashing profile, calibrated on a 7-screen reference app rather than this one, ` +
      `with declared limits held to a floor of ${UNCALIBRATED_BOUNDARY_FLOOR} until you calibrate`;
  }
  // ADR-017. `stage3` rides in the same manifest `load()` already fetches
  // unconditionally, so turning this on costs the visitor's browser nothing extra until a
  // turn actually needs it — no fourth request, no new file for an adopter to remember to
  // serve. Absent here is what makes "off by default" true of the artefact rather than of
  // a flag: `embed`'s `create()` never constructs a runtime unless this key exists.
  if (options.stage3 && !options.stage3.path.trim()) {
    throw new Error('--stage3 needs a path — the address on your own origin to POST completion requests to.');
  }
  const timeoutMs = options.stage3?.timeoutMs;
  if (
    timeoutMs !== undefined &&
    (!Number.isInteger(timeoutMs) || timeoutMs < STAGE3_TIMEOUT_BOUNDS.min || timeoutMs > STAGE3_TIMEOUT_BOUNDS.max)
  ) {
    throw new Error(
      `--stage3-timeout must be a whole number of milliseconds from ${STAGE3_TIMEOUT_BOUNDS.min} to ${STAGE3_TIMEOUT_BOUNDS.max}; got ${timeoutMs}.`,
    );
  }
  if (options.stage3) {
    warnings.push(
      `Stage 3 is ON: a turn stages 1–2 cannot settle will POST to "${options.stage3.path}" on YOUR OWN origin, ` +
        'instead of asking the visitor a clarifying question. That path is yours to serve, rate-limit and secure — ' +
        'see "Turn on model-backed answers" in AGENTS.md / the kit README before you ship it.',
    );
  }
  writeFileSync(
    join(bundleDir, 'thresholds.hashing.json'),
    `${JSON.stringify(
      { calibrated, source: thresholdsSource, thresholds, ...(options.stage3 ? { stage3: options.stage3 } : {}) },
      null,
      2,
    )}\n`,
    'utf8',
  );

  if (options.scriptTag !== false) {
    try {
      copyFileSync(scriptTagFile(), join(bundleDir, 'nextgen.js'));
    } catch (error) {
      warnings.push(`The script tag could not be copied: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // The questions the scanner could not answer itself, for the agent to put to the developer.
  const { gaps, coverage } = knowledgeGaps(output.master, loaded.knowledge);
  writeFileSync(join(reviewDir, 'KNOWLEDGE-GAPS.md'), knowledgeQuestions(gaps, coverage, loaded.found), 'utf8');

  const perRole: Record<string, number> = {};
  for (const [role, registry] of output.registries) {
    perRole[role] = registry.capabilities.filter((c) => c.kind !== 'unsupported').length;
  }

  const record: BuildRecord = {
    builtAt: new Date().toISOString(),
    appRoot,
    routesFile: config.routesFile,
    roles: [...output.registries.keys()],
    perRole,
    capabilities: output.master.length,
    boundaries: output.boundaries.length,
    rules: output.master.reduce((n, c) => n + (c.rules ?? []).filter((r) => r.tier === 'read').length, 0),
    inferredRules: output.master.reduce((n, c) => n + (c.rules ?? []).filter((r) => r.tier === 'inferred').length, 0),
    reviewInferred: output.reviewInferred.length,
    skipped: output.skipped,
    invalid: written.invalid,
    calibrated,
    thresholdsSource,
    knowledge: { found: loaded.found, path: loaded.path, coverage, gaps: gaps.length },
    stage3: options.stage3
      ? {
          path: options.stage3.path,
          model: options.stage3.model ?? null,
          ...(options.stage3.timeoutMs !== undefined ? { timeoutMs: options.stage3.timeoutMs } : {}),
        }
      : null,
    prose: 'derived from the app’s own labels (no model)',
    bundleFiles: readdirSync(bundleDir).sort(),
    warnings,
    locales: { folders, collisions },
  };
  writeFileSync(join(reviewDir, 'build.json'), `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  // How to make it better, numbered, with where this build stands on each (ladder.ts) — for the developer
  // to read without running anything else.
  writeFileSync(join(reviewDir, 'IMPROVE.md'), ladderMarkdown(ladder(kit, record, self(), arg(shown(kit)))), 'utf8');
  return record;
}
