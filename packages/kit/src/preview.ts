import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, resolve } from 'node:path';

import { BUNDLE_DIR, REVIEW_DIR } from './paths.ts';

/**
 * `nextgen preview`: try the assistant on your own app before wiring anything in
 * (readiness item 5).
 *
 * A local page that loads the built bundle the way a production page does — the
 * one-line script tag, under a strict Content-Security-Policy — for any role, with the
 * app's own example questions one click away. When the assistant would move the browser,
 * the page says where instead, and links into the running app if you give it one. So a
 * field test can judge the answers first, and the integration separately.
 *
 * Local only: it binds to 127.0.0.1 and serves every role's files so you can switch
 * between them, which is exactly what production must never do (Rule 17). The page says so.
 */

const POLICY = "default-src 'self'; script-src 'self'; style-src 'self'; object-src 'none'; base-uri 'none'";
const TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

export interface PreviewOptions {
  /** Default 4321. `0` picks a free port. */
  readonly port?: number;
  /** Default 127.0.0.1. */
  readonly host?: string;
  /** The running app, e.g. http://localhost:3000, to link each destination into. */
  readonly appUrl?: string;
}

export interface Preview {
  readonly url: string;
  readonly roles: readonly string[];
  close(): Promise<void>;
}

const escapeHtml = (text: string): string => text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function page(roles: readonly string[], role: string, appUrl: string | null): string {
  const links = roles
    .map((r) => `<li><a href="/?role=${encodeURIComponent(r)}"${r === role ? ' aria-current="page"' : ''}>${escapeHtml(r)}</a></li>`)
    .join('');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>NextGen preview — ${escapeHtml(role)}</title>
<link rel="stylesheet" href="/preview.css">
<script src="/preview.js" defer></script>
</head>
<body${appUrl ? ` data-app-url="${escapeHtml(appUrl)}"` : ''}>
<header>
<h1>What a <strong>${escapeHtml(role)}</strong> user can ask</h1>
<p class="warning">Local preview. Every role's files are served here so you can switch between them.
In production, serve each signed-in user only their own role's files (Rule 17).</p>
<nav aria-label="Roles"><ul>${links}</ul></nav>
</header>
<main>
<section aria-labelledby="try">
<h2 id="try">Try the app's own examples</h2>
<p>Or type a question in your users' words in the box.</p>
<ul id="examples"></ul>
</section>
<section aria-labelledby="where">
<h2 id="where">Where it would take you</h2>
<p id="moves" aria-live="polite">Ask something first.</p>
</section>
<div id="assistant"></div>
</main>
<script src="/nextgen/nextgen.js" data-nextgen-role="${escapeHtml(role)}" data-nextgen-target="#assistant" defer></script>
</body>
</html>
`;
}

// External, not inline: the page runs under the same strict policy a careful site would.
const SCRIPT = `(function () {
  var appUrl = document.body.getAttribute('data-app-url');
  var tag = document.querySelector('script[data-nextgen-role]');
  var role = tag ? tag.getAttribute('data-nextgen-role') : '';

  window.addEventListener('nextgen:navigate', function (event) {
    event.preventDefault();
    var route = event.detail ? event.detail.route : '';
    var moves = document.getElementById('moves');
    moves.textContent = 'It would take you to ' + route + '. ';
    if (appUrl) {
      var base = appUrl.charAt(appUrl.length - 1) === '/' ? appUrl.slice(0, -1) : appUrl;
      var link = document.createElement('a');
      link.href = base + route;
      link.textContent = 'Open it in your app';
      link.target = '_blank';
      link.rel = 'noopener';
      moves.appendChild(link);
    }
  });

  function ask(question) {
    var host = document.querySelector('[data-nextgen]');
    if (!host || !host.shadowRoot) return;
    host.shadowRoot.querySelector('input').value = question;
    host.shadowRoot.querySelector('form').requestSubmit();
  }

  fetch('/nextgen/registry.' + encodeURIComponent(role) + '.json')
    .then(function (response) { return response.json(); })
    .then(function (registry) {
      var list = document.getElementById('examples');
      (registry.capabilities || [])
        .filter(function (c) { return c.kind !== 'unsupported' && c.examples && c.examples.length; })
        .forEach(function (c) {
          var item = document.createElement('li');
          var button = document.createElement('button');
          button.type = 'button';
          button.textContent = c.examples[0];
          button.addEventListener('click', function () { ask(c.examples[0]); });
          var target = document.createElement('small');
          target.textContent = ' should reach ' + c.title + ' (' + c.route + ')';
          item.appendChild(button);
          item.appendChild(target);
          list.appendChild(item);
        });
    });
})();
`;

const STYLE = `body { font: 16px/1.5 system-ui, sans-serif; margin: 0 auto; max-width: 60rem; padding: 1rem 1.5rem 8rem; color: CanvasText; background: Canvas; }
.warning { border-left: 4px solid Highlight; padding-left: 0.75rem; }
nav ul, #examples { list-style: none; padding: 0; display: flex; flex-wrap: wrap; gap: 0.5rem; }
#examples { flex-direction: column; }
#examples button { min-height: 44px; text-align: left; }
a[aria-current] { font-weight: 700; }
`;

/** Serve a built kit folder for local trying-out. Resolves once it is listening. */
export async function preview(kitDir: string, options: PreviewOptions = {}): Promise<Preview> {
  const kit = resolve(kitDir);
  const bundle = join(kit, BUNDLE_DIR);
  const recordFile = join(kit, REVIEW_DIR, 'build.json');
  if (!existsSync(recordFile) || !existsSync(join(bundle, 'nextgen.js'))) {
    throw new Error(`Nothing to preview in ${kit}. Run "nextgen build" first.`);
  }
  const roles = (JSON.parse(readFileSync(recordFile, 'utf8')) as { roles: string[] }).roles;
  if (roles.length === 0) throw new Error(`The build in ${kit} has no roles to preview.`);

  let appUrl: string | null = null;
  if (options.appUrl) {
    const parsed = new URL(options.appUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error(`--app-url must be an http(s) URL, not ${options.appUrl}`);
    appUrl = parsed.toString();
  }

  const server = createServer((request, response) => {
    // A base only for parsing the path. Loopback, not an invented host name: Rule 8's gate
    // rejects any remote host written into runtime code, and it was right to reject this one.
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    const send = (status: number, body: string | Buffer, type: string): void => {
      response.writeHead(status, {
        'Content-Type': type,
        'Content-Security-Policy': POLICY,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      });
      response.end(body);
    };

    if (url.pathname === '/') {
      const asked = url.searchParams.get('role');
      // An allowlist: a role that is not one this build has is never written into the page.
      const role = asked !== null && roles.includes(asked) ? asked : roles[0]!;
      send(200, page(roles, role, appUrl), TYPES['.html']!);
      return;
    }
    if (url.pathname === '/preview.js') return send(200, SCRIPT, TYPES['.js']!);
    if (url.pathname === '/preview.css') return send(200, STYLE, TYPES['.css']!);
    if (url.pathname.startsWith('/nextgen/')) {
      const name = decodeURIComponent(url.pathname.slice('/nextgen/'.length));
      // One file name from bundle/, nothing with a separator or a leading dot.
      if (!/^[\w][\w.-]*$/.test(name) || !existsSync(join(bundle, name))) return send(404, 'Not found', 'text/plain');
      send(200, readFileSync(join(bundle, name)), TYPES[extname(name)] ?? 'application/octet-stream');
      return;
    }
    send(404, 'Not found', 'text/plain');
  });

  const host = options.host ?? '127.0.0.1';
  await new Promise<void>((ready, fail) => {
    server.once('error', fail);
    server.listen(options.port ?? 4321, host, () => ready());
  });
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : (options.port ?? 4321);

  return {
    url: `http://${host}:${port}/`,
    roles,
    close: () => new Promise<void>((done) => server.close(() => done())),
  };
}
