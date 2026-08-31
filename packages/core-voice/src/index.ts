// @nextgen/core-voice
//
// STT and TTS: Whisper for input, Piper for output. Both prebuilt Windows
// binaries, downloaded and verified on first use via VoiceAssetStore — the
// same discipline core-inference's ModelStore applies to LLM weights.
// Voice is a first-class input path, not an add-on.

export {
  AssetIntegrityError,
  VoiceAssetStore,
  sha256File,
  PIPER_ASSET,
  PIPER_VOICE_CONFIG_ASSET,
  PIPER_VOICE_ONNX_ASSET,
  WHISPER_CLI_ASSET,
  WHISPER_MODEL_ASSET,
  type AssetDescriptor,
  type AssetStoreOptions,
} from './assets.ts';

export { WhisperCppSttEngine, type WhisperCppOptions } from './whisper.ts';
export { PiperTtsEngine, type PiperOptions } from './piper.ts';

export type { SttEngine, SttResult, TtsEngine } from './types.ts';
