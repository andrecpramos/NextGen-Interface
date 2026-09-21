import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { build } from './build.ts';
import { detectApp, init } from './detect.ts';
import { calibrate } from './calibrate.ts';
import { adapterVersion, doctor } from './doctor.ts';

/**
 * WP-41: the kit, run the way an adopter runs it, on apps it was not written for.
 *
 * Two fixtures in two different shapes: a route array with a role table and
 * translations (tiny-app), and a data router with a paths table and no roles
 * (data-router-app). Neither knows the kit exists.
 */

const FIXTURES = fileURLToPath(new URL('../../generator/fixtures/', import.meta.url));
const TINY = join(FIXTURES, 'tiny-app');
const DATA_ROUTER = join(FIXTURES, 'data-router-app');
const CLI_COPIED = fileURLToPath(new URL('./cli-copied.ts', import.meta.url));

const kitFolder = (): string => join(mkdtempSync(join(tmpdir(), 'nextgen-kit-')), 'nextgen');

/** Names, sizes and contents, recursively: the same assertion as `git status`, without git. */
function fingerprint(directory: string): string {
  const hash = createHash('sha256');
  const walk = (current: string): void => {
    for (const entry of readdirSync(current).sort()) {
      const path = join(current, entry);
      if (statSync(path).isDirectory()) walk(path);
      else hash.update(path).update(readFileSync(path));
    }
  };
  walk(directory);
  return hash.digest('hex');
}

describe('init — detection', () => {
  it('finds a route array, its role table and its translations', () => {
    const { config, warnings } = detectApp(TINY);
    expect(config.routesFile).toBe('routes.tsx');
    expect(config.permissionsFile).toBe('lib/permissions.ts');
    expect(config.roleSetExport).toBe('ROUTE_ROLES');
    expect(config.allRolesExport).toBe('APP_ROLES');
    expect(config.localesDir).toBe('i18n/locales');
    expect(config.languages).toEqual(['en']);
    // Only the language is a guess: the fixture has no <html lang>.
    expect(warnings).toHaveLength(1);
  });

  it('picks the router over the paths table that names the same routes', () => {
    const { config, findings } = detectApp(DATA_ROUTER);
    expect(config.routesFile).toBe('app/router.tsx');
    expect(config.permissionsFile).toBeUndefined();
    expect(findings.find((f) => f.what === 'role table')).toMatchObject({ value: null, confident: false });
  });

  it('says which answers were guesses, rather than presenting a guess as found', () => {
    const { findings } = detectApp(DATA_ROUTER);
    expect(findings.find((f) => f.what === 'app language')).toMatchObject({ value: 'en', confident: false });
  });
});

describe('init writes its own two files and no instructions for an agent', () => {
  it('writes the config and the detection record, and nothing else', () => {
    // Until ADR-021 it also wrote AGENT.md, a second copy of adapter/AGENTS.md for the npm
    // path. That copy offered `--model`, which the copied tool refuses. There is one front
    // door now, in the folder the tool came from, and init does not add another beside the
    // adopter's code.
    const kit = kitFolder();
    init(TINY, kit);
    expect(existsSync(join(kit, 'nextgen.config.json'))).toBe(true);
    expect(existsSync(join(kit, 'review', 'detect.json'))).toBe(true);
    expect(existsSync(join(kit, 'AGENT.md'))).toBe(false);
  });
});

describe('build refuses a model rather than ignoring the flag', () => {
  it('names why, and exits non-zero, when --model is passed', async () => {
    // There is no model to reach. A flag silently dropped would give someone who has seen
    // it documented a build that did something other than what they asked for.
    const kit = kitFolder();
    init(TINY, kit);
    const { status, stderr } = spawnSync(
      process.execPath,
      ['--experimental-strip-types', CLI_COPIED, 'build', kit, '--model', 'llama3.1:8b'],
      { encoding: 'utf8' },
    );
    expect(status).toBe(2);
    expect(stderr).toMatch(/cannot use a model/);
    expect(existsSync(join(kit, 'bundle'))).toBe(false);
  }, 60_000);
});

describe('Rule 16 — the kit only writes into its own folder', () => {
  it('refuses a kit folder inside the application source, before writing anything', () => {
    const inside = join(TINY, 'src', 'nextgen');
    expect(() => init(TINY, inside)).toThrow(/Rule 16/);
    expect(existsSync(inside)).toBe(false);
  });

  it('does not overwrite a config the adopter may have corrected', () => {
    const kit = kitFolder();
    init(TINY, kit);
    expect(() => init(TINY, kit)).toThrow(/--force/);
    expect(() => init(TINY, kit, { force: true })).not.toThrow();
  });
});

describe('init → build → doctor, end to end', () => {
  it('builds a served bundle and a review folder, and leaves the app byte-for-byte unchanged', async () => {
    const before = fingerprint(TINY);
    const kit = kitFolder();
    init(TINY, kit);
    const record = await build(kit);
    expect(fingerprint(TINY)).toBe(before);

    expect(record.roles).toEqual(['ADMIN', 'COACH', 'PARENT']);
    const served = readdirSync(join(kit, 'bundle'));
    for (const role of record.roles) {
      expect(served).toContain(`registry.${role}.json`);
      expect(served).toContain(`index.${role}.json`);
    }
    expect(served).toContain('thresholds.hashing.json');
    expect(served).toContain('nextgen.js');

    // Rule 17: the master list, with every role per screen, is never in the served folder.
    expect(served).not.toContain('master.json');
    expect(readdirSync(join(kit, 'review'))).toEqual(expect.arrayContaining(['master.json', 'SKIPPED.md', 'build.json']));
    for (const file of served.filter((f) => f.startsWith('registry.'))) {
      const registry = JSON.parse(readFileSync(join(kit, 'bundle', file), 'utf8')) as { capabilities: object[] };
      expect(registry.capabilities.some((c) => 'roles' in c)).toBe(false);
    }
  }, 60_000);

  it('says plainly that the thresholds are not calibrated for this app', async () => {
    const kit = kitFolder();
    init(TINY, kit);
    await build(kit);
    const thresholds = JSON.parse(readFileSync(join(kit, 'bundle', 'thresholds.hashing.json'), 'utf8'));
    expect(thresholds.calibrated).toBe(false);
    // The script tag reads `.thresholds` — the shape WP-29's load() expects.
    expect(thresholds.thresholds.tauHigh).toBeTypeOf('number');
    // Refusal is the one claim nothing has measured for this app, so a limit must clear a floor of its own
    // until a calibration decides otherwise (Thresholds.boundaryFloor) — and the file says so.
    expect(thresholds.thresholds.boundaryFloor).toBe(0.15);
    expect(thresholds.source).toMatch(/floor/i);
    expect(doctor(kit).text).toMatch(/NOT calibrated/);
    expect(doctor(kit).text).toMatch(/floor of 0\.15/);
    // …and that the first thing to do about it, on a small or thinly described app, is to say what the
    // screens are for: a screen the visitor's words never match cannot win (FIELD-NOTES §5).
    expect(doctor(kit).text).toMatch(/small app[\s\S]*knowledge\.json/);
    // …and it says what a visitor's attachment does: reaches the page as an event, or is switched off.
    expect(doctor(kit).text).toMatch(/nextgen:attach/);
    expect(doctor(kit).text).toMatch(/data-nextgen-attach="off"/);
    expect(doctor(kit).text).toMatch(/never leaves their device/);
  }, 60_000);

  // `adapter/VERSION` is written by tooling/scripts/build-adapter.mjs: an id of the two shipped files, so an
  // adopter can say which build they copied. It changes exactly when scan.mjs or runtime/nextgen.js does.
  it('says which build of the adapter produced this report, when the adapter says', async () => {
    const kit = kitFolder();
    init(TINY, kit);
    await build(kit);
    const adapter = mkdtempSync(join(tmpdir(), 'nextgen-adapter-'));
    writeFileSync(join(adapter, 'VERSION'), 'nextgen-adapter 3240543bfd6a-ab20d96823cd\nIdentifies these two files.\n');
    expect(adapterVersion(adapter)).toBe('nextgen-adapter 3240543bfd6a-ab20d96823cd');
    expect(doctor(kit, adapter).text).toMatch(/nextgen-adapter 3240543bfd6a-ab20d96823cd/);
    // Run from source, or from a copy that lost the file: nothing to say, and nothing broken.
    expect(adapterVersion(join(adapter, 'missing'))).toBeNull();
    expect(doctor(kit, join(adapter, 'missing')).text).not.toMatch(/nextgen-adapter/);
  }, 60_000);

  it('explains every skip in words, with what to do', async () => {
    const kit = kitFolder();
    init(TINY, kit);
    const record = await build(kit);
    const report = doctor(kit);
    expect(report.ok).toBe(true);
    expect(record.skipped.length).toBeGreaterThan(0);
    expect(report.text).toMatch(/What it left out, and why/);
    expect(report.text).toMatch(/What to do:/);
    expect(report.text).toMatch(/CURRENT_USER_ROLE/);
    expect(report.text).not.toMatch(/unresolved-roles|dev-only|declared-legacy/); // no bare reason codes
  }, 60_000);

  it('rebuilds the served folder from nothing, so a vanished role is not still served', async () => {
    const kit = kitFolder();
    init(TINY, kit);
    await build(kit);
    writeFileSync(join(kit, 'bundle', 'registry.GHOST.json'), '{}');
    await build(kit);
    expect(readdirSync(join(kit, 'bundle'))).not.toContain('registry.GHOST.json');
  }, 60_000);

  it('uses a calibration the adopter produced, and says so', async () => {
    const kit = kitFolder();
    init(TINY, kit);
    mkdirSync(join(kit, 'calibration'), { recursive: true });
    const thresholds = { tauHigh: 0.5, delta: 0.01, tauFloor: 0, topK: 5, boundaryMargin: 0.07 };
    writeFileSync(join(kit, 'calibration', 'thresholds.hashing.json'), JSON.stringify({ thresholds }));
    const record = await build(kit);
    expect(record.calibrated).toBe(true);
    expect(doctor(kit).text).toMatch(/Calibrated for this app/);
    // A calibration replaces the whole set: the floor was a stand-in for one, and is gone with it.
    const shipped = JSON.parse(readFileSync(join(kit, 'bundle', 'thresholds.hashing.json'), 'utf8'));
    expect(shipped.thresholds).toEqual(thresholds);
    expect('boundaryFloor' in shipped.thresholds).toBe(false);
  }, 60_000);

  it('treats an app with no role table as one audience, and serves it as PUBLIC', async () => {
    const kit = kitFolder();
    init(DATA_ROUTER, kit);
    const record = await build(kit);
    expect(record.roles).toEqual(['PUBLIC']);
    expect(doctor(kit).text).toMatch(/data-nextgen-role="PUBLIC"/);
  }, 60_000);

  it('counts rules read from the app\'s own controls, and doctor says so (ADR-020, WP-54)', async () => {
    // tiny-app's notifications page declares `required` on its email input —
    // a real constraint, read rather than guessed.
    const kit = kitFolder();
    init(TINY, kit);
    const record = await build(kit);
    expect(record.rules).toBeGreaterThan(0);
    expect(doctor(kit).text).toMatch(/Rules read from validation schemas and control attributes: \d+ \(ADR-020, WP-54\)/);
  }, 60_000);

  it('reports the inferred tier too, and writes review/INFERRED.md whether or not anything shipped (ADR-020, WP-55)', async () => {
    const kit = kitFolder();
    init(TINY, kit);
    const record = await build(kit);
    // tiny-app has no disabled-submit or guard-message shape at all — this is
    // the honest zero, not an untested line.
    expect(record.inferredRules).toBe(0);
    expect(record.reviewInferred).toBe(0);
    expect(doctor(kit).text).toMatch(/Rules inferred from a handler or a disabled control, shipped: 0 \(ADR-020, WP-55\)/);
    expect(existsSync(join(kit, 'review', 'INFERRED.md'))).toBe(true);
  }, 60_000);

  it('rebuilds the script tag when embed\'s source is newer than its compiled dist', async () => {
    // Reproduces the exact failure found running the kit against the pilot app:
    // `dist/nextgen.js` survived a later `embed/src` change untouched because
    // the old check only asked whether a bundle existed, not whether it was
    // current. `doctor` reported a clean build while `NextGen.start` did not
    // exist on the page.
    const embedDir = dirname(createRequire(import.meta.url).resolve('@nextgen/embed/package.json'));
    const distFile = join(embedDir, 'dist', 'nextgen.js');
    const sourceFile = join(embedDir, 'src', 'index.ts');

    const kit = kitFolder();
    init(TINY, kit);
    await build(kit); // ensures dist exists at all

    // Simulate a stale, broken artefact: older than the source, and missing
    // the export a mount depends on.
    writeFileSync(distFile, 'export {};');
    const past = new Date(Date.now() - 60_000);
    utimesSync(distFile, past, past);
    const future = new Date(Date.now() + 60_000);
    utimesSync(sourceFile, future, future);

    await build(kit);
    const rebuilt = readFileSync(distFile, 'utf8');
    expect(rebuilt).not.toBe('export {};');
    expect(rebuilt).toMatch(/NextGen/);
    expect(doctor(kit).text).not.toMatch(/broken/);
  }, 60_000);

  it('before a build, says what to run next instead of failing obscurely', () => {
    const kit = kitFolder();
    init(TINY, kit);
    const report = doctor(kit);
    expect(report.ok).toBe(false);
    expect(report.text).toMatch(/scan.mjs build/);
  });
});

/**
 * `nextgen calibrate` — Rule 14 for an app this repository has never seen.
 *
 * The sweep itself is tested where it lives (`core-intent`). What is tested here
 * is the part that can hurt an adopter: that it refuses to produce a number it
 * cannot stand behind, and that what it writes is actually picked up.
 */
describe('calibrate', () => {
  const goldenFor = (dir: string, turns: readonly { utterance: string; route: string | null; role?: string }[]): string => {
    const file = join(dir, 'golden.jsonl');
    writeFileSync(file, `${turns.map((t) => JSON.stringify(t)).join('\n')}\n`);
    return file;
  };

  /** Enough turns to clear the minimum, spread over enough screens to split. */
  const plausibleTurns = (): { utterance: string; route: string | null; role: string }[] => {
    const screens = ['/squad', '/squad/players', '/squad/teams', '/settings', '/settings/notifications', '/my/child'];
    const turns = screens.flatMap((route, i) => [
      { utterance: `where is screen ${i}`, route, role: 'PARENT' },
      { utterance: `open screen ${i} please`, route, role: 'PARENT' },
      { utterance: `take me to number ${i}`, route, role: 'PARENT' },
    ]);
    return [
      ...turns,
      { utterance: 'book me a flight', route: null, role: 'PARENT' },
      { utterance: 'what is the weather', route: null, role: 'PARENT' },
      { utterance: 'send an email for me', route: null, role: 'PARENT' },
      { utterance: 'pay this invoice', route: null, role: 'PARENT' },
    ];
  };

  it('refuses before a build, because there are no registries to calibrate against', async () => {
    const kit = kitFolder();
    init(TINY, kit);
    await expect(calibrate(kit, goldenFor(kit, plausibleTurns()))).rejects.toThrow(/scan.mjs build/);
  });

  it('refuses a golden set too small to mean anything, rather than fitting noise', async () => {
    const kit = kitFolder();
    init(TINY, kit);
    await build(kit);
    const tooFew = plausibleTurns().slice(0, 5);
    await expect(calibrate(kit, goldenFor(kit, tooFew))).rejects.toThrow(/at least 20/);
  }, 60_000);

  it('writes thresholds the next build actually uses', async () => {
    const kit = kitFolder();
    init(TINY, kit);
    await build(kit);
    expect((await build(kit)).calibrated).toBe(false);

    const result = await calibrate(kit, goldenFor(kit, plausibleTurns()));
    expect(existsSync(result.file)).toBe(true);
    // The held-out split is reported, and is never the split that was optimised.
    expect(result.heldOutEntries).toBeGreaterThan(0);
    expect(result.calibrationEntries + result.heldOutEntries).toBe(result.entries);

    const rebuilt = await build(kit);
    expect(rebuilt.calibrated).toBe(true);
    expect(doctor(kit).text).toMatch(/Calibrated for this app/);
  }, 120_000);

  it('says so when a turn names a role the app does not have, instead of scoring it anyway', async () => {
    const kit = kitFolder();
    init(TINY, kit);
    await build(kit);
    const turns = [...plausibleTurns(), { utterance: 'a turn for nobody', route: '/squad', role: 'NO_SUCH_ROLE' }];
    const result = await calibrate(kit, goldenFor(kit, turns));
    expect(result.warnings.join(' ')).toMatch(/NO_SUCH_ROLE/);
    expect(result.entries).toBe(turns.length - 1);
  }, 120_000);

  it('offers no way to calibrate from the generator\'s own examples', () => {
    // Measured on the pilot app: calibrating on the generator's examples wrongly
    // refused 7 real requests in 105, against 1 for the default profile. A
    // command that offered it would offer a worse outcome than doing nothing,
    // wrapped in something that looks like diligence. This asserts the absence.
    const source = readFileSync(fileURLToPath(new URL('./calibrate.ts', import.meta.url)), 'utf8');
    expect(source).not.toMatch(/examples\s*\)/);
    expect(calibrate.length).toBe(2); // (kitDir, goldenFile) — there is no third way in
  });
});

describe('stage 3 (WP-52, ADR-017)', () => {
  it('is off by default: no stage3 field, no doctor mention, thresholds unchanged', async () => {
    const kit = kitFolder();
    init(TINY, kit);
    const record = await build(kit);

    expect(record.stage3).toBeNull();
    const thresholds = JSON.parse(readFileSync(join(kit, 'bundle', 'thresholds.hashing.json'), 'utf8'));
    expect('stage3' in thresholds).toBe(false);
    expect(doctor(kit).text).not.toMatch(/Model-backed answers|stage 3/i);
  }, 60_000);

  it('writes the configured path into the served thresholds file, and only when asked', async () => {
    const kit = kitFolder();
    init(TINY, kit);
    const record = await build(kit, { stage3: { path: '/api/nextgen-stage3', model: 'house-model' } });

    expect(record.stage3).toEqual({ path: '/api/nextgen-stage3', model: 'house-model' });
    const thresholds = JSON.parse(readFileSync(join(kit, 'bundle', 'thresholds.hashing.json'), 'utf8'));
    expect(thresholds.stage3).toEqual({ path: '/api/nextgen-stage3', model: 'house-model' });
  }, 60_000);

  it('refuses an empty path rather than shipping an unreachable one', async () => {
    const kit = kitFolder();
    init(TINY, kit);
    await expect(build(kit, { stage3: { path: '   ' } })).rejects.toThrow(/needs a path/);
  }, 60_000);

  it('doctor states it is ON, names the path, and warns before the developer ships it', async () => {
    const kit = kitFolder();
    init(TINY, kit);
    await build(kit, { stage3: { path: 'stage3' } });

    const text = doctor(kit).text;
    expect(text).toMatch(/Model-backed answers \(stage 3\)/);
    expect(text).toMatch(/ON.*stage3.*YOUR OWN/s);
  }, 60_000);

  it('rebuilding without --stage3 turns it back off — it is not sticky in the kit folder', async () => {
    const kit = kitFolder();
    init(TINY, kit);
    await build(kit, { stage3: { path: 'stage3' } });
    const record = await build(kit); // no stage3 this time

    expect(record.stage3).toBeNull();
    const thresholds = JSON.parse(readFileSync(join(kit, 'bundle', 'thresholds.hashing.json'), 'utf8'));
    expect('stage3' in thresholds).toBe(false);
  }, 60_000);

  it('writes exactly {path, model} — the shape @nextgen/embed/src/stage3.ts declares as Stage3Config', async () => {
    // Not a cross-package import: kit is a Node CLI with no DOM lib in its tsconfig, and
    // @nextgen/embed's root pulls in theme.ts/widget.ts/voice.ts, which are genuinely
    // DOM-typed. Real interoperation between what this writes and what embed reads back
    // is proved at the process level, outside either package's typecheck boundary, by
    // tooling/scripts/check-stage3.mjs — the same shape this repo already uses for
    // check-adapter.mjs and preview/check-bench.mjs.
    const kit = kitFolder();
    init(TINY, kit);
    await build(kit, { stage3: { path: 'stage3', model: 'house-model' } });

    const thresholds = JSON.parse(readFileSync(join(kit, 'bundle', 'thresholds.hashing.json'), 'utf8'));
    expect(Object.keys(thresholds.stage3).sort()).toEqual(['model', 'path']);
    expect(thresholds.stage3).toEqual({ path: 'stage3', model: 'house-model' });
  }, 60_000);
});

describe('knowledge — what the adopter says about their own app', () => {
  const write = (kit: string, body: unknown): void => writeFileSync(join(kit, 'knowledge.json'), typeof body === 'string' ? body : JSON.stringify(body));
  const registryOf = (kit: string, role: string) =>
    JSON.parse(readFileSync(join(kit, 'bundle', `registry.${role}.json`), 'utf8')) as {
      domainDescription: string;
      capabilities: { route: string | null; explanation?: string; description: string; examples: (string | { say: string })[] }[];
    };

  const about = {
    app: { about: 'A club: parents follow their children, coaches run the squad.' },
    screens: {
      '/settings': {
        purpose: 'Where you change how the club contacts you.',
        aliases: ['preferências'],
        askedAs: ['quero mudar os avisos', 'como paro os emails', 'mudar as minhas preferências'],
      },
    },
  };

  it('reaches the served registry, and leaves the application byte-for-byte unchanged', async () => {
    const before = fingerprint(TINY);
    const kit = kitFolder();
    init(TINY, kit);
    write(kit, about);
    const record = await build(kit);
    expect(fingerprint(TINY)).toBe(before);

    const registry = registryOf(kit, 'PARENT');
    const settings = registry.capabilities.find((c) => c.route === '/settings')!;
    expect(settings.explanation).toBe('Where you change how the club contacts you.');
    expect(settings.description).toContain('preferências');
    expect(settings.examples).toContain('como paro os emails');
    expect(registry.domainDescription).toBe('A club: parents follow their children, coaches run the squad.');
    expect(record.knowledge).toMatchObject({ found: true, coverage: { withPurpose: 1, withPhrasing: 1 } });
  }, 60_000);

  it('writes the open questions for the agent to put to the developer, screen by screen', async () => {
    const kit = kitFolder();
    init(TINY, kit);
    write(kit, about);
    await build(kit);
    const questions = readFileSync(join(kit, 'review', 'KNOWLEDGE-GAPS.md'), 'utf8');
    expect(questions).toMatch(/what is this screen for/i);
    expect(questions).toContain('/squad');
    expect(questions).not.toMatch(/\/settings \(/); // already answered
  }, 60_000);

  it('asks everything when the developer has written nothing yet, and does not fail', async () => {
    const kit = kitFolder();
    init(TINY, kit);
    const record = await build(kit);
    expect(record.knowledge).toMatchObject({ found: false, coverage: { withPurpose: 0 } });
    expect(readFileSync(join(kit, 'review', 'KNOWLEDGE-GAPS.md'), 'utf8')).toMatch(/what is this application for/i);
    expect(record.warnings.join('\n')).not.toMatch(/knowledge/i);
  }, 60_000);

  it('turns a file it cannot fully read into a warning that names the place, not a crash', async () => {
    const kit = kitFolder();
    init(TINY, kit);
    write(kit, { screens: { '/settings': { purpose: 7, askedAs: 'ok' } }, screen: {} });
    const record = await build(kit);
    const warnings = record.warnings.join('\n');
    expect(warnings).toContain('knowledge.json');
    expect(warnings).toContain('screens./settings.purpose');
    expect(warnings).toMatch(/unknown section/);
  }, 60_000);

  it('says so when the file is not JSON at all, and still builds', async () => {
    const kit = kitFolder();
    init(TINY, kit);
    write(kit, '{ "app": ');
    const record = await build(kit);
    expect(record.warnings.join('\n')).toMatch(/knowledge\.json.*not valid JSON/i);
    expect(record.knowledge.found).toBe(true);
    expect(record.roles.length).toBeGreaterThan(0);
  }, 60_000);

  it('lists knowledge about a screen that is not there, so a typo is caught', async () => {
    const kit = kitFolder();
    init(TINY, kit);
    write(kit, { app: { about: 'x' }, screens: { '/settngs': { purpose: 'oops' } } });
    await build(kit);
    expect(readFileSync(join(kit, 'review', 'KNOWLEDGE-GAPS.md'), 'utf8')).toMatch(/\/settngs.*matches no screen/);
  }, 60_000);
});

describe('doctor — how much the assistant knows about the app', () => {
  it('says nothing has been written yet, and where the questions are', async () => {
    const kit = kitFolder();
    init(TINY, kit);
    await build(kit);
    const text = doctor(kit).text;
    expect(text).toMatch(/nothing yet \(no knowledge\.json\)/);
    expect(text).toMatch(/open question\(s\).*review\/KNOWLEDGE-GAPS\.md/);
  }, 60_000);

  it('reports how many screens are described once the developer has written some', async () => {
    const kit = kitFolder();
    init(TINY, kit);
    writeFileSync(join(kit, 'knowledge.json'), JSON.stringify({ app: { about: 'x' }, screens: { '/settings': { purpose: 'Contas.', askedAs: ['a', 'b', 'c'] } } }));
    await build(kit);
    expect(doctor(kit).text).toMatch(/knowledge\.json — 1 of \d+ screens described, real phrasing for 1 of \d+/);
  }, 60_000);
});

describe('knowledge — what the model stage is told, role by role (Rule 17)', () => {
  const contextOf = (kit: string, role: string) =>
    (JSON.parse(readFileSync(join(kit, 'bundle', `registry.${role}.json`), 'utf8')) as { context?: { rules?: string[]; glossary?: { term: string }[]; limits?: { about: string }[] } }).context;

  const build_ = async (knowledge: unknown) => {
    const kit = kitFolder();
    init(TINY, kit);
    writeFileSync(join(kit, 'knowledge.json'), JSON.stringify(knowledge));
    const record = await build(kit);
    return { kit, record };
  };

  const everyone = 'Every page is reached from the menu on the left.';
  const adminOnly = 'Only an administrator can change who is a coach.';

  it('writes each role only the rules and words that are for it, and never another role’s', async () => {
    const { kit } = await build_({
      rules: [everyone, { text: adminOnly, roles: ['ADMIN'] }],
      glossary: [{ term: 'squad', means: 'a team', aliases: ['team'] }, { term: 'audit trail', roles: ['ADMIN'] }],
      cannot: [{ about: 'Payments', say: 'Fees are handled by the office.', askedAs: ['pay my fee', 'how much do I owe', 'when is the fee due'] }],
    });
    expect(contextOf(kit, 'ADMIN')!.rules).toEqual([everyone, adminOnly]);
    expect(contextOf(kit, 'PARENT')!.rules).toEqual([everyone]);
    expect(contextOf(kit, 'COACH')!.rules).toEqual([everyone]);
    expect(contextOf(kit, 'PARENT')!.glossary!.map((g) => g.term)).toEqual(['squad']);
    expect(contextOf(kit, 'ADMIN')!.glossary!.map((g) => g.term)).toEqual(['squad', 'audit trail']);
    for (const role of ['ADMIN', 'PARENT', 'COACH']) expect(contextOf(kit, role)!.limits![0]!.about).toBe('Payments');
    // Not just absent from the field: absent from the served file altogether.
    for (const role of ['PARENT', 'COACH']) expect(readFileSync(join(kit, 'bundle', `registry.${role}.json`), 'utf8')).not.toContain('change who is a coach');
    expect(readFileSync(join(kit, 'bundle', 'registry.PARENT.json'), 'utf8')).not.toContain('audit trail');
  }, 60_000);

  it('writes no context at all when the developer has said nothing for the model', async () => {
    const { kit } = await build_({ app: { about: 'A club.' }, screens: { '/settings': { purpose: 'Contas.' } } });
    for (const role of ['ADMIN', 'PARENT', 'COACH']) expect(contextOf(kit, role)).toBeUndefined();
  }, 60_000);

  it('says so, and still builds, when a rule is for a role the app does not have', async () => {
    const { kit, record } = await build_({ rules: [{ text: 'Something.', roles: ['ADMINN'] }] });
    expect(record.roles.length).toBeGreaterThan(0);
    expect(readFileSync(join(kit, 'review', 'KNOWLEDGE-GAPS.md'), 'utf8')).toMatch(/ADMINN.*no such role/);
  }, 60_000);

  it('asks how the app works while nothing has been said about it', async () => {
    const { kit } = await build_({ app: { about: 'x' } });
    expect(readFileSync(join(kit, 'review', 'KNOWLEDGE-GAPS.md'), 'utf8')).toMatch(/How does this app work that a newcomer would not guess/);
  }, 60_000);
});
