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
 * Same script as `domain-finance/scripts/build-registry.ts`, same reasoning —
 * one source produces the registry the intent engine reads, the route table
 * the app router reads, and the golden-set fixtures that assert the two
 * agree.
 *
 * `OUT_INTENT` is this domain's own `generated/registry.json` (WP-47, ADR-016).
 * Until then every domain wrote one shared path and only one could be
 * authoritative at a time; the eval scripts now take `--registry=` instead.
 *
 *   node scripts/build-registry.ts [--check]
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

// OUT_INTENT is this domain's own path since WP-47, so this refusal now needs a
// misconfigured output rather than a mistyped command. Kept anyway: replacing a
// registry that describes a different application is the worst failure available
// here, and it is one `existsSync` to rule out. Identical guard in
// domain-finance's script — deliberately duplicated
// rather than shared, because a build script reaching into a sibling domain is
// the coupling Rule 1 exists to prevent.
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
