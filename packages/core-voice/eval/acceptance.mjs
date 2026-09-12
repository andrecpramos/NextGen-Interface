// WP-21 — voice acceptance, measured as a round trip.
//
// Voice has been built since WP-13/14 and "never acceptance-tested" (PLAN.md §3).
// This is the test: take real golden-set utterances for the registered
// application, speak them with Piper, hear them with whisper.cpp, and route both
// the original text and what whisper heard. Voice is acceptable when hearing an
// utterance changes the routing decision rarely — the router already has its own
// accuracy; what voice must not do is subtract from it.
//
// Reported:
//   word error rate           whisper's transcript against the original
//   routing agreement         same outcome and capability, text vs voice
//   latency                   synthesis and transcription per utterance
//
// Both binaries and both models are hash-pinned assets (core-voice/assets.ts);
// the whisper CLI downloads on first use and is refused if its sha256 differs.
//
// ⚠️ LIMIT, stated before the result rather than after: this script measures
// ENGLISH, with `base.en` and the en_US voice. That is deliberate and unchanged —
// English-only whisper is better at English, and WP-21's numbers were measured
// with it.
//
// Portuguese is measured separately by eval/fut-app/voice-acceptance.mjs (WP-44),
// which added a multilingual model and a pt_PT voice to the manifest and routes
// against fut-app's own role registries. Read eval/fut-app/VOICE-PT.md before
// quoting any voice number: English here is 7.1% word error, Portuguese there is
// 46-59%, and they are not interchangeable.
//
// Still untested by either: accented speech, and any real microphone.
//
//   node --experimental-strip-types packages/core-voice/eval/acceptance.mjs \
//     --registry=<path to a built registry.json> [--n 40]

import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { VoiceAssetStore, PiperTtsEngine, WhisperCppSttEngine } from '../src/index.ts';
import { makeEmbedder } from '../../core-intent/src/embedder.ts';
import { loadRegistry } from '../../core-intent/src/registry.ts';
import { route } from '../../core-intent/src/cascade.ts';
import { THRESHOLD_PROFILES } from '../../core-intent/src/config.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..');
const flag = (n, d) => {
  const i = process.argv.indexOf(`--${n}`);
  return i > -1 ? process.argv[i + 1] : d;
};
const N = Number(flag('n', '40'));

const store = new VoiceAssetStore({ directory: join(ROOT, 'models', 'voice') });
const tts = new PiperTtsEngine({ store });
const stt = new WhisperCppSttEngine({ store, timeoutMs: 120_000 });

// The application under test, English, with the thresholds calibrated for it.
const embedder = makeEmbedder('hashing');
const registryArg = process.argv.find((a) => a.startsWith('--registry='))?.split('=')[1];
if (!registryArg) {
  console.error(
    '\n  --registry=<path> is required: this package knows no application.' +
    '\n  Pass the generated registry of the application to measure.\n',
  );
  process.exit(2);
}
const registry = await loadRegistry(registryArg, embedder);
const thresholds = THRESHOLD_PROFILES.hashing;

const entries = readFileSync(join(ROOT, 'packages', 'core-intent', 'eval', 'golden-set.jsonl'), 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((l) => JSON.parse(l))
  // English only — see the limit above. Adversarial entries are kept: a spoken
  // injection must be refused exactly as a typed one is.
  .filter((e) => e.bucket !== 'non_english')
  .slice(0, N);

const words = (s) => s.toLowerCase().replace(/[^\p{L}\p{N}\s']/gu, ' ').split(/\s+/).filter(Boolean);

/** Levenshtein over words — the standard WER numerator. */
function wordEdits(ref, hyp) {
  const d = Array.from({ length: ref.length + 1 }, (_, i) => [i, ...Array(hyp.length).fill(0)]);
  for (let j = 1; j <= hyp.length; j++) d[0][j] = j;
  for (let i = 1; i <= ref.length; i++) {
    for (let j = 1; j <= hyp.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (ref[i - 1] === hyp[j - 1] ? 0 : 1));
    }
  }
  return d[ref.length][hyp.length];
}

const ctx = { route: '/', today: '2026-09-11' };
const dir = mkdtempSync(join(tmpdir(), 'nextgen-voice-'));

let edits = 0;
let refWords = 0;
let agree = 0;
let ttsMs = 0;
let sttMs = 0;
const disagreements = [];

for (const [i, e] of entries.entries()) {
  const t0 = performance.now();
  const wav = await tts.synthesize(e.utterance);
  const t1 = performance.now();
  const path = join(dir, `u${i}.wav`);
  writeFileSync(path, wav);
  const heard = await stt.transcribe(path);
  const t2 = performance.now();
  ttsMs += t1 - t0;
  sttMs += t2 - t1;

  const ref = words(e.utterance);
  const hyp = words(heard.text);
  edits += wordEdits(ref, hyp);
  refWords += ref.length;

  const typed = await route(e.utterance, ctx, { registry, embedder, thresholds, useStage3: false });
  const spoken = await route(heard.text, ctx, { registry, embedder, thresholds, useStage3: false });
  const same = typed.outcome === spoken.outcome && typed.capabilityId === spoken.capabilityId;
  if (same) agree++;
  else disagreements.push({ said: e.utterance, heard: heard.text, typed: `${typed.outcome}:${typed.capabilityId}`, spoken: `${spoken.outcome}:${spoken.capabilityId}` });
  if ((i + 1) % 10 === 0) process.stderr.write(`  ${i + 1}/${entries.length}\n`);
}

const n = entries.length;
const result = {
  measuredAt: new Date().toISOString(),
  utterances: n,
  wordErrorRate: edits / refWords,
  routingAgreement: agree / n,
  meanSynthesisMs: ttsMs / n,
  meanTranscriptionMs: sttMs / n,
  disagreements,
  limits: 'English only: whisper base.en and a single en_US Piper voice. Portuguese and accented speech are untested.',
};

console.log(`utterances            ${n} (English, synthesised by Piper en_US)`);
console.log(`word error rate       ${(100 * result.wordErrorRate).toFixed(1)}%`);
console.log(`routing agreement     ${agree}/${n} = ${(100 * result.routingAgreement).toFixed(1)}%  (same outcome and capability, typed vs spoken)`);
console.log(`mean synthesis        ${result.meanSynthesisMs.toFixed(0)}ms`);
console.log(`mean transcription    ${result.meanTranscriptionMs.toFixed(0)}ms`);
if (disagreements.length) {
  console.log('\nwhere hearing it changed the decision:');
  for (const d of disagreements.slice(0, 10)) console.log(`  said "${d.said}"\n  heard "${d.heard}"\n    typed ${d.typed}  ->  spoken ${d.spoken}`);
}

writeFileSync(join(HERE, 'acceptance.json'), `${JSON.stringify(result, null, 2)}\n`);
