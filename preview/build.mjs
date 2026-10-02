// Bundle the bench's own browser code: `preview/dist/*.js`. Run by `pnpm preview`.
//
// `nextgen.js` (the widget an adopter receives) is built by packages/embed/build.mjs and is
// the only thing here an adopter ever gets. This builds the bench pages that import the
// widget's *source* — `/alive` draws the orb and the composer's light with the same modules
// the widget uses, so what it shows is what ships, not a redrawing of it.
//
// esbuild only, already a devDependency; nothing here is installed for an adopter.

import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const here = (path) => fileURLToPath(new URL(path, import.meta.url));

await build({
  entryPoints: { alive: here('./alive.js'), extras: here('./extras.jsx') },
  outdir: here('./dist'),
  bundle: true,
  platform: 'browser',
  target: 'es2020',
  format: 'iife',
  legalComments: 'none',
  logLevel: 'warning',
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' },
  // One React for the page and for every library that has it as a peer: two copies break hooks.
  alias: { react: here('../node_modules/react'), 'react-dom': here('../node_modules/react-dom') },
});
console.log('preview/dist/alive.js, preview/dist/extras.js');
