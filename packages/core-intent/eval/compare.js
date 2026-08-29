import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, basename } from 'node:path';

/**
 * Side-by-side scorecard comparison.
 *
 * WP-01 asks whether a phone-class model can do stage-3 work. A single gate
 * table does not answer it: an 8B and a 1B model can post a similar top-1 number
 * while failing on completely different buckets, and the gates hide that. This
 * prints the per-bucket and per-stage view the decision actually rests on.
 *
 *   node eval/compare.js                                    # every scorecard
 *   node eval/compare.js ollama-llama3.1_8b ollama-gemma3_1b
 *
 * The FIRST scorecard named is the baseline.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const DIR = join(HERE, 'scorecards');

const named = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const tags = named.length
  ? named.map((n) => n.replace(/\.json$/, ''))
  : readdirSync(DIR)
      .filter((f) => f.endsWith('.json') && !f.startsWith('thresholds'))
      .map((f) => basename(f, '.json'));

const cards = tags.map((tag) => ({
  tag,
  card: JSON.parse(readFileSync(join(DIR, tag + '.json'), 'utf8')),
}));

if (cards.length === 0) {
  console.error('no scorecards found - run evaluate.js first');
  process.exit(2);
}

const W = 24;
const pct = (x) => (x === null || x === undefined ? 'n/a' : (x * 100).toFixed(1) + '%');
const ms = (x) => (x === null || x === undefined ? 'n/a' : Math.round(x) + 'ms');
const col = (s) => String(s).padStart(W);
const label = (s) => s.slice(0, 17).padEnd(18);

function header(title) {
  console.log('');
  console.log('== ' + title + ' ' + '='.repeat(Math.max(0, 70 - title.length)));
}

// ------------------------------------------------------------------ config --
header('CONFIG');
console.log('  ' + label('scorecard') + cards.map((c) => col(c.tag)).join(''));
console.log('  ' + label('embedder') + cards.map((c) => col(c.card.config.embedder)).join(''));
console.log('  ' + label('stage-3 model') + cards.map((c) => col(c.card.config.model ?? 'disabled')).join(''));
console.log('  ' + label('entries') + cards.map((c) => col(c.card.entries)).join(''));
console.log('  ' + label('generated') + cards.map((c) => col(c.card.generatedAt.slice(0, 16))).join(''));

// ------------------------------------------------------------------- gates --
header('GATES');
for (const g of Object.keys(cards[0].card.gates)) {
  const row = cards.map((c) => {
    const e = c.card.gates[g];
    return col(e ? pct(e.actual) + (e.pass ? ' ok' : ' FAIL') : 'n/a');
  });
  console.log('  ' + label(g) + row.join(''));
}
console.log('  ' + label('safety violations') + cards.map((c) => col(c.card.safetyViolations.length)).join(''));

// --------------------------------------------------------- per-bucket top-1 --
// The number WP-01 gates on. Bucket PASS rate is not a substitute: it also
// counts maxStage violations, which say nothing about whether the model can
// identify the right capability.
header('TOP-1 ACCURACY BY BUCKET');
const buckets = Object.keys(cards[0].card.buckets);
for (const b of buckets) {
  const row = cards.map((c) => {
    const e = c.card.buckets[b];
    if (!e || e.top1 === null || e.top1 === undefined) return col('n/a');
    return col(pct(e.top1) + ' (' + e.top1Correct + '/' + e.top1Total + ')');
  });
  console.log('  ' + label(b) + row.join(''));
}

// The stop-or-continue criterion. direct + paraphrase are the closest proxy for
// real traffic; the rest of the corpus is deliberately un-resolvable.
const combined = cards.map((c) => {
  let correct = 0;
  let total = 0;
  for (const b of ['direct', 'paraphrase']) {
    const e = c.card.buckets[b];
    if (e && e.top1Total) {
      correct += e.top1Correct;
      total += e.top1Total;
    }
  }
  return total ? correct / total : null;
});
console.log('  ' + '-'.repeat(18 + W * cards.length));
console.log('  ' + label('direct+paraphrase')
  + combined.map((x) => col(pct(x) + (x >= 0.70 ? ' ok' : ' BELOW 70%'))).join(''));

header('BUCKET PASS RATE (all assertions)');
for (const b of buckets) {
  const row = cards.map((c) => {
    const e = c.card.buckets[b];
    return col(e ? pct(e.rate) + ' (' + e.pass + '/' + e.total + ')' : 'n/a');
  });
  console.log('  ' + label(b) + row.join(''));
}

// ----------------------------------------------------------------- latency --
header('LATENCY');
const latRows = [
  ['total p50', (c) => c.card.latency.p50],
  ['total p95', (c) => c.card.latency.p95],
  ['stage2 p95', (c) => c.card.latency.stage2p95],
  ['stage3 p95', (c) => c.card.latency.stage3p95],
];
for (const [name, get] of latRows) {
  console.log('  ' + label(name) + cards.map((c) => col(ms(get(c)))).join(''));
}

header('STAGE-3 LATENCY p95 BY BUCKET');
for (const b of buckets) {
  const row = cards.map((c) => {
    const e = c.card.buckets[b];
    return col(e && e.stage3p95 ? ms(e.stage3p95) + ' (n=' + e.stage3Calls + ')' : '-');
  });
  console.log('  ' + label(b) + row.join(''));
}

// --------------------------------------------------------------- stage mix --
header('STAGE MIX');
const stages = [...new Set(cards.flatMap((c) => Object.keys(c.card.stageMix)))];
for (const s of stages) {
  console.log('  ' + label(s)
    + cards.map((c) => col(pct((c.card.stageMix[s] || 0) / c.card.entries))).join(''));
}
console.log('  ' + label('model-free') + cards.map((c) => col(pct(c.card.modelFreeRate))).join(''));

// ---------------------------------------------------------- stage-3 health --
if (cards.some((c) => c.card.stage3Health)) {
  header('STAGE-3 HEALTH (count, share of stage-3 calls)');
  for (const k of ['parseFailures', 'hallucinatedIds', 'outOfScopeSelected', 'belowTauAct', 'unavailable']) {
    const row = cards.map((c) => {
      const h = c.card.stage3Health;
      if (!h || !h.calls) return col('n/a');
      return col(h[k] + '  ' + pct(h[k] / h.calls));
    });
    console.log('  ' + label(k) + row.join(''));
  }
}

// --------------------------------------------------- disagreement analysis --
// Where two models fail on the same entry the cause is usually the corpus or
// the registry. Where only one fails, it is the model. That distinction is the
// whole reason for running a second model.
if (cards.length === 2) {
  const [a, b] = cards;
  const fa = new Map(a.card.failures.map((f) => [f.id, f]));
  const fb = new Map(b.card.failures.map((f) => [f.id, f]));
  const onlyA = [...fa.keys()].filter((id) => !fb.has(id));
  const onlyB = [...fb.keys()].filter((id) => !fa.has(id));
  const both = [...fa.keys()].filter((id) => fb.has(id));

  header('FAILURE OVERLAP');
  console.log('  both fail          ' + String(both.length).padStart(3)
    + '   <- corpus / registry / cascade, not the model');
  console.log('  only ' + a.tag.padEnd(26) + String(onlyA.length).padStart(3));
  console.log('  only ' + b.tag.padEnd(26) + String(onlyB.length).padStart(3));

  const show = (title, ids, map) => {
    if (!ids.length) return;
    console.log('');
    console.log('  ' + title);
    for (const id of ids.slice(0, 20)) {
      const f = map.get(id);
      console.log('    ' + id + ' [' + f.bucket + '] "' + f.utterance + '"');
      console.log('        -> ' + f.failures.join(' | '));
    }
    if (ids.length > 20) console.log('    ... and ' + (ids.length - 20) + ' more');
  };
  show('regressions unique to ' + b.tag + ':', onlyB, fb);
  show('failing only on ' + a.tag + ':', onlyA, fa);
}

console.log('');
