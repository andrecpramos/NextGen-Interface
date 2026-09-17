#!/usr/bin/env node
// The widget under a strict Content-Security-Policy, in a real browser.
//
// A policy without 'unsafe-inline' is what security-conscious sites run, and it is
// invisible to every other check here: jsdom and the widget tests' fake DOM enforce
// no policy at all. Measured in Edge 153 on 2026-09-13, before this gate existed:
//   - the widget's <style> element was blocked (style-src-elem), so it rendered
//     unstyled;
//   - the `<script>NextGen.start(...)</script>` that `doctor` told adopters to paste
//     was blocked (script-src-elem), so the widget never started at all.
//
// WHAT IT DOES
//   Builds packages/embed, then serves dist/nextgen.js and one role's generated
//   bundle from a local server that sends
//     default-src 'self'; script-src 'self'; style-src 'self'; object-src 'none'; base-uri 'none'
//   and loads, in headless Chrome or Edge, a page whose only integration is the
//   documented one-liner:
//     <script src="/nextgen/nextgen.js" data-nextgen-role="PARENT" defer></script>
//   A probe script (external, so the policy allows it) asks a question through the
//   widget's own form and clicks the first choice. The gate fails on:
//     - any Content-Security-Policy violation
//     - the widget not starting, or the role's files not fetched from the script's folder
//     - the widget unstyled (its input's computed min-height is not 48px)
//     - no answer rendered
//     - a choice clicked without `nextgen:navigate` reaching the page
//
// Browser: $NEXTGEN_BROWSER, else Chrome, Chromium or Edge from the usual places.
// With none it skips, loudly, on a developer machine — and FAILS under CI, where a
// skip would be a gate that protects nothing.
//
//   node tooling/scripts/check-csp.mjs

import { execFile, execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const GEN = join(ROOT, 'eval', 'frameworks', 'family', 'generated');
const ROLE = 'PARENT';
const POLICY = "default-src 'self'; script-src 'self'; style-src 'self'; object-src 'none'; base-uri 'none'";

function findBrowser() {
  if (process.env.NEXTGEN_BROWSER) return process.env.NEXTGEN_BROWSER;
  const env = process.env;
  const candidates =
    process.platform === 'win32'
      ? [
          `${env.ProgramFiles}\\Google\\Chrome\\Application\\chrome.exe`,
          `${env['ProgramFiles(x86)']}\\Google\\Chrome\\Application\\chrome.exe`,
          `${env['ProgramFiles(x86)']}\\Microsoft\\Edge\\Application\\msedge.exe`,
          `${env.ProgramFiles}\\Microsoft\\Edge\\Application\\msedge.exe`,
        ]
      : process.platform === 'darwin'
        ? [
            '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
            '/Applications/Chromium.app/Contents/MacOS/Chromium',
            '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
          ]
        : ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge'];
  return candidates.find((path) => path && existsSync(path)) ?? null;
}

const browser = findBrowser();
if (!browser) {
  if (process.env.CI) {
    console.error('\n  CSP check FAILED — no Chrome, Chromium or Edge found. Set NEXTGEN_BROWSER. Under CI a skip protects nothing.\n');
    process.exit(1);
  }
  console.log('\n  CSP check SKIPPED — no Chrome, Chromium or Edge found on this machine. Set NEXTGEN_BROWSER to run it.\n');
  process.exit(0);
}

// The artefact under test has to be current.
execFileSync(process.execPath, [join(ROOT, 'packages', 'embed', 'build.mjs')], { stdio: 'pipe' });

const site = mkdtempSync(join(tmpdir(), 'nextgen-csp-'));
mkdirSync(join(site, 'nextgen'));
copyFileSync(join(ROOT, 'packages', 'embed', 'dist', 'nextgen.js'), join(site, 'nextgen', 'nextgen.js'));
for (const file of [`registry.${ROLE}.json`, `index.${ROLE}.json`, 'thresholds.hashing.json']) {
  copyFileSync(join(GEN, file), join(site, 'nextgen', file));
}

writeFileSync(
  join(site, 'index.html'),
  `<!doctype html>
<html lang="pt-PT">
<head><meta charset="utf-8"><title>Clube — área do encarregado</title><script src="/probe.js"></script></head>
<body>
<main><h1>Área do encarregado</h1><p>Uma página do clube.</p></main>
<script src="/nextgen/nextgen.js" data-nextgen-role="${ROLE}" defer></script>
</body>
</html>
`,
);

// Plain ES5 on purpose, and no inline anything: it runs under the same policy.
writeFileSync(
  join(site, 'probe.js'),
  `(function () {
  var report = { violations: [], warnings: [], errors: [], mounted: false, minHeight: null, tone: null, choices: 0, navigated: null };
  document.addEventListener('securitypolicyviolation', function (e) {
    report.violations.push(e.effectiveDirective + (e.blockedURI ? ' ' + e.blockedURI : ''));
  });
  window.addEventListener('error', function (e) { report.errors.push(String(e.message)); });
  window.addEventListener('unhandledrejection', function (e) { report.errors.push('unhandled rejection: ' + String(e.reason)); });
  window.addEventListener('nextgen:navigate', function (e) {
    e.preventDefault();
    report.navigated = e.detail ? e.detail.route : '(no detail)';
  });
  var warn = console.warn;
  console.warn = function () { report.warnings.push(Array.prototype.join.call(arguments, ' ')); warn.apply(console, arguments); };

  function finish() { document.documentElement.setAttribute('data-report', JSON.stringify(report)); }
  var spent = 0;
  function waitFor(ready, then) {
    if (ready()) { then(); return; }
    spent += 50;
    if (spent > 10000) { finish(); return; }
    setTimeout(function () { waitFor(ready, then); }, 50);
  }

  waitFor(function () { var h = document.querySelector('[data-nextgen]'); return h && h.shadowRoot; }, function () {
    var root = document.querySelector('[data-nextgen]').shadowRoot;
    report.mounted = true;
    var input = root.querySelector('input');
    report.minHeight = getComputedStyle(input).minHeight;
    input.value = 'onde vejo como o meu filho está a evoluir';
    root.querySelector('form').requestSubmit();
    // .answer is the assistant layer (what the one-liner mounts), .result the chat box.
    waitFor(function () { var r = root.querySelector('.answer, .result'); return r && r.hasAttribute('data-tone'); }, function () {
      var result = root.querySelector('.answer, .result');
      report.tone = result.getAttribute('data-tone');
      var links = result.querySelectorAll('a');
      report.choices = links.length;
      if (links.length > 0) links[0].click();
      // The assistant flies the orb to the edge before it moves, so wait for the move itself.
      if (links.length > 0 || report.tone === 'go') waitFor(function () { return report.navigated !== null; }, finish);
      else setTimeout(finish, 200);
    });
  });
})();
`,
);

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json' };
const served = [];
const server = createServer((request, response) => {
  const path = request.url === '/' ? '/index.html' : decodeURIComponent(new URL(request.url, 'http://x').pathname);
  const file = normalize(join(site, path));
  if (!file.startsWith(site) || !existsSync(file)) {
    response.writeHead(404, { 'Content-Security-Policy': POLICY });
    response.end();
    return;
  }
  served.push(path);
  response.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream', 'Content-Security-Policy': POLICY });
  response.end(readFileSync(file));
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}/`;

const profile = join(site, 'browser-profile');
const flags = [
  '--headless=new',
  '--disable-gpu',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-dev-shm-usage',
  `--user-data-dir=${profile}`,
  '--virtual-time-budget=15000',
  ...(typeof process.getuid === 'function' && process.getuid() === 0 ? ['--no-sandbox'] : []),
  '--dump-dom',
  url,
];

const dom = await new Promise((resolve) => {
  execFile(browser, flags, { timeout: 120_000, maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
    resolve({ error, stdout: String(stdout), stderr: String(stderr) });
  });
});
server.close();

const match = /data-report="([^"]*)"/.exec(dom.stdout);
const report = match
  ? JSON.parse(match[1].replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'))
  : null;

console.log(`\n  CSP check — ${browser}`);
console.log(`  policy: ${POLICY}\n`);

const failures = [];
const check = (ok, line) => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${line}`);
  if (!ok) failures.push(line);
};

if (!report) {
  check(false, `the page produced no report${dom.error ? ` (${dom.error.message})` : ''}`);
  console.error(dom.stderr.split('\n').slice(-10).join('\n'));
} else {
  check(report.violations.length === 0, `no policy violations${report.violations.length ? `: ${report.violations.join('; ')}` : ''}`);
  const fetched = [`/nextgen/registry.${ROLE}.json`, `/nextgen/index.${ROLE}.json`, '/nextgen/thresholds.hashing.json'].filter((f) => served.includes(f));
  check(fetched.length === 3, `the role's three files were fetched from the script's own folder (${fetched.length}/3)`);
  check(report.mounted, 'the widget started from data-nextgen-role alone, with no inline script');
  check(report.minHeight === '48px', `the widget is styled (input min-height ${report.minHeight ?? 'unknown'}, expected 48px)`);
  check(Boolean(report.tone), `a question was answered (${report.tone ?? 'no answer'}, ${report.choices} choice(s))`);
  if (report.choices > 0 || report.tone === 'go') {
    check(Boolean(report.navigated), `nextgen:navigate reached the page and it took the move (${report.navigated ?? 'no event'})`);
  }
  check(report.errors.length === 0, `no page errors${report.errors.length ? `: ${report.errors.join('; ')}` : ''}`);
  check(report.warnings.length === 0, `no warnings from the widget${report.warnings.length ? `: ${report.warnings.join('; ')}` : ''}`);
}

rmSync(site, { recursive: true, force: true });

if (failures.length > 0) {
  console.error(`\n  CSP check FAILED — ${failures.length} problem(s).\n`);
  process.exit(1);
}
console.log('\n  CSP OK — the documented one-liner starts, styles and routes under a strict policy, with no violations.\n');
