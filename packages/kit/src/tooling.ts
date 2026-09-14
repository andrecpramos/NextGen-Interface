import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { isAbsolute, join, relative } from 'node:path';

/**
 * Would the adopter's own checks trip over the kit folder? (readiness item 4)
 *
 * The kit folder sits inside the adopter's project by default, and its bundle is a
 * minified script and generated JSON that no formatter or linter in their project was
 * written for. Nothing breaks at run time — their CI goes red on the first commit that
 * includes the folder. Measured on 2026-09-13: `prettier --check .` over a kit folder
 * failed on both `nextgen.js` and a registry.
 *
 * This reads the project's own scripts and ignore files and says, per tool, the one line
 * to add. It never edits those files: they are the adopter's (Rule 16).
 */

export interface SweepWarning {
  /** Prettier, ESLint or Biome. */
  readonly tool: string;
  /** The package.json script that runs it over the whole project. */
  readonly script: string;
  /** What to add, and where. */
  readonly fix: string;
  /** Whether a failure is measured (Prettier) or depends on the adopter's own config. */
  readonly certain: boolean;
}

/** Flags whose next token is a value, not a path. */
const VALUE_FLAGS = new Set([
  '--config',
  '-c',
  '--config-path',
  '--ignore-path',
  '--ext',
  '--format',
  '-f',
  '--output-file',
  '-o',
  '--max-warnings',
  '--cache-location',
  '--resolve-plugins-relative-to',
  '--rulesdir',
  '--parser',
  '--plugin',
  '--log-level',
  '--max-diagnostics',
  '--reporter',
]);

function scriptsOf(projectDir: string): Record<string, string> {
  const file = join(projectDir, 'package.json');
  if (!existsSync(file)) return {};
  try {
    const manifest = JSON.parse(readFileSync(file, 'utf8').replace(/^﻿/, '')) as { scripts?: Record<string, string> };
    return manifest.scripts ?? {};
  } catch {
    return {};
  }
}

/** True when a non-comment line of `file` names the folder. */
function mentions(file: string, folder: string): boolean {
  if (!existsSync(file)) return false;
  return readFileSync(file, 'utf8')
    .split('\n')
    .some((line) => !/^\s*(#|\/\/)/.test(line) && line.includes(folder));
}

function anyMentions(dir: string, pattern: RegExp, folder: string): boolean {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return false;
  }
  return names.filter((name) => pattern.test(name)).some((name) => mentions(join(dir, name), folder));
}

/**
 * The paths a tool's command runs over, from the segment after its name. `null` when it
 * names none, which for ESLint and Biome means the whole project.
 */
function targetsAfter(command: string, at: number, skip: number): string[] {
  const segment = command.slice(at).split(/&&|\|\||;|\|/)[0] ?? '';
  // `skip`: the tool's own name, and for Biome its subcommand (`biome check`), which is
  // not a path. Found by the first test run: "check" was counted as one.
  const tokens = segment.trim().split(/\s+/).slice(skip);
  const paths: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!.replace(/^['"]|['"]$/g, '');
    if (token.startsWith('-')) {
      if (VALUE_FLAGS.has(token)) i++;
      continue;
    }
    paths.push(token);
  }
  return paths;
}

const sweepsProject = (paths: readonly string[], noPathsMeansAll: boolean): boolean =>
  paths.length === 0 ? noPathsMeansAll : paths.some((p) => p === '.' || p === './' || p.startsWith('**') || p.startsWith('./**'));

interface Tool {
  readonly tool: string;
  readonly command: RegExp;
  /** Tokens before the first path: the tool's name, and Biome's subcommand. */
  readonly skip: number;
  readonly noPathsMeansAll: boolean;
  readonly certain: boolean;
  ignored(projectDir: string, folder: string): boolean;
  fix(folder: string): string;
}

const TOOLS: readonly Tool[] = [
  {
    tool: 'Prettier',
    skip: 1,
    command: /\bprettier\b(?=[^&|;]*\s(?:--check|-c|--list-different|-l|--write|-w)(?:\s|$))/,
    noPathsMeansAll: false,
    certain: true,
    // Prettier 3 also honours .gitignore.
    ignored: (dir, folder) => mentions(join(dir, '.prettierignore'), folder) || mentions(join(dir, '.gitignore'), folder),
    fix: (folder) => `add "${folder}/" to .prettierignore`,
  },
  {
    tool: 'ESLint',
    skip: 1,
    command: /(?:^|[\s;&|])eslint(?![-\w])/,
    noPathsMeansAll: true,
    certain: false,
    ignored: (dir, folder) => mentions(join(dir, '.eslintignore'), folder) || anyMentions(dir, /^eslint\.config\.[cm]?[jt]s$/, folder),
    fix: (folder) => `add "${folder}/**" to the ignores in your ESLint config (for example globalIgnores([..., '${folder}/**']))`,
  },
  {
    tool: 'Biome',
    skip: 2,
    command: /\bbiome\s+(?:check|ci|lint|format)\b/,
    noPathsMeansAll: true,
    certain: false,
    ignored: (dir, folder) => anyMentions(dir, /^biome\.jsonc?$/, folder),
    fix: (folder) => `exclude "${folder}" in biome.json ("!${folder}" in files.includes on Biome 2, files.ignore on Biome 1)`,
  },
];

/**
 * Each tool a project script runs over the whole project without ignoring the kit folder.
 * Empty when the kit folder is outside the project.
 */
export function sweepingTools(projectDir: string, kitDir: string): SweepWarning[] {
  const inside = relative(projectDir, kitDir);
  if (!inside || inside.startsWith('..') || isAbsolute(inside)) return [];
  const folder = inside.split(/[\\/]/)[0]!;

  const out: SweepWarning[] = [];
  for (const tool of TOOLS) {
    for (const [script, command] of Object.entries(scriptsOf(projectDir))) {
      const match = tool.command.exec(command);
      if (!match) continue;
      const at = match.index + (match[0].startsWith('eslint') || !/^\s/.test(match[0]) ? 0 : 1);
      if (!sweepsProject(targetsAfter(command, at, tool.skip), tool.noPathsMeansAll)) continue;
      if (tool.ignored(projectDir, folder)) break;
      out.push({ tool: tool.tool, script, fix: tool.fix(folder), certain: tool.certain });
      break; // one warning per tool is enough
    }
  }
  return out;
}

/** The warning as doctor prints it. */
export function describeSweep(warning: SweepWarning, folder: string): string {
  const effect = warning.certain
    ? `and it fails on the minified nextgen.js and the generated JSON in ${folder}/ (measured)`
    : `which may lint the minified nextgen.js in ${folder}/, depending on your config`;
  return `${warning.tool} runs over your whole project (script "${warning.script}"), ${effect}. To keep your checks green, ${warning.fix}. The kit does not edit your config.`;
}
