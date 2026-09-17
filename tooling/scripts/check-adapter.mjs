// Does `adapter/` work the way ADR-018 says it does?
//
//   node tooling/scripts/check-adapter.mjs [--keep]
//
// The premise is "copy the folder into your repository and run it". Every part of that is
// checkable and none of it is checked by a unit test, because every failure found while
// building it was a failure of *the bundle in a bare directory* rather than of the source:
//
//   - a shebang on line 2, because esbuild preserved the entry's own;
//   - `Dynamic require of "…" is not supported`, because typescript is CommonJS;
//   - `Cannot determine intended module format`, because the entry had a top-level await;
//   - `__filename is not defined in ES module scope`;
//   - and the one that mattered: `build` resolving the widget through `node_modules`,
//     which does not exist for an adopter, so `bundle/` shipped with no assistant in it
//     and `doctor` called it a warning.
//
// So: copy the committed folder and a fixture application into a scratch directory
// OUTSIDE this repository, with no node_modules anywhere above it, and run the real
// commands. Then check Rule 16 by fingerprinting the application before and after.

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const KEEP = process.argv.includes('--keep');
const ADAPTER = join(ROOT, 'adapter');
const APP = join(ROOT, 'packages', 'generator', 'fixtures', 'family-app');

const failures = [];
const check = (ok, line) => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${line}`);
  if (!ok) failures.push(line);
};

/** Every file's content hash, so "nothing was written into the app" is provable. */
function fingerprint(dir) {
  const out = new Map();
  const walk = (current) => {
    for (const entry of readdirSync(current)) {
      const path = join(current, entry);
      if (statSync(path).isDirectory()) walk(path);
      else out.set(relative(dir, path), createHash('sha256').update(readFileSync(path)).digest('hex'));
    }
  };
  walk(dir);
  return out;
}

if (!existsSync(join(ADAPTER, 'scan.mjs'))) {
  console.error('\n  adapter/scan.mjs is missing. Build it first:\n');
  console.error('    node packages/embed/build.mjs && node tooling/scripts/build-adapter.mjs\n');
  process.exit(1);
}

// Outside the repository on purpose: inside it, Node would find the workspace's
// node_modules by walking up, and every "no dependencies" claim here would be vacuous.
const scratch = mkdtempSync(join(tmpdir(), 'nextgen-adapter-'));
const project = join(scratch, 'adopter');
const tool = join(project, 'nextgen-tool');

cpSync(join(APP, 'src'), join(project, 'src'), { recursive: true });
cpSync(ADAPTER, tool, { recursive: true });
writeFileSync(join(project, 'package.json'), '{"name":"pretend-adopter","private":true}\n');

console.log(`\n  adapter check — ${project}`);
console.log(`  node ${process.version} · no node_modules above it · network blocked\n`);

const before = fingerprint(join(project, 'src'));

// Every command runs with the network poisoned: `fetch`, `net`, `tls`, `http`, `https`
// and DNS all throw, naming what was attempted. So "the copied folder does not call out"
// is held by *running it that way* rather than by grepping the bundle for URLs — which is
// the wrong instrument, since it vendors `typescript`, whose diagnostic messages quote
// documentation URLs as ordinary strings. A compiler's help text is not a socket.
const BLOCKER = fileURLToPath(new URL('./no-network.mjs', import.meta.url));

const run = (args) => {
  try {
    return {
      ok: true,
      out: execFileSync(process.execPath, ['--import', pathToFileURL(BLOCKER).href, join(tool, 'scan.mjs'), ...args], {
        cwd: project,
        encoding: 'utf8',
        stdio: 'pipe',
        timeout: 300_000,
      }),
    };
  } catch (error) {
    return { ok: false, out: `${error.stdout ?? ''}${error.stderr ?? ''}` };
  }
};

const short = (text) => (text ?? '').trim().split('\n').slice(-3).join(' / ').slice(0, 240);

const init = run(['init', '.']);
check(init.ok, `init read the application${init.ok ? '' : ` — ${short(init.out)}`}`);

if (init.ok) {
  // The fixture is Portuguese-first and `init` cannot know that, so it says GUESSED and
  // warns. Acting on the warning is part of what is being checked: doctor must stop
  // repeating it once the developer has done what it asked.
  const configFile = join(project, 'nextgen', 'nextgen.config.json');
  const config = JSON.parse(readFileSync(configFile, 'utf8'));
  check(config.languages?.[0] === 'en', 'init guessed the language, and said so');
  config.languages = ['pt-PT', 'en'];
  writeFileSync(configFile, JSON.stringify(config, null, 2));
}

const built = run(['build', 'nextgen']);
check(built.ok, `build generated the bundle${built.ok ? '' : ` — ${short(built.out)}`}`);

const bundle = join(project, 'nextgen', 'bundle');
if (existsSync(bundle)) {
  const files = readdirSync(bundle);
  // The one the first end-to-end run got wrong: without this the adopter serves no
  // assistant at all, and every other artefact looks perfect.
  check(files.includes('nextgen.js'), 'the widget is in the bundle, ready to serve');
  const roles = files.filter((f) => /^registry\.[A-Z_]+\.json$/.test(f));
  check(roles.length >= 2, `one registry per role (${roles.length})`);
  check(
    roles.every((f) => files.includes(f.replace('registry.', 'index.'))),
    'every registry has its precomputed index beside it',
  );
  check(files.includes('thresholds.hashing.json'), 'thresholds shipped');
  // Rule 17: what a browser receives must not name any other role.
  const leaks = roles.filter((f) => {
    const text = readFileSync(join(bundle, f), 'utf8');
    return roles.some((other) => other !== f && text.includes(other.slice('registry.'.length, -'.json'.length)));
  });
  check(leaks.length === 0, `no shipped registry names another role (Rule 17)${leaks.length ? `: ${leaks.join(', ')}` : ''}`);
}

const report = run(['doctor', 'nextgen']);
check(report.ok, `doctor ran${report.ok ? '' : ` — ${short(report.out)}`}`);
if (report.ok) {
  check(!report.out.includes('PROBLEM'), 'doctor reports no PROBLEMS');
  check(
    !report.out.includes("The app's language is a guess"),
    'doctor stops repeating a warning the developer has acted on',
  );
}

// Rule 8, stated as what it is: three commands completed with every outbound path
// throwing. The blocker is proved to block — `fetch`, `net.connect` and `dns.lookup` all
// refuse under it — so a pass here means no socket was opened, not that none was noticed.
check(
  init.ok && built.ok && report.ok,
  'the whole pipeline ran with the network blocked — nothing reached out (Rule 8)',
);

// Rule 16, the promise the whole product rests on.
const after = fingerprint(join(project, 'src'));
const changed = [...after].filter(([path, hash]) => before.get(path) !== hash).map(([path]) => path);
const removed = [...before.keys()].filter((path) => !after.has(path));
check(
  changed.length === 0 && removed.length === 0,
  `Rule 16: nothing was written into the application (${before.size} files unchanged)`,
);
for (const path of [...changed, ...removed].slice(0, 5)) console.error(`          ${path}`);

if (KEEP) console.log(`\n  kept: ${project}`);
else rmSync(scratch, { recursive: true, force: true });

console.log('');
if (failures.length > 0) {
  console.error(`  adapter FAILED — ${failures.length} check(s).`);
  console.error('  Run again with --keep to inspect the scratch project.\n');
  process.exit(1);
}
console.log('  adapter OK — it is copied, and it runs, with nothing installed.\n');
