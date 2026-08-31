import 'server-only';

import type { AnswerView, ConfirmView, NavItem, ParamView, TraceView } from '@nextgen/ui';
import type { NextGenApp } from '@nextgen/cli';
import type { Decision } from '@nextgen/core-dispatch';
import { explain, type TurnTrace } from '@nextgen/core-trace';

/**
 * The web renderer.
 *
 * "Answers are rendered, not narrated." The CLI turns a query result into
 * padded text; this turns the same result into a headline and rows. Neither
 * is more authoritative than the other — both read `app.search()`, which is
 * the only thing in the system that scores a module match (Rule 2's shape,
 * applied here: the model never picks the target, code does, from a fixed
 * search — the model's own judgment about create-vs-append happens earlier,
 * inside `module.capture`, and is itself reviewed on a confirmation card).
 */

export async function renderAnswer(
  app: NextGenApp,
  capabilityId: string,
  params: Readonly<Record<string, string | number>>,
): Promise<AnswerView> {
  switch (capabilityId) {
    case 'module.search': {
      const query = String(params.query ?? '');
      const matches = await app.search(query);
      if (matches.length === 0) {
        return { caption: query ? `Nothing saved yet matches "${query}".` : 'Nothing saved yet.' };
      }
      const [best, ...rest] = matches;
      return {
        headline: best!.module.title,
        caption: best!.module.body,
        ...(rest.length > 0
          ? { rows: rest.map((m) => ({ label: m.module.title, value: '' })) }
          : {}),
      };
    }

    default: {
      // A navigate capability with nothing to read. The route already changed;
      // saying so is the whole answer.
      const cap = app.capabilities.find((c) => c.id === capabilityId);
      return { caption: `Opened ${cap?.title ?? capabilityId}.` };
    }
  }
}

interface CaptureCandidateWire {
  readonly id: string;
  readonly title: string;
}

/**
 * The confirmation card's data.
 *
 * `body` is shown as a textarea (`multiline: true`) rather than a single-line
 * input — it is the one field long enough that a single line would hide most
 * of what there is to review. `module.capture`'s `action` field is the
 * standardised question itself — create / add to one of the specific
 * existing modules offered / just interpret and save nothing — rendered as a
 * choice rather than free text, so picking the wrong one is not a typo away.
 */
export function renderConfirm(decision: Extract<Decision, { type: 'confirm' }>, trace: TurnTrace): ConfirmView {
  const HIDDEN = new Set(['sourceExcerpt', 'sourceType', 'candidatesJson']);

  let candidates: readonly CaptureCandidateWire[] = [];
  if (decision.capabilityId === 'module.capture') {
    try {
      candidates = JSON.parse(String(decision.params.candidatesJson ?? '[]')) as CaptureCandidateWire[];
    } catch {
      candidates = [];
    }
  }

  const params: ParamView[] = Object.entries(decision.params)
    .filter(([name]) => !HIDDEN.has(name))
    .map(([name, value]) => ({
      name,
      display: String(value),
      raw: String(value),
      source: trace.paramSources[name] ?? 'model',
      editable: true,
      ...(name === 'body' ? { multiline: true } : {}),
      ...(name === 'action'
        ? {
            choices: [
              { value: 'create', label: 'Create a new module' },
              ...candidates.map((c) => ({ value: `append:${c.id}`, label: `Add to "${c.title}"` })),
              { value: 'interpret', label: "Just tell me what it says — don't save anything" },
            ],
          }
        : {}),
    }));

  return {
    capabilityId: decision.capabilityId,
    title: decision.title,
    destructive: decision.destructive,
    params,
  };
}

/**
 * The trace, as the panel wants it.
 *
 * `explain()` does the prose; every string it returns is assembled from ids,
 * enums and numbers held in the record. The candidate scores are passed
 * through raw because the panel draws them, and a decision whose runners-up
 * you cannot see is asserted rather than explained.
 */
export function renderTrace(trace: TurnTrace, local: boolean): TraceView {
  const e = explain(trace);
  return {
    turnId: trace.turnId,
    headline: e.headline,
    steps: e.steps,
    alternatives: e.alternatives,
    dataUsed: e.dataUsed,
    values: e.values,
    timing: e.timing,
    candidates: trace.candidates.map((c) => ({ capabilityId: c.capabilityId, score: c.score })),
    chosen: trace.capabilityId,
    decidedAt: trace.decidedAt,
    local,
    notes: trace.notes,
  };
}

/**
 * The drawer's contents.
 *
 * Every `navigate` capability in the registry, in registry order. Not a menu
 * anybody maintains: a capability added tomorrow appears here, and an entry
 * can never point at something the dispatcher cannot run.
 */
export function renderNav(app: NextGenApp): NavItem[] {
  return app.capabilities
    .filter((c) => c.kind === 'navigate')
    .map((c) => ({ capabilityId: c.id, label: c.title, route: c.route }));
}
