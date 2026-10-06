import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { ignoresAgentsMd, landingCandidate } from './doctor.ts';

/** Two things `doctor` could have said in a real integration, and did not. */

const folder = (): string => mkdtempSync(join(tmpdir(), 'nextgen-doctor-'));

describe('landingCandidate — where a signed-in user probably lands', () => {
  const kit = (routes: (string | null)[]): string => {
    const dir = folder();
    mkdirSync(join(dir, 'review'));
    writeFileSync(join(dir, 'review', 'master.json'), JSON.stringify({ capabilities: routes.map((route) => ({ kind: 'navigate', route })) }));
    return dir;
  };

  it('names a dashboard-like route the app really has', () => {
    expect(landingCandidate(kit(['/', '/login', '/dashboard', '/squad']))).toBe('/dashboard');
    expect(landingCandidate(kit(['/painel', '/plantel']))).toBe('/painel');
  });

  it('names nothing when there is no such route, or nothing was built', () => {
    expect(landingCandidate(kit(['/', '/squad', null]))).toBeNull();
    expect(landingCandidate(folder())).toBeNull();
  });
});

describe('ignoresAgentsMd — a .gitignore that would keep this tool’s instructions out of the repo', () => {
  const project = (gitignore: string | null): string => {
    const dir = folder();
    if (gitignore !== null) writeFileSync(join(dir, '.gitignore'), gitignore);
    return dir;
  };

  it('sees AGENTS.md ignored everywhere, in its common spellings', () => {
    for (const line of ['AGENTS.md', '/AGENTS.md', '**/AGENTS.md']) expect(ignoresAgentsMd(project(`node_modules\n${line}\n`)), line).toBe(true);
  });

  it('is satisfied by an exception, and says nothing without the pattern or the file', () => {
    expect(ignoresAgentsMd(project('AGENTS.md\n!tools/nextgen-tool/AGENTS.md\n'))).toBe(false);
    expect(ignoresAgentsMd(project('dist\n'))).toBe(false);
    expect(ignoresAgentsMd(project(null))).toBe(false);
  });
});
