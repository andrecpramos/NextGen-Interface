import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  checkRegistryOwnership,
  formatValidation,
  generateCapabilitiesJson,
  generateGoldenEntries,
  generateRouteTable,
  validateRegistry,
} from '@nextgen/core-capability';

import { registry } from '../src/capabilities.ts';

/**
 * Registry codegen.
 *
 * One source (`src/capabilities.ts`) produces the registry the intent engine
 * reads, the route table the app router reads, and the golden-set fixtures that
 * assert the two agree. A route cannot exist that the AI does not know about,
 * and the AI cannot know about a route that does not exist.
 *
 * `OUT_INTENT` is this domain's own `generated/registry.json` (WP-47, ADR-016).
 * Until then every domain wrote one shared path, this build was not the
 * authoritative one, and running it clobbered the registry the router loads.
 * It is now an ordinary command, checked by CI alongside domain-modules.
 *
 *   node scripts/build-registry.ts [--check]
 *
 * `--check` validates and prints without writing — the CI form.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_INTENT = join(HERE, '..', 'generated', 'registry.json');
const OUT_GEN = join(HERE, '..', 'generated');

const checkOnly = process.argv.includes('--check');

const result = validateRegistry(registry);
process.stdout.write(formatValidation(result));

if (!result.ok) {
  console.error('  registry is invalid — nothing written\n');
  process.exit(1);
}

const counts = registry.capabilities.reduce<Record<string, number>>((acc, c) => {
  acc[c.kind] = (acc[c.kind] ?? 0) + 1;
  return acc;
}, {});
console.log(`  ${registry.capabilities.length} capabilities: ` +
  Object.entries(counts).map(([k, n]) => `${n} ${k}`).join(', '));

const routes = generateRouteTable(registry);
const golden = generateGoldenEntries(registry);
console.log(`  ${routes.length} routes, ${golden.length} generated golden entries`);

if (checkOnly) {
  console.log('\n  --check: valid, nothing written\n');
  process.exit(0);
}

// Until WP-47 this was the documented way to break the router: every domain's
// build wrote one shared path, so an unguarded run here replaced the registry the
// app loads with a different application's capabilities, and everything
// downstream kept working, on the wrong app. Each domain now writes its own path
// and the guard is a backstop against a misconfigured OUT_INTENT. Identical guard
// in domain-modules' script, duplicated rather than shared so neither build
// script reaches into a sibling domain.
if (!process.argv.includes('--force') && existsSync(OUT_INTENT)) {
  const verdict = checkRegistryOwnership(
    readFileSync(OUT_INTENT, 'utf8'),
    registry.capabilities.map((c) => c.id),
  );
  if (!verdict.safe) {
    console.error(`\n  refusing to write — ${verdict.reason}\n`);
    process.exit(1);
  }
}

mkdirSync(OUT_GEN, { recursive: true });
writeFileSync(OUT_INTENT, generateCapabilitiesJson(registry), 'utf8');
writeFileSync(join(OUT_GEN, 'routes.json'), JSON.stringify(routes, null, 2) + '\n', 'utf8');
writeFileSync(
  join(OUT_GEN, 'golden.generated.jsonl'),
  golden.map((g) => JSON.stringify(g)).join('\n') + (golden.length ? '\n' : ''),
  'utf8',
);

console.log(`\n  wrote ${OUT_INTENT}`);
console.log(`  wrote ${join(OUT_GEN, 'routes.json')}`);
console.log(`  wrote ${join(OUT_GEN, 'golden.generated.jsonl')}\n`);
