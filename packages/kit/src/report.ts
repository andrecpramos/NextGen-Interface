import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import type { BuildRecord } from './build.ts';
import { doctor } from './doctor.ts';
import { REVIEW_DIR } from './paths.ts';

/**
 * `nextgen doctor --report <file>`: everything a field test needs to send back, in one
 * Markdown file (readiness item 5).
 *
 * doctor's own text, plus what doctor shortens: every screen declared with its title and
 * the roles that reach it, and every route left out with the reason. It lists screens
 * against roles, exactly as review/master.json does, so the file says to share it only
 * with people who may see that.
 */

interface MasterCapability {
  readonly id: string;
  readonly kind: string;
  readonly route?: string;
  readonly title: string;
  readonly roles?: readonly string[];
}

const cell = (text: string): string => text.replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();

function readJson<T>(file: string): T | null {
  return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as T) : null;
}

export function report(kitDir: string): string {
  const kit = resolve(kitDir);
  const checked = doctor(kit);
  const record = readJson<BuildRecord>(join(kit, REVIEW_DIR, 'build.json'));
  const master = readJson<{ capabilities?: MasterCapability[] } | MasterCapability[]>(join(kit, REVIEW_DIR, 'master.json'));
  const capabilities = (Array.isArray(master) ? master : (master?.capabilities ?? [])).filter((c) => c.kind === 'navigate');

  const out: string[] = [
    '# NextGen kit report',
    '',
    `Written ${new Date().toISOString()} for \`${kit}\`. doctor: **${checked.ok ? 'no problems' : 'PROBLEMS — see below'}**.`,
    '',
    '> This lists every screen with the roles that can reach it, like `review/master.json`. Share it only',
    '> with people who may know that.',
    '',
    '## doctor',
    '',
    '```text',
    checked.text,
    '```',
  ];

  if (capabilities.length > 0) {
    out.push('', `## Every screen it declared (${capabilities.length})`, '', '| Route | Title | Roles |', '|---|---|---|');
    for (const c of [...capabilities].sort((a, b) => (a.route ?? '').localeCompare(b.route ?? ''))) {
      out.push(`| \`${cell(c.route ?? '')}\` | ${cell(c.title)} | ${cell((c.roles ?? []).join(', '))} |`);
    }
  }

  const skipped = record?.skipped ?? [];
  out.push('', `## Everything it left out (${skipped.length})`, '');
  if (skipped.length === 0) {
    out.push('Nothing.');
  } else {
    out.push('| Route | Why | Detail |', '|---|---|---|');
    for (const s of skipped) out.push(`| \`${cell(s.path)}\` | ${s.reason} | ${cell(s.detail)} |`);
  }
  out.push('');
  return out.join('\n');
}
