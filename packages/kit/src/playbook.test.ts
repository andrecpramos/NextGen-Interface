import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { AGENT_PLAYBOOK } from './agent-playbook.ts';

/**
 * Two documents tell an installing agent the same things, because there are two ways in:
 *
 *   adapter/AGENTS.md            ships in the copied folder, read before anything runs
 *   AGENT_PLAYBOOK               written into the kit folder by `init`, on the npm path
 *
 * They are deliberately not the same text — one is a front door and the other arrives
 * after `init` — but they carry the same decisions, and **two documents saying the same
 * thing in different words is a drift machine**. These tests do not compare prose. They
 * assert the things that would actually harm an adopter if one copy quietly lost them.
 *
 * If you add a decision to one, this fails until it is in both. That is the point.
 */
const ADAPTER_AGENTS = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'adapter',
  'AGENTS.md',
);

const agents = readFileSync(ADAPTER_AGENTS, 'utf8');
const asks = (text: string): number => (text.match(/^#+ ASK \d+/gm) ?? []).length;

describe('the two installing-agent documents stay in step', () => {
  it('ask the developer the same number of decisions', () => {
    // Seven, as of 2026-09-18. The number is not sacred; having the same one is.
    expect(asks(agents)).toBe(asks(AGENT_PLAYBOOK));
    expect(asks(agents)).toBeGreaterThanOrEqual(7);
  });

  it('both number their decisions from 1 with no gaps', () => {
    for (const text of [agents, AGENT_PLAYBOOK]) {
      const numbers = [...text.matchAll(/^#+ ASK (\d+)/gm)].map((m) => Number(m[1]));
      expect(numbers).toEqual(numbers.map((_, i) => i + 1));
    }
  });

  it('both forbid editing the application\'s own source without asking', () => {
    // The single most damaging thing an unattended agent can do here, and the reason
    // these documents exist at all.
    for (const text of [agents, AGENT_PLAYBOOK]) {
      expect(text).toMatch(/never do without asking/i);
      expect(text.toLowerCase()).toContain('edit');
      expect(text.toLowerCase()).toMatch(/source|src\//);
    }
  });

  it('both forbid serving the review folder', () => {
    // review/master.json lists every screen with every role that can open it. Losing this
    // line from either document is a Rule 17 leak waiting for a hurried afternoon.
    for (const text of [agents, AGENT_PLAYBOOK]) {
      expect(text).toMatch(/never serve|must not be served/i);
      expect(text).toContain('review');
    }
  });

  it('both say a GUESSED line is not good enough', () => {
    for (const text of [agents, AGENT_PLAYBOOK]) {
      expect(text).toContain('GUESSED');
    }
  });

  it('the adapter one does not offer a model flag, because that build has none', () => {
    // ADR-018 D-6: `cli-copied.ts` passes no prose model, so `--model` is refused. An
    // agent told to offer it would waste the developer's time on an impossible option.
    expect(agents).not.toMatch(/--model\s+<?name>?/);
    expect(agents).toMatch(/does not reach the network/i);
  });
});
