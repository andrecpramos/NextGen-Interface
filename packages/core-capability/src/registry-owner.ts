/**
 * Who owns the generated registry?
 *
 * Each domain writes its own `packages/domain-<name>/generated/registry.json`
 * (ADR-016). This refuses a write whose capability namespaces describe a
 * *different* application than the file already on disk — so a build pointed at
 * the wrong output path stops and names both sides, rather than leaving a
 * registry that the router reads correctly and that describes the wrong app.
 * `--force` overrides.
 *
 * It was written for a sharper problem. Until ADR-016 all domains wrote one global
 * `packages/core-intent/eval/registry.json`, only one could be authoritative at a
 * time, and `critical-infrastructure.md` carried it as *"survivable with two
 * domains and a documented order; not survivable with three"*. This made that
 * failure loud in 2026-09-10; ADR-016 removed it in 2026-09-12. What remains is a
 * cheap check against a rarer mistake, and it is kept for that.
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
