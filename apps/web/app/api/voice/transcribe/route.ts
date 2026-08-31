import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NextResponse } from 'next/server';

import { getEngine } from '@/lib/engine';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** A cold whisper.cpp process load plus a first-use asset download can take a while. */
export const maxDuration = 120;

const MAX_BYTES = 25 * 1024 * 1024;

/**
 * Speech in, text out. The browser already resampled to 16kHz mono WAV
 * before uploading — this route does no audio processing itself, only
 * transcription. The temp file is written for the engine to read (whisper.cpp
 * takes a path, not a stream) and unlinked in a `finally`: audio is never
 * persisted past transcription.
 */
export async function POST(request: Request): Promise<NextResponse> {
  let audio: File;
  try {
    const form = await request.formData();
    const given = form.get('audio');
    if (!(given instanceof File) || given.size === 0) {
      return NextResponse.json({ error: 'No audio given.' }, { status: 400 });
    }
    if (given.size > MAX_BYTES) {
      return NextResponse.json({ error: 'That recording is too long.' }, { status: 400 });
    }
    audio = given;
  } catch {
    return NextResponse.json({ error: 'Malformed upload.' }, { status: 400 });
  }

  const workDir = await mkdtemp(join(tmpdir(), 'nextgen-voice-in-'));
  const wavPath = join(workDir, 'input.wav');
  try {
    await writeFile(wavPath, Buffer.from(await audio.arrayBuffer()));
    const app = await getEngine();
    const result = await app.transcribe(wavPath);
    return NextResponse.json({ transcript: result.text, ...(result.confidence !== undefined ? { confidence: result.confidence } : {}) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Could not transcribe that.' },
      { status: 500 },
    );
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}
