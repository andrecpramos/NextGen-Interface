import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

import { FinanceApp, type AppOptions } from './app.ts';
import type { Decision } from '@nextgen/core-dispatch';

/**
 * The assistant surface, as a terminal.
 *
 * This is MVP-1's turn loop without the visual layer: speak an intent, land on
 * the right data, and be able to ask why. `apps/web` (WP-09) puts a UI on the
 * same assembly.
 */

const HELP = `
  Type what you want. Some things it can do:

    how much did I spend on food last month
    show my transactions
    what's my balance
    budgets
    add 45 for groceries              (a write — it will ask you to confirm)
    transfer 500 to my brother        (a declared limit — it will refuse)

  Commands:
    why      explain the last turn, from the record
    trace    the raw trace of the last turn
    stats    how many turns went to the model
    help     this
    exit
`;

function parseArgs(argv: readonly string[]): AppOptions {
  const opts: AppOptions = {};
  const get = (flag: string) => {
    const hit = argv.find((a) => a.startsWith(`${flag}=`));
    return hit ? hit.split('=')[1] : undefined;
  };
  const model = get('--model');
  const embedder = get('--embedder');
  return {
    ...opts,
    ...(model ? { model } : {}),
    ...(embedder === 'hashing' || embedder === 'ollama' ? { embedder } : {}),
    ...(argv.includes('--no-model') ? { noModel: true } : {}),
  };
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.includes('--help')) {
    console.log(HELP);
    return;
  }

  const options = parseArgs(argv);

  console.log('\n  NextGen — finance assistant');
  console.log('  ─────────────────────────────────────────────');

  const app = await FinanceApp.create(options);

  if (options.noModel) {
    console.log('  Running WITHOUT the language model (stages 1–2 only).');
    console.log('  Anything the deterministic and embedding stages cannot settle');
    console.log('  becomes a question rather than a guess — that is the offline path.');
  } else {
    console.log(`  Model: ${options.model ?? 'qwen2.5:1.5b'} via Ollama`);
  }
  console.log('  Data:  500 seeded transactions over 18 months, in memory.');
  console.log("  Type 'help' for ideas, 'why' after any turn, 'exit' to quit.\n");

  const rl = createInterface({ input: stdin, output: stdout });

  /**
   * Read one line, from a terminal or a pipe.
   *
   * `rl.question()` looks like the obvious call and does not survive piped
   * input: once stdin closes it never resolves again, so the loop hangs. The
   * async iterator ends cleanly instead — which also makes the CLI scriptable,
   * and that is what lets a demo session be replayed in CI.
   */
  const lines = rl[Symbol.asyncIterator]();
  const nextLine = async (prompt: string): Promise<string | null> => {
    stdout.write(prompt);
    const { value, done } = await lines.next();
    return done ? null : String(value).trim();
  };
  let pending: Decision | null = null;
  let turns = 0;
  let modelTurns = 0;

  for (;;) {
    const answer = await nextLine(pending ? '  confirm> ' : '  > ');
    if (answer === null) break;
    if (!answer) continue;

    // --- an outstanding confirmation takes priority over anything else -------
    if (pending) {
      if (/^(y|yes|confirm|ok|do it)$/i.test(answer)) {
        for (const line of await app.confirm(pending)) console.log(`  ${line}`);
      } else {
        console.log('  Cancelled. Nothing was written.');
      }
      pending = null;
      console.log('');
      continue;
    }

    const lower = answer.toLowerCase();
    if (lower === 'exit' || lower === 'quit') break;
    if (lower === 'help') {
      console.log(HELP);
      continue;
    }
    if (lower === 'why') {
      console.log('');
      for (const line of app.why().split('\n')) console.log(`  ${line}`);
      console.log('');
      continue;
    }
    if (lower === 'trace') {
      console.log(JSON.stringify(app.traceStore.latest(), null, 2));
      continue;
    }
    if (lower === 'stats') {
      const pct = turns === 0 ? 0 : Math.round((100 * (turns - modelTurns)) / turns);
      console.log(`\n  ${turns} turns, ${modelTurns} of them reached the model.`);
      console.log(`  ${pct}% resolved without inference.\n`);
      continue;
    }

    try {
      const result = await app.turn(answer);
      turns++;
      if (result.trace.latency.stage3 !== undefined) modelTurns++;

      console.log('');
      for (const line of result.output) console.log(`  ${line}`);

      const stage = result.trace.decidedAt;
      const ms = Math.round(result.trace.latency.total);
      console.log(`\n  \x1b[2m[${stage}, ${ms}ms — type 'why' to see how]\x1b[0m\n`);

      if (result.decision.type === 'confirm') pending = result.decision;
    } catch (err) {
      // Even a thrown turn produced a trace; say so rather than losing it.
      console.log(`\n  Something went wrong: ${err instanceof Error ? err.message : String(err)}`);
      console.log("  The turn was still recorded — type 'why'.\n");
    }
  }

  rl.close();
  console.log('\n  Bye.\n');
}

main().catch((err) => {
  console.error('\nfatal:', err);
  process.exit(1);
});
