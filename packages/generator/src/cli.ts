import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { generate } from './generate.ts';
import { formatRoleSummary, writeOutput, writeIndexes } from './emit.ts';
import { ollamaModel, type ProseCache } from './synthesise.ts';
import { normaliseConfig, REQUIRED_FIELD_HELP } from './config.ts';
import { loadKnowledge } from './knowledge-file.ts';
import type { GeneratorConfig } from './types.ts';

/**
 *   node --experimental-strip-types src/cli.ts <config.json> [options]
 *
 *     --out <dir>      where to write the bundle (default: the config's `out`)
 *     --model <name>   the model that writes descriptions and examples
 *     --no-model       derive prose from the app's own labels instead
 *     --endpoint <url> the model host (default http://localhost:11434)
 *
 * The config is a `GeneratorConfig` plus an `out` path. Both are the adopter's
 * to write once; nothing here is interactive, because "no human step" is the
 * goal WP-25 is measured against.
 */

interface CliConfig extends GeneratorConfig {
  readonly out?: string;
}

/** Validation lives in config.ts so it can be tested; importing this file runs `main()`. */
function normalise(raw: CliConfig, configFile: string): CliConfig {
  const { config, problem } = normaliseConfig(raw);
  if (problem) {
    console.error(`  ${configFile}`);
    console.error(`  missing required field(s): ${problem.missing.join(', ')}`);
    for (const field of problem.missing) {
      console.error(`    ${field.padEnd(11)} ${REQUIRED_FIELD_HELP[field] ?? ''}`);
    }
    process.exit(2);
  }
  return config;
}

function flag(name: string): string | null {
  const index = process.argv.indexOf(`--${name}`);
  return index > -1 ? (process.argv[index + 1] ?? null) : null;
}

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

async function main(): Promise<void> {
  const configPath = process.argv[2];
  if (!configPath || configPath.startsWith('--')) {
    console.error('usage: cli.ts <config.json> [--out dir] [--model name] [--no-model]');
    process.exit(2);
  }

  const configFile = resolve(configPath);
  const config = normalise(JSON.parse(stripBom(readFileSync(configFile, 'utf8'))) as CliConfig, configFile);
  // Relative paths in a config file are relative to that file, not to wherever
  // the command happened to be run from.
  const appRoot = resolve(dirname(configFile), config.appRoot);
  const outputDir = resolve(dirname(configFile), flag('out') ?? config.out ?? 'generated');

  const useModel = !process.argv.includes('--no-model');
  const modelName = flag('model') ?? 'llama3.1:8b';
  const endpoint = flag('endpoint') ?? 'http://localhost:11434';

  const cacheFile = resolve(outputDir, 'prose-cache.json');
  const cache: ProseCache = existsSync(cacheFile)
    ? (JSON.parse(readFileSync(cacheFile, 'utf8')) as ProseCache)
    : {};
  const cachedBefore = Object.keys(cache).length;

  // What the adopter wrote about their own app: beside the config, or where the config says.
  const knowledgeLoaded = loadKnowledge(configFile, config.knowledge);

  console.log(`  reading ${appRoot}`);
  if (knowledgeLoaded.found) console.log(`  knowledge: ${knowledgeLoaded.path}`);
  for (const problem of knowledgeLoaded.problems) console.warn(`  knowledge.json: ${problem.path ? `${problem.path}: ` : ''}${problem.message}`);
  console.log(`  prose:  ${useModel ? `${modelName} at ${endpoint}` : 'derived from the app’s own labels (--no-model)'}`);
  if (cachedBefore > 0) console.log(`  cache:  ${cachedBefore} entries`);

  const output = await generate({
    config: { ...config, appRoot },
    knowledge: knowledgeLoaded.knowledge,
    model: useModel ? ollamaModel(modelName, endpoint) : null,
    cache,
    onProgress: (done, total) => {
      if (done % 20 === 0 || done === total) console.log(`    ... ${done}/${total} screens described`);
    },
  });

  const result = writeOutput(outputDir, appRoot, output);

  // WP-24: the precomputed index, so stages 1+2 can run with no model server
  // and no fit on the critical path of the first turn.
  const indexes = await writeIndexes(outputDir, output.registries);

  // An empty cache is not written: with no model it could only ever say `{}`.
  if (Object.keys(cache).length > 0) writeFileSync(cacheFile, `${JSON.stringify(cache, null, 2)}\n`, 'utf8');
  else rmSync(cacheFile, { force: true });

  console.log(`\n${formatRoleSummary(output)}\n`);
  console.log(`  wrote ${result.files.length + indexes.length + 1} files to ${outputDir}`);
  console.log(`  including ${indexes.length} precomputed embedding index/indexes (WP-24)`);

  if (result.invalid.length > 0) {
    console.error(`\n  ${result.invalid.length} role registry/registries failed validation:\n`);
    for (const report of result.invalid) console.error(report);
    process.exit(1);
  }
  console.log('  every role registry passes validateRegistry()\n');
}

await main();
