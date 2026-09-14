/**
 * Which edge does the blob dock to?
 *
 * The blob starts centered — the "I'm here" moment — then moves to whichever
 * side of the screen has less already on it. There is no adopter config to
 * read for this: the same generic heuristic has to work on a page this
 * package has never seen, so it looks at what is actually there rather than
 * guessing from layout conventions.
 *
 * The check: sample a few points near each edge, a few pixels in from it, and
 * ask what is drawn there. `HTML`/`BODY` at a point means nothing else claims
 * it; anything else (a fixed sidebar, a nav rail, a scrollbar-adjacent panel)
 * means that edge is spoken for. The side with fewer occupied samples wins;
 * a tie goes right, because that is where a launcher affordance is expected
 * by convention when nothing on the page argues otherwise.
 *
 * Reached through a two-method interface rather than `Window`/`Document`, so
 * this is testable without a browser — same reasoning as `anchor.ts`.
 */

/** The slice of an element the heuristic reads. `Element` satisfies it. */
export interface DockNode {
  readonly tagName: string;
}

/** The slice of the browser this heuristic reads. `window`/`document` together satisfy it. */
export interface DockContext {
  readonly innerWidth: number;
  readonly innerHeight: number;
  /** As `document.elementsFromPoint` reports it, topmost first. */
  elementsFromPoint(x: number, y: number): readonly DockNode[];
}

export type DockSide = 'left' | 'right';

const EDGE_INSET = 8;
const SAMPLE_FRACTIONS: readonly number[] = [0.25, 0.5, 0.75];

function edgeOccupied(nodes: readonly DockNode[]): boolean {
  return nodes.some((node) => {
    const tag = node.tagName.toUpperCase();
    return tag !== 'HTML' && tag !== 'BODY';
  });
}

export function chooseDockSide(ctx: DockContext): DockSide {
  let leftOccupied = 0;
  let rightOccupied = 0;
  for (const fraction of SAMPLE_FRACTIONS) {
    const y = ctx.innerHeight * fraction;
    if (edgeOccupied(ctx.elementsFromPoint(EDGE_INSET, y))) leftOccupied++;
    if (edgeOccupied(ctx.elementsFromPoint(ctx.innerWidth - EDGE_INSET, y))) rightOccupied++;
  }
  return rightOccupied <= leftOccupied ? 'right' : 'left';
}
