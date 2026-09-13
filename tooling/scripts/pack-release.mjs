#!/usr/bin/env node
// Build every publishable package and pack it into release/, ready to install in
// another project without publishing anything.
//
//   pnpm pack:release
//
// Then, in the adopter's project:
//
//   npm install -D <this repo>/release/*.tgz      (the command is printed below)
//   npx nextgen init .
//
// `pnpm pack` is used rather than `npm pack` because it rewrites `workspace:*`
// dependencies to real versions and applies `publishConfig`, exactly as a publish
// would. tooling/scripts/check-install.mjs proves the result installs and runs.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const OUT = join(ROOT, 'release');
const WINDOWS = process.platform === 'win32';

// pnpm is a .cmd shim on Windows, which Node only starts through a shell, and an
// argument array with `shell: true` is deprecated (DEP0190). Join and quote there.
const quote = (arg) => (/[\s"&|<>^()]/.test(arg) ? `"${arg.replace(/"/g, '\\"')}"` : arg);

const step = (label, command, args, cwd = ROOT) => {
  const result = WINDOWS
    ? spawnSync([command, ...args].map(quote).join(' '), { cwd, shell: true, stdio: 'inherit' })
    : spawnSync(command, args, { cwd, stdio: 'inherit' });
  if (result.status !== 0) {
    console.error(`\n  ${label} failed.\n`);
    process.exit(result.status ?? 1);
  }
};

step('pnpm build', 'pnpm', ['build']);

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const packed = [];
for (const name of readdirSync(join(ROOT, 'packages'))) {
  const manifestPath = join(ROOT, 'packages', name, 'package.json');
  if (!existsSync(manifestPath)) continue;
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8').replace(/^﻿/, ''));
  if (manifest.private) continue;
  step(`pnpm pack ${manifest.name}`, 'pnpm', ['pack', '--pack-destination', OUT], join(ROOT, 'packages', name));
  packed.push(manifest.name);
}

const files = readdirSync(OUT).filter((f) => f.endsWith('.tgz')).sort();
console.log(`\n  Packed ${files.length} package(s) into release/:\n`);
for (const f of files) console.log(`    ${f}`);
console.log('\n  In your project (Node 20 or newer):\n');
console.log(`    npm install -D ${files.map((f) => join(OUT, f)).join(' ')}`);
console.log('    npx nextgen init .\n');
