// A static server for one thing this repo has no existing tool for: looking
// at what an adopter's page actually shows, in a real browser, instead of
// judging it in code. `node:http` and `node:fs` only — no new dependency,
// consistent with esbuild being the only bundling tool anywhere in this repo.
//
//   node build.mjs && node demo/serve.mjs   (pnpm --filter @nextgen/embed preview)

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEMO = new URL('./', import.meta.url);
const DIST = new URL('../dist/', import.meta.url);
// The same generated fut-app registry embed.test.ts and check-accessibility.mjs
// already drive, so what this preview shows is what those already measure.
const FUT_APP = new URL('../../../eval/fut-app/generated/', import.meta.url);
const PORT = 4173;

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json' };

const ROUTES = [
  [/^\/$/, () => [DEMO, 'index.html']],
  [/^\/(plain|themed|nav-right)\.html$/, (m) => [DEMO, `${m[1]}.html`]],
  [/^\/nextgen\.js$/, () => [DIST, 'nextgen.js']],
  [/^\/nextgen\/(registry\.PARENT\.json|index\.PARENT\.json|thresholds\.hashing\.json)$/, (m) => [FUT_APP, m[1]]],
];

const server = createServer(async (req, res) => {
  const { pathname } = new URL(req.url ?? '/', 'http://localhost');
  for (const [pattern, resolve] of ROUTES) {
    const match = pattern.exec(pathname);
    if (!match) continue;
    const [base, file] = resolve(match);
    try {
      const body = await readFile(fileURLToPath(new URL(file, base)));
      res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404).end('Not found');
    }
    return;
  }
  res.writeHead(404).end('Not found');
});

server.listen(PORT, () => {
  console.log(`\n  Preview running: http://localhost:${PORT}/\n`);
});
