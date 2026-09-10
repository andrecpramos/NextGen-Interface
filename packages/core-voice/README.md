# @nextgen/core-voice

STT and TTS adapters: Whisper for input, Piper for output.

**Boundary:** Voice is a first-class input path, not an add-on.

**Status: built, and on no rung of the roadmap.** `whisper.ts`, `piper.ts` and the asset
store are real and `apps/cli` imports them — but only the asset store is covered by tests,
voice has never been acceptance-tested end to end (PLAN.md WP-21), and both runtimes are
desktop binaries a browser cannot load. Since the product became a layer that ships *into
someone else's web app*, that last point matters: a browser transport is unscoped work
nobody has costed. Parked, not dead.

