// "Make it better, step by step" — the numbered path an adopter follows to improve the assistant for
// their own app, with where they stand on each step (ADR-028).
//
// Every app is different, so how clever and how careful the assistant is belongs to the adopter. The
// levers exist (knowledge, calibration, teaching, the dial, search, their own assistant, a model); what
// was missing was the order, what each one does for them, and a way to see how far along they are. The
// same steps are printed by `doctor`, written by `build` to review/IMPROVE.md, and described in AGENTS.md.

import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { REVIEW_DIR } from './paths.ts';

/** What `build` records that the ladder reads. Older records lack some fields; each is optional. */
export interface LadderRecord {
  readonly calibrated: boolean;
  readonly stage3?: { readonly path: string } | null;
  readonly knowledge?: { readonly found: boolean; readonly coverage: { readonly screens: number; readonly withPurpose: number; readonly withPhrasing: number } };
}

export type StepState = 'done' | 'next' | 'todo' | 'yours';

export interface Step {
  readonly title: string;
  /** What it does for the adopter's visitors. */
  readonly gives: string;
  /** How, as a command or a place to look. */
  readonly how: readonly string[];
  readonly state: StepState;
  /** Where they stand, when the build can tell. */
  readonly status: string | null;
}

/** How many screens step 1 asks about first (the interview's own "start here"). */
const FIRST_SCREENS = 10;

export function ladder(kit: string, record: LadderRecord, tool: string, here: string): Step[] {
  const coverage = record.knowledge?.coverage ?? null;
  const target = coverage ? Math.min(FIRST_SCREENS, coverage.screens) : FIRST_SCREENS;
  const described = coverage?.withPurpose ?? 0;
  const taught = existsSync(join(kit, REVIEW_DIR, 'TAUGHT.md'));

  /** `done`: true or false where the build can tell; `null` where only the adopter can. */
  const steps: (Omit<Step, 'state'> & { readonly done: boolean | null })[] = [];
  const add = (step: Omit<Step, 'state'>, done: boolean | null): void => void steps.push({ ...step, done });

  add(
    {
      title: 'Tell it what your screens are for',
      gives: 'The biggest single improvement. A screen described in your words is found by the words your users say, not only by its title.',
      how: [
        'Answer review/KNOWLEDGE-GAPS.md into knowledge.json — the ten screens that matter most are listed first.',
        'A screen the scanner could not read (a route decided on the server, a micro-frontend): add it there too, with a "title" and the "roles" that can open it.',
        `Then: ${tool} build ${here}`,
      ],
      status: coverage ? `${described} of ${coverage.screens} screens described; real phrasing for ${coverage.withPhrasing}` : 'no knowledge.json yet',
    },
    described >= target && target > 0,
  );
  add(
    {
      title: 'Calibrate it on your own questions',
      gives: 'Fits how sure it must be before it opens a screen by itself, to your app — fewer wrong moves, fewer needless questions.',
      how: [
        'Write 20 or more real questions, each with the screen it should reach (and a few it should refuse, with "route": null).',
        `${tool} calibrate ${here} --golden your-questions.jsonl, then ${tool} build ${here}`,
      ],
      status: record.calibrated ? 'calibrated for this app' : 'not calibrated — it uses default settings',
    },
    record.calibrated,
  );
  add(
    {
      title: 'Put it in your app properly',
      gives: 'Moves without reloading the page, opens where signed-in users land, and stays clear of your own buttons.',
      how: [
        'Wire navigation to your router; set data-nextgen-home to the page users land on; move the orb with data-nextgen-inset if it covers anything.',
        'A single-page app with token auth: start it from code (AGENTS.md, "A single-page app with token auth").',
      ],
      status: null,
    },
    null,
  );
  add(
    {
      title: 'Let real use teach it',
      gives: 'Every question it could not settle, and the screen the visitor then picked, becomes a phrase it knows. It gets better the more it is used.',
      how: [
        'Keep the nextgen:learn events (or onLearn) as one JSON object per line.',
        `${tool} teach ${here} --from lessons.jsonl — read review/TAUGHT.md — then add --write, and build.`,
      ],
      status: taught ? 'taught at least once (review/TAUGHT.md)' : 'not yet',
    },
    taught,
  );
  add(
    {
      title: 'Choose how bold it is, and where the rest goes',
      gives: 'Your app, your call: more careful, or fewer questions — and an answer for what no screen covers.',
      how: [
        'data-nextgen-decide: "confirm" never moves without a yes; "balanced" (default); "eager" also moves when one screen is plainly ahead.',
        'data-nextgen-search="/search?q={query}" sends what matches no screen to your own search.',
        'Already have an assistant or a tour? Merge it in as a companion (AGENTS.md, ASK 6).',
      ],
      status: null,
    },
    null,
  );
  add(
    {
      title: 'Add a model, if it is worth it for you',
      gives: 'Settles the questions the steps above cannot. Optional: it costs a server you run and pay for, and it cannot make up for screens nobody described.',
      how: ['AGENTS.md, ASK 8.'],
      status: record.stage3 ? `on — through ${record.stage3.path}` : 'off',
    },
    // Optional, so never "next": off is a choice, not a gap.
    record.stage3 ? true : null,
  );

  // The first step the build can see is not done is "next"; the ones it cannot see are the adopter's.
  let marked = false;
  return steps.map(({ done, ...step }) => {
    if (done === null) return { ...step, state: 'yours' as const };
    if (done) return { ...step, state: 'done' as const };
    if (!marked) {
      marked = true;
      return { ...step, state: 'next' as const };
    }
    return { ...step, state: 'todo' as const };
  });
}

const MARK: Readonly<Record<StepState, string>> = { done: '✓', next: '→', todo: ' ', yours: '?' };

/** The ladder as `doctor` prints it: one line per step, its state, and the how under the one to do next. */
export function ladderLines(steps: readonly Step[]): string[] {
  const lines = ['Make it better, step by step (each one helps; do them in this order)'];
  steps.forEach((step, i) => {
    lines.push(`  ${MARK[step.state]} ${i + 1}. ${step.title}${step.status ? ` — ${step.status}` : ''}`);
    if (step.state === 'next' || step.state === 'yours') for (const line of step.how) lines.push(`         ${line}`);
  });
  lines.push('  (✓ done   → do this next   ? only you can tell — check it yourself)');
  return lines;
}

/** review/IMPROVE.md: the same steps, in full, for the developer to read without running anything. */
export function ladderMarkdown(steps: readonly Step[]): string {
  const out = [
    '# Make the assistant better for your app, step by step',
    '',
    'Every app is different, so how clever and how careful the assistant is is yours to decide. Each step below',
    'makes it better on its own; they are in the order that gives the most for the least effort. `doctor` shows',
    'where you are on each one.',
    '',
  ];
  steps.forEach((step, i) => {
    const state = step.state === 'done' ? ' ✓ done' : step.state === 'next' ? ' ← next' : '';
    out.push(`## ${i + 1}. ${step.title}${state}`, '', step.gives, '');
    if (step.status) out.push(`Where you are: ${step.status}.`, '');
    for (const line of step.how) out.push(`- ${line}`);
    out.push('');
  });
  return out.join('\n');
}
