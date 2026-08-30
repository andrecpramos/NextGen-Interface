import type { TurnTrace } from './types.ts';

/**
 * "Why did you do that?" — rendered entirely from the record.
 *
 * Every sentence below is assembled from ids, scores, enums and resolved values.
 * Nothing is asked of a model, which is what makes the answer *true* rather than
 * plausible: the system is reporting what happened, not producing an account of
 * itself after the fact.
 *
 * It also means this works offline, works when the model has been unloaded, and
 * cannot drift from the behaviour it describes.
 */

export interface Explanation {
  /** One line: what it did. */
  readonly headline: string;
  /** How it decided, in the order it decided. */
  readonly steps: readonly string[];
  /** What else it nearly chose, and by how much it lost. */
  readonly alternatives: readonly string[];
  /** What it read. */
  readonly dataUsed: readonly string[];
  /** Where each visible value came from. */
  readonly values: readonly string[];
  readonly timing: string;
}

const STAGE_NAMES: Record<string, string> = {
  deterministic: 'a phrase it knows exactly',
  embedding: 'similarity to the capability descriptions',
  llm: 'the language model, choosing from a shortlist',
  none: 'no stage reached a decision',
};

export function explain(trace: TurnTrace): Explanation {
  const steps: string[] = [];
  const alternatives: string[] = [];
  const dataUsed: string[] = [];
  const values: string[] = [];

  // ---- headline -------------------------------------------------------------
  let headline: string;
  switch (trace.outcome) {
    case 'execute':
      headline = trace.requiresConfirmation
        ? `Asked you to confirm "${trace.capabilityId}" before doing it.`
        : `Ran "${trace.capabilityId}".`;
      break;
    case 'clarify':
      headline = trace.missing.length
        ? `Asked a question, because ${trace.missing.join(' and ')} ${trace.missing.length === 1 ? 'was' : 'were'} missing.`
        : 'Asked a question rather than guessing.';
      break;
    case 'out_of_scope':
      headline = 'Said this is outside what the app does.';
      break;
    case 'error':
      headline = 'Could not complete the turn.';
      break;
  }

  // ---- how it decided -------------------------------------------------------
  steps.push(`You said: "${trace.transcript}"`);
  if (trace.sttConfidence !== undefined) {
    steps.push(`Speech recognition was ${(trace.sttConfidence * 100).toFixed(0)}% confident of that transcript.`);
  }
  steps.push(`Decided using ${STAGE_NAMES[trace.decidedAt] ?? trace.decidedAt}.`);

  if (trace.decidedAt === 'llm' && trace.modelId) {
    steps.push(
      `The model (${trace.modelId}${trace.promptVersion ? `, prompt ${trace.promptVersion}` : ''}) ` +
        `chose from ${trace.candidates.length} shortlisted option${trace.candidates.length === 1 ? '' : 's'} — ` +
        'it was never shown the full list of what this app can do.',
    );
  }

  if (trace.capabilityKind === 'write' || trace.capabilityKind === 'destructive') {
    steps.push(
      `"${trace.capabilityId}" is a ${trace.capabilityKind} action, so confirmation is required. ` +
        'That rule is in the code and does not depend on how confident anything was.',
    );
  }
  if (trace.capabilityKind === 'unsupported') {
    steps.push('This matched something the app declares it does not do, so it was refused rather than guessed at.');
  }

  for (const note of trace.notes) steps.push(note);

  // ---- alternatives ---------------------------------------------------------
  const [top, ...rest] = trace.candidates;
  if (top && rest.length > 0) {
    for (const c of rest.slice(0, 3)) {
      const gap = top.score - c.score;
      alternatives.push(
        `${c.capabilityId} — scored ${c.score.toFixed(3)}, ${gap.toFixed(3)} behind ${top.capabilityId}`,
      );
    }
  }

  // ---- data -----------------------------------------------------------------
  for (const d of trace.dataRead) {
    const range = d.from && d.to ? ` between ${d.from} and ${d.to}` : '';
    dataUsed.push(`${d.rowCount} row${d.rowCount === 1 ? '' : 's'} from ${d.table}${range}`);
  }
  if (dataUsed.length === 0) dataUsed.push('No stored data was read.');

  // ---- values ---------------------------------------------------------------
  // The important half. A user checking a number wants to know whether a machine
  // computed it or a model guessed it.
  for (const [name, value] of Object.entries(trace.params)) {
    const source = trace.paramSources[name] ?? 'model';
    const how =
      source === 'deterministic'
        ? 'worked out by code from what you said'
        : source === 'context'
          ? 'taken from the screen you were on'
          : 'read from your words by the model';
    values.push(`${name} = ${value} (${how})`);
  }
  if (values.length === 0) values.push('No values were needed.');

  const timing =
    `Took ${Math.round(trace.latency.total)}ms` +
    (trace.latency.stage3 !== undefined
      ? `, of which ${Math.round(trace.latency.stage3)}ms was the model.`
      : ', without using the model at all.');

  return { headline, steps, alternatives, dataUsed, values, timing };
}

/** Flatten an explanation for a terminal, a log, or an accessibility reader. */
export function formatExplanation(e: Explanation): string {
  const lines = [e.headline, ''];
  lines.push('How it decided:');
  for (const s of e.steps) lines.push(`  · ${s}`);
  if (e.alternatives.length) {
    lines.push('', 'What else it considered:');
    for (const a of e.alternatives) lines.push(`  · ${a}`);
  }
  lines.push('', 'Values:');
  for (const v of e.values) lines.push(`  · ${v}`);
  lines.push('', 'Data used:');
  for (const d of e.dataUsed) lines.push(`  · ${d}`);
  lines.push('', e.timing);
  return lines.join('\n');
}
