// The bench. `pnpm preview`.
//
// What an adopter's visitor gets, running locally, plus everything needed to judge it:
// the real `nextgen.js` on a mock of the adopter's app, any role, and the trace behind
// every answer — which stage decided, what else it considered, by what margin.
//
//   pnpm preview                 # the only fixture app, whichever it is
//   pnpm preview -- --app family # by name, once there is more than one
//   PORT=5000 pnpm preview
//
// It serves **every role's bundle at once**, which is exactly what production must never
// do (Rule 17): a role's registry *is* its entitlement, and one page here can switch
// between them. That is the point of a bench and the reason this directory never ships.
// It binds to 127.0.0.1 and the pages say so.
//
// `node:http` and `node:fs` only — no new dependency, and no network.

import { createServer } from 'node:http';
import { readFile, readdir, stat } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = new URL('./', import.meta.url);
const DIST = new URL('../packages/embed/dist/', import.meta.url);
const APPS = new URL('../eval/frameworks/', import.meta.url);
const PORT = Number(process.env.PORT) || 4173;
const HOST = '127.0.0.1';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
};

/** Every fixture application: a folder under eval/frameworks holding generated output. */
async function findApps() {
  const dir = fileURLToPath(APPS);
  const names = [];
  for (const entry of await readdir(dir)) {
    try {
      if (!(await stat(join(dir, entry))).isDirectory()) continue;
      await stat(join(dir, entry, 'generated'));
      names.push(entry);
    } catch {
      /* not an application, or never generated */
    }
  }
  return names.sort();
}

function flag(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? (process.argv[i + 1] ?? null) : null;
}

const available = await findApps();
if (available.length === 0) {
  console.error('\n  No generated fixture application found under eval/frameworks/.');
  console.error('  Generate one first:\n');
  console.error('    node --experimental-strip-types packages/generator/src/cli.ts \\');
  console.error('      eval/frameworks/<app>/generator.config.json --no-model\n');
  process.exit(1);
}

const asked = flag('app');
if (asked && !available.includes(asked)) {
  console.error(`\n  --app ${asked}: no such fixture application.`);
  console.error(`  available: ${available.join(', ')}\n`);
  process.exit(1);
}
const APP = asked ?? (available.length === 1 ? available[0] : null);
if (!APP) {
  console.error(`\n  --app <name> is required: ${available.length} fixture applications are present.`);
  console.error(`  available: ${available.join(', ')}\n`);
  process.exit(1);
}

const GEN = new URL(`${APP}/generated/`, APPS);

/** The roles this application generated, read from the files themselves. */
const roles = (await readdir(fileURLToPath(GEN)))
  .map((f) => /^registry\.([A-Z_]+)\.json$/.exec(f)?.[1])
  .filter(Boolean)
  .sort();

if (roles.length === 0) {
  console.error(`\n  ${APP} has no registry.<ROLE>.json in generated/. Run the generator again.\n`);
  process.exit(1);
}

const escape = (s) =>
  String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);

/** Pages for one role: every navigable route with no unfilled parameter. */
async function pagesFor(role) {
  const registry = JSON.parse(await readFile(fileURLToPath(new URL(`registry.${role}.json`, GEN)), 'utf8'));
  return registry.capabilities.filter(
    (c) => c.kind === 'navigate' && typeof c.route === 'string' && !c.route.includes(':'),
  );
}

/**
 * The mock app's page language, which is the widget's: it speaks English and Portuguese, and English for
 * anything else. English by default (2026-09-22), `?lang=pt` to see the Portuguese; the fixture's own
 * content stays Portuguese test data either way.
 */
const LANGS = { en: 'en', pt: 'pt-PT' };

/** `?role=…`, and `&lang=…` unless it is the default. */
const query = (role, lang) => `?role=${encodeURIComponent(role)}${lang === 'en' ? '' : `&lang=${lang}`}`;

const roleLinks = (current, path, lang = 'en') =>
  roles
    .map(
      (r) =>
        `<a href="${escape(path)}${query(r, lang)}"${r === current ? ' aria-current="page"' : ''}>${escape(r)}</a>`,
    )
    .join('');

const langLinks = (role, path, current) =>
  Object.keys(LANGS)
    .map((l) => `<a href="${escape(path)}${query(role, l)}" lang="${LANGS[l]}"${l === current ? ' aria-current="page"' : ''}>${l}</a>`)
    .join('');

/** The mock application shell — where the assistant lands when it navigates. */
async function appPage(pathname, role, lang = 'en') {
  const shell = await readFile(fileURLToPath(new URL('app.html', HERE)), 'utf8');
  const pages = await pagesFor(role);
  const here = pages.find((p) => p.route === pathname);
  const nav = pages
    .map(
      (p) =>
        `<a href="${escape(p.route)}${query(role, lang)}"${p.route === pathname ? ' aria-current="page"' : ''}>${escape(p.title)}</a>`,
    )
    .join('\n      ');
  return shell
    .replace('<!--LANG-->', LANGS[lang])
    .replaceAll('<!--TITLE-->', escape(here?.title ?? pathname))
    .replace('<!--PATH-->', escape(pathname))
    .replace('<!--NAV-->', nav)
    // Twice in the page (the body's role and the link back to the bench): `replace` filled only the first.
    .replaceAll('<!--ROLE-->', escape(role))
    .replace('<!--ROLES-->', roleLinks(role, pathname, lang))
    .replace('<!--LANGS-->', langLinks(role, pathname, lang))
    .replace('<!--APP-->', escape(APP));
}

async function benchPage(role) {
  const shell = await readFile(fileURLToPath(new URL('bench.html', HERE)), 'utf8');
  const pages = await pagesFor(role);
  return shell
    .replaceAll('<!--ROLE-->', escape(role))
    .replace('<!--ROLES-->', roleLinks(role, '/bench'))
    .replaceAll('<!--APP-->', escape(APP))
    .replace('<!--APPS-->', available.map((a) => `<option${a === APP ? ' selected' : ''}>${escape(a)}</option>`).join(''))
    .replace('<!--COUNT-->', String(pages.length));
}

const STATIC = [
  [/^\/(plain|themed|nav-right|phone)\.html$/, (m) => [HERE, `${m[1]}.html`]],
  [/^\/(bench|app)\.js$/, (m) => [HERE, `${m[1]}.js`]],
  [/^\/nextgen\.js$/, () => [DIST, 'nextgen.js']],
  [/^\/(alive|extras)\.js$/, (m) => [HERE, `dist/${m[1]}.js`]],
  [/^\/nextgen\/(registry\.[A-Z_]+\.json|index\.[A-Z_]+\.json|thresholds\.hashing\.json)$/, (m) => [GEN, m[1]]],
];

const server = createServer(async (req, res) => {
  let url;
  try {
    url = new URL(req.url ?? '/', `http://${HOST}`);
  } catch {
    res.writeHead(400).end('Bad request');
    return;
  }
  const pathname = decodeURIComponent(url.pathname);
  const role = roles.includes(url.searchParams.get('role') ?? '') ? url.searchParams.get('role') : roles[0];
  // An allow-list: anything else is the default, and never reaches the page.
  const lang = Object.hasOwn(LANGS, url.searchParams.get('lang') ?? '') ? url.searchParams.get('lang') : 'en';

  for (const [pattern, resolve] of STATIC) {
    const match = pattern.exec(pathname);
    if (!match) continue;
    const [base, file] = resolve(match);
    try {
      const body = await readFile(fileURLToPath(new URL(file, base)));
      res.writeHead(200, {
        'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream',
        'Cache-Control': 'no-store',
      });
      res.end(body);
    } catch {
      res.writeHead(404).end(
        file === 'nextgen.js'
          ? 'Not built yet — run: node packages/embed/build.mjs'
          : file.startsWith('dist/')
            ? 'Not built yet — run: node preview/build.mjs'
            : `Not found: ${file}`,
      );
    }
    return;
  }

  const html = (body) => {
    res.writeHead(200, { 'Content-Type': TYPES['.html'], 'Cache-Control': 'no-store' });
    res.end(body);
  };

  // Every browser asks; a 404 is a red line in the console that has nothing to do with the widget.
  if (pathname === '/favicon.ico') {
    res.writeHead(204, { 'Cache-Control': 'max-age=86400' }).end();
    return;
  }
  if (pathname === '/' || pathname === '/bench') return html(await benchPage(role));
  if (pathname === '/hosts') {
    // The link to the mock app is rendered rather than written in, so it points at a route
    // this fixture actually has — hard-coding one survives exactly until the fixture changes.
    const first = (await pagesFor(role))[0]?.route ?? '/';
    const shell = await readFile(fileURLToPath(new URL('index.html', HERE)), 'utf8');
    return html(shell.replace('<!--APPLINK-->', `${first}?role=${encodeURIComponent(role)}`));
  }
  if (pathname === '/alive') return html(await readFile(fileURLToPath(new URL('alive.html', HERE)), 'utf8'));
  if (!extname(pathname)) return html(await appPage(pathname, role, lang));

  res.writeHead(404).end('Not found');
});

// A bench left running in another terminal holds the port. Crashing with EADDRINUSE and a stack trace
// read as "the preview is broken" (2026-09-23); the next free port is what anyone would do by hand.
// A port asked for explicitly (PORT=…) is not second-guessed.
const FIXED = Boolean(process.env.PORT);
const TRIES = 20;

function listen(port, attempt = 0) {
  server.once('error', (error) => {
    if (error.code === 'EADDRINUSE' && !FIXED && attempt < TRIES) {
      if (attempt === 0) console.log(`\n  Port ${port} is in use — probably a bench left running in another terminal. Trying the next one.`);
      listen(port + 1, attempt + 1);
      return;
    }
    console.error(
      error.code === 'EADDRINUSE'
        ? `\n  Port ${port} is in use. Stop whatever holds it, or pick another: PORT=5000 pnpm preview\n`
        : `\n  The bench could not start: ${error.message}\n`,
    );
    process.exit(1);
  });
  server.listen(port, HOST);
}

// One listener, reading the port actually bound: a callback per attempt would announce the busy one too.
server.once('listening', async () => {
  server.removeAllListeners('error');
  const { port } = server.address();
  const pages = await pagesFor(roles[0]);
  console.log(`\n  ${APP} — ${roles.length} role(s): ${roles.join(', ')}`);
  console.log(`\n  Bench (ask, and see why): http://${HOST}:${port}/bench`);
  console.log(`  The app, as a visitor:    http://${HOST}:${port}${pages[0]?.route ?? '/'}`);
  console.log(`  … with its own assistant: http://${HOST}:${port}${pages[0]?.route ?? '/'}?companion&open`);
  console.log(`  Host-page variants:       http://${HOST}:${port}/hosts`);
  console.log(`  The orb, alive:           http://${HOST}:${port}/alive`);
  console.log(`\n  Every role's bundle is served here. Production must serve one (Rule 17).\n`);
});

listen(PORT);
