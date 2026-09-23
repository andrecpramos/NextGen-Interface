// The folder an adopter is given: `pnpm export:adopter <folder>`.
//
// `adapter/` is what an adopter copies into their project (ADR-021). This is what they are *handed*: that
// folder, the one page that tells them how to use it, the licence, and nothing of how it was built — no
// `packages/`, `eval/`, `tooling/`, `preview/` or `.claude/`. It is shaped like a small repository, so it
// can be published or zipped as it is.
//
//   <folder>/
//     README.md            what it is, what is in here, the five commands, the honest limits
//     GETTING-STARTED.md   the five steps, links rewritten for this layout
//     LICENSE
//     SHA256SUMS.txt       a hash of every file, so a copy can be checked against this one
//     adapter/             scan.mjs, runtime/nextgen.js, AGENTS.md, FIELD-NOTES.md, VERSION
//
// It refuses to export a stale `adapter/` (the same check as the `adapter-stale` gate), refuses to write
// over a folder it did not make, and checks every relative link in what it wrote before it says done.

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const MARK = '.nextgen-export';

const dest = process.argv.slice(2).find((arg) => !arg.startsWith('--'));
if (!dest) {
  console.error('\n  usage: pnpm export:adopter <folder>   (e.g. ~/Desktop/NextGen-Interface)\n');
  process.exit(2);
}
const out = resolve(dest);
if (out === ROOT || !relative(ROOT, out).startsWith('..')) {
  console.error(`\n  ${out} is inside this repository. Export somewhere else.\n`);
  process.exit(2);
}

// 1. The adapter must be what packages/ builds, or the adopter gets yesterday's tool.
try {
  execFileSync(process.execPath, [join(ROOT, 'tooling', 'scripts', 'build-adapter.mjs'), '--check'], { stdio: 'pipe' });
} catch (error) {
  console.error(`\n  adapter/ is stale — run \`pnpm adapter:build\` and commit it first.\n${error.stdout ?? ''}`);
  process.exit(1);
}

// 2. Never write over something this script did not make.
if (existsSync(out)) {
  if (!existsSync(join(out, MARK))) {
    console.error(`\n  ${out} exists and was not made by this script. Choose another folder, or remove it yourself.\n`);
    process.exit(1);
  }
  rmSync(out, { recursive: true, force: true });
}
mkdirSync(out, { recursive: true });

// 3. The folder.
cpSync(join(ROOT, 'adapter'), join(out, 'adapter'), { recursive: true });
cpSync(join(ROOT, 'LICENSE'), join(out, 'LICENSE'));
const gettingStarted = readFileSync(join(ROOT, '.MDFiles', 'GETTING-STARTED.md'), 'utf8')
  // In the repository it lives in .MDFiles/; here it sits beside adapter/ and LICENSE.
  .replaceAll('](../adapter/', '](adapter/')
  .replaceAll('](../LICENSE)', '](LICENSE)')
  .replace('Copy [`adapter/`](adapter/) from this repository into your project.', 'Copy [`adapter/`](adapter/) from this folder into your project.')
  .replace('- Access to this repository, to copy one folder out of it.', '- This folder.')
  .replace('cp -r path/to/AI-Interface/adapter  your-app/nextgen-tool', 'cp -r path/to/NextGen-Interface/adapter  your-app/nextgen-tool')
  .replace('copy `adapter/` from the commit you\n  want in its place', 'copy `adapter/` from the newer folder you\n  were given in its place');
writeFileSync(join(out, 'GETTING-STARTED.md'), gettingStarted);

const version = readFileSync(join(ROOT, 'adapter', 'VERSION'), 'utf8').split(/\r?\n/, 1)[0].trim();
writeFileSync(join(out, 'README.md'), readme(version));
writeFileSync(join(out, MARK), 'Made by tooling/scripts/export-adopter.mjs. Safe to delete.\n');

// 4. A hash of every file, so a copy can be checked against the one that was handed over.
const files = walk(out).filter((file) => !file.endsWith(MARK) && !file.endsWith('SHA256SUMS.txt'));
const sums = files
  .map((file) => `${createHash('sha256').update(readFileSync(file)).digest('hex')}  ${relative(out, file).split('\\').join('/')}`)
  .join('\n');
writeFileSync(join(out, 'SHA256SUMS.txt'), `${sums}\n`);

// 5. Every relative link in what was written resolves inside the folder.
const broken = [];
for (const file of walk(out).filter((f) => f.endsWith('.md'))) {
  for (const [, target] of readFileSync(file, 'utf8').matchAll(/\]\(([^)#\s]+)(?:#[^)]*)?\)/g)) {
    if (/^[a-z]+:/i.test(target)) continue;
    const at = resolve(dirname(file), target);
    if (!existsSync(at) || relative(out, at).startsWith('..')) broken.push(`${relative(out, file)} -> ${target}`);
  }
}
if (broken.length > 0) {
  console.error(`\n  Broken links in the export:\n${broken.map((b) => `    ${b}`).join('\n')}\n`);
  process.exit(1);
}

const size = files.reduce((total, file) => total + statSync(file).size, 0);
console.log(`\n  Exported ${files.length} files (${(size / 1024 / 1024).toFixed(1)} MB) to ${out}`);
console.log(`  ${version}\n`);

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

function readme(version) {
  return `# NextGen Interface

**An assistant for a web app that already exists.** Visitors say what they want in their own words, and it
takes them to the right screen and tells them what they will find there — or offers the two likeliest
places, each with what it is for.

> *"My son got hurt at training"* → **Medical status** — *"Where a guardian sees whether a child is fit to
> play, and how an injury is healing."*

- It reads your app's routes, roles and translations. **It never changes your files**; everything it writes
  goes into one folder of its own.
- **Nothing is installed.** You copy one folder. No package manager, no registry, no account.
- **The tool makes no network request**, and in the browser the assistant needs **no model and no server**.
- **It moves between screens and explains them. It never performs an action** — it does not save, send,
  pay or delete anything. Asked for something it will not do, it says so and, where you have told it,
  points to the screen where the visitor can do it themselves.

## What is in this folder

| | |
|---|---|
| [\`GETTING-STARTED.md\`](GETTING-STARTED.md) | **Start here.** Five steps |
| [\`adapter/\`](adapter/) | The tool. Copy it into your project |
| [\`adapter/AGENTS.md\`](adapter/AGENTS.md) | For a coding agent installing it on your behalf — and the decisions that are yours to make |
| [\`adapter/FIELD-NOTES.md\`](adapter/FIELD-NOTES.md) | What goes wrong when this meets a real application. Read it before you trust the output |
| \`adapter/VERSION\` | Which build this is. \`doctor\` prints it; quote it when you report a problem |
| \`SHA256SUMS.txt\` | A hash of every file here |
| [\`LICENSE\`](LICENSE) | Proprietary. Use requires a written agreement |

## You need

- **Node 20 or newer**, to run the tool on your machine. Your visitors need nothing.
- An app built with **React Router, Vue Router, Angular, Next.js, Remix, SvelteKit or Nuxt**.

## In one minute

From your app's root, after copying \`adapter/\` in as \`nextgen-tool/\`:

\`\`\`bash
node nextgen-tool/scan.mjs init .          # find your routes, roles and languages
node nextgen-tool/scan.mjs build nextgen   # write nextgen/bundle/ (served) and nextgen/review/ (never served)
node nextgen-tool/scan.mjs doctor nextgen  # what it found, what it guessed, and what to do next
node nextgen-tool/scan.mjs preview nextgen # try it locally before wiring anything in
\`\`\`

Then one line in your page — [\`GETTING-STARTED.md\`](GETTING-STARTED.md) has it, and how to serve each
signed-in user only their own role's files.

## What to expect, honestly

- **It usually offers rather than decides.** Most questions get the two likeliest screens, the likely one
  first; it moves straight to a screen only when it is sure. On its reference app it has sent nobody to a
  wrong screen.
- **It gets much better when you tell it about your app.** \`build\` writes the questions only you can
  answer — what each screen is for, the words your users use, what the app cannot do — into
  \`nextgen/review/KNOWLEDGE-GAPS.md\`. Answering them is the biggest single improvement.
- **It declines about half of the requests for things your app cannot do**, and asks a clarifying question
  for the rest. It never carries them out.
- **English and Portuguese.** It speaks your page's language when that is one of the two, and English
  otherwise; visitors may write in either.
- Every accuracy figure behind it was measured on test applications with questions written by its author.
  Your own app and your own users are the test that counts — \`doctor\` tells you how to measure it.

## Version

\`${version}\`
`;
}
