#!/usr/bin/env node
import { resolve } from 'node:path';

import { build } from './build.ts';
import { init } from './detect.ts';
import { doctor } from './doctor.ts';

/**
 *   nextgen init <app folder> [--out <kit folder>] [--force]
 *   nextgen build [kit folder] [--model <name>] [--endpoint <url>]
 *   nextgen doctor [kit folder]
 *
 * The kit folder defaults to ./nextgen. Nothing is ever written outside it
 * (Rule 16). `build` without --model needs no model server: descriptions are
 * derived from the app's own labels, which is flatter but always available.
 */

const USAGE = `usage:
  nextgen init <app folder> [--out <kit folder>] [--force]
  nextgen build [kit folder] [--model <name>] [--endpoint <url>]
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
    console.log(`  Next: nextgen build ${result.kitDir}\n`);
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
