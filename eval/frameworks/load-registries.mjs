// One embedder per registry. Shared here so no harness can get it wrong again.
//
// ## The bug this exists to prevent, and what it cost
//
// `HashingEmbedder` is TF-IDF: `fit(corpus)` REPLACES its vocabulary, its IDF
// weights and its dimensionality. Those are instance state. Load ten role
// registries through one instance and each `loadRegistry` re-fits it, so nine
// registries end up holding vectors computed under a vocabulary that no longer
// exists — and the query is then embedded under the tenth. The comparison is
// between two different spaces, and the scores are noise.
//
// The repo already knew. `apps/cli/src/app.ts` constructs a second instance for
// module search with the comment *"sharing one with the router would mean each
// `.fit()` call stomps the other's fitted vocabulary (relevant only to the
// hashing embedder; the neural one is stateless)"*. Every `eval/fut-app`
// harness then shared one across ten registries.
//
// **This is what produced "hashing gets 4.0% recall@1".** Fitted correctly it
// gets ~45% on the same registry and the same questions. The 4.0% figure was
// the headline evidence that the zero-dependency encoder "does not survive
// scale", it rewrote WP-24, and it was an artefact of the harness.
//
// `nomic-embed-text` is stateless, so every `--embedder ollama` number in this
// project is unaffected. That asymmetry is exactly why the bug was invisible:
// the encoder under suspicion was the only one being broken.

import { join } from 'node:path';

import { makeEmbedder } from '../../packages/core-intent/src/embedder.ts';
import { loadRegistry } from '../../packages/core-intent/src/registry.ts';

/**
 * Load one registry per role, each with its own embedder instance.
 *
 * Returns a map of role -> { registry, embedder }. **Always embed a question
 * with the embedder that came back beside its registry**, never with a shared
 * one, or the same bug returns by a different route.
 */
export async function loadRegistriesPerRole(dir, roles, kind) {
  const loaded = new Map();
  for (const role of roles) {
    const embedder = makeEmbedder(kind);
    const registry = await loadRegistry(join(dir, `registry.${role}.json`), embedder);
    loaded.set(role, { registry, embedder });
  }
  return loaded;
}
