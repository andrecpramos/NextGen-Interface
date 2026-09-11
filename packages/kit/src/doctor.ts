import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import type { SkipReason } from '@nextgen/generator';

import type { BuildRecord } from './build.ts';
import type { Finding } from './detect.ts';
import { BUNDLE_DIR, CONFIG_FILE, REVIEW_DIR } from './paths.ts';

/**
 * `nextgen doctor`: what the kit read, what it could not, and what to do.
 *
 * Written for the person who runs the kit on their own app without having built
 * it. That is the owner's run in `fut-app` (WP-35), and it is the product's
 * promise to every adopter. So every line says what happened in plain words, and
 * every problem says what to change. A report that lists a skip reason code
 * without saying what it means has failed at its only job.
 *
 * It also re-checks the two properties that matter most, rather than trusting
 * the build: nothing in the served folder names a role (Rule 17), and the review
 * folder's master list is not in it.
 */

export interface DoctorReport {
  readonly ok: boolean;
  readonly text: string;
}

const WHY: Readonly<Record<SkipReason, { readonly means: string; readonly fix: string }>> = {
  'unreadable-route': {
    means: 'it is in your route table, but its path or page could not be read',
    fix: 'FIX THESE FIRST. These screens are invisible to the assistant. Write the path as a string or a constant, and the page as a direct or lazy import',
  },
  'unresolved-roles': {
    means: 'its role guard could not be read, so it was left out rather than shown to the wrong people',
    fix: 'if the guard is computed or comes from a helper, make it a plain entry in your role table',
  },
  'no-roles': { means: 'no role can reach it', fix: 'nothing to do, if that is intended' },
  'dev-only': { means: 'it only exists in development builds', fix: 'nothing to do' },
  'declared-legacy': {
    means: 'your code or navigation calls it legacy or replaced',
    fix: 'nothing to do, or remove that comment if it is wrong',
  },
  'bookmark-redirect': { means: 'it only redirects to another section', fix: 'nothing to do' },
  'no-component': { means: 'it renders no page of its own', fix: 'nothing to do, if it is a layout or a redirect' },
  'duplicate-route': { means: 'another screen already covers the same path', fix: 'nothing to do' },
};

function readJson<T>(file: string): T | null {
  return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as T) : null;
}

export function doctor(kitDir: string): DoctorReport {
  const kit = resolve(kitDir);
  const lines: string[] = [];
  const problems: string[] = [];
  const say = (line = ''): void => void lines.push(line);

  if (!existsSync(join(kit, CONFIG_FILE))) {
    return { ok: false, text: `No kit here (${kit}). Run "nextgen init <your app folder>" first.` };
  }
  const detect = readJson<{ findings: Finding[]; warnings: string[] }>(join(kit, REVIEW_DIR, 'detect.json'));
  const record = readJson<BuildRecord>(join(kit, REVIEW_DIR, 'build.json'));

  say(`nextgen doctor — ${kit}`);
  say();

  // 1. What init read, and what it guessed.
  if (detect) {
    say('What the kit found in your app');
    for (const f of detect.findings) {
      say(`  ${f.confident ? 'found  ' : 'GUESSED'}  ${f.what}: ${f.value ?? '(none)'}`);
      say(`           ${f.evidence}`);
    }
    say();
  }

  if (!record) {
    say('Not built yet. Run "nextgen build" next.');
    return { ok: false, text: lines.join('\n') };
  }

  // 2. What build produced.
  say(`What it built (${record.builtAt})`);
  say(`  ${record.capabilities} screen(s) the assistant can take people to, plus ${record.boundaries} declared limit(s)`);
  for (const role of record.roles) say(`    ${role.padEnd(14)} ${record.perRole[role] ?? 0} screen(s)`);
  say(`  Descriptions: ${record.prose}`);
  say();

  // 3. What it skipped, grouped, most urgent first.
  if (record.skipped.length > 0) {
    say(`What it left out, and why (${record.skipped.length})`);
    const byReason = new Map<SkipReason, string[]>();
    for (const s of record.skipped) byReason.set(s.reason, [...(byReason.get(s.reason) ?? []), s.path]);
    const order = Object.keys(WHY) as SkipReason[];
    for (const reason of order.filter((r) => byReason.has(r))) {
      const paths = byReason.get(reason)!;
      say(`  ${paths.length} left out because ${WHY[reason].means}:`);
      for (const path of paths.slice(0, 8)) say(`      ${path}`);
      if (paths.length > 8) say(`      … and ${paths.length - 8} more. See review/SKIPPED.md`);
      say(`    What to do: ${WHY[reason].fix}.`);
    }
    if (byReason.has('unreadable-route')) problems.push('some routes could not be read at all (see above)');
    say();
  }

  // 4. Calibration.
  say('How confident the assistant is allowed to be');
  if (record.calibrated) {
    say(`  Calibrated for this app (${record.thresholdsSource}).`);
  } else {
    // Measured, not assumed: eval/fut-app/experiment-self-calibration.mjs. An earlier
    // version of this text said an uncalibrated build "will work, but ask more
    // clarifying questions". On a 145-screen app that was false.
    say('  NOT calibrated for this app. It is using default settings tuned on a different,');
    say('  7-screen app. On a 145-screen app, those defaults sent 2 of 7 confident answers to');
    say('  the wrong screen, and refused 1 real question in 105. Calibrated for that app, it');
    say('  made neither mistake. The kit cannot calibrate from its own example questions:');
    say('  that was measured too, and it was worse. Calibrating needs real questions, each');
    say('  with the screen it should reach. Put the result in calibration/thresholds.hashing.json');
    say('  and build again (PLAN.md WP-41).');
  }
  say();

  // 5. Re-check what is served, rather than trusting the build.
  const bundle = join(kit, BUNDLE_DIR);
  const served = existsSync(bundle) ? readdirSync(bundle) : [];
  for (const role of record.roles) {
    for (const file of [`registry.${role}.json`, `index.${role}.json`]) {
      if (!served.includes(file)) problems.push(`bundle/${file} is missing. Run "nextgen build" again`);
    }
  }
  if (!served.includes('thresholds.hashing.json')) problems.push('bundle/thresholds.hashing.json is missing');
  if (served.includes('master.json')) problems.push('bundle/ contains master.json, which lists every role. Delete it; it must never be served');
  for (const file of served.filter((f) => /^registry\..+\.json$/.test(f))) {
    const registry = readJson<{ capabilities: Array<Record<string, unknown>> }>(join(bundle, file));
    if (registry?.capabilities.some((c) => 'roles' in c)) {
      problems.push(`bundle/${file} carries role annotations. It would tell a user who else can see each screen (Rule 17)`);
    }
  }
  for (const report of record.invalid) problems.push(`a registry failed validation:\n${report}`);
  if (record.capabilities === 0) problems.push('no screens were found. Check "routesFile" in nextgen.config.json');

  // 6. How to mount it.
  const role = record.roles[0] ?? 'PUBLIC';
  say('How to put it in your app');
  say(`  1. Serve ${join(kit, BUNDLE_DIR)} at a path of your choice, for example /nextgen.`);
  if (record.roles.length > 1) {
    say('     Serve each signed-in user ONLY their own role\'s registry.<ROLE>.json and index.<ROLE>.json.');
    say('     A role\'s file lists the screens that role can reach; the others must not reach it (Rule 17).');
  }
  say('  2. Add to your page:');
  say('       <script src="/nextgen/nextgen.js"></script>');
  say(`       <script>NextGen.load('/nextgen', ${record.roles.length > 1 ? 'CURRENT_USER_ROLE' : `'${role}'`}).then((assistant) => { /* assistant.route(question) */ });</script>`);
  say(`  Never serve ${join(kit, REVIEW_DIR)}. Its master.json lists every screen with every role.`);
  say();

  const warnings = [...(detect?.warnings ?? []), ...record.warnings];
  if (warnings.length > 0) {
    say('Read these before you ship');
    for (const w of warnings) say(`  ! ${w}`);
    say();
  }

  if (problems.length > 0) {
    say('PROBLEMS');
    for (const p of problems) say(`  x ${p}`);
  } else {
    say(warnings.length > 0 ? 'Built. Read the warnings above before you ship.' : 'Built, and nothing needs fixing.');
  }
  return { ok: problems.length === 0, text: lines.join('\n') };
}
