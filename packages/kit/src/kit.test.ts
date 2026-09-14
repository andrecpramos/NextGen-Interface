import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { build } from './build.ts';
import { detectApp, init } from './detect.ts';
import { calibrate } from './calibrate.ts';
import { doctor } from './doctor.ts';

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

describe('AGENT.md — the decisions this kit leaves to the developer', () => {
  it('is written by init, for whichever agent runs the rest of these commands', () => {
    const kit = kitFolder();
    init(TINY, kit);
    const text = readFileSync(join(kit, 'AGENT.md'), 'utf8');
    // The point of this file is that these are put to the developer, not
    // assumed. If a heading goes missing, so does the question.
    for (const heading of [
      'ASK 1',
      'ASK 2',
      'ASK 3',
      'ASK 4',
      'ASK 5',
      'ASK 6',
      'ASK 7',
      'never do without asking',
    ]) {
      expect(text).toContain(heading);
    }
  });

  it('is not clobbered by --force, which redoes detection, not a developer\'s edits to it', () => {
    const kit = kitFolder();
    init(TINY, kit);
    writeFileSync(join(kit, 'AGENT.md'), 'a developer wrote this instead');
    init(TINY, kit, { force: true });
    expect(readFileSync(join(kit, 'AGENT.md'), 'utf8')).toBe('a developer wrote this instead');
  });

  it('doctor points an agent at it, when it exists', async () => {
    const kit = kitFolder();
    init(TINY, kit);
    await build(kit);
    expect(doctor(kit).text).toMatch(/AGENT\.md/);
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
    expect(doctor(kit).text).toMatch(/NOT calibrated/);
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
  }, 60_000);

  it('treats an app with no role table as one audience, and serves it as PUBLIC', async () => {
    const kit = kitFolder();
    init(DATA_ROUTER, kit);
    const record = await build(kit);
    expect(record.roles).toEqual(['PUBLIC']);
    expect(doctor(kit).text).toMatch(/'PUBLIC'/);
  }, 60_000);

  it('before a build, says what to run next instead of failing obscurely', () => {
    const kit = kitFolder();
    init(TINY, kit);
    const report = doctor(kit);
    expect(report.ok).toBe(false);
    expect(report.text).toMatch(/nextgen build/);
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
    await expect(calibrate(kit, goldenFor(kit, plausibleTurns()))).rejects.toThrow(/nextgen build/);
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
    // Measured on fut-app: calibrating on the generator's examples wrongly
    // refused 7 real requests in 105, against 1 for the default profile. A
    // command that offered it would offer a worse outcome than doing nothing,
    // wrapped in something that looks like diligence. This asserts the absence.
    const source = readFileSync(fileURLToPath(new URL('./calibrate.ts', import.meta.url)), 'utf8');
    expect(source).not.toMatch(/examples\s*\)/);
    expect(calibrate.length).toBe(2); // (kitDir, goldenFile) — there is no third way in
  });
});
