import { NextResponse } from 'next/server';

import { engineInfo, getEngine, remember } from '@/lib/engine';
import { renderAnswer, renderConfirm, renderTrace } from '@/lib/render';
import type { ErrorResponse, TurnResponse } from '@/lib/wire';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Run a capability the user picked from the drawer.
 *
 * This exists so that Rule 7 is true in the strong sense. Routing a sentence
 * the menu generated would still be the AI doing the work, and it would still
 * miss — top-1 is measured at 80%. `app.invoke()` hands the capability id
 * straight to the dispatcher, so the menu path cannot be misrouted at all.
 *
 * What it does *not* skip is policy. The id is validated against the registry
 * and a `write` still comes back as a confirmation card, because the policy is
 * attached to the capability's kind and never to how the user arrived
 * (ADR-004). That is why this handler is a near-twin of `turn` rather than a
 * shortcut around it.
 */
export async function POST(request: Request): Promise<NextResponse<TurnResponse | ErrorResponse>> {
  let capabilityId: string;
  try {
    const body = (await request.json()) as { capabilityId?: unknown };
    capabilityId = typeof body.capabilityId === 'string' ? body.capabilityId : '';
  } catch {
    return NextResponse.json({ error: 'Malformed request.' }, { status: 400 });
  }

  if (!capabilityId) {
    return NextResponse.json({ error: 'No capability given.' }, { status: 400 });
  }

  try {
    const app = await getEngine();

    // Validated against the registry before it reaches the dispatcher — the
    // same rule that applies to anything the model produces (Rule 4) applies
    // to anything a client produces.
    if (!app.capabilities.some((c) => c.id === capabilityId)) {
      return NextResponse.json({ error: `Unknown capability "${capabilityId}".` }, { status: 404 });
    }

    const { decision, trace } = await app.invoke(capabilityId);
    const base = {
      turnId: trace.turnId,
      trace: renderTrace(trace, engineInfo().local),
      route: app.route,
    };

    switch (decision.type) {
      case 'execute':
        return NextResponse.json({
          ...base,
          kind: 'execute' as const,
          answer: await renderAnswer(app, decision.capabilityId, decision.params, trace.explanationRequest),
        });

      case 'confirm':
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
      { error: error instanceof Error ? error.message : 'That did not open.' },
      { status: 500 },
    );
  }
}
