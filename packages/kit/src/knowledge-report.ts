// review/KNOWLEDGE-GAPS.md: what the assistant does not yet know about this app, as questions.
//
// It is written by `build` for the agent that is installing the folder, and it is the difference
// between an agent that fills in a form and one that has an interview: every line is a question
// about a screen this app really has, put in the words the scanner could not supply itself.
// The answers go into `knowledge.json` (adapter/AGENTS.md, ASK 0), and the next `build` is
// smarter for them.

import type { KnowledgeCoverage, KnowledgeGap } from '@nextgen/generator';

const EXAMPLE = `{
  "app": {
    "name": "Your app",
    "about": "What it is for and who uses it, in two sentences."
  },
  "glossary": [
    { "term": "your word", "means": "what it means here", "aliases": ["what people say instead", "another way"] }
  ],
  "cannot": [
    { "about": "something users ask for that the app does not do", "say": "what to tell them, in your words", "askedAs": ["how they ask", "another way", "a third way"] }
  ],
  "screens": {
    "/your/route": {
      "purpose": "What this screen is for, in your words. Shown to a visitor who asks what it is.",
      "contains": ["what is on it", "another thing"],
      "aliases": ["another name for it"],
      "askedAs": ["a real thing a user says", "another one", "a third"]
    }
  }
}`;

export function knowledgeQuestions(gaps: readonly KnowledgeGap[], coverage: KnowledgeCoverage, found: boolean): string {
  const of = (n: number): string => `${n} of ${coverage.screens}`;
  const app = gaps.filter((g) => g.kind === 'app-about-missing' || g.kind === 'limits-missing');
  const screens = gaps.filter((g) => g.route !== undefined && g.kind !== 'knowledge-orphan');
  const orphans = gaps.filter((g) => g.kind === 'knowledge-orphan');
  const lines: string[] = [
    '# What the assistant does not know yet',
    '',
    found
      ? `\`knowledge.json\` describes ${of(coverage.withPurpose)} screens (what they are for) and gives real phrasing for ${of(coverage.withPhrasing)}.`
      : 'There is no `knowledge.json` yet, so every screen is described only by its title and a template sentence. That is why ordinary questions ("my son got hurt in training") do not find the right screen.',
    '',
    'This file is written by `build`, for the agent installing this folder. **Ask the developer these, one screen at a',
    'time, in their own words, and write what they say into `knowledge.json`** beside `nextgen.config.json` (AGENTS.md,',
    'ASK 0). Then run `build` again. Do not invent answers: a wrong purpose is served to visitors as fact.',
    '',
  ];

  if (app.length) lines.push('## The application', '', ...app.map((g) => `- ${g.message}`), '');
  if (screens.length) {
    lines.push('## Screens', '');
    lines.push(...screens.map((g) => `- ${g.message}`), '');
  }
  if (orphans.length) lines.push('## Knowledge that points at nothing', '', ...orphans.map((g) => `- ${g.message}`), '');
  if (!app.length && !screens.length && !orphans.length) lines.push('Nothing is missing. Every screen has a purpose and enough real phrasing.', '');

  lines.push('## Also ask, once, about the whole app', '');
  lines.push(
    '- Which words do your users say that never appear on a screen? (Each goes in `glossary` with what people say instead.)',
    '- Which three screens do users most often struggle to find?',
    '',
    '## The shape of `knowledge.json`',
    '',
    '```json',
    EXAMPLE,
    '```',
    '',
  );
  return lines.join('\n');
}
