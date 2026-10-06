// Build `adapter/` — the folder an adopter copies (ADR-018).
//
//   node tooling/scripts/build-adapter.mjs           # write it
//   node tooling/scripts/build-adapter.mjs --check   # is what is committed current?
//
// Three artefacts, from source that already exists:
//
//   scan.mjs            packages/kit/src/cli-copied.ts and everything it imports, in one
//                       file. It is the kit's only entry point (ADR-021) and references no
//                       model client, so the bundle cannot reach a network.
//   runtime/nextgen.js  packages/embed/dist/nextgen.js, byte for byte
//   runtime/nextgen.d.ts  packages/embed/nextgen.d.ts: types for the API an app calls
//   VERSION             an id of the files above (their hashes; no date, no commit), which
//                       `doctor` prints so an adopter can say which build they copied
//
// The premise of ADR-018 is "copy a folder, run it". That is only true if the folder
// needs no package manager, no registry and no network, so `scan.mjs` is bundled with
// **no externals at all** — including `typescript`, which the generator uses at run time
// to parse the adopter's source. That is most of the file's size and it is the price of
// the premise; check-adapter.mjs proves the result runs from a directory with no
// node_modules in it.
//
// `--check` rebuilds into memory and compares, so a change to packages/ that is not
// reflected in the committed folder fails rather than shipping stale. Committed build
// output with no staleness gate is a failure mode this repository has hit three times.

import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const CHECK = process.argv.includes('--check');

const ENTRY = join(ROOT, 'packages', 'kit', 'src', 'cli-copied.ts');
const WIDGET = join(ROOT, 'packages', 'embed', 'dist', 'nextgen.js');
const OUT = join(ROOT, 'adapter');

// Each artefact is built once, however many others read it.
const memo = new Map();
const built = (target) => {
  if (!memo.has(target)) memo.set(target, target.build());
  return memo.get(target);
};

const targets = [
  { path: join(OUT, 'scan.mjs'), build: bundleScanner },
  { path: join(OUT, 'runtime', 'nextgen.js'), build: readWidget },
  // Types for the part of the widget an app calls, held to the source by embed's declarations.check.ts.
  { path: join(OUT, 'runtime', 'nextgen.d.ts'), build: () => readFileSync(join(ROOT, 'packages', 'embed', 'nextgen.d.ts')) },
  // Which build an adopter copied. An id of the files above and nothing else — no date, no commit —
  // so it changes exactly when they do, and `--check` stays a comparison of bytes.
  { path: join(OUT, 'VERSION'), build: writeVersion },
];

async function writeVersion() {
  const [scanner, ...runtime] = await Promise.all(targets.slice(0, -1).map((target) => built(target)));
  const text = [
    `nextgen-adapter ${sha(scanner)}-${sha(Buffer.concat(runtime))}`,
    'Identifies scan.mjs and runtime/ (nextgen.js and its types), the files an adopter copies. It changes',
    'exactly when any of them does. `node scan.mjs doctor` prints it: quote it when you report a problem.',
    '',
  ].join('\n');
  return Buffer.from(text, 'utf8');
}

async function bundleScanner() {
  if (!existsSync(ENTRY)) throw new Error(`missing ${relative(ROOT, ENTRY)}`);
  const result = await build({
    entryPoints: [ENTRY],
    bundle: true,
    platform: 'node',
    // The declared floor in package.json's engines. The repo itself needs 23.6+ to run
    // TypeScript directly, but the adopter runs a bundle, so their floor is lower.
    target: 'node20',
    format: 'esm',
    minify: true,
    legalComments: 'none',
    // Not `write`, so --check never touches the tree.
    write: false,
    logLevel: 'warning',
  });
  // With `write: false` and no outfile, esbuild returns a single entry named `<stdout>`.
  const [file] = result.outputFiles;
  if (!file) throw new Error('esbuild produced no output file');

  let code = file.text;

  // Two fixes, both forced by what is inside this bundle, and both verified by running
  // the result from a directory with no node_modules (check-adapter.mjs).
  //
  // 1. `cli-copied.ts` starts with its own shebang and esbuild preserves it wherever it lands.
  //    With anything prepended, Node hits `#!/usr/bin/env node` on line 2 and refuses the
  //    file outright. So it is stripped here and re-added first.
  // 2. The generator parses the adopter's source with `typescript`, which is CommonJS and
  //    calls `require()` internally. An ESM bundle has no `require`, and esbuild's shim
  //    throws *"Dynamic require of … is not supported"* on the first parse. CommonJS
  //    output is not the way out: `kit/src/build.ts` uses `import.meta.url`, which CJS
  //    does not have. So: ESM, with a real `require` bridged in from node:module — which
  //    esbuild's own shim then finds and uses.
  code = code.replace(/^#![^\n]*\n/, '');
  const preamble = [
    '#!/usr/bin/env node',
    // The three things CommonJS code takes for granted and an ES module does not have.
    // `typescript` reaches for all of them; each was found by running the bundle from a
    // bare directory and reading what it threw, in this order.
    'import{createRequire as __ngRequire}from"node:module";',
    'import{fileURLToPath as __ngPath}from"node:url";',
    'import{dirname as __ngDir}from"node:path";',
    'var require=__ngRequire(import.meta.url);',
    'var __filename=__ngPath(import.meta.url);',
    'var __dirname=__ngDir(__filename);',
    '',
  ].join('\n');

  return Buffer.from(preamble + code, 'utf8');
}

function readWidget() {
  if (!existsSync(WIDGET)) {
    throw new Error(
      `missing ${relative(ROOT, WIDGET)} — run: node packages/embed/build.mjs`,
    );
  }
  return readFileSync(WIDGET);
}

const sha = (buffer) => createHash('sha256').update(buffer).digest('hex').slice(0, 12);
const kb = (buffer) => `${(buffer.length / 1024).toFixed(0)}KB`;

const stale = [];
for (const target of targets) {
  const shown = relative(ROOT, target.path).replace(/\\/g, '/');
  let output;
  try {
    output = await built(target);
  } catch (cause) {
    console.error(`FAIL  ${shown}\n      ${cause.message}`);
    process.exit(1);
  }

  if (CHECK) {
    const committed = existsSync(target.path) ? readFileSync(target.path) : null;
    if (committed === null) {
      console.error(`FAIL  ${shown}  is not committed`);
      stale.push(shown);
    } else if (!committed.equals(output)) {
      console.error(`FAIL  ${shown}  committed ${sha(committed)}, rebuild gives ${sha(output)}`);
      stale.push(shown);
    } else {
      console.log(`ok    ${shown}  ${kb(output)}  ${sha(output)}`);
    }
    continue;
  }

  mkdirSync(dirname(target.path), { recursive: true });
  writeFileSync(target.path, output);
  console.log(`wrote ${shown}  ${kb(output)}  ${sha(output)}`);
}

if (CHECK && stale.length > 0) {
  console.error(`
  adapter/ is STALE — ${stale.length} file(s) do not match what packages/ builds.

  It is committed build output: an adopter copies it as it sits, so it cannot be
  regenerated on their machine. Rebuild and commit the result with the change that
  caused it:

    node packages/embed/build.mjs
    node tooling/scripts/build-adapter.mjs
`);
  process.exit(1);
}

if (CHECK) console.log(`\n  adapter/ is current — ${targets.length} artefact(s) match what packages/ builds.`);
else console.log('\n  Built. Commit adapter/ with the change that caused it.');
