import { NextResponse } from 'next/server';

import { engineInfo, getEngine } from '@/lib/engine';
import { renderNav } from '@/lib/render';
import type { SessionResponse } from '@/lib/wire';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Everything the surface needs before the first turn.
 *
 * Both lists below are read from the registry rather than hand-written, which
 * is the point of having one: a screen that tells the user what exists is
 * reading the same file the router matches against, so the two cannot drift.
 */
export async function GET(): Promise<NextResponse<SessionResponse | { error: string }>> {
  try {
    const app = await getEngine();

    const examples = app.capabilities
      .filter((c) => c.kind === 'read')
      .flatMap((c) => (c.examples ?? []).map((e) => (typeof e === 'string' ? e : e.say)))
      .slice(0, 4);

    return NextResponse.json({
      status: engineInfo(),
      nav: renderNav(app),
      examples,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to start the engine.' },
      { status: 500 },
    );
  }
}
