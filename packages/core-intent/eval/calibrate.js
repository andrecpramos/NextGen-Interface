import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { makeEmbedder } from '../src/embedder.ts';
import { loadRegistry } from '../src/registry.ts';
import { stage1, stage2 } from '../src/stages.ts';

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * Threshold calibration.
 *
 * Thresholds must never be hand-tuned against a handful of manual tries â€” that
 * over-samples the phrasings you already thought of. This sweeps the operating
 * space against the whole golden set and picks a point against an explicit
 * objective.
 *
 * The objective encodes a value judgement worth stating out loud:
 *
 *   Maximise the share of turns stage 2 can accept outright (that is latency,
 *   battery and offline viability), SUBJECT TO a hard floor on the precision of
 *   those acceptances.
 *
 * Accepting wrongly is far more expensive than escalating unnecessarily. An
 * escalation costs ~500ms. A wrong acceptance on a write capability corrupts
 * financial data behind a confirmation card the user will probably tap through.
 * So precision is a constraint, not a term to be traded off.
 */

const args = process.argv.slice(2);
const embedderKind = args.find((a) => a.startsWith('--embedder='))?.split('=')[1] || 'hashing';

/**
 * --defer-oos pins tauFloor to 0 and drops the out-of-scope constraint, which
 * is the configuration the trade-off curve below argues for: stage 2 refuses
 * nothing, and domain membership is decided at stage 3 where it is a semantic
 * judgement. Use it to find the accept rate actually available to stage 2.
 */
const deferOos = args.includes('--defer-oos');

const PRECISION_FLOOR = 0.95; // of the turns stage 2 accepts, how many must be right
const OOS_FLOOR = deferOos ? 0 : 0.95; // out-of-scope utterances kept below tauFloor
const AMBIG_FLOOR = 0.95;     // ambiguous utterances NOT accepted outright

const embedder = makeEmbedder(embedderKind);
const registry = await loadRegistry(join(HERE, 'registry.json'), embedder);

const entries = readFileSync(join(HERE, 'golden-set.jsonl'), 'utf8')
  .split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));

// Score every utterance once; the sweep is then pure arithmetic over the cache.
console.log(`\n  scoring ${entries.length} utterances with ${embedder.name}â€¦`);
const scored = [];
for (const e of entries) {
  const s1 = stage1(e.utterance, registry);
  const s2 = await stage2(e.utterance, registry, embedder, { tauHigh: 2, delta: 2, tauFloor: -1, topK: 5 });
  scored.push({
    entry: e,
    stage1Hit: s1?.capabilityId ?? null,
    top: s2.all[0],
    margin: s2.margin,
    all: s2.all,
    expected: e.expect?.capability ?? null,
    bucket: e.bucket,
  });
}

const range = (from, to, step) => {
  const out = [];
  for (let v = from; v <= to + 1e-9; v += step) out.push(Math.round(v * 1000) / 1000);
  return out;
};

function evaluate(tauHigh, delta, tauFloor) {
  let accepted = 0, acceptedCorrect = 0;
  let oosCaught = 0, oosTotal = 0;
  let ambigSafe = 0, ambigTotal = 0;
  let stage1Resolved = 0;

  for (const s of scored) {
    if (s.stage1Hit) stage1Resolved++;

    const belowFloor = s.top.score < tauFloor;
    const accept = !belowFloor && s.top.score >= tauHigh && s.margin >= delta;

    if (s.bucket === 'out_of_scope') {
      oosTotal++;
      if (belowFloor) oosCaught++;
      continue;
    }
    if (s.bucket === 'ambiguous') {
      ambigTotal++;
      // Must reach CLARIFY specifically. Falling below tauFloor sends it to
      // OutOfScope instead, which tells an in-app user "I can't help with
      // that" when the honest answer is "which of these did you mean?".
      if (!accept && !belowFloor) ambigSafe++;
      continue;
    }
    if (accept) {
      accepted++;
      if (s.expected && s.top.capabilityId === s.expected) acceptedCorrect++;
      else if (!s.expected) acceptedCorrect++; // adversarial/no-expectation: not a precision miss here
    }
  }

  const routable = scored.filter((s) => s.bucket !== 'out_of_scope' && s.bucket !== 'ambiguous').length;
  return {
    tauHigh, delta, tauFloor,
    acceptRate: accepted / routable,
    precision: accepted ? acceptedCorrect / accepted : 1,
    oosRate: oosTotal ? oosCaught / oosTotal : 1,
    ambigRate: ambigTotal ? ambigSafe / ambigTotal : 1,
    stage1Rate: stage1Resolved / scored.length,
  };
}

const topScores = scored.map((s) => s.top.score).sort((a, b) => a - b);
const lo = topScores[0], hi = topScores[topScores.length - 1];
console.log(`  score range observed: ${lo.toFixed(3)} â€¦ ${hi.toFixed(3)}\n`);

const results = [];
const floors = deferOos ? [0] : range(lo, lo + (hi - lo) * 0.6, (hi - lo) / 40);
for (const tauHigh of range(lo, hi, (hi - lo) / 40)) {
  for (const delta of range(0.01, 0.25, 0.01)) {
    for (const tauFloor of floors) {
      if (tauFloor >= tauHigh) continue;
      results.push(evaluate(tauHigh, delta, tauFloor));
    }
  }
}

const feasible = results.filter(
  (r) => r.precision >= PRECISION_FLOOR && r.oosRate >= OOS_FLOOR && r.ambigRate >= AMBIG_FLOOR,
);

console.log(`  swept ${results.length} operating points, ${feasible.length} feasible`);
console.log(`  constraints: precision >= ${PRECISION_FLOOR}, oos >= ${OOS_FLOOR}, ambiguous-safe >= ${AMBIG_FLOOR}\n`);

if (feasible.length === 0) {
  console.log('  NO FEASIBLE OPERATING POINT.');
  console.log('  Stage 2 cannot accept anything at this precision with this encoder.');
  console.log('  That is a finding, not a failure: it means every routable turn must');
  console.log('  reach stage 3, and the model-free rate gate cannot be met by stage 2');
  console.log('  alone with these embeddings.\n');
  // Which constraint is actually binding? Show the frontier so the trade-off is
  // a number rather than an assertion.
  const precisionOk = results.filter((r) => r.precision >= PRECISION_FLOOR);
  console.log('  â”€â”€ tauFloor trade-off: OOS detection vs ambiguousâ†’clarify â”€â”€â”€â”€â”€');
  console.log('  Both live in the same low-score band, so tauFloor cannot separate');
  console.log('  them. Raising it catches off-domain input and misfiles vague');
  console.log('  in-domain input as "I can\'t help"; lowering it does the reverse.\n');
  console.log('  tauFloor    OOS detected    ambiguousâ†’clarify');
  const byFloor = new Map();
  for (const r of precisionOk) {
    const cur = byFloor.get(r.tauFloor);
    if (!cur || r.acceptRate > cur.acceptRate) byFloor.set(r.tauFloor, r);
  }
  for (const [floor, r] of [...byFloor.entries()].sort((a, b) => a[0] - b[0])) {
    console.log(`   ${floor.toFixed(3)}       ${(r.oosRate * 100).toFixed(0).padStart(3)}%            ${(r.ambigRate * 100).toFixed(0).padStart(3)}%`);
  }

  const bestSum = [...byFloor.values()].sort((a, b) => (b.oosRate + b.ambigRate) - (a.oosRate + a.ambigRate))[0];
  console.log(`\n  best joint point: tauFloor=${bestSum.tauFloor} â†’ OOS ${(bestSum.oosRate * 100).toFixed(0)}%, ambiguous ${(bestSum.ambigRate * 100).toFixed(0)}%`);
  console.log('\n  Recommendation: stop rejecting at stage 2. Set tauFloor below the');
  console.log('  observed minimum so nothing is refused on lexical evidence alone,');
  console.log('  and let stage 3 make the in-domain / out-of-domain call â€” it is a');
  console.log('  semantic judgement, which is what the model is actually good at.\n');
  process.exit(1);
}

feasible.sort((a, b) => b.acceptRate - a.acceptRate || b.precision - a.precision);
const best = feasible[0];

console.log('  â”€â”€ best operating points â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€');
console.log('  tauHigh  delta  tauFloor   accept   precision   oos    ambig');
for (const r of feasible.slice(0, 10)) {
  console.log(
    `   ${r.tauHigh.toFixed(3)}   ${r.delta.toFixed(2)}   ${r.tauFloor.toFixed(3)}    ` +
    `${(r.acceptRate * 100).toFixed(1)}%     ${(r.precision * 100).toFixed(1)}%   ` +
    `${(r.oosRate * 100).toFixed(0)}%   ${(r.ambigRate * 100).toFixed(0)}%`,
  );
}

console.log(`\n  â”€â”€ recommended for "${embedder.name}" â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€`);
console.log(`  tauHigh:  ${best.tauHigh}`);
console.log(`  delta:    ${best.delta}`);
console.log(`  tauFloor: ${best.tauFloor}`);
console.log(`\n  stage 1 alone resolves ${(best.stage1Rate * 100).toFixed(1)}% of all turns`);
console.log(`  stage 2 accepts ${(best.acceptRate * 100).toFixed(1)}% of routable turns at ${(best.precision * 100).toFixed(1)}% precision\n`);

mkdirSync(join(HERE, 'scorecards'), { recursive: true });
writeFileSync(
  join(HERE, 'scorecards', `thresholds-${embedderKind}.json`),
  JSON.stringify({ embedder: embedder.name, calibratedAt: new Date().toISOString(), constraints: { PRECISION_FLOOR, OOS_FLOOR, AMBIG_FLOOR }, recommended: best, alternatives: feasible.slice(0, 10) }, null, 2),
);
console.log(`  written â†’ eval/scorecards/thresholds-${embedderKind}.json\n`);
