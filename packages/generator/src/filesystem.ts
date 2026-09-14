import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

import ts from 'typescript';

import type { DiscoveredRoute, RoleName, SkipReason } from './types.ts';

/**
 * Routes declared by where files sit, rather than by a route table in code.
 *
 * React Router apps declare routes in code, and discover.ts evaluates that code.
 * The frameworks here declare them with a folder layout, so the route list is a
 * walk of a directory under each framework's naming rules — nothing evaluated,
 * nothing guessed. Written against ground truth recorded before this file existed
 * (eval/field-apps/GROUND_TRUTH.md), not against what it happened to find.
 *
 * What these adapters cannot declare, they report. A content catch-all
 * (`[...slug]`, a Remix `$` splat) matches pages that come from content rather
 * than code, so no single screen can be offered for it; it is reported as left
 * out, never declared and never dropped in silence (lessons.md L12).
 *
 * Roles are not read here. No framework in this file declares roles in its
 * folder layout, so every route receives the application's full role set, and
 * `routeRoles` in the config narrows it where the app guards a route in code.
 */

export interface LeftOut {
  readonly path: string;
  readonly reason: SkipReason;
  readonly detail: string;
}

export interface FileDiscovery {
  readonly routes: readonly DiscoveredRoute[];
  readonly leftOut: readonly LeftOut[];
}

interface Found {
  readonly path: string;
  readonly file: string;
}

const SOURCE = /\.(tsx|ts|jsx|js|mdx)$/;
const NOT_A_PAGE_FILE = /\.d\.ts$|\.(test|spec|stories)\.[jt]sx?$/;
const CATCH_ALL_DETAIL =
  'a catch-all matches many pages that come from content, not code, so no single screen can be offered for it. ' +
  'Name the pages it serves in a navigation manifest if users should be able to ask for them';

function toPath(segments: readonly string[]): string {
  return segments.length === 0 ? '/' : `/${segments.join('/')}`;
}

function entriesOf(dir: string): import('node:fs').Dirent[] {
  try {
    return readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

function isSourceFile(name: string): boolean {
  return SOURCE.test(name) && !NOT_A_PAGE_FILE.test(name);
}

function scriptKind(file: string): ts.ScriptKind {
  if (file.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (file.endsWith('.jsx')) return ts.ScriptKind.JSX;
  if (file.endsWith('.js')) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

/**
 * Does this module have a default export, and what is it called?
 *
 * In Remix a route module with no default export is a resource route — a loader
 * or an action with no page — and so not a destination. Everywhere, the name is
 * the component the rest of the generator titles a screen from.
 */
function defaultExport(file: string): { readonly exported: boolean; readonly name: string | null } {
  // A markup or MDX page has no default export to read: the file is the page.
  if (/\.(mdx|vue|svelte)$/.test(file)) return { exported: true, name: null };
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    return { exported: false, name: null };
  }
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, scriptKind(file));
  for (const statement of source.statements) {
    const modifiers = ts.canHaveModifiers(statement) ? ts.getModifiers(statement) : undefined;
    const isDefault =
      modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) && modifiers.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword);
    if (isDefault && (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement))) {
      return { exported: true, name: statement.name?.text ?? null };
    }
    if (ts.isExportAssignment(statement) && !statement.isExportEquals) {
      return { exported: true, name: ts.isIdentifier(statement.expression) ? statement.expression.text : null };
    }
    if (ts.isExportDeclaration(statement) && statement.exportClause && ts.isNamedExports(statement.exportClause)) {
      const element = statement.exportClause.elements.find((e) => e.name.text === 'default');
      if (element) return { exported: true, name: element.propertyName?.text ?? null };
    }
  }
  return { exported: false, name: null };
}

/** `/dashboard/settings` → `SettingsPage`; `/` → `HomePage`. A title of last resort. */
function nameFromPath(path: string): string {
  const segments = path.split('/').filter(Boolean);
  const named = segments.filter((segment) => !segment.includes(':'));
  // The last two named segments, so `/genre/:no/movie` is "Genre Movie", not "Movie": one word
  // loses the section the page sits in. A route made only of parameters (`/:type/:id`) is named
  // by them. Only `/` is home.
  const source = named.length > 0 ? named.slice(-2).join(' ') : segments.join(' ');
  const words = source.split(/[^a-zA-Z0-9]+/).filter(Boolean);
  return `${words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join('') || 'Home'}Page`;
}

function toRoutes(found: readonly Found[], allRoles: readonly RoleName[]): DiscoveredRoute[] {
  const seen = new Set<string>();
  const out: DiscoveredRoute[] = [];
  for (const { path, file } of found) {
    if (seen.has(path)) continue;
    seen.add(path);
    out.push({
      path,
      component: defaultExport(file).name ?? nameFromPath(path),
      componentFile: file,
      feature: null,
      roles: [...allRoles],
      roleKey: null,
      devOnly: false,
      comment: null,
    });
  }
  return out;
}

// ----------------------------------------------------------------- Next.js --

const APP_PAGE = /^page\.(tsx|ts|jsx|js|mdx)$/;

function pageIn(dir: string): string | null {
  const page = entriesOf(dir).find((e) => e.isFile() && APP_PAGE.test(e.name));
  return page ? join(dir, page.name) : null;
}

/**
 * The app router: a folder is a URL segment and `page.*` makes it a destination.
 *
 * Not segments: route groups `(name)`. Not addressable at all: private folders
 * `_name`, parallel-route slots `@name`, and intercepting routes `(.)name` —
 * each renders inside another page's URL. `route.*` files are request handlers,
 * and `layout`, `loading`, `error` and `not-found` are not pages.
 */
function walkApp(dir: string, segments: readonly string[], found: Found[], leftOut: LeftOut[]): void {
  const page = pageIn(dir);
  if (page) found.push({ path: toPath(segments), file: page });

  for (const entry of entriesOf(dir)) {
    if (!entry.isDirectory()) continue;
    const name = entry.name;
    const child = join(dir, name);
    if (name.startsWith('_') || name.startsWith('@') || /^\(\.{1,3}\)/.test(name) || name === 'node_modules') continue;
    if (/^\(.+\)$/.test(name)) {
      walkApp(child, segments, found, leftOut);
      continue;
    }
    if (/^\[\[\.\.\..+\]\]$/.test(name)) {
      // An optional catch-all also matches its own base URL, which is a destination.
      const optional = pageIn(child);
      if (optional) found.push({ path: toPath(segments), file: optional });
      continue;
    }
    if (/^\[\.\.\..+\]$/.test(name)) {
      if (pageIn(child)) leftOut.push({ path: toPath([...segments, name]), reason: 'catch-all', detail: CATCH_ALL_DETAIL });
      continue;
    }
    const parameter = /^\[(.+)\]$/.exec(name);
    walkApp(child, [...segments, parameter ? `:${parameter[1]}` : name], found, leftOut);
  }
}

const PAGES_SPECIAL = /^(_app|_document|_error|404|500)$/;

/** The pages router: every file is a page, `index` is its folder's page, `api/` is not pages. */
function walkPages(dir: string, segments: readonly string[], found: Found[], leftOut: LeftOut[]): void {
  const atRoot = segments.length === 0;
  for (const entry of entriesOf(dir)) {
    const name = entry.name;
    const child = join(dir, name);
    if (entry.isDirectory()) {
      if (atRoot && name === 'api') continue;
      if (name === 'node_modules' || name.startsWith('.')) continue;
      if (/^\[\.\.\..+\]$/.test(name)) {
        leftOut.push({ path: toPath([...segments, name]), reason: 'catch-all', detail: CATCH_ALL_DETAIL });
        continue;
      }
      const parameter = /^\[(.+)\]$/.exec(name);
      walkPages(child, [...segments, parameter ? `:${parameter[1]}` : name], found, leftOut);
      continue;
    }
    if (!entry.isFile() || !isSourceFile(name)) continue;
    const stem = name.replace(SOURCE, '');
    if (atRoot && PAGES_SPECIAL.test(stem)) continue;
    if (stem === 'index' || /^\[\[\.\.\..+\]\]$/.test(stem)) {
      found.push({ path: toPath(segments), file: child });
    } else if (/^\[\.\.\..+\]$/.test(stem)) {
      leftOut.push({ path: toPath([...segments, stem]), reason: 'catch-all', detail: CATCH_ALL_DETAIL });
    } else {
      const parameter = /^\[(.+)\]$/.exec(stem);
      found.push({ path: toPath([...segments, parameter ? `:${parameter[1]}` : stem]), file: child });
    }
  }
}

/**
 * A Next.js application: `routesDir` is its `app` (or `pages`) folder.
 *
 * Both routers are read when both exist, because Next serves both at once — the
 * field app has an app router beside a `pages/api`. Where both declare a path,
 * the app router's page is kept, as Next itself refuses the conflict.
 */
export function discoverNextRoutes(routesDir: string, allRoles: readonly RoleName[]): FileDiscovery {
  const found: Found[] = [];
  const leftOut: LeftOut[] = [];
  const parent = dirname(routesDir);
  const app = basename(routesDir) === 'pages' ? null : routesDir;
  const pages = basename(routesDir) === 'pages' ? routesDir : join(parent, 'pages');
  if (app && isDirectory(app)) walkApp(app, [], found, leftOut);
  if (isDirectory(pages)) walkPages(pages, [], found, leftOut);
  return { routes: toRoutes(found, allRoles), leftOut };
}

// ------------------------------------------------------------------- Remix --

/** Split a flat-route id on dots, except inside `[...]`, which escapes literal characters. */
function splitRouteId(id: string): string[] {
  const out: string[] = [];
  let current = '';
  let escaped = false;
  for (const character of id) {
    if (character === '[') escaped = true;
    if (character === ']') escaped = false;
    if (character === '.' && !escaped) {
      out.push(current);
      current = '';
    } else {
      current += character;
    }
  }
  out.push(current);
  return out;
}

/**
 * A Remix / React Router flat-route id to a URL.
 *
 *   _index          the index of its parent
 *   _name           a pathless layout: no URL segment
 *   name_           opts out of its parent's layout; the URL is unchanged
 *   $param          :param
 *   $               a splat: a catch-all
 *   (segment)       optional: declared without it
 *   [.]             escaped literal characters
 */
function flatRoute(id: string): { segments: string[]; splat: boolean; layoutOnly: boolean; index: boolean } {
  const parts = splitRouteId(id);
  const segments: string[] = [];
  let splat = false;
  const last = parts[parts.length - 1] ?? '';
  const index = last === '_index';
  const layoutOnly = !index && last.startsWith('_');
  for (const part of parts) {
    if (part === '_index' || part.startsWith('_') || /^\(.*\)$/.test(part)) continue;
    let segment = part.endsWith('_') ? part.slice(0, -1) : part;
    if (segment === '$') {
      splat = true;
      break;
    }
    segment = segment.replace(/\[(.*?)\]/g, '$1');
    if (segment.startsWith('$')) segment = `:${segment.slice(1)}`;
    if (segment) segments.push(segment);
  }
  return { segments, splat, layoutOnly, index };
}

/**
 * A Remix v2 (or React Router 7 `flatRoutes()`) application: `routesDir` is `app/routes`.
 *
 * A route module with no default export is a resource route and is not a page.
 * A pathless layout alone is not a destination. A layout and its `_index` share one
 * URL and are one destination; the layout is kept, because it is what names the page.
 */
export function discoverRemixRoutes(routesDir: string, allRoles: readonly RoleName[]): FileDiscovery {
  const candidates: { id: string; file: string }[] = [];
  for (const entry of entriesOf(routesDir)) {
    const full = join(routesDir, entry.name);
    if (entry.isFile() && isSourceFile(entry.name)) {
      candidates.push({ id: entry.name.replace(SOURCE, ''), file: full });
    } else if (entry.isDirectory()) {
      const route = entriesOf(full).find((e) => e.isFile() && /^route\.(tsx|ts|jsx|js|mdx)$/.test(e.name));
      if (route) candidates.push({ id: entry.name, file: join(full, route.name) });
    }
  }

  const leftOut: LeftOut[] = [];
  const byPath = new Map<string, { file: string; index: boolean }>();
  for (const { id, file } of candidates) {
    if (!defaultExport(file).exported) continue; // a resource route
    const route = flatRoute(id);
    if (route.splat) {
      leftOut.push({ path: toPath([...route.segments, '$']), reason: 'catch-all', detail: CATCH_ALL_DETAIL });
      continue;
    }
    if (route.layoutOnly) continue;
    const path = toPath(route.segments);
    const existing = byPath.get(path);
    if (!existing || (existing.index && !route.index)) byPath.set(path, { file, index: route.index });
  }

  const found = [...byPath].map(([path, { file }]) => ({ path, file })).sort((a, b) => a.path.localeCompare(b.path));
  return { routes: toRoutes(found, allRoles), leftOut };
}

// --------------------------------------------------------------- SvelteKit --

/** `[name]` and `[name=matcher]` to `:name`, wherever they sit in a segment: `@[user]` is `@:user`. */
function svelteSegment(name: string): string {
  return name.replace(/\[([^\]=]+)(?:=[^\]]+)?\]/g, ':$1');
}

/**
 * A folder is a URL segment and `+page.svelte` makes it a destination.
 *
 * Not segments: groups `(name)`, and optional parameters `[[name]]`, which are declared
 * without themselves. A rest parameter `[...rest]` is a catch-all, reported. `+layout`,
 * `+error` and a `+page.server.js` with no `+page.svelte` are not pages, and neither is
 * any component that lives beside one.
 */
function walkSvelteKit(dir: string, segments: readonly string[], found: Found[], leftOut: LeftOut[]): void {
  const page = entriesOf(dir).find((e) => e.isFile() && e.name === '+page.svelte');
  if (page) found.push({ path: toPath(segments), file: join(dir, page.name) });
  for (const entry of entriesOf(dir)) {
    if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name === 'node_modules') continue;
    const name = entry.name;
    const child = join(dir, name);
    if (/^\(.+\)$/.test(name) || /^\[\[.+\]\]$/.test(name)) {
      walkSvelteKit(child, segments, found, leftOut);
      continue;
    }
    if (/\[\.\.\..+\]/.test(name)) {
      if (entriesOf(child).some((e) => e.isFile() && e.name === '+page.svelte')) {
        leftOut.push({ path: toPath([...segments, name]), reason: 'catch-all', detail: CATCH_ALL_DETAIL });
      }
      continue;
    }
    walkSvelteKit(child, [...segments, svelteSegment(name)], found, leftOut);
  }
}

/** A SvelteKit application: `routesDir` is `src/routes`. */
export function discoverSvelteKitRoutes(routesDir: string, allRoles: readonly RoleName[]): FileDiscovery {
  const found: Found[] = [];
  const leftOut: LeftOut[] = [];
  walkSvelteKit(routesDir, [], found, leftOut);
  return { routes: toRoutes(found, allRoles), leftOut };
}

// -------------------------------------------------------------------- Nuxt --

const NUXT_PAGE = /\.(vue|tsx|jsx)$/;

/**
 * Every file is a page: `index` is its folder's page, `[name]` a parameter, `[[name]]`
 * optional (declared without it), `[...slug]` a catch-all (reported), `(name)` a group.
 * A parent page `parent.vue` beside a `parent/` folder is one destination with its
 * children; where `parent.vue` and `parent/index.vue` share a URL, the parent is kept,
 * because it is what names the page.
 */
function walkNuxt(dir: string, segments: readonly string[], found: (Found & { index: boolean })[], leftOut: LeftOut[]): void {
  for (const entry of entriesOf(dir)) {
    const name = entry.name;
    const child = join(dir, name);
    if (entry.isDirectory()) {
      if (name.startsWith('.') || name === 'node_modules') continue;
      if (/^\(.+\)$/.test(name) || /^\[\[.+\]\]$/.test(name)) {
        walkNuxt(child, segments, found, leftOut);
        continue;
      }
      if (/^\[\.\.\..+\]$/.test(name)) {
        leftOut.push({ path: toPath([...segments, name]), reason: 'catch-all', detail: CATCH_ALL_DETAIL });
        continue;
      }
      walkNuxt(child, [...segments, name.replace(/\[([^\]]+)\]/g, ':$1')], found, leftOut);
      continue;
    }
    if (!entry.isFile() || !NUXT_PAGE.test(name) || NOT_A_PAGE_FILE.test(name)) continue;
    const stem = name.replace(NUXT_PAGE, '');
    if (stem === 'index' || /^\[\[.+\]\]$/.test(stem)) {
      found.push({ path: toPath(segments), file: child, index: stem === 'index' });
    } else if (/^\[\.\.\..+\]$/.test(stem)) {
      leftOut.push({ path: toPath([...segments, stem]), reason: 'catch-all', detail: CATCH_ALL_DETAIL });
    } else {
      found.push({ path: toPath([...segments, stem.replace(/\[([^\]]+)\]/g, ':$1')]), file: child, index: false });
    }
  }
}

/** A Nuxt application: `routesDir` is its `pages` folder (`app/pages` in Nuxt 4). */
export function discoverNuxtRoutes(routesDir: string, allRoles: readonly RoleName[]): FileDiscovery {
  const found: (Found & { index: boolean })[] = [];
  const leftOut: LeftOut[] = [];
  walkNuxt(routesDir, [], found, leftOut);
  const byPath = new Map<string, Found & { index: boolean }>();
  for (const route of found) {
    const existing = byPath.get(route.path);
    if (!existing || (existing.index && !route.index)) byPath.set(route.path, route);
  }
  const routes = [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path));
  return { routes: toRoutes(routes, allRoles), leftOut };
}

function isDirectory(path: string): boolean {
  return existsSync(path) && statSync(path).isDirectory();
}
