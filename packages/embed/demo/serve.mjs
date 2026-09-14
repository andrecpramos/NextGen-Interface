// A static server for looking at what an adopter's visitor actually gets, in a
// real browser. `node:http` and `node:fs` only — no new dependency.
//
//   node build.mjs && node demo/serve.mjs   (pnpm embed:preview)
//
// Besides the bare host pages, every other extensionless path is a page of a mock
// club app built from the real generated fut-app PARENT registry. So when the
// assistant navigates, it lands on a page that exists, and the orb is there.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEMO = new URL('./', import.meta.url);
const DIST = new URL('../dist/', import.meta.url);
const FUT_APP = new URL('../../../eval/fut-app/generated/', import.meta.url);
const PORT = Number(process.env.PORT) || 4173;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
};

const registry = JSON.parse(await readFile(fileURLToPath(new URL('registry.PARENT.json', FUT_APP)), 'utf8'));
const pages = registry.capabilities.filter(
  (c) => c.kind === 'navigate' && typeof c.route === 'string' && !c.route.includes(':'),
);
const escape = (s) =>
  String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);

async function appPage(pathname) {
  // Read per request, so editing the template shows on reload without a restart.
  const shell = await readFile(fileURLToPath(new URL('app.html', DEMO)), 'utf8');
  const here = pages.find((p) => p.route === pathname);
  const nav = pages
    .map((p) => `<a href="${escape(p.route)}"${p.route === pathname ? ' aria-current="page"' : ''}>${escape(p.title)}</a>`)
    .join('\n      ');
  return shell
    .replaceAll('<!--TITLE-->', escape(here?.title ?? pathname))
    .replace('<!--PATH-->', escape(pathname))
    .replace('<!--NAV-->', nav);
}

const FILES = [
  [/^\/$/, () => [DEMO, 'index.html']],
  [/^\/(plain|themed|nav-right|phone)\.html$/, (m) => [DEMO, `${m[1]}.html`]],
  [/^\/nextgen\.js$/, () => [DIST, 'nextgen.js']],
  [/^\/nextgen\/(registry\.PARENT\.json|index\.PARENT\.json|thresholds\.hashing\.json)$/, (m) => [FUT_APP, m[1]]],
];

const server = createServer(async (req, res) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
  } catch {
    res.writeHead(400).end('Bad request');
    return;
  }
  for (const [pattern, resolve] of FILES) {
    const match = pattern.exec(pathname);
    if (!match) continue;
    const [base, file] = resolve(match);
    try {
      const body = await readFile(fileURLToPath(new URL(file, base)));
      res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(body);
    } catch {
      res.writeHead(404).end(file === 'nextgen.js' ? 'Not built yet: run node build.mjs' : 'Not found');
    }
    return;
  }
  if (!extname(pathname)) {
    res.writeHead(200, { 'Content-Type': TYPES['.html'], 'Cache-Control': 'no-store' });
    res.end(await appPage(pathname));
    return;
  }
  res.writeHead(404).end('Not found');
});

server.listen(PORT, () => {
  console.log(`\n  Club app:        http://localhost:${PORT}/my`);
  console.log(`  On a phone frame: http://localhost:${PORT}/phone.html`);
  console.log(`  Host page index: http://localhost:${PORT}/\n`);
});
