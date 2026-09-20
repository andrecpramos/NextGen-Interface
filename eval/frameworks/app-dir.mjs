// Which fixture application a harness script is measuring.
//
// The point of this directory is that there is no privileged application. Each script
// takes `--app <name>` and reads `eval/frameworks/<name>/`, so adding a second app to the
// measurement is adding a folder, not editing six scripts. That is the property the
// product actually claims — it works on any web app — and a harness wired to one app
// cannot demonstrate it.
//
// Until 2026-09-17 these scripts lived beside the one application they measured and resolved
// everything relative to themselves, which made the measured application structurally unswappable.

import { existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));

/** Every fixture app in this directory: a folder holding a generator.config.json. */
export function apps() {
  return readdirSync(ROOT)
    .filter((name) => {
      const path = join(ROOT, name);
      return statSync(path).isDirectory() && existsSync(join(path, 'generator.config.json'));
    })
    .sort();
}

/**
 * The directory for `--app <name>`, defaulting to the only one when there is only one.
 *
 * Defaulting to "whatever is there" rather than to a hard-coded name is deliberate: a
 * default of `family` would quietly re-privilege one app the moment a second is added.
 */
export function appDir(argv = process.argv) {
  const index = argv.indexOf('--app');
  const available = apps();

  if (index > -1) {
    const name = argv[index + 1];
    if (!name || !available.includes(name)) {
      console.error(`  --app ${name ?? '<missing>'}: no such fixture app.`);
      console.error(`  available: ${available.join(', ') || '(none)'}`);
      process.exit(2);
    }
    return join(ROOT, name);
  }

  if (available.length === 1) return join(ROOT, available[0]);

  console.error(`  --app <name> is required: ${available.length} fixture apps are present.`);
  console.error(`  available: ${available.join(', ')}`);
  process.exit(2);
}

export const appName = (dir) => dir.split(/[\\/]/).pop();
