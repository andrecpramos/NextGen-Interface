'use client';

/**
 * Client-side audio capture and resampling.
 *
 * No server-side ffmpeg dependency (WP-13's design point): the browser
 * resamples to 16kHz mono PCM before upload, which is exactly the shape
 * `/api/voice/transcribe` hands to whisper.cpp, so the route itself does no
 * audio processing at all.
 *
 * Captures raw PCM directly via `ScriptProcessorNode` rather than recording
 * through `MediaRecorder` and decoding the result back with
 * `AudioContext.decodeAudioData`. That two-step path depends on the browser
 * being able to both encode *and* later decode whatever container/codec it
 * picked (webm/opus, in most Chromium builds) — one more thing that can fail
 * silently depending on the machine. Reading samples directly off the mic
 * stream has no container format at all, so there is nothing to fail to
 * decode. `ScriptProcessorNode` is formally deprecated in favour of
 * `AudioWorkletNode`, but remains universally implemented, and avoids
 * `AudioWorklet`'s extra requirement of loading a separate module file.
 */

export interface VoiceRecorderHandle {
  /** Stop, resample, and return a WAV blob ready to upload. */
  stop(): Promise<Blob>;
  /** Abandon the recording — the mic closes, nothing is uploaded. */
  cancel(): void;
}

const TARGET_RATE = 16000;
/** Per Web Audio API spec, must be a power of 2 in [256, 16384]. */
const BUFFER_SIZE = 4096;

export async function startVoiceRecording(onAmplitude?: (level: number) => void): Promise<VoiceRecorderHandle> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error(
      'This browser will not allow microphone access here — it needs a secure context (https://, or localhost).',
    );
  }
  const AudioCtx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtx) throw new Error('This browser does not support the Web Audio API.');

  const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1 } });
  const audioCtx = new AudioCtx();
  const nativeRate = audioCtx.sampleRate;

  const source = audioCtx.createMediaStreamSource(stream);
  // createScriptProcessor is deprecated but has no replacement that avoids
  // loading a separate worklet module file — see the file-level comment.
  const processor = audioCtx.createScriptProcessor(BUFFER_SIZE, 1, 1);
  // A zero-gain sink: some browsers only fire `onaudioprocess` while the
  // node is connected all the way to the destination, but audible mic
  // playback (echo) is never wanted.
  const silence = audioCtx.createGain();
  silence.gain.value = 0;

  const chunks: Float32Array[] = [];
  let totalSamples = 0;

  processor.onaudioprocess = (e) => {
    const channelData = e.inputBuffer.getChannelData(0);
    chunks.push(new Float32Array(channelData)); // copy — the buffer is reused by the browser
    totalSamples += channelData.length;

    if (onAmplitude) {
      let sumSquares = 0;
      for (const v of channelData) sumSquares += v * v;
      onAmplitude(Math.min(1, Math.sqrt(sumSquares / channelData.length) * 4));
    }
  };

  source.connect(processor);
  processor.connect(silence);
  silence.connect(audioCtx.destination);

  const teardown = () => {
    processor.onaudioprocess = null;
    processor.disconnect();
    silence.disconnect();
    source.disconnect();
    for (const track of stream.getTracks()) track.stop();
  };

  return {
    async stop() {
      teardown();
      await audioCtx.close();

      if (totalSamples === 0) {
        throw new Error('No audio was captured — check the microphone permission and try again.');
      }

      const merged = new Float32Array(totalSamples);
      let offset = 0;
      for (const chunk of chunks) {
        merged.set(chunk, offset);
        offset += chunk.length;
      }

      const resampled = linearResample(merged, nativeRate, TARGET_RATE);
      return encodeWav(resampled, TARGET_RATE);
    },
    cancel() {
      teardown();
      void audioCtx.close().catch(() => {});
    },
  };
}

/**
 * Linear-interpolation resample. Not the highest-fidelity method available,
 * but whisper.cpp is transcribing speech, not judging audio quality, and this
 * has no dependency beyond arithmetic — nothing else in this path can fail
 * to decode, be unsupported, or throw for a codec reason.
 */
function linearResample(input: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate) return input;
  const ratio = fromRate / toRate;
  const outLength = Math.max(1, Math.round(input.length / ratio));
  const output = new Float32Array(outLength);
  for (let i = 0; i < outLength; i++) {
    const srcIndex = i * ratio;
    const i0 = Math.floor(srcIndex);
    const i1 = Math.min(i0 + 1, input.length - 1);
    const frac = srcIndex - i0;
    output[i] = (input[i0] ?? 0) * (1 - frac) + (input[i1] ?? 0) * frac;
  }
  return output;
}

function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);

  const writeString = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate (mono, 16-bit)
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeString(36, 'data');
  view.setUint32(40, samples.length * 2, true);

  let offset = 44;
  for (const raw of samples) {
    const s = Math.max(-1, Math.min(1, raw));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }

  return new Blob([buffer], { type: 'audio/wav' });
}
