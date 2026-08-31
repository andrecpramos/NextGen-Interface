import { NextResponse } from 'next/server';

import { engineInfo, getEngine, remember } from '@/lib/engine';
import { extractFromFile } from '@/lib/extract';
import { renderAnswer, renderConfirm, renderTrace } from '@/lib/render';
import type { ErrorResponse, TurnResponse } from '@/lib/wire';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** Vision/document extraction plus a stage-3-class model call can take a while on a cold model. */
export const maxDuration = 120;

const MAX_BYTES = 20 * 1024 * 1024;

/**
 * Capture from an upload — a photo of a document, a PDF, a Word file, or
 * plain text. Mirrors `/api/navigate`'s reasoning, one level further: there
 * is no sentence for the router to get wrong, so this bypasses it entirely
 * and goes straight to `module.capture`'s own reasoning
 * (`app.captureFromContent`). Policy is unchanged — it still comes back as a
 * `confirm` card, exactly like a typed "remember this" would.
 */
export async function POST(request: Request): Promise<NextResponse<TurnResponse | ErrorResponse>> {
  let file: File;
  try {
    const form = await request.formData();
    const given = form.get('file');
    if (!(given instanceof File) || given.size === 0) {
      return NextResponse.json({ error: 'No file given.' }, { status: 400 });
    }
    if (given.size > MAX_BYTES) {
      return NextResponse.json({ error: 'That file is too large (20MB limit).' }, { status: 400 });
    }
    file = given;
  } catch {
    return NextResponse.json({ error: 'Malformed upload.' }, { status: 400 });
  }

  try {
    const extracted = await extractFromFile(file);
    const app = await getEngine();

    const { decision, trace } =
      extracted.kind === 'image'
        ? await app.captureFromContent({ text: '', sourceType: 'image', images: [extracted.base64] })
        : await app.captureFromContent({ text: extracted.text, sourceType: 'document' });

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
          answer: await renderAnswer(app, decision.capabilityId, decision.params),
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
      { error: error instanceof Error ? error.message : 'Could not read that file.' },
      { status: 500 },
    );
  }
}
