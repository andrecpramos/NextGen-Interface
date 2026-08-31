import { NextResponse } from 'next/server';

import { getEngine } from '@/lib/engine';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MAX_CHARS = 2000;

/** Text in, WAV bytes out. Piper is fast enough (measured real-time factor ~0.05) that this stays a same-turn reply. */
export async function POST(request: Request): Promise<NextResponse> {
  let text: string;
  try {
    const body = (await request.json()) as { text?: unknown };
    text = typeof body.text === 'string' ? body.text.trim() : '';
  } catch {
    return NextResponse.json({ error: 'Malformed request.' }, { status: 400 });
  }

  if (!text) return NextResponse.json({ error: 'Nothing to say.' }, { status: 400 });
  if (text.length > MAX_CHARS) text = text.slice(0, MAX_CHARS);

  try {
    const app = await getEngine();
    const wav = await app.speak(text);
    return new NextResponse(new Uint8Array(wav), {
      headers: { 'content-type': 'audio/wav', 'cache-control': 'no-store' },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Could not speak that.' },
      { status: 500 },
    );
  }
}
