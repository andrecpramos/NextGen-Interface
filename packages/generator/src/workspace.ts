import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

/**
 * The packages of a monorepo the application sits in.
 *
 * An app in a workspace imports its pages and its role sets from sibling packages by bare name —
 * `@acme/engine/training/pages/TrainingHomePage`, `@acme/core/permissions` — and a scan that resolved only
 * relative imports and path aliases found none of them: the pilot app's current source came out as 0
 * screens, 65 "left out". A workspace package is the adopter's own code in the same repository, so a bare
 * import is followed into a package **the workspace itself declares**, and into nothing else — not
 * `node_modules`, not a package the repository does not list, not a specifier that names no package.
 *
 * Read only, like everything here (Rule 16). An app outside any workspace has none of this.
 */

export interface Workspace {
  /** Every package directory the workspace declares. The scan may read files under these, and only these. */
  readonly roots: readonly string[];
  /** The file a bare specifier names in a declared package, or null. `probe` finds the file a path stands for. */
  resolve(specifier: string): string | null;
}

interface WorkspacePackage {
  readonly name: string;
  readonly dir: string;
  readonly exports: unknown;
  readonly main: string | null;
}

const SKIP = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'coverage']);

function readJson(file: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8').replace(/^﻿/, ''));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** The package globs a directory declares as a workspace root: pnpm's file, or `workspaces` in package.json. */
function workspaceGlobs(dir: string): string[] | null {
  const pnpm = join(dir, 'pnpm-workspace.yaml');
  if (existsSync(pnpm)) {
    const globs: string[] = [];
    let inPackages = false;
    for (const line of readFileSync(pnpm, 'utf8').split(/\r?\n/)) {
      if (/^packages\s*:/.test(line)) inPackages = true;
      else if (/^\S/.test(line)) inPackages = false;
      const item = inPackages ? /^\s*-\s*['"]?([^'"#]+?)['"]?\s*(?:#.*)?$/.exec(line) : null;
      if (item) globs.push(item[1]!.trim());
    }
    if (globs.length > 0) return globs;
  }
  const manifest = readJson(join(dir, 'package.json'));
  const workspaces = manifest?.workspaces;
  if (Array.isArray(workspaces)) return workspaces.filter((w): w is string => typeof w === 'string');
  if (workspaces && typeof workspaces === 'object') {
    const packages = (workspaces as { packages?: unknown }).packages;
    if (Array.isArray(packages)) return packages.filter((w): w is string => typeof w === 'string');
  }
  return null;
}

/** Directories a glob names: literal segments, `*` for any one directory, `**` for any depth (to three). */
function expand(base: string, segments: readonly string[], depth = 0): string[] {
  const [head, ...rest] = segments;
  if (head === undefined) return [base];
  const children = (): string[] => {
    try {
      return readdirSync(base, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && !SKIP.has(entry.name) && !entry.name.startsWith('.'))
        .map((entry) => join(base, entry.name));
    } catch {
      return [];
    }
  };
  if (head === '*') return children().flatMap((child) => expand(child, rest, depth));
  if (head === '**') {
    const here = expand(base, rest, depth);
    return depth >= 3 ? here : [...here, ...children().flatMap((child) => expand(child, segments, depth + 1))];
  }
  return expand(join(base, head), rest, depth);
}

function packagesOf(root: string, globs: readonly string[]): WorkspacePackage[] {
  const out: WorkspacePackage[] = [];
  const seen = new Set<string>();
  for (const glob of globs) {
    if (glob.startsWith('!')) continue;
    for (const dir of expand(root, glob.replace(/^\.\//, '').split('/').filter(Boolean))) {
      const manifest = readJson(join(dir, 'package.json'));
      const name = manifest?.name;
      if (typeof name !== 'string' || seen.has(dir)) continue;
      seen.add(dir);
      out.push({ name, dir, exports: manifest!.exports, main: typeof manifest!.main === 'string' ? manifest!.main : null });
    }
  }
  return out;
}

/** A package's `exports` target: a string, or the first string a conditions object offers. */
function targetOf(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(targetOf).find((v): v is string => v !== null) ?? null;
  if (value && typeof value === 'object') {
    const conditions = value as Record<string, unknown>;
    for (const key of ['import', 'default', 'types', 'require', 'browser', 'module']) {
      const found = targetOf(conditions[key]);
      if (found) return found;
    }
  }
  return null;
}

/** `./training/*` matched against `./training/pages/X`: what `*` stood for, or null. */
function wildcard(key: string, subpath: string): string | null {
  const star = key.indexOf('*');
  if (star === -1) return null;
  const head = key.slice(0, star);
  const tail = key.slice(star + 1);
  if (!subpath.startsWith(head) || !subpath.endsWith(tail) || subpath.length < head.length + tail.length) return null;
  return subpath.slice(head.length, subpath.length - tail.length);
}

function targetFor(pkg: WorkspacePackage, subpath: string): string[] {
  const exported = pkg.exports;
  if (exported && typeof exported === 'object' && !Array.isArray(exported)) {
    const map = exported as Record<string, unknown>;
    if (Object.keys(map).some((key) => key.startsWith('.'))) {
      const exact = targetOf(map[subpath]);
      if (exact) return [exact];
      for (const [key, value] of Object.entries(map)) {
        const star = wildcard(key, subpath);
        const target = star === null ? null : targetOf(value);
        if (target) return [target.split('*').join(star!)];
      }
      return [];
    }
    // `exports` is a conditions object standing for the package's own root.
    return subpath === '.' ? [targetOf(map)].filter((t): t is string => t !== null) : [];
  }
  if (typeof exported === 'string') return subpath === '.' ? [exported] : [];
  // No `exports`: the package's files are addressed by path, from its root or its `src`.
  if (subpath === '.') return [pkg.main ?? 'src/index', 'src/index', 'index'];
  const rest = subpath.replace(/^\.\//, '');
  return [rest, join('src', rest)];
}

/**
 * The workspace `start` belongs to, found by walking up to the nearest directory that declares one, or
 * null. `probe` turns a path into the file it stands for (an extension, an index), as discovery does.
 */
export function findWorkspace(start: string, probe: (base: string) => string | null): Workspace | null {
  let dir = resolve(start);
  for (let depth = 0; depth < 8; depth++) {
    const globs = workspaceGlobs(dir);
    if (globs) {
      const packages = packagesOf(dir, globs);
      if (packages.length === 0) return null;
      // Longest name first, so `@acme/core-extra` is never taken for `@acme/core`.
      const byName = [...packages].sort((a, b) => b.name.length - a.name.length);
      return {
        roots: packages.map((pkg) => pkg.dir),
        resolve(specifier) {
          const pkg = byName.find((p) => specifier === p.name || specifier.startsWith(`${p.name}/`));
          if (!pkg) return null;
          const subpath = specifier === pkg.name ? '.' : `./${specifier.slice(pkg.name.length + 1)}`;
          for (const target of targetFor(pkg, subpath)) {
            const file = probe(resolve(pkg.dir, target));
            if (file) return file;
          }
          return null;
        },
      };
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}
