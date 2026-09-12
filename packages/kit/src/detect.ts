import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';

import type { GeneratorConfig } from '@nextgen/generator';

import { assertOutsideApp, CONFIG_FILE, REVIEW_DIR, toPosix } from './paths.ts';

/**
 * `nextgen init`: where does this application keep what the generator reads?
 *
 * Every answer carries its evidence, and says whether it was found or guessed.
 * The kit will be run by someone who did not write it, on an application nobody
 * on this project has read (PLAN.md WP-41, WP-35). A wrong guess that is stated
 * can be corrected in one line of config. A wrong guess that is silent becomes a
 * missing screen that no report mentions (lessons.md L12).
 */

export interface Finding {
  readonly what: string;
  readonly value: string | null;
  readonly evidence: string;
  /** `false`: a default or a best guess that the adopter should confirm. */
  readonly confident: boolean;
}

export interface Detection {
  /** Absolute paths. `init` rewrites them relative to the config file. */
  readonly config: GeneratorConfig;
  readonly findings: readonly Finding[];
  readonly warnings: readonly string[];
}

const SOURCE = /\.(tsx?|jsx?)$/;
const TEST_FILE = /\.(test|spec|stories)\.[jt]sx?$/;
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', 'coverage', '__tests__', '__mocks__', 'testing', 'e2e', 'out']);

function isDir(path: string): boolean {
  return existsSync(path) && statSync(path).isDirectory();
}

function sourceFiles(root: string, limit = 5000): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (out.length >= limit) return;
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith('.')) walk(join(dir, entry.name));
      } else if (SOURCE.test(entry.name) && !TEST_FILE.test(entry.name) && !entry.name.endsWith('.d.ts')) {
        out.push(join(dir, entry.name));
      }
    }
  };
  walk(root);
  return out;
}

const count = (text: string, pattern: RegExp): number => (text.match(pattern) ?? []).length;

// ------------------------------------------------------------ the route table --

const ROUTER_CALL = /\b(createBrowserRouter|createHashRouter|createMemoryRouter|createRoutesFromElements|useRoutes)\s*\(/;
/** A route table renders something. A paths table only names routes. */
const RENDERS = /\b(element|Component|component|lazy)\s*:|<Route\b/;

function routeScore(text: string): number {
  const entries = count(text, /\bpath\s*:/g) + count(text, /<Route\b/g);
  if (entries === 0 || !RENDERS.test(text)) return 0;
  return entries + (ROUTER_CALL.test(text) ? 10 : 0);
}

// ---------------------------------------------------------------- the roles --

const OBJECT_EXPORT = /export\s+const\s+(\w+)\s*(?::[^=]+)?=\s*\{/g;
const ARRAY_EXPORT = /export\s+const\s+(\w+)\s*(?::[^=]+)?=\s*\[/g;
const ROLE_HINT = /export\s+(?:enum|type|const|interface)\s+(\w*role\w*)/gi;

function exportsNamed(text: string, pattern: RegExp): string[] {
  return [...text.matchAll(pattern)].map((m) => m[1]!).filter((name) => /role/i.test(name));
}

// ------------------------------------------------------------------ locales --

const LOCALE_DIR = /^(locales?|i18n|lang(s|uages)?|translations)$/i;

/** A directory whose subdirectories each hold JSON: `locales/<lang>/<namespace>.json`. */
function findLocales(root: string): { dir: string; languages: string[] } | null {
  const queue = [root];
  while (queue.length > 0) {
    const dir = queue.shift()!;
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (!entry.isDirectory() || SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
      const path = join(dir, entry.name);
      if (LOCALE_DIR.test(entry.name)) {
        const languages = readdirSync(path, { withFileTypes: true })
          .filter((sub) => sub.isDirectory() && readdirSync(join(path, sub.name)).some((f) => f.endsWith('.json')))
          .map((sub) => sub.name)
          .sort();
        if (languages.length > 0) return { dir: path, languages };
      }
      queue.push(path);
    }
  }
  return null;
}

function htmlLang(appDir: string, appRoot: string): { lang: string; file: string } | null {
  for (const file of [join(appDir, 'index.html'), join(appDir, 'public', 'index.html'), join(appRoot, 'index.html')]) {
    if (!existsSync(file)) continue;
    const match = /<html[^>]*\blang=["']([^"']+)["']/i.exec(readFileSync(file, 'utf8'));
    if (match) return { lang: match[1]!, file };
  }
  return null;
}

// ------------------------------------------------------------------ detect --

export function detectApp(appDir: string): Detection {
  const dir = resolve(appDir);
  if (!isDir(dir)) throw new Error(`No folder at ${dir}.`);
  const appRoot = isDir(join(dir, 'src')) ? join(dir, 'src') : dir;
  const rel = (path: string): string => toPosix(relative(appRoot, path));

  const findings: Finding[] = [];
  const warnings: string[] = [];
  findings.push({
    what: 'source root',
    value: toPosix(relative(dir, appRoot)) || '.',
    evidence: appRoot === dir ? 'no src/ folder, so the folder itself' : 'the src/ folder',
    confident: appRoot !== dir,
  });

  const files = sourceFiles(appRoot).map((file) => ({ file, text: readFileSync(file, 'utf8') }));

  // The route table: the file that declares the most routes AND renders pages.
  const ranked = files
    .map(({ file, text }) => ({ file, score: routeScore(text) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || a.file.length - b.file.length);
  const routes = ranked[0];
  if (!routes) {
    throw new Error(
      `No route table found under ${appRoot}. The kit looks for a file that declares routes ` +
        `(createBrowserRouter, <Route>, or objects with path: and element:). ` +
        `Set "routesFile" in ${CONFIG_FILE} by hand, relative to ${appRoot}.`,
    );
  }
  const routesText = files.find((f) => f.file === routes.file)!.text;
  findings.push({
    what: 'route table',
    value: rel(routes.file),
    evidence:
      `declares ${routes.score >= 10 && ROUTER_CALL.test(routesText) ? 'a router and ' : ''}the most routes` +
      (ranked.length > 1 ? `; next best: ${ranked.slice(1, 3).map((r) => rel(r.file)).join(', ')}` : ''),
    confident: ranked.length === 1 || routes.score > (ranked[1]?.score ?? 0) * 1.5,
  });

  // The roles: an exported object of named role sets, plus the array of every role.
  const roleFiles = files
    .map(({ file, text }) => ({ file, sets: exportsNamed(text, OBJECT_EXPORT), all: exportsNamed(text, ARRAY_EXPORT) }))
    .filter((r) => r.sets.length > 0 && r.all.length > 0);
  const referenced = roleFiles.find((r) => r.sets.some((name) => routesText.includes(`${name}.`)));
  const roles = referenced ?? roleFiles[0];

  let permissions: Pick<GeneratorConfig, 'roleSetExport' | 'allRolesExport'> & { permissionsFile?: string } = {
    roleSetExport: 'ROUTE_ROLES',
    allRolesExport: 'APP_ROLES',
  };
  if (roles) {
    const roleSetExport = roles.sets.find((name) => routesText.includes(`${name}.`)) ?? roles.sets[0]!;
    const allRolesExport = roles.all.find((name) => /app|all/i.test(name)) ?? roles.all[0]!;
    permissions = { permissionsFile: rel(roles.file), roleSetExport, allRolesExport };
    findings.push({
      what: 'role table',
      value: `${rel(roles.file)}: ${roleSetExport} (role sets), ${allRolesExport} (every role)`,
      evidence: referenced ? `the route table reads ${roleSetExport}.` : 'exports both shapes, but the route table does not name it',
      confident: Boolean(referenced),
    });
  } else {
    findings.push({
      what: 'role table',
      value: null,
      evidence: 'no permissions module, so the roles come from the route table itself',
      confident: false,
    });
    const hints = files.flatMap(({ file, text }) => [...text.matchAll(ROLE_HINT)].map((m) => `${m[1]} in ${rel(file)}`));
    if (hints.length > 0) {
      warnings.push(
        `This app mentions roles (${hints.slice(0, 3).join('; ')}), and the kit found no permissions module. ` +
          `Check the roles listed under "What it built" after you run build: if they are not this app's real ` +
          `roles, every screen goes into ONE registry that every user receives, and users would see the names ` +
          `of screens they cannot open (Rule 17). Point permissionsFile, roleSetExport and allRolesExport at ` +
          `your role table, or confirm that no screen is restricted.`,
      );
    }
  }

  // Manifests are the richest signal, and the least standard shape. Not guessed.
  findings.push({
    what: 'navigation manifests',
    value: null,
    evidence: 'not detected. Optional: a hand-kept list of routes with labels makes descriptions better. Add it to "manifests"',
    confident: true,
  });

  // Languages. The first one decides the language of every description, and the
  // encoder matches words: an English description cannot be found by a Portuguese question.
  const locales = findLocales(appRoot);
  const html = htmlLang(dir, appRoot);
  let languages: string[];
  if (locales) {
    const primary = html
      ? (locales.languages.find((l) => l.toLowerCase() === html.lang.toLowerCase()) ??
        locales.languages.find((l) => l.split('-')[0]!.toLowerCase() === html.lang.split('-')[0]!.toLowerCase()))
      : undefined;
    languages = primary ? [primary, ...locales.languages.filter((l) => l !== primary)] : locales.languages;
    findings.push({ what: 'translations', value: rel(locales.dir), evidence: `languages: ${locales.languages.join(', ')}`, confident: true });
    findings.push({
      what: 'app language',
      value: languages[0]!,
      evidence: primary ? `<html lang="${html!.lang}"> in ${basename(dirname(html!.file))}/${basename(html!.file)}` : 'first alphabetically: confirm it',
      confident: Boolean(primary),
    });
  } else {
    languages = [html?.lang ?? 'en'];
    findings.push({ what: 'translations', value: null, evidence: 'none found. Labels are read from the source as written', confident: true });
    findings.push({
      what: 'app language',
      value: languages[0]!,
      evidence: html ? `<html lang="${html.lang}">` : 'no <html lang>, so English was assumed: confirm it',
      confident: Boolean(html),
    });
  }
  if (!findings.find((f) => f.what === 'app language')!.confident) {
    warnings.push(
      `The app's language is a guess (${languages[0]}). It decides the language of every description, and a ` +
        `question in another language will not find them. Put the app's own language first in "languages".`,
    );
  }

  const config: GeneratorConfig = {
    appRoot,
    routesFile: rel(routes.file),
    ...permissions,
    manifests: [],
    localesDir: locales ? rel(locales.dir) : null,
    languages,
  };
  return { config, findings, warnings };
}

// -------------------------------------------------------------------- init --

export interface InitResult extends Detection {
  readonly kitDir: string;
  readonly configFile: string;
}

/**
 * Detect, then write `nextgen.config.json` and `review/detect.json`. Nothing else.
 *
 * The default kit folder is `<app>/nextgen`, a sibling of `src/`. That is inside
 * the adopter's repository but outside their source, and the kit never writes
 * anywhere else. An existing config is not overwritten without `force`: after
 * the first run it is the adopter's file, and they may have corrected it.
 */
export function init(appDir: string, kitDir?: string, options: { force?: boolean } = {}): InitResult {
  const detection = detectApp(appDir);
  const appRoot = detection.config.appRoot;
  const target = resolve(kitDir ?? join(resolve(appDir), 'nextgen'));
  assertOutsideApp(target, appRoot);

  const configFile = join(target, CONFIG_FILE);
  if (existsSync(configFile) && !options.force) {
    throw new Error(`${configFile} already exists. It may hold your corrections; pass --force to replace it.`);
  }

  mkdirSync(join(target, REVIEW_DIR), { recursive: true });
  const written = { ...detection.config, appRoot: toPosix(relative(target, appRoot)) };
  writeFileSync(configFile, `${JSON.stringify(written, null, 2)}\n`, 'utf8');
  writeFileSync(
    join(target, REVIEW_DIR, 'detect.json'),
    `${JSON.stringify({ detectedAt: new Date().toISOString(), findings: detection.findings, warnings: detection.warnings }, null, 2)}\n`,
    'utf8',
  );
  return { ...detection, kitDir: target, configFile };
}
