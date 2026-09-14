#!/usr/bin/env node
import { join, resolve } from 'node:path';

import { build } from './build.ts';
import { calibrate } from './calibrate.ts';
import { init } from './detect.ts';
import { doctor } from './doctor.ts';

/**
 *   nextgen init <app folder> [--out <kit folder>] [--force]
 *   nextgen build [kit folder] [--model <name>] [--endpoint <url>]
 *   nextgen calibrate [kit folder] --golden <file.jsonl>
 *   nextgen doctor [kit folder]
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
  nextgen doctor [kit folder]`;

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

async function main(): Promise<number> {
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
      endpoint: flag('endpoint') ?? 'http://localhost:11434',
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
    const report = doctor(resolve(positional() ?? 'nextgen'));
    console.log(report.text);
    return report.ok ? 0 : 1;
  }

  console.error(USAGE);
  return 2;
}

try {
  process.exitCode = await main();
} catch (error) {
  // A person runs this, not a pipeline: say what went wrong, without a stack.
  console.error(`\n  ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
