import { existsSync, readFileSync, readdirSync, type Dirent } from 'node:fs';
import { basename, join, resolve } from 'node:path';

import ts from 'typescript';

import type { GeneratorConfig, ManifestEntry, NavLabel } from './types.ts';

export type { NavLabel } from './types.ts';

/**
 * The application's own words for its own screens.
 *
 * A route path is a developer's spelling; `nav.lessonCalendar` resolved
 * against the locale files is what the user actually reads on the sidebar. The
 * second is the vocabulary an assistant has to match. A hand-maintained nav
 * manifest is a far richer signal than JSX, because a person wrote it for
 * other people.
 *
 * Everything read here is untrusted text (Rule 15): it is the adopter's copy,
 * not ours, and it reaches a prompt only through `synthesise.ts`'s isolation.
 */

function parse(file: string): ts.SourceFile {
  return ts.createSourceFile(
    file,
    readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

/** String literals, and the `'a' + 'b'` concatenations these manifests use. */
function stringValue(expression: ts.Expression): string | null {
  if (ts.isStringLiteralLike(expression)) return expression.text;
  if (ts.isParenthesizedExpression(expression)) return stringValue(expression.expression);
  if (ts.isBinaryExpression(expression) && expression.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = stringValue(expression.left);
    const right = stringValue(expression.right);
    return left !== null && right !== null ? left + right : null;
  }
  return null;
}

function propertyMap(node: ts.ObjectLiteralExpression): Map<string, ts.Expression> {
  const out = new Map<string, ts.Expression>();
  for (const property of node.properties) {
    if (ts.isPropertyAssignment(property) && (ts.isIdentifier(property.name) || ts.isStringLiteralLike(property.name))) {
      out.set(property.name.text, property.initializer);
    }
  }
  return out;
}

/** Strip `as const`, `satisfies` and parentheses. */
function bare(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (ts.isAsExpression(current) || ts.isSatisfiesExpression(current) || ts.isParenthesizedExpression(current)) {
    current = current.expression;
  }
  return current;
}

function placementOf(expression: ts.Expression): NavLabel | null {
  const node = bare(expression);
  if (!ts.isObjectLiteralExpression(node)) return null;
  const properties = propertyMap(node);
  const label = properties.get('labelKey');
  const labelKey = label ? stringValue(bare(label)) : null;
  if (labelKey === null) return null;
  const group = properties.get('group');
  const groupNode = group ? bare(group) : null;
  const groupLabel = groupNode && ts.isObjectLiteralExpression(groupNode) ? propertyMap(groupNode).get('labelKey') : undefined;
  return { labelKey, groupLabelKey: groupLabel ? stringValue(bare(groupLabel)) : null };
}

/**
 * The placements a role-keyed nav map declares, in declaration order —
 * `{ COACH: { labelKey: 'nav.overview', group: { labelKey: 'nav.competition' } }, STAFF: [{…}, {…}] }` —
 * or null when the expression is not one: every member is a role naming one placement or a list of them.
 */
export function navPlacements(expression: ts.Expression | undefined): NavLabel[] | null {
  const node = expression ? bare(expression) : undefined;
  if (!node || !ts.isObjectLiteralExpression(node) || node.properties.length === 0) return null;
  const out: NavLabel[] = [];
  for (const property of node.properties) {
    if (!ts.isPropertyAssignment(property)) return null;
    const value = bare(property.initializer);
    const placements = ts.isArrayLiteralExpression(value) ? value.elements.map(placementOf) : [placementOf(value)];
    if (placements.length === 0 || placements.some((p) => p === null)) return null;
    out.push(...(placements as NavLabel[]));
  }
  return out;
}

/**
 * One name for a screen that each role's sidebar may file differently.
 *
 * The label most placements use. On a tie, the placement `prefer` ranks highest — generate ranks one
 * that names the route's own area or address above one that does not — and then the first, in
 * declaration order. The group is the group of the placement chosen, so a label and its group always
 * come from the same sidebar.
 */
export function chooseNavLabel(
  placements: readonly NavLabel[] | null | undefined,
  prefer: (placement: NavLabel) => number = () => 0,
): NavLabel | null {
  if (!placements || placements.length === 0) return null;
  const counts = new Map<string, number>();
  for (const placement of placements) counts.set(placement.labelKey, (counts.get(placement.labelKey) ?? 0) + 1);
  const most = Math.max(...counts.values());
  let chosen: NavLabel | null = null;
  let best = -Infinity;
  for (const placement of placements) {
    if (counts.get(placement.labelKey) !== most) continue;
    const rank = prefer(placement);
    if (rank > best) {
      chosen = placement;
      best = rank;
    }
  }
  return chosen;
}

/** How many of these placements use this label. */
export function placementVotes(placements: readonly NavLabel[] | null | undefined, labelKey: string): number {
  return (placements ?? []).filter((placement) => placement.labelKey === labelKey).length;
}

/** A role's name as an application writes one when it has no role list to check it against: `COACH`, `CLUB_ADMIN`. */
const ROLE_NAME = /^[A-Z][A-Z0-9_]*$/;

/**
 * `{ 'training/calendar': { COACH: { labelKey, group }, … }, … }`: a nav map keyed by route, each
 * route's placements keyed by role. Every member must be such a placement map, and every key of a
 * placement map a role — one of `roles` when the application's roles are known, else a name written
 * like one — so a route entry that merely carries a `nav` beside its `path`, or a map of anything else
 * that happens to hold label keys, is not taken for one.
 */
function routeKeyedNav(node: ts.ObjectLiteralExpression, roles: readonly string[] | null): ManifestEntry[] | null {
  if (node.properties.length === 0) return null;
  const isRole = (name: string): boolean => (roles ? roles.includes(name) : ROLE_NAME.test(name));
  const out: ManifestEntry[] = [];
  for (const property of node.properties) {
    if (!ts.isPropertyAssignment(property) || !(ts.isIdentifier(property.name) || ts.isStringLiteralLike(property.name))) return null;
    const byRole = bare(property.initializer);
    if (!ts.isObjectLiteralExpression(byRole)) return null;
    for (const member of byRole.properties) {
      const name = ts.isPropertyAssignment(member) && (ts.isIdentifier(member.name) || ts.isStringLiteralLike(member.name)) ? member.name.text : null;
      if (name === null || !isRole(name)) return null;
    }
    const placements = navPlacements(property.initializer);
    const label = chooseNavLabel(placements);
    if (!label || !placements) return null;
    out.push({
      path: `/${property.name.text.replace(/^\/+/, '')}`,
      labelKey: label.labelKey,
      groupLabelKey: label.groupLabelKey,
      placements,
      reason: null,
    });
  }
  return out;
}

/**
 * Every `(path | route, label?, reason?)` triple a manifest declares.
 *
 * Deliberately shape-driven rather than name-driven: any object literal that
 * names a route is a navigation entry, wherever it sits in whatever tree. That
 * covers a flat deep-link list and a nested per-role sidebar config without
 * this module knowing either format. `roles`: the application's roles, when known (see `routeKeyedNav`).
 */
export function readManifest(file: string, roles: readonly string[] | null = null): ManifestEntry[] {
  const source = parse(file);
  const out: ManifestEntry[] = [];
  // The labels of the nav groups being read, innermost last. A group is an object with a
  // `label` and an `items` array: a sidebar may nest every "Visão geral" leaf in one, and a
  // command palette names the leaf "Turmas · Visão geral" from exactly that.
  const groups: (string | null)[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isObjectLiteralExpression(node)) {
      // A nav map keyed by route is read whole, and what it holds is still walked: a placement may
      // carry entries of its own.
      const byRoute = routeKeyedNav(node, roles);
      if (byRoute) out.push(...byRoute);
      const properties = propertyMap(node);
      const pathExpression = properties.get('path') ?? properties.get('route');
      const path = pathExpression ? stringValue(pathExpression) : null;
      if (path !== null && path.startsWith('/')) {
        const labelExpression = properties.get('label');
        const reasonExpression = properties.get('reason');
        const palette = properties.get('palette');
        const paletteLabel =
          palette && ts.isObjectLiteralExpression(palette)
            ? (propertyMap(palette).get('label') ?? null)
            : null;
        out.push({
          path,
          labelKey:
            (labelExpression ? stringValue(labelExpression) : null) ??
            (paletteLabel ? stringValue(paletteLabel) : null),
          groupLabelKey: groups.at(-1) ?? null,
          reason: reasonExpression ? stringValue(reasonExpression) : null,
        });
      }
      const items = properties.get('items');
      if (items && ts.isArrayLiteralExpression(items)) {
        const label = properties.get('label');
        groups.push(label ? stringValue(label) : null);
        ts.forEachChild(node, visit);
        groups.pop();
        return;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);

  return out;
}

/** First entry wins, so an explicit deep-link reason is not overwritten by a nav leaf. */
export function readManifests(config: GeneratorConfig, roles: readonly string[] | null = null): Map<string, ManifestEntry> {
  const out = new Map<string, ManifestEntry>();
  for (const manifest of config.manifests) {
    const file = resolve(config.appRoot, manifest);
    if (!existsSync(file)) continue;
    for (const entry of readManifest(file, roles)) {
      const existing = out.get(entry.path);
      if (!existing) {
        out.set(entry.path, entry);
        continue;
      }
      // Merge: a nav leaf often carries the label, the deep-link list the reason.
      const placements = existing.labelKey ? existing.placements : entry.placements;
      out.set(entry.path, {
        path: entry.path,
        labelKey: existing.labelKey ?? entry.labelKey,
        groupLabelKey: existing.groupLabelKey ?? entry.groupLabelKey ?? null,
        ...(placements ? { placements } : {}),
        reason: existing.reason ?? entry.reason,
      });
    }
  }
  return out;
}

/** Folders that hold no source of the application's own. */
const NOT_SOURCE = new Set(['node_modules', '.git', 'dist', 'build', 'out', 'coverage', 'public', '.next', '.nuxt', '.svelte-kit']);

/**
 * Nav-shaped entries written anywhere in the application's source: route -> label key.
 *
 * A configured manifest is where an app keeps its navigation, but not always all of it.
 * An app may render its pinned Settings item inline in `Sidebar.tsx` —
 * `{ label: 'nav.settings', route: '/settings' }` — so `/settings` had no label and was
 * named after its component: "Settings", in a Portuguese registry. Read with the same
 * shape-driven reader as a manifest, and used only as a last resort: a title the page or
 * its configured navigation gives always comes first.
 */
export function readSourceLabels(appRoot: string): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (dir: string): void => {
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // a folder we cannot list is not a reason to fail a build
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!NOT_SOURCE.has(entry.name) && !entry.name.startsWith('__')) walk(path);
        continue;
      }
      if (!/\.[jt]sx?$/.test(entry.name) || /\.(test|spec|stories)\.[jt]sx?$|\.d\.ts$/.test(entry.name)) continue;
      let text: string;
      try {
        text = readFileSync(path, 'utf8');
      } catch {
        continue;
      }
      // Cheap before parsing: a nav entry names a route and a label.
      if (!/\b(?:route|path)\s*:\s*['"`]\//.test(text) || !/\blabel\s*:/.test(text)) continue;
      for (const found of readManifest(path)) {
        if (found.labelKey && !out.has(found.path)) out.set(found.path, found.labelKey);
      }
    }
  };
  walk(resolve(appRoot));
  return out;
}

// ------------------------------------------------------------------ i18n ------

export type Translations = ReadonlyMap<string, Record<string, unknown>>;

/** The locale folders a config names, in the order it lists them: one, several, or none. */
export function localeFolders(config: Pick<GeneratorConfig, 'localesDir'>): string[] {
  const dirs = config.localesDir;
  if (!dirs) return [];
  return (typeof dirs === 'string' ? [dirs] : [...dirs]).filter((dir) => typeof dir === 'string' && dir.trim().length > 0);
}

/** Every `<folder>/<lang>/<namespace>.json` in one locale folder, by namespace, in file-name order on every file system. */
function readLocaleFolder(appRoot: string, folder: string, language: string): Map<string, Record<string, unknown>> {
  const out = new Map<string, Record<string, unknown>>();
  const directory = resolve(appRoot, folder, language);
  if (!existsSync(directory)) {
    // One flat file per language — `locales/pt-PT.json` — as @nuxtjs/i18n, vue-i18n and
    // next-intl lay them out. Loaded as a single, unnamed namespace.
    const flat = resolve(appRoot, folder, `${language}.json`);
    if (!existsSync(flat)) return out;
    try {
      const parsed: unknown = JSON.parse(readFileSync(flat, 'utf8'));
      if (parsed && typeof parsed === 'object') out.set('', parsed as Record<string, unknown>);
    } catch {
      // a locale file we cannot parse is not a reason to fail a build
    }
    return out;
  }
  for (const file of readdirSync(directory).sort()) {
    if (!file.endsWith('.json')) continue;
    try {
      const parsed: unknown = JSON.parse(readFileSync(join(directory, file), 'utf8'));
      if (parsed && typeof parsed === 'object') {
        out.set(basename(file, '.json'), parsed as Record<string, unknown>);
      }
    } catch {
      continue; // a locale file we cannot parse is not a reason to fail a build
    }
  }
  return out;
}

const isBranch = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Adds what `later` defines to `kept`, in place, and counts what it could not: a key `kept`
 * already holds stays as it is. Branches merge key by key, so two folders may each fill in part of
 * one namespace — a package adding entries to a lookup table another owns.
 */
function mergeLocale(kept: Record<string, unknown>, later: Record<string, unknown>): number {
  let collisions = 0;
  for (const [key, value] of Object.entries(later)) {
    if (!(key in kept)) {
      kept[key] = value;
      continue;
    }
    const current = kept[key];
    if (isBranch(current) && isBranch(value)) collisions += mergeLocale(current, value);
    else collisions += 1;
  }
  return collisions;
}

/** One language's translations, and how many keys a later locale folder defined again. */
export interface LocaleRead {
  readonly translations: Translations;
  /** Keys a later folder also defined; the first folder's value was kept. */
  readonly collisions: number;
}

/**
 * Every namespace of one language, from every locale folder the config lists.
 *
 * A monorepo keeps each package's copy beside its code — a shared folder for the navigation, one per
 * feature package for its pages — and an app that reads one folder names only the screens whose words
 * live there; the rest fall back to a component's name. The folders merge per namespace and key, in
 * the order listed: the first to define a key wins, as an owner's copy wins over a package that only
 * extends it, and each key another folder defined again is counted, so a build can say so.
 */
export function readLocales(config: Pick<GeneratorConfig, 'appRoot' | 'localesDir'>, language: string): LocaleRead {
  const out = new Map<string, Record<string, unknown>>();
  let collisions = 0;
  for (const folder of localeFolders(config)) {
    for (const [namespace, document] of readLocaleFolder(config.appRoot, folder, language)) {
      const kept = out.get(namespace);
      if (kept) collisions += mergeLocale(kept, document);
      else out.set(namespace, document);
    }
  }
  return { translations: out, collisions };
}

/** Every `<localesDir>/<lang>/<namespace>.json`, by namespace, from each folder listed. */
export function readTranslations(config: Pick<GeneratorConfig, 'appRoot' | 'localesDir'>, language: string): Translations {
  return readLocales(config, language).translations;
}

function lookup(document: Record<string, unknown> | undefined, dotted: string): string | null {
  if (!document) return null;
  let current: unknown = document;
  for (const segment of dotted.split('.')) {
    if (typeof current !== 'object' || current === null) return null;
    current = (current as Record<string, unknown>)[segment];
  }
  return typeof current === 'string' ? current : null;
}

/**
 * Resolve `ns:a.b`, `ns.a.b` or a bare `a.b` against the loaded locale files.
 *
 * The three forms all appear in one real codebase, and a key that resolves in
 * none of them returns `null` rather than its own key text — a raw i18n key in
 * a registry would be worse than no label at all, because it embeds our failure
 * in text the end user reads.
 */
export function translate(translations: Translations, key: string): string | null {
  // A key written as the text itself — `"Type to search...": "…"` — contains dots that
  // are not a path. Look for it whole first.
  for (const document of translations.values()) {
    const exact = document[key];
    if (typeof exact === 'string') return exact;
  }
  const [head, ...rest] = key.includes(':') ? key.split(':') : [null, key];
  if (head !== null) {
    const direct = lookup(translations.get(head), rest.join(':'));
    if (direct !== null) return direct;
  }
  const dotted = key.replace(':', '.');
  const [namespace, ...tail] = dotted.split('.');
  if (namespace !== undefined && tail.length > 0) {
    const viaNamespace = lookup(translations.get(namespace), tail.join('.'));
    if (viaNamespace !== null) return viaNamespace;
  }
  for (const document of translations.values()) {
    const found = lookup(document, dotted);
    if (found !== null) return found;
  }
  return null;
}
