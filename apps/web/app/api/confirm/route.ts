import { NextResponse } from 'next/server';

import type { Decision } from '@nextgen/core-dispatch';

import { forget, getEngine, recall } from '@/lib/engine';
import type { ConfirmResponse, ErrorResponse } from '@/lib/wire';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Carry out a confirmed write.
 *
 * The client sends a turn id and the values it was shown — never a decision.
 * The decision is recalled from the server's own table, the edited values are
 * merged into it, and the dispatcher re-applies policy to the result. So the
 * worst a hostile client can do is change a *value* on a capability the router
 * already chose and the user already saw: it cannot pick the capability, and
 * it cannot skip the card.
 *
 * Two rules do the work below:
 *
 *   - **No new slots.** A key that was not in the original decision is dropped,
 *     not added. The confirmation card is a form over a fixed shape.
 *   - **Types are preserved.** A slot that came back from the router as a
 *     number goes to the use case as a number.
 */
export async function POST(request: Request): Promise<NextResponse<ConfirmResponse | ErrorResponse>> {
  let turnId: string;
  let edits: Record<string, string>;

  try {
    const body = (await request.json()) as { turnId?: unknown; params?: unknown };
    turnId = typeof body.turnId === 'string' ? body.turnId : '';
    edits =
      body.params && typeof body.params === 'object'
        ? (body.params as Record<string, string>)
        : {};
  } catch {
    return NextResponse.json({ error: 'Malformed request.' }, { status: 400 });
  }

  const pending = recall(turnId);
  if (!pending || pending.type !== 'confirm') {
    return NextResponse.json(
      { error: 'That confirmation has expired. Ask again and I will re-read it.' },
      { status: 409 },
    );
  }

  try {
    const app = await getEngine();
    const merged: Record<string, string | number> = { ...pending.params };

    for (const [name, value] of Object.entries(edits)) {
      if (!(name in pending.params)) continue;

      const original = pending.params[name];
      const text = String(value).trim();

      if (typeof original === 'number') {
        const n = Number(text);
        if (!Number.isFinite(n)) {
          return NextResponse.json({ error: `"${name}" must be a number.` }, { status: 400 });
        }
        merged[name] = n;
      } else {
        // "category" may legitimately be cleared — an empty category means
        // uncategorised, not a missing field.
        if (!text && name !== 'category') {
          return NextResponse.json({ error: `"${name}" cannot be empty.` }, { status: 400 });
        }
        merged[name] = text;
      }
    }

    const decision: Decision = { ...pending, params: merged };
    const lines = await app.confirm(decision);
    forget(turnId);

    return NextResponse.json({
      answer: { caption: lines.join(' '), tone: pending.destructive ? 'attention' : 'accent' },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'The write failed.' },
      { status: 500 },
    );
  }
}
