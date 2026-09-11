# @nextgen/core-voice

STT and TTS adapters: Whisper for input, Piper for output.

**Boundary:** Voice is a first-class input path, not an add-on.

**Status: built, acceptance-tested in English, and on no rung of the roadmap.**
`whisper.ts`, `piper.ts` and the asset store are real, and `apps/cli` imports them. Only the
asset store has unit tests, but the end-to-end path is measured:
[eval/acceptance.mjs](eval/acceptance.mjs) synthesises each utterance with Piper,
transcribes it with whisper.cpp, and routes the transcript next to the typed text.
Measured on 2026-09-11 (PLAN.md WP-21):
- **97.5%** routing agreement (39 of 40).
- WER 7.1%.
- ~317ms synthesis and ~717ms transcription.

**Scope:** English only (`base.en`, an en_US voice), and synthetic speech only.
Portuguese and real speakers are PLAN.md WP-44. Both runtimes are desktop binaries that a
browser cannot load. Since the product became a layer that ships *into
someone else's web app*, that last point matters: a browser transport is unscoped work
nobody has costed. Parked, not dead.

