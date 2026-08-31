/**
 * Voice interfaces — narrow, like `core-inference`'s `LlmRuntime`, so a
 * future WASM or platform-native implementation is a package-internal swap
 * rather than a change everywhere voice is used.
 */

export interface SttResult {
  readonly text: string;
  /** 0..1, when the engine reports one. Absent rather than fabricated when it does not. */
  readonly confidence?: number;
}

export interface SttEngine {
  readonly name: string;
  isAvailable(): Promise<boolean>;
  /** `wavPath` — 16kHz mono PCM WAV, already resampled client-side before upload. */
  transcribe(wavPath: string): Promise<SttResult>;
}

export interface TtsEngine {
  readonly name: string;
  isAvailable(): Promise<boolean>;
  /** WAV bytes, ready to play. */
  synthesize(text: string): Promise<Buffer>;
}
