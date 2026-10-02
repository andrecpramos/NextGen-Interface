// Does the bench actually route, in a real browser?
//
//   node preview/check-bench.mjs
//
// A page that renders is not a page that works. This starts the bench on a free port,
// loads it in headless Chrome or Edge with `?ask=`, and reads the JSON the page publishes
// on <body data-bench>. Same mechanism as `tooling/scripts/check-csp.mjs`, for the same
// reason: the only honest place to check browser code is a browser.
//
// It asserts the decision, not the pixels — that a known in-scope question reaches its
// screen and a known out-of-scope one is refused, through the bundle the bench serves.
//
// Skips with a message when no browser is installed, and fails under CI, where one is.

import { execFile, spawn } from 'node:child_process';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CI = !!process.env.CI;

function findBrowser() {
  const env = process.env;
  const candidates =
    process.platform === 'win32'
      ? [
          `${env.ProgramFiles}\\Google\\Chrome\\Application\\chrome.exe`,
          `${env['ProgramFiles(x86)']}\\Google\\Chrome\\Application\\chrome.exe`,
          `${env['ProgramFiles(x86)']}\\Microsoft\\Edge\\Application\\msedge.exe`,
          `${env.ProgramFiles}\\Microsoft\\Edge\\Application\\msedge.exe`,
        ]
      : [
          '/usr/bin/google-chrome',
          '/usr/bin/google-chrome-stable',
          '/usr/bin/chromium',
          '/usr/bin/chromium-browser',
          '/usr/bin/microsoft-edge',
        ];
  return candidates.find((p) => p && existsSync(p)) ?? null;
}

const browser = findBrowser();
if (!browser) {
  const line = '  No Chrome or Edge found — the bench cannot be checked in a real browser.';
  if (CI) {
    console.error(`${line}\n  CI has one, so this is a failure rather than a skip.\n`);
    process.exit(1);
  }
  console.log(`${line}\n  Skipping locally.\n`);
  process.exit(0);
}

// Two turns with known answers in the reference fixture: one that must reach a screen,
// one that must be refused. Both come from the committed golden set.
const CASES = [
  { role: 'PARENT', ask: 'quero ver o estado médico do meu filho', route: '/my/children/medical' },
  { role: 'PARENT', ask: 'marca uma consulta de fisioterapia para o meu filho', outcome: 'out_of_scope' },
];

const port = 4100 + Math.floor(Math.random() * 400);
const server = spawn(process.execPath, ['preview/serve.mjs'], {
  env: { ...process.env, PORT: String(port) },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let banner = '';
server.stdout.on('data', (d) => (banner += d));
server.stderr.on('data', (d) => (banner += d));

const ready = await new Promise((resolve) => {
  const timer = setTimeout(() => resolve(false), 15_000);
  const poll = setInterval(async () => {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/bench`);
      if (response.ok) {
        clearInterval(poll);
        clearTimeout(timer);
        resolve(true);
      }
    } catch {
      /* not up yet */
    }
  }, 200);
});

if (!ready) {
  server.kill();
  console.error(`\n  The bench did not start on ${port}.\n${banner}\n`);
  process.exit(1);
}

const profile = mkdtempSync(join(tmpdir(), 'bench-profile-'));
const failures = [];

for (const testCase of CASES) {
  const url = `http://127.0.0.1:${port}/bench?role=${testCase.role}&ask=${encodeURIComponent(testCase.ask)}`;
  const dom = await new Promise((resolve) => {
    execFile(
      browser,
      [
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
      ],
      { timeout: 120_000, maxBuffer: 16 * 1024 * 1024 },
      (error, stdout) => resolve(String(stdout)),
    );
  });

  const match = /data-bench="([^"]*)"/.exec(dom);
  const report = match
    ? JSON.parse(
        match[1]
          .replace(/&quot;/g, '"')
          .replace(/&#39;/g, "'")
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&amp;/g, '&'),
      )
    : null;

  const say = (ok, line) => {
    console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${line}`);
    if (!ok) failures.push(line);
  };

  console.log(`\n  ${testCase.role} · "${testCase.ask}"`);
  if (!report) {
    say(false, 'the page published no report — it did not finish loading the bundle');
    continue;
  }
  say(report.ready === true, `the bundle loaded (${report.capabilities ?? 0} capabilities)`);
  if (testCase.route) say(report.route === testCase.route, `reached ${testCase.route} (got ${report.route ?? 'nowhere'})`);
  if (testCase.outcome) say(report.outcome === testCase.outcome, `outcome ${testCase.outcome} (got ${report.outcome ?? 'none'})`);
}

server.kill();

console.log('');
if (failures.length > 0) {
  console.error(`  Bench FAILED — ${failures.length} check(s).\n`);
  process.exit(1);
}
console.log(`  Bench OK — it routes in a real browser (${browser}).\n`);
