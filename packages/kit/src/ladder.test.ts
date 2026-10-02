import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { ladder, ladderLines, ladderMarkdown } from './ladder.ts';

/** ADR-028: the numbered path to a better assistant, with where this app stands on each step. */

const kit = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'nextgen-ladder-'));
  mkdirSync(join(dir, 'review'));
  return dir;
};
const record = (over: Partial<{ calibrated: boolean; stage3: { path: string } | null; withPurpose: number; screens: number }> = {}) => ({
  calibrated: over.calibrated ?? false,
  stage3: over.stage3 ?? null,
  knowledge: { found: true, coverage: { screens: over.screens ?? 40, withPurpose: over.withPurpose ?? 0, withPhrasing: 0 } },
});

describe('ladder — six steps, in order, each with its state', () => {
  it('starts at describing the screens, and says how far along that is', () => {
    const steps = ladder(kit(), record({ withPurpose: 3 }), 'scan.mjs', 'nextgen');
    expect(steps.map((s) => s.title)).toHaveLength(6);
    expect(steps[0]).toMatchObject({ state: 'next', status: '3 of 40 screens described; real phrasing for 0' });
    expect(steps[1]!.state).toBe('todo');
  });

  it('moves "next" on as steps are done, and marks what only the adopter can check', () => {
    const dir = kit();
    const described = ladder(dir, record({ withPurpose: 10 }), 's', 'k');
    expect(described.map((s) => s.state)).toEqual(['done', 'next', 'yours', 'todo', 'yours', 'yours']);
    writeFileSync(join(dir, 'review', 'TAUGHT.md'), '# taught');
    const most = ladder(dir, record({ withPurpose: 10, calibrated: true, stage3: { path: '/ai' } }), 's', 'k');
    expect(most.map((s) => s.state)).toEqual(['done', 'done', 'yours', 'done', 'yours', 'done']);
  });

  it('asks about the first ten screens of a big app, and all of a small one', () => {
    expect(ladder(kit(), record({ withPurpose: 10, screens: 400 }), 's', 'k')[0]!.state).toBe('done');
    expect(ladder(kit(), record({ withPurpose: 5, screens: 6 }), 's', 'k')[0]!.state).toBe('next');
  });

  it('never makes the optional model the next step', () => {
    const steps = ladder(kit(), record({ withPurpose: 10, calibrated: true }), 's', 'k');
    expect(steps[5]!.state).toBe('yours');
  });

  it('prints numbered lines with the how under the step to do next, and a full markdown page', () => {
    const steps = ladder(kit(), record(), 'scan.mjs', 'nextgen');
    const lines = ladderLines(steps);
    expect(lines.some((l) => l.includes('→ 1. Tell it what your screens are for'))).toBe(true);
    expect(lines.some((l) => l.includes('KNOWLEDGE-GAPS.md'))).toBe(true);
    const page = ladderMarkdown(steps);
    for (let n = 1; n <= 6; n++) expect(page).toContain(`## ${n}. `);
    expect(page).toContain('← next');
  });
});
