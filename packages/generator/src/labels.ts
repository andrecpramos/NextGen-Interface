import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

import ts from 'typescript';

import type { GeneratorConfig, ManifestEntry } from './types.ts';

/**
 * The application's own words for its own screens.
 *
 * A route path is a developer's spelling; `nav.trainingCalendar` resolved
 * against the locale files is what the user actually reads on the sidebar. The
 * second is the vocabulary an assistant has to match, and PLAN.md §7.2 is
 * explicit that a hand-maintained nav manifest is "a far richer signal than
 * JSX" — because a person wrote it for other people.
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

/**
 * Every `(path | route, label?, reason?)` triple a manifest declares.
 *
 * Deliberately shape-driven rather than name-driven: any object literal that
 * names a route is a navigation entry, wherever it sits in whatever tree. That
 * covers a flat deep-link list and a nested per-role sidebar config without
 * this module knowing either format.
 */
export function readManifest(file: string): ManifestEntry[] {
  const source = parse(file);
  const out: ManifestEntry[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isObjectLiteralExpression(node)) {
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
          reason: reasonExpression ? stringValue(reasonExpression) : null,
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);

  return out;
}

/** First entry wins, so an explicit deep-link reason is not overwritten by a nav leaf. */
export function readManifests(config: GeneratorConfig): Map<string, ManifestEntry> {
  const out = new Map<string, ManifestEntry>();
  for (const manifest of config.manifests) {
    const file = resolve(config.appRoot, manifest);
    if (!existsSync(file)) continue;
    for (const entry of readManifest(file)) {
      const existing = out.get(entry.path);
      if (!existing) {
        out.set(entry.path, entry);
        continue;
      }
      // Merge: a nav leaf often carries the label, the deep-link list the reason.
      out.set(entry.path, {
        path: entry.path,
        labelKey: existing.labelKey ?? entry.labelKey,
        reason: existing.reason ?? entry.reason,
      });
    }
  }
  return out;
}

// ------------------------------------------------------------------ i18n ------

export type Translations = ReadonlyMap<string, Record<string, unknown>>;

/** Every `<localesDir>/<lang>/<namespace>.json`, by namespace. */
export function readTranslations(config: GeneratorConfig, language: string): Translations {
  const out = new Map<string, Record<string, unknown>>();
  if (!config.localesDir) return out;
  const directory = resolve(config.appRoot, config.localesDir, language);
  if (!existsSync(directory)) return out;
  for (const file of readdirSync(directory)) {
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
