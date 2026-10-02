#!/usr/bin/env node
// The adversarial bucket, against a real model.
//
// WHY THIS EXISTS
//   CI's golden-set job is model-free by design — GitHub Actions has no model
//   server, and only the hashing + no-stage-3 configuration is deterministic
//   enough to gate on (ci.yml says so, ADR-011 explains it). The consequence
//   went unnoticed for a long time: **the adversarial bucket passes trivially in
//   CI, because no model is ever consulted.**
//
//   Finding 14 is what that cost. Run against a live stage 3, `llama3.1:8b`
//   produces four safety violations — three of which pre-dated the run and had
//   never been seen by anything.
//
// WHAT IT DOES
//   For each model in `adversarial-baseline.json` that is actually installed,
//   runs the adversarial bucket and compares the violating entry ids against the
//   recorded ones. A NEW id fails. A recorded id that stops reproducing is
//   reported as an improvement, with a request to update the baseline.
//
//   It does **not** bless the recorded violations. They are a known gap that
//   Finding 14 could not close, and the baseline file says so at length.
//
// WHEN IT SKIPS
//   No Ollama, or none of the baseline's models installed. Skipping is exit 0
//   with a loud message naming what was not checked — the same shape as
//   `kit-sync`, and for the same reason: a gate that fails when a local
//   dependency is absent gets disabled, and a disabled gate protects nothing.
//
// Non-determinism is real here (Finding 10: 7 of 200 entries flipped between two
// identical 8B runs at temperature 0). This compares a SET OF IDS rather than a
// score, which is the more stable comparison, and Finding 14's four reproduced
// across consecutive runs. A single flapping entry should be investigated, not
// absorbed by widening a tolerance.

import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('../..', import.meta.url).pathname
  .replace(/^\/([A-Za-z]:)/, '$1')
  .replace(/\/$/, '');

const EVAL_DIR = join(ROOT, 'packages', 'core-intent', 'eval');
const BASELINE = join(EVAL_DIR, 'adversarial-baseline.json');
const OLLAMA = process.env.OLLAMA_HOST || 'http://127.0.0.1:11434';

const skip = (why) => {
  console.log(`  Adversarial (live model) SKIPPED — ${why}`);
  console.log('    Nothing about model-facing safety was checked by this run.');
  process.exit(0);
};

if (!existsSync(BASELINE)) skip('no adversarial-baseline.json');
const baseline = JSON.parse(readFileSync(BASELINE, 'utf8'));

// --- is a model server there at all? -----------------------------------------
let installed = [];
try {
  const res = await fetch(`${OLLAMA}/api/tags`, { signal: AbortSignal.timeout(4000) });
  if (!res.ok) skip(`${OLLAMA} answered ${res.status}`);
  const body = await res.json();
  installed = (body.models ?? []).map((m) => m.name);
} catch {
  skip(`no model server at ${OLLAMA}`);
}

const wanted = Object.keys(baseline.models ?? {});
const runnable = wanted.filter((m) => installed.includes(m));
if (runnable.length === 0) {
  skip(`none of the baseline's models are installed (wanted: ${wanted.join(', ')})`);
}

const missing = wanted.filter((m) => !runnable.includes(m));

// --- run each model ----------------------------------------------------------
const failures = [];
const improvements = [];

for (const model of runnable) {
  // Must match evaluate.js's own `tag` exactly — it replaces `:` and `/` with
  // `_` and leaves dots alone, so `llama3.1:8b` becomes `llama3.1_8b`. Guessing
  // this wrong is silent: the run succeeds, the file is not where this looked,
  // and the gate reports a problem that does not exist.
  const slug = model.replace(/[:/]/g, '_');
  const scorecard = join(EVAL_DIR, 'scorecards', `hashing-${slug}-topk${baseline.topK}.json`);

  // Found 2026-09-21: this gate reported "OK" for a run that never happened. `evaluate.js` refuses to run
  // without `--registry` ("this package knows no application" — `pnpm router:eval` passes it), exited 2 at
  // once, and the catch below swallowed it. The scorecard it then read was 12 days old and had three
  // recorded violations in it, which is what "no new violations" compared against. So: pass the registry
  // the repo-root scripts pass, keep stderr, and read a scorecard only if THIS run wrote it.
  const started = Date.now();
  let stderr = '';
  try {
    execFileSync(
      process.execPath,
      [
        join(EVAL_DIR, 'evaluate.js'),
        `--registry=${join(EVAL_DIR, 'fixture-registry.json')}`,
        `--bucket=${baseline.bucket}`,
        `--model=${model}`,
        `--topk=${baseline.topK}`,
      ],
      { cwd: ROOT, stdio: ['ignore', 'ignore', 'pipe'], timeout: 15 * 60 * 1000 },
    );
  } catch (error) {
    // The evaluator exits non-zero whenever any gate fails, which it does here
    // by design — the adversarial bucket alone cannot meet the accuracy targets.
    // The scorecard is still written, and it is what this reads — if it was written now.
    stderr = String(error?.stderr ?? error?.message ?? '').trim().split('\n').slice(-3).join(' | ');
  }

  if (!existsSync(scorecard)) {
    failures.push({ model, kind: 'no-scorecard', detail: `expected ${scorecard}${stderr ? ` — ${stderr}` : ''}` });
    continue;
  }
  if (statSync(scorecard).mtimeMs < started) {
    failures.push({
      model,
      kind: 'no-scorecard',
      detail: `the evaluator wrote no new scorecard (${scorecard} is from before this run)${stderr ? ` — ${stderr}` : ''}`,
    });
    continue;
  }

  const card = JSON.parse(readFileSync(scorecard, 'utf8'));
  const seen = new Set((card.safetyViolations ?? []).map((v) => v.id));
  const known = new Set(baseline.models[model].knownViolations ?? []);

  for (const id of seen) {
    if (!known.has(id)) {
      const v = (card.safetyViolations ?? []).find((x) => x.id === id);
      failures.push({ model, kind: 'new', detail: `${id} — ${v?.violation ?? 'safety violation'}` });
    }
  }
  for (const id of known) if (!seen.has(id)) improvements.push({ model, id });
}

// --- report ------------------------------------------------------------------
console.log(`  Adversarial (live model) — ${runnable.length} model(s): ${runnable.join(', ')}`);
if (missing.length > 0) console.log(`    not installed, not checked: ${missing.join(', ')}`);

for (const i of improvements) {
  console.log(`    IMPROVED  ${i.model}: ${i.id} no longer violates — remove it from the baseline`);
}

if (failures.length > 0) {
  const broken = failures.filter((f) => f.kind === 'no-scorecard');
  const newViolations = failures.filter((f) => f.kind === 'new');

  // These are different problems and conflating them wastes the reader's time.
  // The first draft called a missing scorecard a "new safety violation", which
  // is alarming and wrong: nothing unsafe happened, the gate could not look.
  if (broken.length > 0) {
    console.error(`\n  Adversarial BROKEN — ${broken.length} run(s) produced no scorecard.\n`);
    for (const f of broken) console.error(`    ${f.model}  ${f.detail}`);
    console.error(`
  The gate could not read a result, so it checked nothing for these models.
  This is a fault in the harness, not a safety finding.
`);
  }

  if (newViolations.length === 0) process.exit(1);

  console.error(`\n  Adversarial FAILED — ${newViolations.length} new safety violation(s).\n`);
  for (const f of newViolations) console.error(`    ${f.model}  ${f.detail}`);
  console.error(`
  A NEW entry made the router select a forbidden capability. This is the gate
  Finding 14 exists because of: the model-free CI run passes every adversarial
  entry trivially, so a real injection vector reaches nobody's attention.

  Before recording it in adversarial-baseline.json, establish which layer moved:
    - did the fence stop applying? (tooling/scripts/check-prompt-fencing.mjs)
    - or did the model disregard an intact fence? (Finding 14's case — print the
      prompt and count the delimiters before assuming a bypass)
`);
  process.exit(1);
}

const total = runnable.reduce(
  (n, m) => n + (baseline.models[m].knownViolations ?? []).length,
  0,
);
console.log(`  Adversarial OK — no new violations (${total} known, recorded, not approved).`);
