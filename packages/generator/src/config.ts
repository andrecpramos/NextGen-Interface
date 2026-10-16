import type { GeneratorConfig } from './types.ts';

/**
 * Validating the adopter's config file.
 *
 * The file is written by hand and arrives as untrusted JSON. `JSON.parse(...) as
 * GeneratorConfig` is a cast, not a check, so an omitted optional field used to travel as
 * `undefined` until something deep inside the generator dereferenced it:
 *
 *     TypeError: config.manifests is not iterable
 *         at readManifests (labels.ts:110)
 *
 * That is a stack trace about our internals in answer to "your config omitted a field —
 * which was optional anyway". Found 2026-09-17, pointing the generator at an in-repo
 * fixture for the first time; every config in the repo happened to declare every field,
 * so nothing had ever exercised the omission.
 *
 * Two fields were genuinely unguarded, `manifests` and `languages`. `localesDir` and
 * `permissionsFile` were already checked at their use sites.
 */

export interface ConfigProblem {
  readonly missing: readonly string[];
  /** A field that is present but cannot be used, said in a sentence the adopter can act on. */
  readonly invalid?: readonly string[];
}

/**
 * What is wrong with a `localesDir`, or null when nothing is: one folder, a list of folders, or null.
 * A list arrives as untrusted JSON like everything else here, and a number or an empty entry in it
 * would otherwise be read as no translations at all — every title then a component's name.
 */
export function localesDirProblem(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  // A single string is read as before: an empty one names no folder.
  if (typeof value === 'string') return null;
  const usable = (entry: unknown): boolean => typeof entry === 'string' && entry.trim().length > 0;
  if (Array.isArray(value) && value.length > 0 && value.every(usable)) return null;
  return 'localesDir must be a folder relative to appRoot, a list of such folders (the first listed wins a key two of them define), or null';
}

/** The fields without which the generator cannot begin. Everything else has a default. */
const REQUIRED = ['appRoot', 'routesFile'] as const;

export const REQUIRED_FIELD_HELP: Readonly<Record<string, string>> = {
  appRoot: "the folder holding the app's source",
  routesFile: 'its route table, or the routes folder, relative to appRoot',
};

/**
 * Fill in what the adopter may legitimately omit, or report what they may not.
 *
 * Returns the normalised config, or the list of missing required fields for the caller to
 * report. It never exits or throws: deciding how to fail belongs to the CLI, and a
 * programmatic caller may want to recover.
 */
export function normaliseConfig<T extends Partial<GeneratorConfig>>(
  raw: T,
): { config: T & GeneratorConfig; problem: null } | { config: null; problem: ConfigProblem } {
  const missing = REQUIRED.filter((key) => !raw?.[key]);
  const locales = localesDirProblem(raw?.localesDir);
  if (missing.length > 0 || locales) return { config: null, problem: { missing, ...(locales ? { invalid: [locales] } : {}) } };

  return {
    config: {
      ...raw,
      // Omitting these is the common case, not an edge case: plenty of applications keep
      // no hand-maintained navigation manifest, and most declare a single language.
      manifests: raw.manifests ?? [],
      languages: raw.languages?.length ? raw.languages : ['en'],
      localesDir: raw.localesDir ?? null,
    } as T & GeneratorConfig,
    problem: null,
  };
}
