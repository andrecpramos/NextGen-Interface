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

import { THRESHOLD_PROFILES, type Thresholds } from '@nextgen/core-intent/config';
import {
  generate,
  ollamaModel,
  writeIndexes,
  writeOutput,
  type GeneratorConfig,
  type ProseCache,
  type SkippedRoute,
} from '@nextgen/generator';

import { assertOutsideApp, BUNDLE_DIR, CALIBRATION_FILE, CONFIG_FILE, REVIEW_DIR, stripBom } from './paths.ts';

/**
 * `nextgen build`: the generator, run the way an adopter needs it run.
 *
 * It writes two folders (see paths.ts) and a record of what it did, which
 * `doctor` reads. It adds nothing to the generator's decisions. Every judgement
 * about a route is still made in `@nextgen/generator`, and is measured there.
 */

export interface BuildOptions {
  /** The model that writes descriptions. `null`/absent: derive prose from the app's own labels. */
  readonly model?: string | null;
  readonly endpoint?: string;
  /** Copy the script tag into the bundle. Default true. */
  readonly scriptTag?: boolean;
  readonly onProgress?: (done: number, total: number) => void;
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
  readonly skipped: readonly SkippedRoute[];
  /** Role registries that failed `validateRegistry()`, with the report. */
  readonly invalid: readonly string[];
  readonly calibrated: boolean;
  readonly thresholdsSource: string;
  readonly prose: string;
  readonly bundleFiles: readonly string[];
  readonly warnings: readonly string[];
}

export function readConfig(kitDir: string): { config: GeneratorConfig; appRoot: string } {
  const file = join(resolve(kitDir), CONFIG_FILE);
  if (!existsSync(file)) {
    throw new Error(`No ${CONFIG_FILE} in ${resolve(kitDir)}. Run "nextgen init <your app folder>" first.`);
  }
  const config = JSON.parse(stripBom(readFileSync(file, 'utf8'))) as GeneratorConfig;
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
 * The script tag, from the installed `@nextgen/embed`.
 *
 * Resolved through the package's own manifest, so it is found the same way in
 * this workspace and in an adopter's node_modules. A published package ships
 * dist/nextgen.js and no source; if that file is missing the install is broken,
 * and saying so beats attempting a build that cannot run there.
 *
 * In a checkout, where build.mjs and src/ exist, the bundle existing is not the
 * same as it being current. It used to be rebuilt only when missing, so a bundle
 * built before a later `embed` change was reused byte for byte, and `doctor`
 * reported nothing wrong — found running the kit against fut-app: `dist` was two
 * days older than `src` and exported no `start` at all. It is rebuilt whenever
 * `embed`'s own source is newer than the bundle.
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
    throw new Error(`@nextgen/embed is installed without dist/nextgen.js (${embedDir}). Reinstall it.`);
  }
  execFileSync(process.execPath, [builder], { stdio: 'pipe' });
  return bundle;
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

  const cacheFile = join(reviewDir, 'prose-cache.json');
  const cache: ProseCache = existsSync(cacheFile) ? (JSON.parse(readFileSync(cacheFile, 'utf8')) as ProseCache) : {};
  const endpoint = options.endpoint ?? 'http://localhost:11434';

  const output = await generate({
    config: { ...config, appRoot },
    model: options.model ? ollamaModel(options.model, endpoint) : null,
    cache,
    ...(options.onProgress ? { onProgress: options.onProgress } : {}),
  });

  // The generator writes registries beside master.json. Only the registries are
  // for a browser, so they move to the served folder, and master.json stays behind.
  const written = writeOutput(reviewDir, appRoot, output);
  for (const file of readdirSync(reviewDir)) {
    if (/^registry\..+\.json$/.test(file)) renameSync(join(reviewDir, file), join(bundleDir, file));
  }
  await writeIndexes(bundleDir, output.registries);
  writeFileSync(cacheFile, `${JSON.stringify(cache, null, 2)}\n`, 'utf8');

  // Rule 14: thresholds belong to a registry. A calibration the adopter produced
  // wins. Otherwise the shipped profile is used, and says it is not theirs.
  const warnings: string[] = [];
  const calibration = join(kit, CALIBRATION_FILE);
  let thresholds: Thresholds;
  let calibrated = false;
  let thresholdsSource: string;
  if (existsSync(calibration)) {
    thresholds = (JSON.parse(readFileSync(calibration, 'utf8')) as { thresholds: Thresholds }).thresholds;
    calibrated = true;
    thresholdsSource = CALIBRATION_FILE;
  } else {
    thresholds = THRESHOLD_PROFILES.hashing;
    thresholdsSource = 'the default hashing profile, calibrated on a 7-screen reference app rather than this one';
  }
  writeFileSync(
    join(bundleDir, 'thresholds.hashing.json'),
    `${JSON.stringify({ calibrated, source: thresholdsSource, thresholds }, null, 2)}\n`,
    'utf8',
  );

  if (options.scriptTag !== false) {
    try {
      copyFileSync(scriptTagFile(), join(bundleDir, 'nextgen.js'));
    } catch (error) {
      warnings.push(`The script tag could not be copied: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

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
    skipped: output.skipped,
    invalid: written.invalid,
    calibrated,
    thresholdsSource,
    prose: options.model ? `${options.model} at ${endpoint}` : 'derived from the app’s own labels (no model)',
    bundleFiles: readdirSync(bundleDir).sort(),
    warnings,
  };
  writeFileSync(join(reviewDir, 'build.json'), `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  return record;
}
