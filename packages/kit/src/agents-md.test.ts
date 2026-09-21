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

describe('adapter/AGENTS.md runs an interview about the app, and keeps it honest', () => {
  const section = (title: RegExp): string => {
    const parts = AGENTS.split(/^## /m);
    return parts.find((p) => title.test(p.split('\n')[0] ?? '')) ?? '';
  };
  const interview = section(/^ASK 9\b/);
  const theirs = section(/^ASK 10\b/);

  it('has the interview as a decision of its own, and points the agent at the questions the build wrote', () => {
    expect(interview).not.toBe('');
    expect(interview).toContain('review/KNOWLEDGE-GAPS.md');
    expect(interview).toContain('knowledge.json');
    expect(interview).toMatch(/open question/i);
  });

  it('asks about the app, the screens, the words users say, and what it cannot do', () => {
    for (const topic of [/what is this app for/i, /what is this screen for/i, /words/i, /cannot do|can.?t do/i]) expect(interview).toMatch(topic);
  });

  it('forbids inventing an answer, because a purpose is served to visitors as fact', () => {
    expect(interview).toMatch(/never invent|do not invent|don.?t invent/i);
    expect(interview).toMatch(/as fact/i);
  });

  it('carries the field finding about phrasing: requests, the users’ language, only what the screen does', () => {
    expect(interview).toMatch(/request/i);
    expect(interview).toMatch(/language/i);
    expect(interview).toMatch(/only .*(actually|really) (does|do)|does not do|doesn.?t do/i);
  });

  it('has the agent try, after building, things the app CAN do that share words with each limit', () => {
    // A declared limit refuses whatever it beats, so a word it shares with a real screen can
    // refuse a real question ("mensagem" against "mensalidade"). Found by the first honest test.
    expect(interview).toMatch(/limit/i);
    expect(interview).toMatch(/share[sd]?\s+(a\s+|the\s+)?(word|words|stem)|same\s+words?|words?\s+in\s+common/i);
    expect(interview).toMatch(/can\s+(already\s+)?do|does\s+do/i);
    expect(interview).toMatch(/wrongly\s+refus|refuse[sd]?\s+(a\s+)?(real|genuine|ordinary)|refusing\s+a\s+real/i);
  });

  it('keeps phrasing out of the calibration set, which would otherwise measure memory', () => {
    expect(AGENTS).toMatch(/never .*(same|reuse).*(calibrat|golden)|(calibrat|golden).*never .*(same|reuse)/is);
  });

  it('gives the developer their own turn to ask, and says to answer only from what is written here', () => {
    expect(theirs).not.toBe('');
    expect(theirs).toMatch(/anything (you|they) (want|would like|wonder)|questions? (you|they) (have|may have)/i);
    expect(theirs).toMatch(/do not guess|don.?t guess|say so|say you do not know/i);
  });

  it('puts the interview after the first build and before calibration', () => {
    const at = (text: string): number => AGENTS.indexOf(text);
    expect(at('ASK 9')).toBeGreaterThan(-1);
    expect(AGENTS).toMatch(/after\s+the\s+first\s+`?build`?[\s\S]*before[\s\S]*calibrat/i);
  });
});
