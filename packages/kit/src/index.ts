/**
 * The drop-in kit (PLAN.md WP-41): `init`, `build` and `doctor`, as functions.
 * `cli-copied.ts` is the same things as a command, and is what `adapter/scan.mjs` bundles.
 */

export { detectApp, init, type Detection, type Finding, type InitResult } from './detect.ts';
export { build, readConfig, type BuildOptions, type BuildRecord } from './build.ts';
export { doctor, type DoctorReport } from './doctor.ts';
export { calibrate, type CalibrateResult, type GoldenTurn } from './calibrate.ts';
export { preview, type Preview, type PreviewOptions } from './preview.ts';
export { report } from './report.ts';
export { sweepingTools, describeSweep, type SweepWarning } from './tooling.ts';
export { assertOutsideApp, BUNDLE_DIR, CALIBRATION_FILE, CONFIG_FILE, REVIEW_DIR } from './paths.ts';
