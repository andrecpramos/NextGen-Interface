#!/usr/bin/env node
import { ollamaModel } from '@nextgen/generator';

import { run } from './run.ts';

/**
 * `nextgen` — the installed command.
 *
 * This is the npm path: the adopter ran `npm install` and has a `node_modules`, so a
 * local model server is a reasonable thing to offer. It passes `ollamaModel`, which is
 * the only reason this build can reach one at all.
 *
 * `adapter/scan.mjs` is the other entry point (`cli-copied.ts`) and passes nothing. See
 * `run.ts` for why that is a property of the artefact rather than of a flag.
 *
 * Usage, and what each command does, is in `run.ts`.
 */
async function main(): Promise<void> {
  try {
    process.exitCode = await run({ proseModel: ollamaModel, defaultEndpoint: 'http://localhost:11434' });
  } catch (error) {
    // A person runs this, not a pipeline: say what went wrong, without a stack.
    console.error(`\n  ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

void main();
