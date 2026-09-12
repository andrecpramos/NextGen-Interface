// Rule 14's sweep, in one place.
//
// Thresholds are calibrated per encoder AND per registry, never hand-set and
// never carried across. That rule has been applied by two separate scripts —
// `core-intent/eval/calibrate.js` for the reference app and
// `eval/fut-app/calibrate-registries.mjs` for the generated role registries —
// and a third was about to be written for the drop-in kit (WP-41). Two copies of
// a calibration sweep is how Rule 14 drifts: the copies diverge, and the one
// nobody re-reads becomes wrong silently, because a threshold that is merely
// suboptimal still produces plausible numbers.
//
// So the sweep lives here, the apps supply data, and nothing in this file knows
// what application it is scoring (Rule 1).
//
// The order of the sweep is not arbitrary:
//
//   1. `boundaryMargin`, first, because a refusal short-circuits the rest of
//      stage 2. Maximise out-of-scope refusals subject to an ABSOLUTE
//      constraint: zero in-domain turns wrongly refused. Telling users the
//      application cannot do something it can is the expensive error.
//   2. `actionBoundaryMargin` (ADR-015), under the identical zero-false-refusal
//      constraint, and never above `boundaryMargin` — an action verb making the
//      engine more reluctant to refuse would be the opposite of the mechanism.
//   3. `tauHigh` and `delta`, maximising what stage 2 settles alone subject to
//      100% precision. A wrong accept is worse than an escalation: it sends the
//      user somewhere confidently.
//
// The constraint in (1) is applied to EVERY in-scope entry, not only those
// carrying an expected capability. `calibrate-registries.mjs` needed that fix
// once already: a constraint that silently matches nothing reports success.

import { cosine } from './embedder.ts';
import { actionSignalApplies } from './action.ts';
import type { Embedder, Registry } from './types.ts';
import type { Thresholds } from './config.ts';

/** One labelled turn. `expectRoute: null` means "this one should be refused". */
export interface CalibrationEntry {
  readonly id: string;
  readonly utterance: string;
  readonly expectRoute: string | null;
  /** Which registry to score against, for an app with one per role. */
  readonly registryKey?: string;
}

/** A registry and the encoder fitted to it. One encoder per registry, always. */
export interface Scorer {
  readonly registry: Registry;
  readonly embedder: Embedder;
}

export interface ScoredTurn {
  readonly entry: CalibrationEntry;
  readonly top: { readonly score: number; readonly route: string | null };
  readonly runnerUp: { readonly score: number };
  readonly bestBoundary: { readonly score: number } | null;
  readonly actionSignal: boolean;
}

export interface Operating {
  readonly tauHigh: number;
  readonly delta: number;
  readonly boundaryMargin: number;
  readonly actionBoundaryMargin: number;
}

export interface Report {
  readonly entries: number;
  readonly settled: number;
  readonly accepted: number;
  readonly precision: number | null;
  readonly outOfScopeRefused: number | null;
  readonly wronglyRefused: number;
}

export interface CurvePoint {
  readonly precisionFloor: number;
  readonly feasible: boolean;
  readonly tauHigh?: number;
  readonly delta?: number;
  readonly heldOutAccepted?: number;
  readonly heldOutPrecision?: number | null;
}

/**
 * Score every turn once; the sweeps then run over numbers rather than the encoder.
 *
 * Embedding is the expensive part and it does not depend on any threshold, so a
 * sweep that re-embedded per candidate operating point would take hours to reach
 * the same answer.
 */
export async function scoreTurns(
  entries: readonly CalibrationEntry[],
  scorerFor: (key: string | undefined) => Scorer,
): Promise<ScoredTurn[]> {
  const scored: ScoredTurn[] = [];
  for (const entry of entries) {
    const { registry, embedder } = scorerFor(entry.registryKey);
    const vector = await embedder.embed(entry.utterance);
    const all = registry.capabilities
      .map((capability, index) => ({
        id: capability.id,
        route: capability.route ?? null,
        isBoundary: registry.boundaryIds.has(capability.id),
        score: cosine(vector, registry.vectors[index]!),
      }))
      .sort((a, b) => b.score - a.score);

    const supported = all.filter((c) => !c.isBoundary);
    const boundaries = all.filter((c) => c.isBoundary);

    // ADR-015, with its guard: the verb is only evidence about scope when the
    // application does not itself offer the action. Read from the capability the
    // registry actually ranked first, exactly as stage 2 does.
    const topCap = supported[0] ? registry.byId.get(supported[0].id) : undefined;

    scored.push({
      entry,
      top: supported[0] ?? { score: 0, route: null },
      runnerUp: supported[1] ?? { score: 0 },
      bestBoundary: boundaries[0] ?? null,
      actionSignal: actionSignalApplies(entry.utterance, topCap?.kind, registry.actionVocabulary),
    });
  }
  return scored;
}

/**
 * Split 40/60 **by destination, not by entry**.
 *
 * Otherwise a threshold tuned on "o que é o centro clínico" is validated on
 * "para que serve o centro clínico" — the same question twice, and a held-out
 * number that means nothing. Entries with no destination (the out-of-scope ones)
 * fall back to a stable hash of the id, so the split is deterministic.
 */
export function splitByRoute(entries: readonly CalibrationEntry[]): (entry: CalibrationEntry) => boolean {
  const routes = [...new Set(entries.filter((e) => e.expectRoute).map((e) => e.expectRoute!))].sort();
  const calibrationRoutes = new Set(routes.filter((_, index) => index % 5 < 2));
  return (entry) =>
    entry.expectRoute
      ? calibrationRoutes.has(entry.expectRoute)
      : entry.id.charCodeAt(entry.id.length - 1) % 5 < 2;
}

/** How many destinations the split put on each side — for the report. */
export function splitSizes(entries: readonly CalibrationEntry[]): { destinations: number; calibrationDestinations: number } {
  const routes = [...new Set(entries.filter((e) => e.expectRoute).map((e) => e.expectRoute!))].sort();
  return {
    destinations: routes.length,
    calibrationDestinations: routes.filter((_, index) => index % 5 < 2).length,
  };
}

/**
 * stage 2's decision, replicated exactly — see `stages.ts`.
 *
 * `actionMargin` is ADR-015's second margin: when the utterance asks the
 * assistant to *do* something, a boundary may win by less, because the verb is
 * evidence about scope that similarity cannot provide.
 */
export function decide(
  row: ScoredTurn,
  tauHigh: number,
  delta: number,
  boundaryMargin: number,
  actionMargin: number = boundaryMargin,
): 'accept' | 'refuse' | 'escalate' {
  const lead = row.bestBoundary ? row.bestBoundary.score - row.top.score : -Infinity;
  const required = row.actionSignal ? actionMargin : boundaryMargin;
  if (row.bestBoundary && lead >= required) return 'refuse';
  if (row.top.score >= tauHigh && row.top.score - row.runnerUp.score >= delta) return 'accept';
  return 'escalate';
}

const inScope = (rows: readonly ScoredTurn[]): ScoredTurn[] => rows.filter((r) => r.entry.expectRoute);
const outOfScope = (rows: readonly ScoredTurn[]): ScoredTurn[] => rows.filter((r) => !r.entry.expectRoute);

export interface SweepResult extends Operating {
  /** Out-of-scope turns the chosen boundaryMargin refuses, on the calibration split. */
  readonly refusedOutOfScope: number;
  readonly outOfScopeEntries: number;
  readonly acceptedInDomain: number;
  readonly inDomainEntries: number;
  readonly carryingActionVerb: number;
}

/** Steps 1, 1b, 2 — run against the calibration split only. */
export function sweep(calibrationSet: readonly ScoredTurn[]): SweepResult {
  let bestMargin = { value: 1, refused: 0 };
  for (let margin = 0; margin <= 0.4; margin += 0.005) {
    const wronglyRefused = inScope(calibrationSet).filter((r) => decide(r, 1, 0, margin) === 'refuse').length;
    if (wronglyRefused > 0) continue;
    const refused = outOfScope(calibrationSet).filter((r) => decide(r, 1, 0, margin) === 'refuse').length;
    if (refused > bestMargin.refused) bestMargin = { value: Number(margin.toFixed(3)), refused };
  }

  let bestActionMargin = { value: bestMargin.value, refused: bestMargin.refused };
  for (let margin = 0; margin <= bestMargin.value; margin += 0.005) {
    const value = Number(margin.toFixed(3));
    const wronglyRefused = inScope(calibrationSet)
      .filter((r) => decide(r, 1, 0, bestMargin.value, value) === 'refuse').length;
    if (wronglyRefused > 0) continue;
    const refused = outOfScope(calibrationSet)
      .filter((r) => decide(r, 1, 0, bestMargin.value, value) === 'refuse').length;
    if (refused > bestActionMargin.refused) bestActionMargin = { value, refused };
  }

  let best = { tauHigh: 1, delta: 0, accepted: 0 };
  for (let tauHigh = 0.05; tauHigh <= 0.95; tauHigh += 0.005) {
    for (const delta of [0, 0.005, 0.01, 0.02, 0.05]) {
      const accepts = inScope(calibrationSet).filter((r) => decide(r, tauHigh, delta, bestMargin.value) === 'accept');
      if (accepts.length === 0) continue;
      const right = accepts.filter((r) => r.top.route === r.entry.expectRoute).length;
      if (right !== accepts.length) continue; // 100% precision, as the shipped profile requires
      if (accepts.length > best.accepted) {
        best = { tauHigh: Number(tauHigh.toFixed(3)), delta, accepted: accepts.length };
      }
    }
  }

  return {
    tauHigh: best.tauHigh,
    delta: best.delta,
    boundaryMargin: bestMargin.value,
    actionBoundaryMargin: bestActionMargin.value,
    refusedOutOfScope: bestMargin.refused,
    outOfScopeEntries: outOfScope(calibrationSet).length,
    acceptedInDomain: best.accepted,
    inDomainEntries: inScope(calibrationSet).length,
    carryingActionVerb: calibrationSet.filter((r) => r.actionSignal).length,
  };
}

/** What an operating point does to a set of turns. */
export function measure(rows: readonly ScoredTurn[], at: Operating): Report {
  const routable = inScope(rows);
  const oos = outOfScope(rows);
  const decisions = rows.map((r) => ({ r, d: decide(r, at.tauHigh, at.delta, at.boundaryMargin, at.actionBoundaryMargin) }));
  const accepts = decisions.filter((x) => x.d === 'accept' && x.r.entry.expectRoute);
  const right = accepts.filter((x) => x.r.top.route === x.r.entry.expectRoute);
  const refusedOos = decisions.filter((x) => x.d === 'refuse' && !x.r.entry.expectRoute);
  const wronglyRefused = decisions.filter((x) => x.d === 'refuse' && x.r.entry.expectRoute);
  return {
    entries: rows.length,
    settled: (accepts.length + refusedOos.length) / rows.length,
    accepted: accepts.length / (routable.length || 1),
    precision: accepts.length ? right.length / accepts.length : null,
    outOfScopeRefused: oos.length ? refusedOos.length / oos.length : null,
    wronglyRefused: wronglyRefused.length / (routable.length || 1),
  };
}

/**
 * The precision/coverage curve.
 *
 * One operating point hides the shape of the problem. The shipped profile was
 * calibrated at 100% precision against a 7-capability registry, where that cost
 * almost nothing; at 145 capabilities it costs nearly all the coverage. What a
 * product decision needs is the curve, not the point.
 */
export function tradeOffCurve(
  calibrationSet: readonly ScoredTurn[],
  heldOut: readonly ScoredTurn[],
  boundaryMargin: number,
  floors: readonly number[] = [1, 0.95, 0.9, 0.8, 0.7],
): CurvePoint[] {
  const curve: CurvePoint[] = [];
  for (const floor of floors) {
    let point: { tauHigh: number; delta: number; accepted: number } | null = null;
    for (let tauHigh = 0.05; tauHigh <= 0.95; tauHigh += 0.005) {
      for (const delta of [0, 0.005, 0.01, 0.02, 0.05]) {
        const accepts = inScope(calibrationSet).filter((r) => decide(r, tauHigh, delta, boundaryMargin) === 'accept');
        if (accepts.length === 0) continue;
        const right = accepts.filter((r) => r.top.route === r.entry.expectRoute).length;
        if (right / accepts.length < floor) continue;
        if (!point || accepts.length > point.accepted) {
          point = { tauHigh: Number(tauHigh.toFixed(3)), delta, accepted: accepts.length };
        }
      }
    }
    if (!point) {
      curve.push({ precisionFloor: floor, feasible: false });
      continue;
    }
    const heldAccepts = inScope(heldOut).filter((r) => decide(r, point!.tauHigh, point!.delta, boundaryMargin) === 'accept');
    const heldRight = heldAccepts.filter((r) => r.top.route === r.entry.expectRoute).length;
    const routable = inScope(heldOut).length;
    curve.push({
      precisionFloor: floor,
      feasible: true,
      tauHigh: point.tauHigh,
      delta: point.delta,
      heldOutAccepted: heldAccepts.length / routable,
      heldOutPrecision: heldAccepts.length ? heldRight / heldAccepts.length : null,
    });
  }
  return curve;
}

/** The sweep's output as the shape `config.ts` and the shipped files use. */
export function toThresholds(at: Operating): Thresholds {
  return {
    tauHigh: at.tauHigh,
    delta: at.delta,
    tauFloor: 0,
    topK: 5,
    boundaryMargin: at.boundaryMargin,
    actionBoundaryMargin: at.actionBoundaryMargin,
  };
}
