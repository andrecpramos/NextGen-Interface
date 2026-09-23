import { writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { build } from './build.ts';
import { calibrate } from './calibrate.ts';
import { init } from './detect.ts';
import { doctor } from './doctor.ts';
import { arg, self, shown } from './paths.ts';
import { preview } from './preview.ts';
import { report } from './report.ts';
import { teach } from './teach.ts';

/**
 *   scan.mjs init <app folder> [--out <kit folder>] [--force]
 *   scan.mjs build [kit folder] [--stage3 <path>] [--stage3-model <name>]
 *   scan.mjs calibrate [kit folder] --golden <file.jsonl>
 *   scan.mjs teach [kit folder] --from <lessons.jsonl> [--write] [--min <n>]
 *   scan.mjs doctor [kit folder] [--report <file.md>]
 *   scan.mjs preview [kit folder] [--port <n>] [--app-url <url>]
 *
 * The one entry point is `cli-copied.ts`, bundled into `adapter/scan.mjs`. It has no model
 * to reach: no client, no endpoint, and no flag that would name one — a flag that turns a
 * capability off still ships the capability, and this ships neither. That is what makes
 * "it cannot reach the network" checkable rather than promised (ADR-018 D-6, ADR-021;
 * `tooling/scripts/check-network-egress.mjs` and `check-adapter.mjs` cover `adapter/`).
 *
 * The kit folder defaults to ./nextgen. Nothing is ever written outside it
 * (Rule 16). Descriptions are derived from the app's own labels, which is flatter than
 * a model's but always available.
 *
 * `calibrate` requires a golden set you wrote (Rule 14), and there is
 * deliberately no way to calibrate from the generator's own examples — measured,
 * that makes the engine wrongly refuse real requests. See calibrate.ts.
 *
 * `--stage3 <path>` (WP-52, ADR-017): a turn stages 1-2 cannot settle POSTs to
 * that path on the ADOPTER'S OWN origin instead of asking a clarifying question.
 * Off unless this is passed — there is no bare `--stage3` with a guessed default,
 * because the path is a server the developer has to actually run, rate-limit and
 * secure, and typing it is the smallest possible forcing function for that.
 */

const USAGE = `usage:
  scan.mjs init <app folder> [--out <kit folder>] [--force]
  scan.mjs build [kit folder] [--stage3 <path>] [--stage3-model <name>]
  scan.mjs calibrate [kit folder] --golden <file.jsonl>
  scan.mjs teach [kit folder] --from <lessons.jsonl> [--write] [--min <n>]
  scan.mjs doctor [kit folder] [--report <file.md>]
  scan.mjs preview [kit folder] [--port <n>] [--app-url <url>]`;

function flag(name: string): string | null {
  const index = process.argv.indexOf(`--${name}`);
  return index > -1 ? (process.argv[index + 1] ?? null) : null;
}

function positional(): string | null {
  const args = process.argv.slice(3);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg.startsWith('--')) {
      if (!['--force', '--write'].includes(arg)) i++;
      continue;
    }
    return arg;
  }
  return null;
}

export async function run(): Promise<number> {
  const command = process.argv[2];

  if (command === 'init') {
    const app = positional();
    if (!app) {
      console.error(USAGE);
      return 2;
    }
    const result = init(app, flag('out') ?? undefined, { force: process.argv.includes('--force') });
    console.log(`\n  Read ${result.config.appRoot}\n`);
    for (const f of result.findings) {
      console.log(`  ${f.confident ? 'found  ' : 'GUESSED'}  ${f.what}: ${f.value ?? '(none)'}`);
      console.log(`           ${f.evidence}`);
    }
    for (const w of result.warnings) console.log(`\n  ! ${w}`);
    console.log(`\n  Wrote ${result.configFile}`);
    console.log('  Anything marked GUESSED can be corrected in that file.');
    console.log('\n  If an AI agent is running these next steps: read AGENTS.md, in the folder this');
    console.log('  tool came from, first. It lists the decisions that are the developer\'s to make.');
    console.log(`\n  Next: ${self()} build ${arg(shown(result.kitDir))}\n`);
    return 0;
  }

  if (command === 'build') {
    const kit = resolve(positional() ?? 'nextgen');
    // Refused, not ignored: someone who has seen `--model` documented would otherwise get a
    // build that quietly did something other than what they asked for.
    if (flag('model') !== null || flag('endpoint') !== null) {
      console.error(
        '\n  This tool cannot use a model: it has no client for one and reaches no network.\n' +
          "  Descriptions are derived from the application's own labels. Run without --model.\n",
      );
      return 2;
    }
    const stage3Path = flag('stage3');
    const record = await build(kit, {
      ...(stage3Path
        ? { stage3: { path: stage3Path, ...(flag('stage3-model') ? { model: flag('stage3-model')! } : {}) } }
        : {}),
      onProgress: (done, total) => {
        if (done % 20 === 0 || done === total) console.log(`    ... ${done}/${total} screens described`);
      },
    });
    console.log(`\n  ${record.capabilities} screen(s) across ${record.roles.length} role(s); ${record.skipped.length} left out.`);
    if (record.stage3) {
      console.log(`  Stage 3 is ON: unsettled turns will POST to "${record.stage3.path}" on your own origin.`);
    }
    // Exit 1 alone is invisible to a person: say it, and say where the reason is.
    if (record.invalid.length > 0) {
      console.log(`  ! ${record.invalid.length} role file(s) failed validation. Do not serve this build: doctor says why.`);
    }
    console.log(`  Next: ${self()} doctor ${arg(shown(kit))}\n`);
    return record.invalid.length > 0 ? 1 : 0;
  }

  if (command === 'calibrate') {
    const golden = flag('golden');
    if (!golden) {
      console.error(USAGE);
      console.error(
        '\n  --golden is required: a file of turns YOU wrote, one JSON object per line:\n' +
          '    {"utterance": "where do I see the invoices?", "route": "/billing", "role": "ADMIN"}\n' +
          '    {"utterance": "book me a flight", "route": null, "role": "ADMIN"}\n' +
          '\n  "route": null means the assistant should refuse it. Include both kinds:\n' +
          '  a sweep with nothing to refuse cannot find the refusal threshold.\n' +
          '  There is no option to calibrate from the generator\'s own examples — measured,\n' +
          '  it wrongly refuses real requests, which is worse than keeping the default.\n',
      );
      return 2;
    }
    const result = await calibrate(resolve(positional() ?? 'nextgen'), golden);
    console.log(result.text);
    return 0;
  }

  if (command === 'teach') {
    const from = flag('from');
    const min = flag('min');
    if (!from || (min !== null && !/^\d+$/.test(min))) {
      console.error(USAGE);
      console.error(
        '\n  --from is required: the lessons your page kept from `nextgen:learn` events, one JSON object per line:\n' +
          '    {"question": "onde vejo quem está lesionado", "route": "/medical/availability", "how": "chose"}\n' +
          '    {"question": "quero falar com alguém", "route": null, "how": "unplaced"}\n',
      );
      return 2;
    }
    const kit = resolve(positional() ?? 'nextgen');
    const result = teach(kit, from, { write: process.argv.includes('--write'), ...(min !== null ? { min: Number(min) } : {}) });
    const phrases = result.taught.reduce((n, t) => n + t.phrases.length, 0);
    console.log(`\n  ${result.read} lesson(s) read.`);
    console.log(`  ${phrases} new phrase(s) for ${result.taught.length} screen(s); ${result.unanswered.length} question(s) no screen answered; ${result.held.length} held back.`);
    console.log(`  Report: ${result.reportFile}`);
    if (result.wrote) console.log(`  Wrote ${result.knowledgeFile}. Next: ${self()} build ${arg(shown(kit))}\n`);
    else if (phrases > 0) console.log(`  Nothing written. Read the report, then: ${self()} teach ${arg(shown(kit))} --from ${arg(from)} --write\n`);
    else console.log('');
    return 0;
  }

  if (command === 'doctor') {
    const kit = resolve(positional() ?? 'nextgen');
    const checked = doctor(kit);
    console.log(checked.text);
    const reportFile = flag('report');
    if (reportFile) {
      writeFileSync(resolve(reportFile), report(kit), 'utf8');
      console.log(`  Wrote ${resolve(reportFile)}. It lists every screen with its roles: share it only with people who may know that.\n`);
    }
    return checked.ok ? 0 : 1;
  }

  if (command === 'preview') {
    const kit = resolve(positional() ?? 'nextgen');
    const port = flag('port');
    if (port !== null && !/^\d+$/.test(port)) {
      console.error(`\n  --port must be a number, not ${port}\n`);
      return 2;
    }
    const appUrl = flag('app-url');
    const server = await preview(kit, { ...(port !== null ? { port: Number(port) } : {}), ...(appUrl ? { appUrl } : {}) });
    console.log(`\n  Preview: ${server.url}   roles: ${server.roles.join(', ')}`);
    console.log('  Local only: every role\'s files are served here, which production must never do. Ctrl+C to stop.\n');
    await new Promise(() => {}); // serve until interrupted
    return 0;
  }

  console.error(USAGE);
  return 2;
}
