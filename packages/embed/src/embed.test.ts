import { beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import vm from 'node:vm';

/**
 * WP-29 — Ladder C3, tested as the artefact it is: one file, loaded the way a
 * `<script src>` loads it.
 *
 * The built `dist/nextgen.js` is run in a fresh V8 context holding nothing but
 * `window` and `console` — no `require`, no `import`, no `fetch`, no `process`.
 * If the bundle reached for any of them, it would throw here, which is the test.
 * Then it routes real turns from the generator's own output.
 */

const ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const DIST = fileURLToPath(new URL('../dist/nextgen.js', import.meta.url));
const GEN = `${ROOT}/eval/frameworks/family/generated`;

let code = '';

beforeAll(() => {
  execFileSync(process.execPath, [fileURLToPath(new URL('../build.mjs', import.meta.url))], { stdio: 'pipe' });
  code = readFileSync(DIST, 'utf8');
}, 120_000);

function loadLikeAScriptTag(): Record<string, unknown> {
  const window: Record<string, unknown> = {};
  // What a page actually provides: `window`/`self`, `console`, and `performance`
  // (a web standard every browser has — the router times its stages with it).
  // Deliberately absent: `process`, `require`, `fetch` — the Node-isms and the
  // network. The first version of this sandbox also lacked `performance`, and the
  // failure it produced was the harness's, not the bundle's.
  const context = vm.createContext({ window, self: window, console, performance });
  vm.runInContext(`${code}\nwindow.NextGen = NextGen;`, context);
  return window;
}

const bundle = (role: string) => ({
  registry: JSON.parse(readFileSync(`${GEN}/registry.${role}.json`, 'utf8')),
  index: JSON.parse(readFileSync(`${GEN}/index.${role}.json`, 'utf8')),
  thresholds: JSON.parse(readFileSync(`${GEN}/thresholds.hashing.json`, 'utf8')).thresholds,
});

describe('the script-tag artefact (WP-29)', () => {
  it('defines window.NextGen with no module system and nothing else in scope', () => {
    const window = loadLikeAScriptTag();
    const api = window.NextGen as Record<string, unknown>;
    expect(typeof api.create).toBe('function');
    expect(typeof api.load).toBe('function');
    // WP-41: the chat box ships in the same file, and still loads without a DOM.
    expect(typeof api.start).toBe('function');
    expect(typeof api.mount).toBe('function');
    expect(typeof api.mountAssistant).toBe('function');
    expect(typeof api.present).toBe('function');
  });

  it('routes a real turn with no network, no fetch even defined', async () => {
    const { NextGen } = loadLikeAScriptTag() as { NextGen: { create: (b: unknown) => { route: (u: string) => Promise<{ outcome: string; decidedAt: string }>; capabilities: number } } };
    const assistant = NextGen.create(bundle('PARENT'));
    // A real bundle, not an empty one: the point of the assertion is that the script tag
    // loaded a whole role's registry, not its exact size. It was `> 10` while this read a
    // 145-capability pilot registry; the fixture PARENT ships 10, and pinning the number
    // to whatever the current fixture happens to emit would make it a maintenance tax
    // rather than a check.
    expect(assistant.capabilities).toBeGreaterThan(5);
    const trace = await assistant.route('onde vejo as lesões do meu filho');
    // Whatever it decides, it decides without a model — there is no stage-3
    // transport in a script tag, so the only legal outcomes are stages 1 and 2's.
    expect(['execute', 'clarify', 'out_of_scope']).toContain(trace.outcome);
    expect(trace.decidedAt).not.toBe('llm');
  });

  it('makes the same decision the server path makes', async () => {
    const { NextGen } = loadLikeAScriptTag() as { NextGen: { create: (b: unknown) => { route: (u: string) => Promise<{ outcome: string; capabilityId: string | null }> } } };
    const assistant = NextGen.create(bundle('COACH'));
    const { registryFromIndex, makeEmbedder, route } = await import('@nextgen/core-intent/browser');
    const b = bundle('COACH');
    const registry = registryFromIndex(b.registry, b.index);
    const embedder = makeEmbedder('hashing');
    embedder.fit?.(registry.documents);
    for (const u of ['Como ver o resumo geral do plantel', 'What is the training calendar?', 'reserva-me um voo']) {
      const viaScript = await assistant.route(u);
      const direct = await route(u, { route: '/', today: new Date().toISOString().slice(0, 10) }, {
        registry, embedder, thresholds: b.thresholds, useStage3: false,
      });
      expect([viaScript.outcome, viaScript.capabilityId]).toEqual([direct.outcome, direct.capabilityId]);
    }
  });

  it('is small enough to be a script tag', () => {
    const gz = gzipSync(Buffer.from(code)).length;
    // The router is pure arithmetic over shipped vectors, so this should be a
    // few tens of KB. The index is fetched separately and measured in WP-24.
    expect(gz).toBeLessThan(60 * 1024);
  });
});

/**
 * ADR-029: the widget writes markup into someone else's page. The one place it may is `glyph()`, and
 * only a compiled-in `ICON_` constant reaches it. Anything a registry, a page or a visitor supplies
 * is `textContent`. A new HTML sink, or an icon argument that is not a constant, fails here.
 */
describe('what reaches markup', () => {
  const SRC = fileURLToPath(new URL('.', import.meta.url));
  const sources = readdirSync(SRC)
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts') && !f.endsWith('.check.ts'))
    .map((f) => ({ file: f, text: readFileSync(join(SRC, f), 'utf8') }));

  it('has one HTML sink, and it is the icon glyph', () => {
    const sinks = sources.flatMap(({ file, text }) =>
      [...text.matchAll(/\.(?:innerHTML|outerHTML)\s*=|insertAdjacentHTML|document\.write|\beval\(|new Function\(/g)].map(
        (m) => `${file}: ${text.slice(m.index, text.indexOf('\n', m.index)).trim()}`,
      ),
    );
    expect(sinks).toEqual(['assistant.ts: .innerHTML = icon;']);
  });

  it('hands the glyph only compiled-in icons', () => {
    const assistant = sources.find((s) => s.file === 'assistant.ts')!.text;
    const icons = [...assistant.matchAll(/\b(?:glyph|iconButton)\(([^()]*(?:\([^()]*\)[^()]*)*)\)/g)].map((m) => m[1]!.split(',').at(-1)!.trim());
    expect(icons.length).toBeGreaterThan(5);
    for (const icon of icons) expect(icon, icon).toMatch(/^(?:ICON_[A-Z_]+|icon)$/);
  });
});
