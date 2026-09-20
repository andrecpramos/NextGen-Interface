import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * `adapter/AGENTS.md` is the only document an installing agent is told to read first, and it
 * ships in the folder the adopter copies (ADR-018, ADR-021). Until ADR-021 a second copy of
 * it was written into the adopter's project by `init`, and these tests kept the two in step.
 * There is one now, so what they hold is what would actually harm an adopter if a hurried
 * edit quietly lost it. They do not compare prose.
 */
const AGENTS = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'adapter', 'AGENTS.md'),
  'utf8',
);

describe('adapter/AGENTS.md keeps the decisions that are the developer\'s to make', () => {
  it('numbers its decisions from 1 with no gaps, and has at least the seven that were field-tested', () => {
    const numbers = [...AGENTS.matchAll(/^#+ ASK (\d+)/gm)].map((m) => Number(m[1]));
    expect(numbers.length).toBeGreaterThanOrEqual(7);
    expect(numbers).toEqual(numbers.map((_, i) => i + 1));
  });

  it('forbids editing the application\'s own source without asking', () => {
    // The single most damaging thing an unattended agent can do here, and the reason this
    // document exists at all.
    expect(AGENTS).toMatch(/never do without asking/i);
    expect(AGENTS.toLowerCase()).toContain('edit');
    expect(AGENTS.toLowerCase()).toMatch(/source|src\//);
  });

  it('forbids serving the review folder', () => {
    // review/master.json lists every screen with every role that can open it. Losing this
    // line is a Rule 17 leak waiting for a hurried afternoon.
    expect(AGENTS).toMatch(/never serve|must not be served/i);
    expect(AGENTS).toContain('review');
  });

  it('says a GUESSED line is not good enough', () => {
    expect(AGENTS).toContain('GUESSED');
  });

  it('does not offer a model flag for scan.mjs, because that build has none', () => {
    // ADR-018 D-6, ADR-021: `--model` is refused. An agent told to offer it would waste the
    // developer's time on an impossible option.
    expect(AGENTS).not.toMatch(/--model\s+<?name>?/);
    expect(AGENTS).toMatch(/does not reach the network/i);
  });
});
