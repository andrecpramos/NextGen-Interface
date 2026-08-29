import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { makeEmbedder } from '../src/embedder.js';
import { loadRegistry } from '../src/registry.js';
import { stage2 } from '../src/stages.js';
import { THRESHOLDS } from '../src/config.js';

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * Score distribution inspector.
 *
 * Thresholds are encoder-specific: TF-IDF cosine and a sentence encoder do not
 * live on the same scale, so a tauHigh tuned for one is meaningless for the
 * other. Look at the distribution before touching config.js.
 */
const args = process.argv.slice(2);
const embedderKind = args.find((a) => a.startsWith('--embedder='))?.split('=')[1] || 'hashing';
const single = args.find((a) => !a.startsWith('--'));

const embedder = makeEmbedder(embedderKind);
const registry = await loadRegistry(join(HERE, 'registry.json'), embedder);

if (single) {
  const s2 = await stage2(single, registry, embedder);
  console.log(`\n  "${single}"   [${embedder.name}]\n`);
  for (const c of s2.all.slice(0, 8)) {
    const bar = 'â–ˆ'.repeat(Math.round(c.score * 40));
    console.log(`   ${c.score.toFixed(3)}  ${bar.padEnd(40)}  ${c.capabilityId}`);
  }
  console.log(`\n   margin ${s2.margin.toFixed(3)}   decision: ${s2.decision}\n`);
  process.exit(0);
}

const entries = readFileSync(join(HERE, 'golden-set.jsonl'), 'utf8')
  .split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));

const rows = [];
for (const e of entries) {
  const s2 = await stage2(e.utterance, registry, embedder);
  const expected = e.expect?.capability;
  const rank = expected ? s2.all.findIndex((c) => c.capabilityId === expected) : -1;
  rows.push({
    bucket: e.bucket, top: s2.top.score, margin: s2.margin,
    correctTop: expected ? s2.all[0].capabilityId === expected : null,
    rank: rank >= 0 ? rank + 1 : null,
    hasExpected: Boolean(expected),
  });
}

const stats = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
  return { min: s[0], p10: q(10), p50: q(50), p90: q(90), max: s[s.length - 1] };
};

console.log(`\n  embedder: ${embedder.name}   dim: ${embedder.dim ?? 'n/a'}\n`);
console.log('  â”€â”€ top-1 score distribution by bucket â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€');
console.log('  bucket          min    p10    p50    p90    max    top1-correct');
const byBucket = {};
for (const r of rows) (byBucket[r.bucket] ??= []).push(r);
for (const [b, rs] of Object.entries(byBucket)) {
  const st = stats(rs.map((r) => r.top));
  const withExp = rs.filter((r) => r.hasExpected);
  const acc = withExp.length ? withExp.filter((r) => r.correctTop).length / withExp.length : null;
  console.log(
    `  ${b.padEnd(14)} ${st.min.toFixed(3)}  ${st.p10.toFixed(3)}  ${st.p50.toFixed(3)}  ` +
    `${st.p90.toFixed(3)}  ${st.max.toFixed(3)}   ${acc === null ? '   n/a' : `${(acc * 100).toFixed(1)}%`}`,
  );
}

const routable = rows.filter((r) => r.hasExpected);
console.log('\n  â”€â”€ recall@k (is the right answer in the top k?) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€');
for (const k of [1, 2, 3, 5]) {
  const hit = routable.filter((r) => r.rank !== null && r.rank <= k).length;
  console.log(`  recall@${k}   ${((hit / routable.length) * 100).toFixed(1)}%`);
}
console.log(`\n  Recall@${THRESHOLDS.topK} is the ceiling on stage 3: it can only pick from what stage 2 hands it.\n`);
