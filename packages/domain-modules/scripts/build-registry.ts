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
 * ⚠️ `OUT_INTENT` is one global path, not namespaced per domain — only one
 * domain's build script may be authoritative at a time. This is now the one
 * the root `registry:build`/`registry:check` scripts invoke; running
 * `domain-finance`'s standalone would silently clobber this output.
 *
 *   node scripts/build-registry.ts [--check]
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..', '..');
const OUT_INTENT = join(REPO, 'packages', 'core-intent', 'eval', 'registry.json');
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

// OUT_INTENT is shared by every domain's build script (see the header). Refuse
// to replace a registry that describes a different application unless a human
// says so. Identical guard in domain-finance's script — deliberately duplicated
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
