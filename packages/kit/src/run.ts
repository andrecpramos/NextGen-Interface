import { writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { build } from './build.ts';
import type { ProseModel } from '@nextgen/generator';
import { calibrate } from './calibrate.ts';
import { init } from './detect.ts';
import { doctor } from './doctor.ts';
import { preview } from './preview.ts';
import { report } from './report.ts';

/**
 * Every command the tool has, minus the decision of what it is ALLOWED to reach.
 *
 * Two entry points call this with different capabilities, and the difference is the
 * product:
 *
 *   cli.ts          the installed `nextgen` command. Can use a local Ollama.
 *   cli-copied.ts   what is bundled into `adapter/scan.mjs`. Passes nothing, so
 *                   `ollamaModel` is unreachable from its import graph and the shipped
 *                   bundle contains no endpoint, no client, and no way to get one.
 *
 * A flag that turns a capability off still ships the capability. This ships neither,
 * which is what makes 'it cannot reach the network' checkable rather than promised
 * (ADR-018 D-6; `tooling/scripts/check-network-egress.mjs` covers `adapter/`).
 */
export interface Capabilities {
  /** How to reach a prose model. Absent: descriptions come from the app's own labels. */
  readonly proseModel?: (model: string, endpoint: string) => ProseModel;
  /** Where that model lives, when one is possible. */
  readonly defaultEndpoint?: string;
}

/**
 *   nextgen init <app folder> [--out <kit folder>] [--force]
 *   nextgen build [kit folder] [--model <name>] [--endpoint <url>]
 *   nextgen calibrate [kit folder] --golden <file.jsonl>
 *   nextgen doctor [kit folder] [--report <file.md>]
 *   nextgen preview [kit folder] [--port <n>] [--app-url <url>]
 *
 * The kit folder defaults to ./nextgen. Nothing is ever written outside it
 * (Rule 16). `build` without --model needs no model server: descriptions are
 * derived from the app's own labels, which is flatter but always available.
 *
 * `calibrate` requires a golden set you wrote (Rule 14), and there is
 * deliberately no way to calibrate from the generator's own examples — measured,
 * that makes the engine wrongly refuse real requests. See calibrate.ts.
 */

const USAGE = `usage:
  nextgen init <app folder> [--out <kit folder>] [--force]
  nextgen build [kit folder] [--model <name>] [--endpoint <url>]
  nextgen calibrate [kit folder] --golden <file.jsonl>
  nextgen doctor [kit folder] [--report <file.md>]
  nextgen preview [kit folder] [--port <n>] [--app-url <url>]`;

function flag(name: string): string | null {
  const index = process.argv.indexOf(`--${name}`);
  return index > -1 ? (process.argv[index + 1] ?? null) : null;
}

function positional(): string | null {
  const args = process.argv.slice(3);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg.startsWith('--')) {
      if (!['--force'].includes(arg)) i++;
      continue;
    }
    return arg;
  }
  return null;
}

export async function run(caps: Capabilities = {}): Promise<number> {
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
    console.log(`\n  Wrote ${join(result.kitDir, 'AGENT.md')}`);
    console.log('  If an AI agent is running these next steps: read that file first.');
    console.log('  It lists the decisions in here that are the developer\'s to make, not yours.');
    console.log(`\n  Next: nextgen build ${result.kitDir}\n`);
    return 0;
  }

  if (command === 'build') {
    const kit = resolve(positional() ?? 'nextgen');
    const record = await build(kit, {
      model: flag('model'),
      ...(caps.proseModel ? { proseModel: caps.proseModel, endpoint: flag('endpoint') ?? caps.defaultEndpoint ?? '' } : {}),
      onProgress: (done, total) => {
        if (done % 20 === 0 || done === total) console.log(`    ... ${done}/${total} screens described`);
      },
    });
    console.log(`\n  ${record.capabilities} screen(s) across ${record.roles.length} role(s); ${record.skipped.length} left out.`);
    console.log(`  Next: nextgen doctor ${kit}\n`);
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
