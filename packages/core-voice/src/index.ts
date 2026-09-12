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
  PIPER_VOICE_PT_CONFIG_ASSET,
  PIPER_VOICE_PT_ONNX_ASSET,
  PIPER_VOICES,
  WHISPER_CLI_ASSET,
  WHISPER_MODEL_ASSET,
  WHISPER_MODEL_MULTILINGUAL_ASSET,
  WHISPER_MODELS,
  type AssetDescriptor,
  type AssetStoreOptions,
  type PiperVoiceId,
  type WhisperModelId,
} from './assets.ts';

export { WhisperCppSttEngine, type WhisperCppOptions } from './whisper.ts';
export { PiperTtsEngine, type PiperOptions } from './piper.ts';

export type { SttEngine, SttResult, TtsEngine } from './types.ts';
