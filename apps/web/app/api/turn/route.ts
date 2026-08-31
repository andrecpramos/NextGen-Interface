import { NextResponse } from 'next/server';

import { engineInfo, getEngine, remember } from '@/lib/engine';
import { renderAnswer, renderConfirm, renderTrace } from '@/lib/render';
import type { ErrorResponse, TurnResponse } from '@/lib/wire';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** Stage 3 on a cold 1.5B model can take tens of seconds. Do not cut it off. */
export const maxDuration = 120;

/**
 * One turn.
 *
 * The handler is thin on purpose. It does not decide anything: `app.turn()`
 * routes, applies policy and records the trace, and everything below is
 * presentation. If this function ever grows a branch that lets a write through
 * without a `confirm` round-trip, the policy has moved into the transport —
 * which is precisely what ADR-004 exists to prevent.
 */
export async function POST(request: Request): Promise<NextResponse<TurnResponse | ErrorResponse>> {
  let utterance: string;
  let sttConfidence: number | undefined;
  try {
    const body = (await request.json()) as { utterance?: unknown; sttConfidence?: unknown };
    utterance = typeof body.utterance === 'string' ? body.utterance.trim() : '';
    sttConfidence = typeof body.sttConfidence === 'number' ? body.sttConfidence : undefined;
  } catch {
    return NextResponse.json({ error: 'Malformed request.' }, { status: 400 });
  }

  if (!utterance) return NextResponse.json({ error: 'Say something first.' }, { status: 400 });
  if (utterance.length > 2000) {
    return NextResponse.json({ error: 'That is too long to route.' }, { status: 400 });
  }

  try {
    const app = await getEngine();
    const { decision, trace } = await app.turn(
      utterance,
      sttConfidence !== undefined ? { sttConfidence } : undefined,
    );
    const local = engineInfo().local;

    const base = {
      turnId: trace.turnId,
      trace: renderTrace(trace, local),
      route: app.route,
    };

    switch (decision.type) {
      case 'execute':
        return NextResponse.json({
          ...base,
          kind: 'execute' as const,
          answer: await renderAnswer(app, decision.capabilityId, decision.params),
        });

      case 'confirm':
        // The decision stays here. The client gets the card and the turn id.
        remember(trace.turnId, decision);
        return NextResponse.json({
          ...base,
          kind: 'confirm' as const,
          confirm: renderConfirm(decision, trace),
        });

      case 'refuse':
        return NextResponse.json({
          ...base,
          kind: 'refuse' as const,
          refuse: { reason: decision.reason, declared: decision.declared },
        });

      case 'clarify':
      default:
        return NextResponse.json({
          ...base,
          kind: 'clarify' as const,
          clarify: { question: decision.question, options: decision.options },
        });
    }
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'The turn failed.' },
      { status: 500 },
    );
  }
}
