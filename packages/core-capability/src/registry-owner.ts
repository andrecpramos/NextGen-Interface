/**
 * Who owns the generated registry?
 *
 * `packages/core-intent/eval/registry.json` is **one global path**. Every
 * domain's `build-registry.ts` writes it, so only one domain can be
 * authoritative at a time, and running the wrong build silently replaces the
 * registry the router loads with a different application's capabilities. The
 * router then routes correctly — to the wrong app.
 *
 * `critical-infrastructure.md` has carried this as a known fragility with the
 * note *"survivable with two domains and a documented order; not survivable
 * with three"*. A documented order is a convention, and a convention is obeyed
 * until someone is in a hurry.
 *
 * **This does not fix the collision.** Where generated artefacts should live is
 * an architectural question — per-domain paths change what the evaluator loads
 * and what CI's staleness gate diffs — and it is owed an ADR, not an inference
 * by whoever touched the file last. What this does is make the failure *loud*:
 * an overwrite that changes which application the registry describes now stops
 * and says so, and proceeds only when a human passes `--force`.
 *
 * Turning a silent default into an explicit one is the part that does not need
 * a decision from anybody.
 */

/**
 * The namespace of a capability id — the part before the first dot.
 *
 * `unsupported` is excluded deliberately. Both registered domains declare
 * `unsupported.*` boundaries (ADR-009), so it is the one namespace they share
 * and the one that must not count as evidence of common ownership. Without this
 * exclusion two entirely different applications look related.
 */
function namespaces(ids: readonly string[]): Set<string> {
  const out = new Set<string>();
  for (const id of ids) {
    const head = id.split('.')[0];
    if (head && head !== 'unsupported') out.add(head);
  }
  return out;
}

export interface OwnershipVerdict {
  readonly safe: boolean;
  /** Present when `safe` is false: what to print before refusing. */
  readonly reason?: string;
}

/**
 * Would writing `incomingIds` over the registry currently on disk replace one
 * application's capabilities with another's?
 *
 * `existingJson` is the raw file contents, or `null` when nothing is there yet.
 * Unreadable or unrecognisable content is treated as safe to overwrite: this
 * guard exists to catch a build pointed at the wrong domain, not to defend a
 * generated file against corruption, and failing closed on a malformed artefact
 * would block the very rebuild that repairs it.
 */
export function checkRegistryOwnership(
  existingJson: string | null,
  incomingIds: readonly string[],
): OwnershipVerdict {
  if (existingJson === null || existingJson.trim() === '') return { safe: true };

  let existingIds: string[];
  try {
    const parsed = JSON.parse(existingJson) as { capabilities?: { id?: string }[] };
    existingIds = (parsed.capabilities ?? []).map((c) => c?.id).filter((id): id is string => !!id);
  } catch {
    return { safe: true };
  }
  if (existingIds.length === 0) return { safe: true };

  const existing = namespaces(existingIds);
  const incoming = namespaces(incomingIds);
  if (existing.size === 0 || incoming.size === 0) return { safe: true };

  for (const ns of incoming) if (existing.has(ns)) return { safe: true };

  const show = (s: Set<string>) => [...s].sort().join(', ');
  return {
    safe: false,
    reason:
      `the registry on disk describes a different application.\n\n` +
      `    on disk:  ${show(existing)}  (${existingIds.length} capabilities)\n` +
      `    incoming: ${show(incoming)}  (${incomingIds.length} capabilities)\n\n` +
      `  This path is shared by every domain's build script, so writing now would\n` +
      `  replace the registry the router loads. If that is what you want, re-run\n` +
      `  with --force. If it is not, you probably meant the other domain's build.\n\n` +
      `  Note the guard is symmetric: if a wrong build already overwrote this file,\n` +
      `  the correct build will refuse too, for the same reason and just as loudly.\n` +
      `  Recovering is \`--force\` on the build you actually want.`,
  };
}
