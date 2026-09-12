import { describe, expect, it } from 'vitest';

import { decide, measure, splitByRoute, sweep, toThresholds, type CalibrationEntry, type ScoredTurn } from './calibrate.ts';

/**
 * The sweep, tested on rows rather than on an encoder.
 *
 * Everything here is arithmetic over scores that `scoreTurns` produced earlier,
 * so these tests do not need a registry, a model or a fixture app — which is the
 * point of the split. What they protect is the part that would fail silently:
 * a constraint that stops constraining still produces plausible thresholds.
 */

const turn = (
  id: string,
  expectRoute: string | null,
  top: number,
  runnerUp = 0,
  boundary: number | null = null,
  actionSignal = false,
  route: string | null = expectRoute,
): ScoredTurn => ({
  entry: { id, utterance: id, expectRoute },
  top: { score: top, route },
  runnerUp: { score: runnerUp },
  bestBoundary: boundary === null ? null : { score: boundary },
  actionSignal,
});

describe('splitByRoute', () => {
  it('keeps two questions about the same screen on the same side of the split', () => {
    // Otherwise a threshold tuned on "what is the clinic" is validated on
    // "what does the clinic do" — the same question twice, and a held-out
    // number that means nothing.
    const entries: CalibrationEntry[] = [];
    for (const route of ['/a', '/b', '/c', '/d', '/e', '/f', '/g']) {
      entries.push({ id: `${route}-1`, utterance: 'x', expectRoute: route });
      entries.push({ id: `${route}-2`, utterance: 'y', expectRoute: route });
    }
    const isCalibration = splitByRoute(entries);
    for (const route of ['/a', '/b', '/c', '/d', '/e', '/f', '/g']) {
      const first = entries.find((e) => e.id === `${route}-1`)!;
      const second = entries.find((e) => e.id === `${route}-2`)!;
      expect(isCalibration(first)).toBe(isCalibration(second));
    }
  });

  it('puts something on each side', () => {
    const entries: CalibrationEntry[] = ['/a', '/b', '/c', '/d', '/e'].map((route) => ({
      id: route, utterance: 'x', expectRoute: route,
    }));
    const isCalibration = splitByRoute(entries);
    expect(entries.some(isCalibration)).toBe(true);
    expect(entries.some((e) => !isCalibration(e))).toBe(true);
  });
});

describe('decide — stage 2, replicated', () => {
  // Scores that subtract exactly. 0.35 - 0.3 is 0.049999999999999996, and a test
  // written on that arithmetic fails for a reason that has nothing to do with
  // the rule it is checking.
  it('refuses when a boundary leads by the required margin', () => {
    expect(decide(turn('a', null, 0.25, 0, 0.5), 0.75, 0, 0.2)).toBe('refuse'); // leads by 0.25
    expect(decide(turn('a', null, 0.25, 0, 0.5), 0.75, 0, 0.3)).toBe('escalate'); // not by enough
  });

  it('lets an action verb win by less, and never by more (ADR-015)', () => {
    // The verb is independent evidence of being out of scope, so a boundary
    // needs a smaller lead — but only for an utterance that carries one.
    const asking = turn('a', null, 0.25, 0, 0.5, true);
    const stating = turn('b', null, 0.25, 0, 0.5, false);
    expect(decide(asking, 0.75, 0, 0.3, 0.2)).toBe('refuse');
    expect(decide(stating, 0.75, 0, 0.3, 0.2)).toBe('escalate');
  });

  it('accepts only above tauHigh and clear of the runner-up by delta', () => {
    expect(decide(turn('a', '/x', 0.5, 0.2), 0.4, 0.1, 1)).toBe('accept');
    expect(decide(turn('a', '/x', 0.35, 0.1), 0.4, 0.1, 1)).toBe('escalate'); // under tauHigh
    expect(decide(turn('a', '/x', 0.5, 0.45), 0.4, 0.1, 1)).toBe('escalate'); // too close to second
  });
});

describe('sweep', () => {
  it('never chooses a margin that wrongly refuses a real request', () => {
    // The constraint that matters most: telling a user the application cannot do
    // something it can. One in-domain turn sits under a boundary that would be
    // refused at any margin low enough to catch the out-of-scope ones.
    const rows = [
      turn('in-1', '/a', 0.30, 0.1, 0.33), // boundary leads by 0.03
      turn('in-2', '/b', 0.40, 0.1, 0.20),
      turn('oos-1', null, 0.20, 0.1, 0.26), // leads by 0.06
      turn('oos-2', null, 0.20, 0.1, 0.28),
    ];
    const swept = sweep(rows);
    const wrongly = rows.filter((r) => r.entry.expectRoute && decide(r, swept.tauHigh, swept.delta, swept.boundaryMargin, swept.actionBoundaryMargin) === 'refuse');
    expect(wrongly).toEqual([]);
    expect(swept.boundaryMargin).toBeGreaterThan(0.03);
  });

  it('accepts nothing rather than accepting something wrong', () => {
    // Two screens that score alike, one of them the wrong answer. There is no
    // operating point with 100% precision that accepts anything, and the sweep
    // must take that rather than trade precision for coverage on its own.
    const rows = [
      turn('a', '/a', 0.5, 0.49, null, false, '/a'),
      turn('b', '/b', 0.5, 0.49, null, false, '/wrong'),
    ];
    const swept = sweep(rows);
    expect(swept.acceptedInDomain).toBe(0);
    expect(swept.tauHigh).toBe(1);
  });

  it('reports the counts its own summary line is built from', () => {
    const rows = [turn('in', '/a', 0.6, 0.1), turn('oos', null, 0.2, 0.1, 0.5)];
    const swept = sweep(rows);
    expect(swept.inDomainEntries).toBe(1);
    expect(swept.outOfScopeEntries).toBe(1);
  });
});

describe('measure', () => {
  it('counts a confident wrong answer as a wrong answer, not as a settled turn', () => {
    const rows = [
      turn('right', '/a', 0.9, 0.1, null, false, '/a'),
      turn('wrong', '/b', 0.9, 0.1, null, false, '/elsewhere'),
    ];
    const report = measure(rows, { tauHigh: 0.5, delta: 0, boundaryMargin: 1, actionBoundaryMargin: 1 });
    expect(report.accepted).toBe(1);
    expect(report.precision).toBe(0.5);
    expect(report.wronglyRefused).toBe(0);
  });
});

describe('toThresholds', () => {
  it('produces the shape the shipped files and config.ts use', () => {
    const t = toThresholds({ tauHigh: 0.4, delta: 0.01, boundaryMargin: 0.07, actionBoundaryMargin: 0.05 });
    expect(t).toEqual({ tauHigh: 0.4, delta: 0.01, tauFloor: 0, topK: 5, boundaryMargin: 0.07, actionBoundaryMargin: 0.05 });
  });
});
