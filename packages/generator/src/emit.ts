import { mkdirSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import { validateRegistry, formatValidation, capabilityDocument, type Capability, type RegistryContext, type RegistryFile } from '@nextgen/core-capability';
import { makeEmbedder } from '@nextgen/core-intent';

import type { AnnotatedCapability, GeneratorOutput, ReviewInferredEntry, RoleName, SkippedRoute } from './types.ts';

/**
 * Turning one annotated inventory into the artefacts an adopter ships.
 *
 * **Rule 17 lives in `splitByRole`.** A capability the current user cannot
 * reach is not in the registry they receive — not filtered at render, *absent*.
 * That is a security property, not a UX filter: the pilot app is role-gated, and
 * shipping one registry to every role would hand a guardian the shape of the
 * admin surface (route names, screen titles, the vocabulary of a system they
 * must not see) even if every one of those entries were greyed out.
 *
 * The `roles` annotation is dropped on the way out for the same reason. Telling
 * a COACH's browser that a screen it can reach is *also* reachable by ADMIN and
 * FINANCE is a smaller leak than the capability itself, but it is a leak, and
 * nothing at run time needs it: the registry a session receives *is* its
 * entitlement.
 */

export const SCHEMA_VERSION = 1;

function withoutRoles(capability: AnnotatedCapability): Capability {
  const { roles: _roles, ...rest } = capability;
  return rest;
}

export function splitByRole(
  master: readonly AnnotatedCapability[],
  boundaries: readonly Capability[],
  domainDescription: string,
  roles: readonly RoleName[],
  /**
   * What the owner says about the app, for one role (ADR-023). Asked per role and written into that
   * role's registry only — Rule 17 again: a rule for COACH is absent from a PARENT's file, not
   * filtered out of it at read time.
   */
  contextFor?: (role: RoleName) => RegistryContext | null,
): Map<RoleName, RegistryFile> {
  const out = new Map<RoleName, RegistryFile>();
  for (const role of roles) {
    const reachable = master.filter((capability) => capability.roles.includes(role)).map(withoutRoles);
    const context = contextFor?.(role) ?? null;
    // A limit goes to every role, but where it points (helpAt) is a screen: kept only where this role
    // can open it, and dropped when none is left — Rule 17, and no link to nowhere.
    const routes = new Set(reachable.map((capability) => capability.route).filter(Boolean));
    const limits = boundaries.map((limit): Capability => {
      if (!limit.helpAt) return limit;
      const { helpAt, ...rest } = limit;
      const open = helpAt.filter((route) => routes.has(route));
      return open.length > 0 ? { ...rest, helpAt: open } : rest;
    });
    out.set(role, {
      schemaVersion: SCHEMA_VERSION,
      domainDescription,
      ...(context ? { context } : {}),
      capabilities: [...reachable, ...limits],
    });
  }
  return out;
}

// ------------------------------------------------------------------- reports --

const REASON_HEADINGS: Record<SkippedRoute['reason'], string> = {
  'unresolved-roles': 'Role guard could not be read — omitted rather than guessed, so no role is shown a screen it cannot open',
  'no-roles': 'No role can reach the route',
  'dev-only': 'Not in a production route table',
  'declared-legacy': 'The application says it is legacy or superseded',
  'bookmark-redirect': 'Redirects out of its own section — a bookmark shim, not a destination',
  'no-component': 'Route renders no component',
  'catch-all': 'A catch-all serving content pages, which no single capability can stand for',
  'duplicate-route': 'Another capability already declares this route',
  'reached-through-resolver': 'The same screen as a route that picks its own parameter — declared once, there',
  'redirect-alias': 'Only redirects to a screen declared at its own address — an old name for it',
  // WP-28. Before this reason existed such a route produced no entry at all —
  // under-discovery that no report could mention. Listed so it can be fixed.
  'unreadable-route': 'Found in the route table, but its path or component could not be read',
};

/**
 * The report is not a log — it is half the output.
 *
 * A generator that silently drops routes is indistinguishable from one that
 * cannot find them, and an adopter has no way to tell a deliberate omission
 * from a bug. Every skip carries the evidence, quoted from their own source, so
 * the answer to "why is this screen missing" is one grep away.
 */
export function formatSkipReport(skipped: readonly SkippedRoute[]): string {
  const lines: string[] = [
    '# Routes not declared',
    '',
    `${skipped.length} route(s) were discovered and deliberately not turned into capabilities.`,
    '',
    'A missing capability degrades safely: every screen stays reachable, as it always was,',
    'without the assistant. A wrongly declared one sends a user confidently to the wrong',
    'place. Where this generator was unsure, it omitted — and said so here.',
    '',
  ];

  const byReason = new Map<SkippedRoute['reason'], SkippedRoute[]>();
  for (const entry of skipped) {
    const bucket = byReason.get(entry.reason) ?? [];
    bucket.push(entry);
    byReason.set(entry.reason, bucket);
  }

  for (const [reason, entries] of [...byReason].sort((a, b) => b[1].length - a[1].length)) {
    lines.push(`## ${REASON_HEADINGS[reason]} (${entries.length})`, '');
    for (const entry of entries) lines.push(`- \`${entry.path}\` — ${entry.detail}`);
    lines.push('');
  }

  return lines.join('\n');
}

const PATTERN_HEADINGS: Record<ReviewInferredEntry['pattern'], string> = {
  'disabled-submit': 'A submit control was disabled by something this generator could not read as a plain field check',
  'guard-message': "A submit handler's first guard did not match one of the two exact shapes this generator trusts",
};

/**
 * Not a log either, for the same reason `SKIPPED.md` is not one — ADR-020's own
 * consequence: "review/ becomes something a developer must read, not only
 * something they must not serve." Every candidate here was found, and every one
 * of them was judged not confident enough to state to a visitor; the raw source
 * is quoted so a human can decide in one glance whether that judgement was
 * right, or whether the pattern is worth widening.
 */
export function formatInferredReport(entries: readonly ReviewInferredEntry[]): string {
  const lines: string[] = [
    '# Inferred rules not shipped',
    '',
    `${entries.length} candidate(s) were found in this application's own submit handlers and`,
    'disabled-submit conditions, and none of them reached a visitor. A rule inferred',
    'from behaviour can be wrong in a way a declared one cannot, so only an exactly recognised',
    'shape ships (see the read-tier ones instead, in every capability\'s own `rules`). Everything',
    'below was found, and none of it was confident enough — read it, and either it is nothing,',
    'or the pattern that would recognise it is worth adding.',
    '',
  ];
  if (entries.length === 0) {
    lines.push('Nothing found.');
    return lines.join('\n');
  }

  const byPattern = new Map<ReviewInferredEntry['pattern'], ReviewInferredEntry[]>();
  for (const entry of entries) {
    const bucket = byPattern.get(entry.pattern) ?? [];
    bucket.push(entry);
    byPattern.set(entry.pattern, bucket);
  }
  for (const [pattern, group] of [...byPattern].sort((a, b) => b[1].length - a[1].length)) {
    lines.push(`## ${PATTERN_HEADINGS[pattern]} (${group.length})`, '');
    for (const entry of group) lines.push(`- \`${entry.route}\` (${entry.source}) — \`${entry.detail}\``);
    lines.push('');
  }
  return lines.join('\n');
}

export function formatRoleSummary(output: GeneratorOutput): string {
  const rows = [...output.registries]
    .map(([role, registry]) => {
      const navigable = registry.capabilities.filter((c) => c.kind !== 'unsupported').length;
      return `  ${role.padEnd(14)} ${String(navigable).padStart(4)} capabilities + ${output.boundaries.length} boundaries`;
    })
    .join('\n');
  return `${rows}\n  ${'—'.repeat(20)}\n  ${output.master.length} distinct capabilities, ${output.skipped.length} routes skipped`;
}

// -------------------------------------------------------------------- writing --

export interface WriteResult {
  readonly files: readonly string[];
  readonly invalid: readonly string[];
}

/**
 * Write the bundle.
 *
 * **Rule 16**: everything lands in `outputDir`, which must sit outside the
 * application's source. The installer reads the adopter's code and writes only
 * new, additive artefacts — a tool that edits a repository it does not own
 * cannot be cleanly uninstalled and turns every upgrade into a merge conflict.
 * The guard below is not a formality: it is the one line standing between this
 * package and the promise the product is sold on.
 */
export function writeOutput(outputDir: string, appRoot: string, output: GeneratorOutput): WriteResult {
  const target = resolve(outputDir);
  const source = resolve(appRoot);
  const inside = relative(source, target);
  if (inside === '' || (!inside.startsWith('..') && !/^[a-zA-Z]:/.test(inside))) {
    throw new Error(
      `The generator never writes inside your app: refusing to write inside the application's own source (${source}). ` +
        `Choose an output directory outside it; the installer only ever adds files of its own.`,
    );
  }

  mkdirSync(target, { recursive: true });
  const files: string[] = [];
  const invalid: string[] = [];

  const write = (name: string, contents: string): void => {
    writeFileSync(join(target, name), contents, 'utf8');
    files.push(name);
  };

  for (const [role, registry] of output.registries) {
    const result = validateRegistry(registry);
    if (!result.ok) invalid.push(`${role}:\n${formatValidation(result)}`);
    write(`registry.${role}.json`, `${JSON.stringify(registry, null, 2)}\n`);
  }

  write(
    'master.json',
    `${JSON.stringify(
      {
        schemaVersion: SCHEMA_VERSION,
        domainDescription: output.domainDescription,
        roles: output.roles,
        capabilities: output.master,
        boundaries: output.boundaries,
      },
      null,
      2,
    )}\n`,
  );
  write('SKIPPED.md', formatSkipReport(output.skipped));
  write('INFERRED.md', formatInferredReport(output.reviewInferred));

  return { files, invalid };
}

// ------------------------------------------------------- the shipped index --

/**
 * Emit the precomputed embedding index, one file per role (WP-24).
 *
 * The runtime can compute these itself — the zero-dependency encoder is pure
 * arithmetic — so this is not about capability. It is about two things:
 *
 * **Startup cost.** Fitting TF-IDF over 145 documents builds a vocabulary of
 * ~8,400 terms before the first question can be routed. That belongs in a build,
 * not on the critical path of a user's first turn.
 *
 * **Removing a way to be wrong.** A fitted vocabulary is state; a vector means
 * nothing except relative to the corpus it was fitted on. Shipping the vectors
 * means the ranking a user gets is the ranking that was measured.
 *
 * ⚠️ **One embedder per registry, and this is not stylistic.** `fit()` replaces
 * the encoder's vocabulary, so a single instance reused across ten roles leaves
 * nine indexes describing a vector space that no longer exists. That exact bug
 * stood as a headline finding in this project for two days — lessons.md L10 —
 * and building the index is precisely where it would do the most damage,
 * because the result would then be shipped rather than merely measured.
 *
 * Measured cost of what this writes: ~41KB gzipped at 50 capabilities, ~126KB at
 * 145, against WP-24's ~500KB budget.
 */
export async function writeIndexes(
  outputDir: string,
  registries: ReadonlyMap<RoleName, RegistryFile>,
  encoderName = 'hashing',
): Promise<string[]> {
  const target = resolve(outputDir);
  mkdirSync(target, { recursive: true });
  const written: string[] = [];

  for (const [role, registry] of registries) {
    const documents = registry.capabilities.map(capabilityDocument);

    // A fresh encoder for this registry, every time. See the warning above.
    const embedder = makeEmbedder(encoderName);
    embedder.fit?.(documents);
    const vectors = await embedder.embedAll(documents);

    const index = {
      schemaVersion: registry.schemaVersion,
      encoder: encoderName,
      generatedAt: new Date().toISOString(),
      // Order is load-bearing: the runtime pairs capabilities[i] with
      // vectors[i], and `assertIndexMatches` refuses an index whose ids do not
      // appear in exactly this order.
      entries: registry.capabilities.map((c, i) => ({
        capabilityId: c.id,
        // Four significant figures. Cosine is scale-invariant and the ranking is
        // unchanged well above this precision, so the remaining digits are bytes
        // a browser downloads and never uses.
        vector: vectors[i]!.map((w) => Number(w.toFixed(4))),
      })),
    };

    const name = `index.${role}.json`;
    writeFileSync(join(target, name), `${JSON.stringify(index)}\n`, 'utf8');
    written.push(name);
  }

  return written;
}
