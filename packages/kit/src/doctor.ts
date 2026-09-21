import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

import type { SkipReason } from '@nextgen/generator';

import { readConfig, type BuildRecord } from './build.ts';
import type { Finding } from './detect.ts';
import { BUNDLE_DIR, CONFIG_FILE, REVIEW_DIR } from './paths.ts';
import { describeSweep, sweepingTools } from './tooling.ts';

/**
 * `nextgen doctor`: what the kit read, what it could not, and what to do.
 *
 * Written for the person who runs the kit on their own app without having built
 * it. That is the owner's run in the pilot app (WP-35), and it is the product's
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
  'catch-all': {
    means: 'it matches many pages that come from content, not code, so no single screen can be offered for it',
    fix: 'list the pages it serves in a navigation manifest, if users should be able to ask for them',
  },
  'duplicate-route': { means: 'another screen already covers the same path', fix: 'nothing to do' },
  'reached-through-resolver': {
    means: 'it is the same page as a route that picks its parameter itself, so it is offered once, at that route',
    fix: 'nothing to do',
  },
  'redirect-alias': {
    means: 'it only redirects to a screen that is offered at its own address, so it is an old name for that screen',
    fix: 'nothing to do',
  },
};

function readJson<T>(file: string): T | null {
  return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as T) : null;
}

/**
 * `build` copying `nextgen.js` into the bundle is not the same as it working —
 * a stale or truncated copy still copies successfully. Load it exactly as a
 * `<script src>` would (the same sandbox `embed`'s own tests use: a bare
 * `window`, no `require`, no `fetch`) and check the one export every mount
 * depends on. This is what would have caught the kit shipping a two-day-old
 * `dist/nextgen.js` that exported nothing while reporting a clean build.
 */
function scriptTagIsBroken(code: string): string | null {
  try {
    const window: Record<string, unknown> = {};
    const context = vm.createContext({ window, self: window, console, performance });
    vm.runInContext(`${code}\nwindow.NextGen = NextGen;`, context);
    const api = window.NextGen as Record<string, unknown> | undefined;
    if (typeof api?.start !== 'function') return 'it does not define a callable NextGen.start';
    return null;
  } catch (error) {
    return `it threw when loaded like a script tag: ${error instanceof Error ? error.message : String(error)}`;
  }
}

/**
 * Which build of the adapter this is: the first line of `VERSION`, next to `scan.mjs` — an id of the two
 * files an adopter copies, written by the build and changing exactly when they do. Null when there is no
 * such file (running from source, or from a copy that lost it).
 */
export function adapterVersion(dir: string = dirname(fileURLToPath(import.meta.url))): string | null {
  try {
    const first = readFileSync(join(dir, 'VERSION'), 'utf8').split(/\r?\n/, 1)[0]?.trim();
    return first && /^nextgen-adapter\s+\S+$/.test(first) ? first : null;
  } catch {
    return null;
  }
}

export function doctor(kitDir: string, adapterDir?: string): DoctorReport {
  const kit = resolve(kitDir);
  const lines: string[] = [];
  const problems: string[] = [];
  const say = (line = ''): void => void lines.push(line);
  const version = adapterVersion(adapterDir);
  if (version) {
    say(`${version}   (quote this when you report a problem)`);
    say();
  }

  if (!existsSync(join(kit, CONFIG_FILE))) {
    return { ok: false, text: `No kit here (${kit}). Run "node scan.mjs init <your app folder>" first.` };
  }
  const detect = readJson<{ findings: Finding[]; warnings: string[]; projectDir?: string }>(join(kit, REVIEW_DIR, 'detect.json'));
  const projectDir = detect?.projectDir !== undefined ? resolve(kit, detect.projectDir) : null;
  const record = readJson<BuildRecord>(join(kit, REVIEW_DIR, 'build.json'));

  say(`nextgen doctor — ${kit}`);
  // The one front door for an installing agent ships beside the tool (adapter/AGENTS.md).
  const agentsFile = join(dirname(fileURLToPath(import.meta.url)), 'AGENTS.md');
  if (existsSync(agentsFile)) {
    say(`(If an AI agent is reading this on a developer's behalf: read ${agentsFile} before acting on anything below.)`);
  }
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
    say('Not built yet. Run "node scan.mjs build" next.');
    return { ok: false, text: lines.join('\n') };
  }

  // 2. What build produced.
  say(`What it built (${record.builtAt})`);
  say(`  ${record.capabilities} screen(s) the assistant can take people to, plus ${record.boundaries} declared limit(s)`);
  for (const role of record.roles) say(`    ${role.padEnd(14)} ${record.perRole[role] ?? 0} screen(s)`);
  say(`  Descriptions: ${record.prose}`);
  say(`  Rules read from validation schemas and control attributes: ${record.rules} (ADR-020, WP-54)`);
  say(`  Rules inferred from a handler or a disabled control, shipped: ${record.inferredRules} (ADR-020, WP-55)`);
  // Older builds have no knowledge block; say nothing rather than something wrong.
  const knowledge = (record as { knowledge?: BuildRecord['knowledge'] }).knowledge;
  if (knowledge) {
    const { coverage } = knowledge;
    say(
      knowledge.found
        ? `  What you told it about the app: knowledge.json — ${coverage.withPurpose} of ${coverage.screens} screens described, real phrasing for ${coverage.withPhrasing} of ${coverage.screens}`
        : '  What you told it about the app: nothing yet (no knowledge.json)',
    );
    if (knowledge.gaps > 0) {
      say(`  ${knowledge.gaps} open question(s) for the developer — review/KNOWLEDGE-GAPS.md. Answering them is the biggest lever on how well it understands your users.`);
    }
  }
  if (record.reviewInferred > 0) {
    say(`  ${record.reviewInferred} more candidate(s) were found but not confident enough to ship — read them in review/INFERRED.md.`);
  }
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
    // Measured, not assumed: an experiment script deleted with the pilot's evidence, ADR-018. An earlier
    // version of this text said an uncalibrated build "will work, but ask more
    // clarifying questions". On a 145-screen app that was false.
    say('  NOT calibrated for this app. It is using default settings tuned on a different,');
    say('  7-screen app. On a 145-screen app, those defaults sent 2 of 7 confident answers to');
    say('  the wrong screen, and refused 1 real question in 105. Calibrated for that app, it');
    say('  made neither mistake. The kit cannot calibrate from its own example questions:');
    say('  that was measured too, and it was worse — it wrongly refused 7 real requests in 105.');
    say('  A small app, or one described only by its own labels, fares worse: on a 2-route');
    say('  landing page, 7 of 12 everyday questions (written by the tool’s author, so an');
    say('  anecdote) were refused. So until you calibrate, a declared limit must score at least');
    say('  a floor of 0.15 of its own before it may refuse — it asks the visitor instead, and');
    say('  refuses fewer out-of-scope requests. Say what each screen is for first —');
    say('  knowledge.json, see review/KNOWLEDGE-GAPS.md — because a screen the visitor’s words');
    say('  never match cannot win.');
    say('  Calibrating needs real questions you wrote, each with the screen it should reach:');
    say('');
    say('    nextgen calibrate <kit folder> --golden your-questions.jsonl');
    say('    node scan.mjs build <kit folder>        # picks up the calibration');
    say('');
    say('  One JSON object per line: {"utterance": "...", "route": "/where", "role": "ADMIN"}.');
    say('  Use "route": null for a question it should refuse, and include both kinds — a sweep');
    say('  with nothing to refuse cannot find the refusal threshold. About 20 turns is the');
    say('  minimum that means anything; fewer and it fits noise.');
  }
  say();

  // 5. Stage 3 (WP-52, ADR-017). Off is the state doctor should say the LEAST about — a
  // silent line here would read as "nothing to report" for the common case, so this only
  // prints when it is ON, and says exactly what that means for a visitor.
  if (record.stage3) {
    say('Model-backed answers (stage 3)');
    say(`  ON — a turn stages 1–2 cannot settle POSTs to "${record.stage3.path}" on YOUR OWN`);
    say('  origin, instead of asking the visitor a clarifying question. That path is yours to');
    say('  serve, rate-limit and secure. See "Turn on model-backed answers" in AGENTS.md or');
    say('  the kit README for a reference proxy with rate limiting.');
    if (record.stage3.model) say(`  Requests name the model "${record.stage3.model}"; your proxy decides what that means.`);
    say();
  }

  // 6. Re-check what is served, rather than trusting the build.
  const bundle = join(kit, BUNDLE_DIR);
  const served = existsSync(bundle) ? readdirSync(bundle) : [];
  for (const role of record.roles) {
    for (const file of [`registry.${role}.json`, `index.${role}.json`]) {
      if (!served.includes(file)) problems.push(`bundle/${file} is missing. Run "node scan.mjs build" again`);
    }
  }
  if (!served.includes('thresholds.hashing.json')) problems.push('bundle/thresholds.hashing.json is missing');
  if (served.includes('nextgen.js')) {
    const broken = scriptTagIsBroken(readFileSync(join(bundle, 'nextgen.js'), 'utf8'));
    if (broken) problems.push(`bundle/nextgen.js is broken: ${broken}. Delete packages/embed/dist and run "node scan.mjs build" again`);
  }
  if (served.includes('master.json')) problems.push('bundle/ contains master.json, which lists every role. Delete it; it must never be served');
  for (const file of served.filter((f) => /^registry\..+\.json$/.test(f))) {
    const registry = readJson<{ capabilities: Array<Record<string, unknown>> }>(join(bundle, file));
    if (registry?.capabilities.some((c) => 'roles' in c)) {
      problems.push(`bundle/${file} carries role annotations. It would tell a user who else can see each screen (Rule 17)`);
    }
  }
  for (const report of record.invalid) problems.push(`a registry failed validation:\n${report}`);
  if (record.capabilities === 0) problems.push('no screens were found. Check "router" and "routesFile" in nextgen.config.json');

  // 7. How to mount it.
  const role = record.roles[0] ?? 'PUBLIC';
  say('How to put it in your app');
  say(`  1. Serve ${join(kit, BUNDLE_DIR)} at a path of your choice, for example /nextgen.`);
  if (record.roles.length > 1) {
    say('     Serve each signed-in user ONLY their own role\'s registry.<ROLE>.json and index.<ROLE>.json.');
    say('     A role\'s file lists the screens that role can reach; the others must not reach it (Rule 17).');
    say('     Ready-made handlers for Express and Next.js, under "Serving it", in');
    say('     AGENTS.md, beside this tool.');
    say('     The role comes from your session, never from the request.');

    // A bundle under the folder a web app serves as-is hands every role's file to everyone.
    if (projectDir) {
      const served = relative(projectDir, join(kit, BUNDLE_DIR)).split('\\').join('/');
      if (/^(?:[\w-]+\/)?(?:public|static)\//.test(served)) {
        problems.push(
          `${served} is served to everyone: it sits in a folder your app serves as-is, and this app has ` +
            `${record.roles.length} roles, so every user could read every role's screen list (Rule 17). ` +
            'Build the kit outside it (node scan.mjs init --out) and serve each role its own files',
        );
      }
    }
  }
  const roleValue = record.roles.length > 1 ? 'CURRENT_USER_ROLE' : role;
  say('  2. Add one line to your page. It puts an accessible "ask where to go" box in a corner.');
  say('     It needs no inline script or style, so it works under a strict Content-Security-Policy:');
  say(`       <script src="/nextgen/nextgen.js" data-nextgen-role="${roleValue}" defer></script>`);
  if (record.roles.length > 1) {
    say("     Write the signed-in user's role into data-nextgen-role on the server, HTML-escaped.");
  }
  say('     Optional: data-nextgen-target="#an-element" to place it yourself,');
  say('     data-nextgen-position="bottom-left" (or top-left, top-right) to move the corner.');
  say('  3. In a single-page app, stop its links reloading the page. In your own code:');
  say("       window.addEventListener('nextgen:navigate', (event) => {");
  say('         event.preventDefault();');
  say('         router.navigate(event.detail.route);');
  say('       });');
  say('  4. Photos and files. The box has a paperclip (and a camera, on a phone). What a visitor attaches');
  say('     never leaves their device: it reaches YOUR page as an event, and nothing else. If the app can');
  say('     use one — an upload form, an inbox — take it; if not, turn the buttons off:');
  say("       window.addEventListener('nextgen:attach', (event) => {");
  say('         const { files, utterance, route } = event.detail;   // File objects, what they typed, where they were');
  say('         event.preventDefault();                             // tells the visitor the app took it');
  say('       });');
  say('     or  data-nextgen-attach="off"  on the script tag. Files are validated (type, size, count); the');
  say("     page should still check what it is given — a file's name and type are the visitor's, not ours.");
  say(`  Never serve ${join(kit, REVIEW_DIR)}. Its master.json lists every screen with every role.`);
  say();

  // Checks in the adopter's own project that would trip over this folder (readiness item 4).
  const kitFolder = projectDir ? (relative(projectDir, kit).split(/[\\/]/)[0] ?? 'nextgen') : 'nextgen';
  const sweeps = projectDir ? sweepingTools(projectDir, kit).map((w) => describeSweep(w, kitFolder)) : [];
  // `detect.json`'s warnings are frozen at `init` time, so a developer who *acts* on one
  // keeps being told about it. A warning that cannot be cleared is a warning people learn
  // to scroll past, which costs the ones that matter.
  //
  // The language guess is the case that bites: `init` warns "put the app's own language
  // first in languages", the developer edits the config and does exactly that, and the
  // warning survives every later run unchanged. So it is dropped once the configured
  // first language is no longer the one that was guessed.
  const guessedLanguage = detect?.findings.find((f) => f.what === 'app language' && !f.confident)?.value ?? null;
  let configuredLanguage: string | null = null;
  try {
    configuredLanguage = readConfig(kit).config.languages?.[0] ?? null;
  } catch {
    // An unreadable config is reported elsewhere; it must not take the warnings with it.
  }
  const acted = guessedLanguage !== null && configuredLanguage !== null && configuredLanguage !== guessedLanguage;
  const detected = (detect?.warnings ?? []).filter(
    (w) => !(acted && w.startsWith("The app's language is a guess")),
  );

  const warnings = [...detected, ...record.warnings, ...sweeps];
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
