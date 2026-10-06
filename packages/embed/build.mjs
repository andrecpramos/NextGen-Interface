// Build the script-tag artefact.
//
// One file, `dist/nextgen.js`, that defines `window.NextGen` when loaded with a
// plain <script src>. No module system, no bundler on the adopter's side, no
// framework. That is Ladder C3's whole point: the adopters it exists for are the
// ones with no build step to add a package to.
//
//   node build.mjs          -> dist/nextgen.js  the script tag
//
// `tooling/scripts/build-adapter.mjs` copies this file, byte for byte, to
// `adapter/runtime/nextgen.js`. Until ADR-021 this also wrote `dist/index.js`, the same code
// as an ES module for `import { start } from '@nextgen/embed'`; nothing was ever installable
// after the tarballs went, so nothing read it.

import { build, transform } from 'esbuild';
import { gzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('./dist/nextgen.js', import.meta.url));

// thinking-orbs' engine is bundled into this file (src/mind.ts), and its licence (MIT) requires its
// notice to travel with every copy. `legalComments: 'none'` below strips comments from sources, so
// the notice is written as a banner — read from the installed package, so it cannot drift from the
// version that was bundled, and the build fails rather than ship the code without it.
const licence = readFileSync(fileURLToPath(new URL('./node_modules/thinking-orbs/LICENSE', import.meta.url)), 'utf8').trim();
const orbs = JSON.parse(readFileSync(fileURLToPath(new URL('./node_modules/thinking-orbs/package.json', import.meta.url)), 'utf8'));
if (!/Permission is hereby granted/.test(licence) || licence.includes('*/')) throw new Error('thinking-orbs/LICENSE is not the MIT text this banner expects');
const banner = `/*! nextgen.js bundles ${orbs.name} ${orbs.version} (its engine only).

${licence}
*/`;

// The widget's stylesheets are template strings in TypeScript (so a shadow root can adopt them under a
// strict CSP), and esbuild ships a string as written — comments, indentation and all. This minifies each
// one at build time with esbuild's own CSS minifier: 1.9 KB gzipped of the script tag, for nothing a
// visitor would see (ADR-029). An interpolation (`${BEAM_CSS}`) is held in place by a rule the minifier
// keeps, and put back after. The sources are untouched, so tests and review read them as written.
const STYLESHEETS = /[\\/]src[\\/](assistant|widget|beam)\.ts$/;
const minifyStylesheets = {
  name: 'minify-stylesheets',
  setup(b) {
    b.onLoad({ filter: STYLESHEETS }, async ({ path }) => {
      const source = readFileSync(path, 'utf8');
      let out = '';
      let last = 0;
      for (const m of source.matchAll(/((?:export )?const (?:CSS|BEAM_CSS)\s*=\s*`)([\s\S]*?)(`;)/g)) {
        const holes = [];
        const css = m[2].replace(/\$\{[^}]+\}/g, (hole) => `.__ng${holes.push(hole) - 1}{--ng-hole:0}`);
        // UTF-8 kept as written ("→" stays "→"); any backslash left is a CSS escape, and inside a JS
        // template string it has to be written twice to stay one.
        let min = (await transform(css, { loader: 'css', minify: true, charset: 'utf8' })).code.trim().replace(/\\/g, '\\\\');
        holes.forEach((hole, i) => {
          const marker = `.__ng${i}{--ng-hole:0}`;
          if (!min.includes(marker)) throw new Error(`minify-stylesheets: lost ${hole} in ${basename(path)}`);
          min = min.replace(marker, hole);
        });
        if (min.includes('`')) throw new Error(`minify-stylesheets: a backtick in ${basename(path)}'s CSS`);
        out += source.slice(last, m.index) + m[1] + min + m[3];
        last = m.index + m[0].length;
      }
      return { contents: out + source.slice(last), loader: 'ts' };
    });
  },
};

// The script tag starts itself from its own data-nextgen-* attributes
// (src/script-tag.ts), so a page needs no inline script.
await build({
  plugins: [minifyStylesheets],
  entryPoints: [fileURLToPath(new URL('./src/script-tag.ts', import.meta.url))],
  bundle: true,
  // A browser target, deliberately. If anything in the routing path reaches for
  // `node:fs` or `node:crypto`, esbuild fails here rather than an adopter's page
  // failing at load — the same property the browser no-network test holds, at the
  // other end of the pipeline.
  platform: 'browser',
  target: 'es2020',
  legalComments: 'none',
  banner: { js: banner },
  format: 'iife',
  globalName: 'NextGen',
  minify: true,
  outfile: script,
});

const bytes = readFileSync(script);
console.log(`dist/${basename(script).padEnd(11)} ${(bytes.length / 1024).toFixed(1)}KB raw, ${(gzipSync(bytes).length / 1024).toFixed(1)}KB gzipped`);
