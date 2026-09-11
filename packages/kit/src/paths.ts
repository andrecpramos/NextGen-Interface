import { isAbsolute, relative, resolve } from 'node:path';

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
      `Rule 16: the kit folder (${resolve(kitDir)}) is inside the application's source ` +
        `(${resolve(appRoot)}). The kit only ever adds files of its own, outside your source. ` +
        `Choose another folder with --out.`,
    );
  }
}

export function toPosix(path: string): string {
  return path.split('\\').join('/');
}

export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}
