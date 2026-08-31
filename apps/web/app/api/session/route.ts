import { NextResponse } from 'next/server';

import { engineInfo, getEngine } from '@/lib/engine';
import { renderNav } from '@/lib/render';
import type { SessionResponse } from '@/lib/wire';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Everything the surface needs before the first turn.
 *
 * The nav list is read from the registry rather than hand-written, which is
 * the point of having one: a screen that tells the user what exists is
 * reading the same file the router matches against, so the two cannot drift.
 */
export async function GET(): Promise<NextResponse<SessionResponse | { error: string }>> {
  try {
    const app = await getEngine();

    return NextResponse.json({
      status: engineInfo(),
      nav: renderNav(app),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to start the engine.' },
      { status: 500 },
    );
  }
}
