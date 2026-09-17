#!/usr/bin/env node
import { run } from './run.ts';

/**
 * The entry point bundled into `adapter/scan.mjs` — what an adopter copies.
 *
 * It passes **no capabilities**, so `ollamaModel` is unreachable from its import graph
 * and the bundle contains neither it nor the chat endpoint it would call. `--model` is
 * refused by `build()` with a sentence saying why.
 *
 * ## Why a separate entry point rather than a flag
 *
 * A flag that turns a capability off still ships the capability. Whoever reviews this
 * folder before letting it near their codebase — and someone will, since it arrives as
 * 3.6MB of minified JavaScript — cannot audit a default. Removing the capability from the
 * artefact is auditable; switching it off is a promise (ADR-018 D-6).
 *
 * ## What is still in the bundle, stated exactly
 *
 * `OllamaEmbeddingRuntime` is, along with a loopback default of
 * `http://127.0.0.1:11434`. It is unreachable — the sweep names `HashingEmbedder`
 * directly and this entry exposes no `--embedder` — but it is a re-export of a re-export
 * from `core-intent`'s root, and a bundler cannot prove that dead. Removing it means
 * restructuring how `core-intent` exposes its encoders, which is worth doing and is not
 * worth doing here.
 *
 * So the claim is **not** "there is no URL in the file". `typescript` is in there too, and
 * its diagnostics quote `https://aka.ms/…` in error text; a grep proves nothing either
 * way. The claim is the one `check-adapter.mjs` holds: **the whole pipeline runs with
 * `fetch`, `net`, `tls`, `http`, `https` and DNS all throwing**, so no socket is opened.
 * That is a property of running it, and it is checked on every commit.
 *
 * ## What is given up, and why it is affordable
 *
 * Model-written descriptions. Measured on a real application, model-written example
 * phrasings routed *worse* than ones derived from the app's own labels: the model spread
 * them evenly across the app's two languages, while the derived ones repeat the screen's
 * own words, which is what the shipped encoder rewards (`adapter/FIELD-NOTES.md` §4).
 *
 * An adopter who wants the model path has it: `packages/kit` installs from npm and its
 * `nextgen` command passes Ollama's. This folder is the no-install path, and the two are
 * allowed to differ.
 */
async function main(): Promise<void> {
  try {
    process.exitCode = await run();
  } catch (error) {
    // A person runs this, not a pipeline: say what went wrong, without a stack.
    console.error(`\n  ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

void main();
