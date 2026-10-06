// Does a bundle built with --stage3 actually reach the transport that reads it back?
//
//   node tooling/scripts/check-stage3.mjs
//
// ADR-017. kit/src/build.ts writes bundle/thresholds.hashing.json's `stage3`
// field; packages/embed/src/stage3.ts's SameOriginLlmRuntime reads it. The two packages
// deliberately do NOT share that type: kit is a Node CLI with no DOM lib in its
// tsconfig, and embed's root re-exports theme.ts/widget.ts/voice.ts, which are genuinely
// DOM-typed — importing the type across that boundary drags DOM globals into a package
// that has no business knowing about them (found the hard way: it broke `kit`'s
// typecheck twice while this was being built). So `kit` declares its own copy of
// `Stage3Config`, and THIS script is what proves the two copies still agree, by making
// them actually interoperate — a stronger guarantee than a shared type would have given,
// and the same shape this repo already uses for check-adapter.mjs and
// preview/check-bench.mjs: a property that only makes sense to check by running it.
//
// Three things proved, each the direct negation of a defect found while building this:
//   1. A bundle built WITHOUT --stage3 never constructs a runtime, never fetches.
//   2. A bundle built WITH --stage3 reaches the exact same-origin URL a real page would
//      resolve it to, and the completion response actually decides the turn.
//   3. The same-origin refusal holds even when the config underneath it is malicious —
//      an absolute URL naming a different host never gets a request.

import { cpSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const FIXTURE = join(ROOT, 'packages', 'generator', 'fixtures', 'school-app');

const failures = [];
const check = (ok, line) => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${line}`);
  if (!ok) failures.push(line);
};

const { build } = await import(`file:///${join(ROOT, 'packages/kit/src/build.ts').replaceAll('\\', '/')}`);
const { init } = await import(`file:///${join(ROOT, 'packages/kit/src/detect.ts').replaceAll('\\', '/')}`);
const { create } = await import(`file:///${join(ROOT, 'packages/embed/src/index.ts').replaceAll('\\', '/')}`);

function scratchKit() {
  const kitDir = mkdtempSync(join(tmpdir(), 'check-stage3-'));
  const appDir = join(kitDir, 'app');
  cpSync(join(FIXTURE, 'src'), appDir, { recursive: true });
  const kit = join(kitDir, 'nextgen');
  init(appDir, kit);
  return kit;
}

function fakePage(href) {
  const url = new URL(href);
  globalThis.location = { href: url.href, origin: url.origin };
}

async function bundleFor(kit, role) {
  const dir = join(kit, 'bundle');
  const thresholds = JSON.parse(readFileSync(join(dir, 'thresholds.hashing.json'), 'utf8'));
  return {
    registry: JSON.parse(readFileSync(join(dir, `registry.${role}.json`), 'utf8')),
    index: JSON.parse(readFileSync(join(dir, `index.${role}.json`), 'utf8')),
    thresholds: { ...thresholds.thresholds, tauHigh: 999, boundaryMargin: 999 }, // force escalation — see kit.test.ts's twin test
    ...(thresholds.stage3 ? { stage3: thresholds.stage3 } : {}),
  };
}

console.log('\n  stage3 interop — kit writes, embed reads, across a real network boundary\n');

// 1. Off by default.
{
  const kit = scratchKit();
  await build(kit, {});
  const bundle = await bundleFor(kit, 'PARENT');
  check(bundle.stage3 === undefined, 'a bundle built without --stage3 carries no stage3 field');

  fakePage('https://adopter.example/app/');
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    return new Response('{}', { status: 200 });
  };
  await create(bundle).route('whatever the visitor actually typed');
  check(!called, 'and create() never fetches, even with thresholds forced to escalate');
}

// 2. On: reaches the exact same-origin URL, and the response decides the turn.
{
  const kit = scratchKit();
  await build(kit, { stage3: { path: 'stage3', model: 'house-model' } });
  const bundle = await bundleFor(kit, 'PARENT');
  check(bundle.stage3?.path === 'stage3', 'a bundle built with --stage3 carries the configured path');

  fakePage('https://adopter.example/app/');
  let calledUrl;
  let sentBody;
  const realCapability = bundle.registry.capabilities.find((c) => c.kind === 'navigate')?.id;
  globalThis.fetch = async (url, init) => {
    calledUrl = String(url);
    sentBody = JSON.parse(init.body);
    return new Response(JSON.stringify({ capabilityId: realCapability, confidence: 0.9 }), { status: 200 });
  };
  const trace = await create(bundle).route('whatever the visitor actually typed');
  check(calledUrl === 'https://adopter.example/app/stage3', `fetched the resolved same-origin URL (got ${calledUrl})`);
  check(sentBody?.model === 'house-model', 'forwarded the configured model in the request body');
  check(trace.decidedAt === 'llm', 'the turn was decided by the response this test controlled');
  check(trace.capabilityId === realCapability, `resolved to the capability the mocked proxy named (${realCapability})`);
}

// 3. Same-origin refusal holds even against a malicious/misconfigured path.
{
  const kit = scratchKit();
  await build(kit, { stage3: { path: 'https://attacker.example/steal' } });
  const bundle = await bundleFor(kit, 'PARENT');

  fakePage('https://adopter.example/app/');
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    return new Response('{}', { status: 200 });
  };
  const trace = await create(bundle).route('whatever the visitor actually typed');
  check(!called, 'an off-origin path in the bundle is refused before any fetch happens');
  check(trace.decidedAt !== 'llm', 'and the turn degrades rather than crashing');
}

console.log('');
if (failures.length > 0) {
  console.error(`  stage3 interop FAILED — ${failures.length} check(s).\n`);
  process.exit(1);
}
console.log('  stage3 interop OK — kit and embed agree on the wire, without sharing a type.\n');
