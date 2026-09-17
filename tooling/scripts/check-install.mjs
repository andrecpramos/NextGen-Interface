#!/usr/bin/env node
// An adopter installs tarballs, not a workspace. Prove that path works.
//
// check-packaging.mjs reads manifests and checks that entry points exist. That is
// the cheap half, and it cannot see the failures that only happen once a package
// leaves this repository: a dependency that resolves here because the workspace
// root has it, a file the kit reaches for by a path that only exists in a
// checkout, a Node API newer than the version the adopter runs, a `bin` that is
// TypeScript source. Every one of those installs without an error and fails on the
// adopter's first command — in their project, not ours.
//
// Its first run found exactly that: the generator imported `typescript` at run
// time while declaring it a devDependency, so every `nextgen` command threw
// ERR_MODULE_NOT_FOUND once installed, on every Node.
//
// WHAT IT DOES
//   1. Packs every package the kit needs with `pnpm pack`, which rewrites
//      `workspace:*` and applies `publishConfig` exactly as a publish would.
//   2. Creates a scratch project outside this repository holding a copy of the
//      fixture app, copies the tarballs into its vendor/nextgen/ and `npm install -D`s
//      them from there — npm, not pnpm, because an adopter's project is not our
//      workspace; vendored, because that is the path INSTALL.md gives an adopter.
//   3. On the current Node AND on Node 20 (the declared minimum, fetched with
//      `npx node@20`, so the claim is tested rather than asserted):
//        - `nextgen init`, `nextgen build`, `nextgen doctor` through the installed bin
//        - imports `@nextgen/embed` as an ES module and routes one turn from the
//          bundle the kit just built
//        - checks the app's own files are byte-for-byte unchanged (Rule 16)
//   4. As the adopter's CI: package.json records every tarball as file:vendor/nextgen/…,
//      and a clean `npm ci` from the lockfile installs a `nextgen` that runs.
//   5. As a TypeScript adopter: type-checks an ES module importing the installed
//      packages under `bundler` and `nodenext` resolution, with skipLibCheck off.
//      (The packages are ESM-only; a CommonJS file cannot import them statically,
//      and that is documented rather than tested.)
//
// It needs the packages built first (`pnpm build`), like check-packaging.mjs, and
// network access for npm to fetch third-party dependencies. A minute or two.
//
//   node tooling/scripts/check-install.mjs [--keep] [--skip-node20]

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const KEEP = process.argv.includes('--keep');
const SKIP_NODE20 = process.argv.includes('--skip-node20');
const WINDOWS = process.platform === 'win32';

/**
 * Every publishable package, leaves first.
 *
 * Was eight until ADR-018. `core-trace` and `core-dispatch` were attached to every
 * release and installed by INSTALL.md although nothing on the path to an adopter
 * imported either — they existed for the deleted terminal app. The list is six now, and
 * it is exactly the transitive closure of what `kit` needs.
 *
 * This whole gate is provisional: ADR-018 makes the unit of distribution `adapter/`, a
 * folder that is copied rather than installed, at which point the property to prove is
 * "a copy of adapter/ runs with no node_modules and no network" rather than "these
 * tarballs install". Until that folder exists, the tarball path is still what an adopter
 * would use, so this keeps running.
 */
const PACKAGES = ['core-capability', 'core-inference', 'core-intent', 'generator', 'embed', 'kit'];

/** Built output each package must have before it can be packed. */
const BUILT = {
  'core-capability': ['dist/index.js'],
  'core-inference': ['dist/index.js'],
  'core-intent': ['dist/index.js', 'dist/browser.js', 'dist/calibrate.js'],
  generator: ['dist/index.js'],
  embed: ['dist/index.js', 'dist/nextgen.js'],
  kit: ['dist/cli.js', 'dist/index.js'],
};

const FIXTURE = join(ROOT, 'packages', 'generator', 'fixtures', 'tiny-app');

const failures = [];
const say = (line) => console.log(line);

/**
 * `npm`, `pnpm` and `npx` are .cmd shims on Windows, which Node will only start
 * through a shell. Passing an argument array with `shell: true` is deprecated
 * (DEP0190: the arguments are concatenated unescaped), so on that path the
 * command is joined here, with quoting, instead.
 */
const quote = (arg) => (/[\s"&|<>^()]/.test(arg) ? `"${arg.replace(/"/g, '\\"')}"` : arg);

function run(command, args, cwd, { shell = false, timeout = 240_000 } = {}) {
  const options = { cwd, encoding: 'utf8', timeout, env: { ...process.env, npm_config_update_notifier: 'false' } };
  const result = shell
    ? spawnSync([command, ...args].map(quote).join(' '), { ...options, shell: true })
    : spawnSync(command, args, options);
  return {
    status: result.status ?? (result.error ? -1 : 0),
    output: `${result.stdout ?? ''}${result.stderr ?? ''}${result.error ? `\n${result.error.message}` : ''}`,
  };
}

const tail = (text, n = 12) => text.trim().split('\n').slice(-n).map((l) => `        ${l}`).join('\n');

function fail(step, detail) {
  failures.push(step);
  say(`  FAIL  ${step}`);
  if (detail) say(detail);
}

function hashTree(dir, skip) {
  const out = new Map();
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      if (skip(full)) continue;
      if (entry.isDirectory()) walk(full);
      else out.set(relative(dir, full), createHash('sha256').update(readFileSync(full)).digest('hex'));
    }
  };
  walk(dir);
  return out;
}

// ------------------------------------------------------------------ preflight --

const missing = [];
for (const name of PACKAGES) {
  for (const file of BUILT[name]) {
    if (!existsSync(join(ROOT, 'packages', name, file))) missing.push(`packages/${name}/${file}`);
  }
}
if (missing.length > 0) {
  console.error(`\n  Not built: ${missing.join(', ')}\n  Run \`pnpm build\` first — this gate installs built packages.\n`);
  process.exit(1);
}

const work = mkdtempSync(join(tmpdir(), 'nextgen-install-'));
const tarballs = join(work, 'tarballs');
const consumer = join(work, 'consumer');
mkdirSync(tarballs, { recursive: true });
mkdirSync(consumer, { recursive: true });

say(`\n  install check — scratch project ${consumer}\n`);

// ----------------------------------------------------------------------- pack --

for (const name of PACKAGES) {
  const packed = run('pnpm', ['pack', '--pack-destination', tarballs], join(ROOT, 'packages', name), { shell: WINDOWS });
  if (packed.status !== 0) fail(`pack @nextgen/${name}`, tail(packed.output));
}
const tgz = readdirSync(tarballs).filter((f) => f.endsWith('.tgz'));
if (tgz.length !== PACKAGES.length) {
  fail(`expected ${PACKAGES.length} tarballs, got ${tgz.length}`, `        ${tgz.join(', ')}`);
} else {
  say(`  ok    packed ${tgz.length} tarballs`);
}

// Nothing a tarball ships may be TypeScript source outside a declaration.
for (const file of tgz) {
  const listed = run('tar', ['-tzf', join(tarballs, file)], work);
  const source = listed.output.split('\n').filter((l) => /\.ts$/.test(l.trim()) && !/\.d\.ts$/.test(l.trim()));
  if (source.length > 0) fail(`${file} ships TypeScript source`, `        ${source.slice(0, 5).join('\n        ')}`);
}

// -------------------------------------------------------------------- install --

writeFileSync(join(consumer, 'package.json'), `${JSON.stringify({ name: 'nextgen-install-check', version: '0.0.0', private: true }, null, 2)}\n`);
cpSync(FIXTURE, join(consumer, 'app'), { recursive: true });
const app = join(consumer, 'app');
const kitDir = join(app, 'nextgen');
const before = hashTree(app, (p) => p.startsWith(kitDir));

// Vendored inside the project, installed by relative path: what INSTALL.md tells an adopter
// to do, and the only form their CI's `npm ci` can reproduce.
mkdirSync(join(consumer, 'vendor', 'nextgen'), { recursive: true });
for (const f of tgz) cpSync(join(tarballs, f), join(consumer, 'vendor', 'nextgen', f));
const installed = run(
  'npm',
  ['install', '-D', '--no-audit', '--no-fund', '--loglevel=error', ...tgz.map((f) => `vendor/nextgen/${f}`)],
  consumer,
  { shell: WINDOWS, timeout: 480_000 },
);
if (installed.status !== 0) {
  fail('npm install of the tarballs', tail(installed.output, 20));
} else {
  say('  ok    npm install of the tarballs, in a project outside this repository');
}

const kitManifestPath = join(consumer, 'node_modules', '@nextgen', 'kit', 'package.json');
let cli = null;
if (existsSync(kitManifestPath)) {
  const manifest = JSON.parse(readFileSync(kitManifestPath, 'utf8'));
  const bin = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin?.nextgen;
  if (!bin) fail('@nextgen/kit declares a `nextgen` bin');
  else if (/\.ts$/.test(bin)) fail(`@nextgen/kit's bin is TypeScript source (${bin})`);
  else {
    cli = join(consumer, 'node_modules', '@nextgen', 'kit', bin);
    if (!existsSync(cli)) {
      fail(`@nextgen/kit's bin ${bin} is not in the tarball`);
      cli = null;
    } else {
      say(`  ok    bin nextgen -> ${bin}`);
    }
  }
} else if (installed.status === 0) {
  fail('@nextgen/kit is installed');
}

// The ESM entry, used the way a single-page app would use it.
writeFileSync(
  join(consumer, 'probe.mjs'),
  `import { readdirSync, readFileSync } from 'node:fs';
import { create } from '@nextgen/embed';

const dir = 'app/nextgen/bundle';
const file = readdirSync(dir).find((f) => /^registry\\..+\\.json$/.test(f));
if (!file) throw new Error('no registry in the bundle');
const role = file.slice('registry.'.length, -'.json'.length);
const json = (name) => JSON.parse(readFileSync(dir + '/' + name, 'utf8'));
const assistant = create({
  registry: json('registry.' + role + '.json'),
  index: json('index.' + role + '.json'),
  thresholds: json('thresholds.hashing.json').thresholds,
});
const trace = await assistant.route('where are my settings');
if (!trace || typeof trace.outcome !== 'string') throw new Error('route() returned no outcome');
console.log(JSON.stringify({ role, capabilities: assistant.capabilities, outcome: trace.outcome }));
`,
);

// ----------------------------------------------------------------- run it ----

const runtimes = [{ label: `node ${process.version}`, command: process.execPath, prefix: [], shell: false }];
if (!SKIP_NODE20) runtimes.push({ label: 'node 20', command: 'npx', prefix: ['-y', 'node@20'], shell: WINDOWS });

if (cli && installed.status === 0) {
  for (const runtime of runtimes) {
    say(`\n  -- ${runtime.label} --`);
    rmSync(kitDir, { recursive: true, force: true });
    const node = (args) => run(runtime.command, [...runtime.prefix, ...args], consumer, { shell: runtime.shell });

    if (runtime.prefix.length > 0) {
      const version = node(['--version']);
      if (version.status !== 0 || !/^v20\./m.test(version.output.trim())) {
        fail(`${runtime.label}: could not start Node 20`, tail(version.output));
        continue;
      }
      say(`  ok    ${version.output.trim().split('\n').pop()}`);
    }

    const init = node([cli, 'init', 'app']);
    if (init.status !== 0) fail(`${runtime.label}: nextgen init`, tail(init.output));
    else say('  ok    nextgen init app');

    const built = node([cli, 'build', join('app', 'nextgen')]);
    if (built.status !== 0) fail(`${runtime.label}: nextgen build`, tail(built.output));
    else say('  ok    nextgen build app/nextgen');

    const bundle = join(kitDir, 'bundle');
    const served = existsSync(bundle) ? readdirSync(bundle) : [];
    const absent = ['nextgen.js', 'thresholds.hashing.json'].filter((f) => !served.includes(f));
    if (!served.some((f) => /^registry\..+\.json$/.test(f))) absent.push('registry.<ROLE>.json');
    if (!served.some((f) => /^index\..+\.json$/.test(f))) absent.push('index.<ROLE>.json');
    if (absent.length > 0) fail(`${runtime.label}: bundle/ is missing ${absent.join(', ')}`);
    else say(`  ok    bundle/ holds ${served.length} files, including the script tag`);

    const doctor = node([cli, 'doctor', join('app', 'nextgen')]);
    // doctor exits 1 when it has a problem to report; that is a finding, not a
    // crash. A crash has no report, and a report always names the script tag.
    if (![0, 1].includes(doctor.status) || !doctor.output.includes('nextgen.js')) {
      fail(`${runtime.label}: nextgen doctor`, tail(doctor.output));
    } else {
      say(`  ok    nextgen doctor (exit ${doctor.status})`);
    }

    const probe = node(['probe.mjs']);
    if (probe.status !== 0) fail(`${runtime.label}: import @nextgen/embed and route a turn`, tail(probe.output));
    else say(`  ok    import { create } from '@nextgen/embed' routed a turn: ${probe.output.trim().split('\n').pop()}`);

    const after = hashTree(app, (p) => p.startsWith(kitDir));
    const changed = [...before.keys()].filter((k) => after.get(k) !== before.get(k));
    const added = [...after.keys()].filter((k) => !before.has(k));
    if (changed.length > 0 || added.length > 0) {
      fail(`${runtime.label}: Rule 16 — the app's own files changed`, `        changed: ${changed.join(', ') || '-'}\n        added outside nextgen/: ${added.join(', ') || '-'}`);
    } else {
      say(`  ok    Rule 16: ${before.size} app files unchanged`);
    }
  }
}

// ------------------------------------------------- the adopter's CI: npm ci --

if (cli && installed.status === 0) {
  say("\n  -- the adopter's CI: a clean npm ci from the lockfile --");
  const manifest = JSON.parse(readFileSync(join(consumer, 'package.json'), 'utf8'));
  const recorded = Object.entries(manifest.devDependencies ?? {}).filter(([name]) => name.startsWith('@nextgen/'));
  const elsewhere = recorded.filter(([, spec]) => !spec.startsWith('file:vendor/nextgen/'));
  if (recorded.length !== tgz.length || elsewhere.length > 0) {
    fail('package.json records every tarball as file:vendor/nextgen/…', `        ${JSON.stringify(Object.fromEntries(recorded))}`);
  } else {
    say(`  ok    package.json records ${recorded.length} tarballs as file:vendor/nextgen/…`);
  }

  rmSync(join(consumer, 'node_modules'), { recursive: true, force: true });
  const clean = run('npm', ['ci', '--no-audit', '--no-fund', '--loglevel=error'], consumer, { shell: WINDOWS, timeout: 480_000 });
  if (clean.status !== 0) {
    fail('npm ci from the lockfile', tail(clean.output, 20));
  } else {
    const doctor = run(process.execPath, [cli, 'doctor', join('app', 'nextgen')], consumer);
    if (![0, 1].includes(doctor.status) || !doctor.output.includes('nextgen.js')) fail('nextgen doctor after npm ci', tail(doctor.output));
    else say('  ok    npm ci from the lockfile, then nextgen doctor');
  }
}

// ------------------------------------------------------ a TypeScript adopter --

if (installed.status === 0) {
  say('\n  -- a TypeScript adopter --');
  const tsc = join(consumer, 'node_modules', 'typescript', 'bin', 'tsc');
  if (!existsSync(tsc)) {
    fail('typescript is installed alongside the kit (the generator depends on it at run time)');
  } else {
    writeFileSync(
      join(consumer, 'types-probe.mts'),
      `import { init, build, doctor } from '@nextgen/kit';
import { create, start, type Assistant } from '@nextgen/embed';
import { route, type TurnTrace } from '@nextgen/core-intent';
import { discoverRoutes } from '@nextgen/generator';

export const used = [init, build, doctor, create, start, route, discoverRoutes];
export type Probe = { assistant: Assistant; trace: TurnTrace };
`,
    );
    for (const [module, resolution] of [['ESNext', 'bundler'], ['NodeNext', 'nodenext']]) {
      const config = `tsconfig.${resolution}.json`;
      writeFileSync(
        join(consumer, config),
        JSON.stringify({
          compilerOptions: { strict: true, noEmit: true, skipLibCheck: false, module, moduleResolution: resolution, target: 'ES2022', lib: ['ES2023', 'DOM'], types: [] },
          files: ['types-probe.mts'],
        }),
      );
      const checked = run(process.execPath, [tsc, '-p', config], consumer);
      if (checked.status !== 0) fail(`types under moduleResolution ${resolution}`, tail(checked.output));
      else say(`  ok    types resolve under moduleResolution ${resolution}, skipLibCheck off`);
    }
  }
}

// --------------------------------------------------------------------- report --

if (failures.length > 0) {
  console.error(`\n  Install check FAILED — ${failures.length} problem(s). Scratch project kept at:\n    ${work}\n`);
  process.exit(1);
}

if (KEEP) console.log(`\n  kept ${work}`);
else rmSync(work, { recursive: true, force: true });
console.log(`\n  Install OK — the tarballs install into a project outside this repository, run on ${runtimes.map((r) => r.label).join(' and ')}, and type-check for a TypeScript adopter.\n`);
