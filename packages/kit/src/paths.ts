import { basename, isAbsolute, relative, resolve } from 'node:path';

/**
 * The kit's own folder, and the one rule about where it may be.
 *
 * Everything the kit writes lands in one folder the adopter chooses, split in
 * two on purpose:
 *
 * - `bundle/` is what gets **served**: one registry and one index per role, the
 *   thresholds, and the script tag. Nothing in it names a role that is not the
 *   file's own.
 * - `review/` is **never served**: `master.json` lists every screen with every
 *   role that can reach it. Serving it would hand every user the shape of the
 *   screens they cannot open, which is exactly what Rule 17 forbids.
 */

export const CONFIG_FILE = 'nextgen.config.json';
export const BUNDLE_DIR = 'bundle';
export const REVIEW_DIR = 'review';
export const CALIBRATION_FILE = 'calibration/thresholds.hashing.json';

/**
 * Rule 16: the kit never writes inside the application it reads.
 *
 * The generator already refuses an output directory inside `appRoot`; this is
 * the same check made earlier, before `init` writes a config there, so the
 * refusal comes before anything has been written rather than halfway through.
 */
export function assertOutsideApp(kitDir: string, appRoot: string): void {
  const inside = relative(resolve(appRoot), resolve(kitDir));
  if (inside === '' || (!inside.startsWith('..') && !isAbsolute(inside))) {
    throw new Error(
      `The kit never writes inside your app, and this kit folder (${resolve(kitDir)}) is inside the application's source ` +
        `(${resolve(appRoot)}). The kit only ever adds files of its own, outside your source. ` +
        `Choose another folder with --out.`,
    );
  }
}

export function toPosix(path: string): string {
  return path.split('\\').join('/');
}

/**
 * A folder as the person at the terminal would type it: relative to where they are, when it is
 * below it. Every "Next:" line is copied and pasted, so it has to run from the folder it was printed
 * in — an absolute scratch path is correct and unreadable, and a bare `nextgen` is readable and wrong
 * when they are elsewhere.
 */
export function shown(dir: string, cwd: string = process.cwd()): string {
  const rel = relative(cwd, resolve(dir));
  if (rel === '') return '.';
  return rel.startsWith('..') || isAbsolute(rel) ? resolve(dir) : toPosix(rel);
}

/**
 * How to run this tool again, as it was run: `node nextgen-tool/scan.mjs`, not `node scan.mjs` — the
 * adopter runs it from their app's root, where there is no `scan.mjs`. Falls back to the bare name
 * when it was not started from a file called `scan.mjs` (tests, the repository's own CLI).
 */
export function self(argv1: string | undefined = process.argv[1], cwd: string = process.cwd()): string {
  if (!argv1 || basename(argv1) !== 'scan.mjs') return 'node scan.mjs';
  return `node ${arg(shown(argv1, cwd))}`;
}

/** A path as one shell argument: quoted when it has a space in it. */
export function arg(path: string): string {
  return /\s/.test(path) ? `"${path}"` : path;
}

export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}
