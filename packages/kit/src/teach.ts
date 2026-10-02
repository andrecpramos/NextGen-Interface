// `scan.mjs teach` — what real visitors taught the assistant, turned into what it knows (ADR-027).
//
// The widget reports every question it could not settle and how the visitor settled it, as
// `nextgen:learn` events (embed `Lesson`). A page that keeps them — one JSON object per line — hands the
// file to this command, which:
//
//   - adds each question a visitor answered by picking a screen to that screen's `askedAs` in
//     `knowledge.json` — the adopter's own file, the one `build` already reads — so the next build
//     finds that screen for that question, and for questions like it;
//   - lists what no screen answered ("neither", nothing matched), for the developer to decide: a
//     screen's purpose that was never written down, a limit to declare, or content for search;
//   - holds back anything that looks like personal data, and anything visitors settled two ways.
//
// **Nothing is written without `--write`.** Every phrase added is served to every visitor of the roles
// that can reach the screen (it becomes an example in their registry), so the developer reads the
// report first. It never calls a model and never reaches a network, like everything in `scan.mjs`.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { loadKnowledge } from '@nextgen/generator';

import { BUNDLE_DIR, CONFIG_FILE, REVIEW_DIR, stripBom } from './paths.ts';

/** One line of the lessons file: the widget's `Lesson`, or the smaller `{ question, route }`. */
interface LessonLine {
  readonly question: string;
  readonly route: string | null;
  readonly how: 'chose' | 'rejected' | 'unplaced';
}

export interface TeachOptions {
  /** Write the phrases into knowledge.json. Without it, only the report. */
  readonly write?: boolean;
  /** How many visitors must have settled a question the same way before it is taught. Default 1. */
  readonly min?: number;
}

export interface Taught {
  readonly screen: string;
  readonly phrases: readonly string[];
}

export interface TeachResult {
  readonly read: number;
  readonly taught: readonly Taught[];
  /** Questions no screen answered, with how many times each was asked. */
  readonly unanswered: readonly { readonly question: string; readonly times: number }[];
  /** Held back, and why. */
  readonly held: readonly { readonly question: string; readonly why: string }[];
  readonly knowledgeFile: string;
  readonly wrote: boolean;
  readonly reportFile: string;
}

/** Phrases a screen's `askedAs` may hold — knowledge.ts's own cap, so a taught file still parses. */
const MAX_ASKED_AS = 40;
const MAX_TEXT = 300;

/** Accent- and case-insensitive, as knowledge.ts compares what people write. */
const fold = (text: string): string =>
  text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();

/**
 * A question that may name a person or carry an identifier is not served to other visitors. Coarse on
 * purpose: an email, a URL, a run of three or more digits, or a phone-like number is enough to hold it
 * back for the developer to read — a missed example costs one screen a phrase; a leaked one cannot be
 * taken back.
 */
function personal(text: string): string | null {
  if (/[\w.+-]+@[\w-]+\.[\w.]+/.test(text)) return 'looks like it contains an email address';
  if (/https?:\/\/|www\./i.test(text)) return 'contains a web address';
  if (/\d[\d\s().-]{6,}\d/.test(text)) return 'looks like it contains a phone or account number';
  if (/\d{3,}/.test(text)) return 'contains a number that could identify someone';
  return null;
}

function parseLine(raw: string): LessonLine | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  const question = typeof record.question === 'string' ? record.question : typeof record.utterance === 'string' ? record.utterance : null;
  if (!question || !question.trim()) return null;
  const route = typeof record.route === 'string' && record.route.startsWith('/') ? record.route : null;
  const how = record.how === 'rejected' || record.how === 'unplaced' ? record.how : route ? 'chose' : 'unplaced';
  return { question: question.replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT), route, how };
}

/** A route pattern (`/players/:id`, `/:locale/a`, `/reports/:id?`) as a test for a concrete path. */
function matcher(pattern: string): RegExp {
  const parts = pattern
    .replace(/\/+$/, '')
    .split('/')
    .map((segment) => (segment.startsWith(':') ? (segment.endsWith('?') ? '(?:[^/]+)?' : '[^/]+') : segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  return new RegExp(`^${parts.join('/') || ''}/?$`);
}

interface Screen {
  readonly id: string;
  readonly route: string;
  readonly test: RegExp;
}

/** Every navigable screen any role's registry has, from the built bundle. */
function screensOf(kit: string): Screen[] {
  const dir = join(kit, BUNDLE_DIR);
  const record = join(kit, REVIEW_DIR, 'build.json');
  if (!existsSync(record)) throw new Error(`Nothing built in ${kit}. Run build first: teach reads the screens it built.`);
  const roles = (JSON.parse(stripBom(readFileSync(record, 'utf8'))) as { roles: string[] }).roles;
  const byRoute = new Map<string, Screen>();
  for (const role of roles) {
    const file = join(dir, `registry.${role}.json`);
    if (!existsSync(file)) continue;
    const registry = JSON.parse(stripBom(readFileSync(file, 'utf8'))) as { capabilities: { id: string; kind: string; route: string | null }[] };
    for (const c of registry.capabilities) {
      if (c.kind !== 'navigate' || typeof c.route !== 'string' || byRoute.has(c.route)) continue;
      byRoute.set(c.route, { id: c.id, route: c.route, test: matcher(c.route) });
    }
  }
  // The most specific first: `/players/new` (no parameter) before `/players/:id`, then the longer route.
  const params = (route: string): number => route.split(':').length - 1;
  return [...byRoute.values()].sort((a, b) => params(a.route) - params(b.route) || b.route.length - a.route.length);
}

export function teach(kitDir: string, lessonsFile: string, options: TeachOptions = {}): TeachResult {
  const kit = resolve(kitDir);
  const min = Math.max(1, options.min ?? 1);
  const lines = stripBom(readFileSync(resolve(lessonsFile), 'utf8')).split(/\r?\n/).filter((l) => l.trim());
  const lessons = lines.map(parseLine).filter((l): l is LessonLine => l !== null);
  const screens = screensOf(kit);
  const screenOf = (path: string): Screen | null => screens.find((s) => s.test.test(path.replace(/[?#].*$/, ''))) ?? null;

  // How each question was settled: by which screen, how many times, and how often not at all.
  const settled = new Map<string, { text: string; screens: Map<string, number>; none: number }>();
  for (const lesson of lessons) {
    const key = fold(lesson.question);
    if (!key) continue;
    const entry = settled.get(key) ?? { text: lesson.question, screens: new Map<string, number>(), none: 0 };
    const screen = lesson.how === 'chose' && lesson.route ? screenOf(lesson.route) : null;
    if (screen) entry.screens.set(screen.route, (entry.screens.get(screen.route) ?? 0) + 1);
    else entry.none++;
    settled.set(key, entry);
  }

  const toTeach = new Map<string, string[]>();
  const held: { question: string; why: string }[] = [];
  const unanswered: { question: string; times: number }[] = [];
  for (const { text, screens: chosen, none } of settled.values()) {
    if (chosen.size === 0) {
      unanswered.push({ question: text, times: none });
      continue;
    }
    const why = personal(text);
    if (why) {
      held.push({ question: text, why });
      continue;
    }
    const ranked = [...chosen.entries()].sort((a, b) => b[1] - a[1]);
    const [top, next] = ranked;
    if (next && next[1] * 2 > top![1]) {
      held.push({ question: text, why: `visitors settled it two ways (${ranked.map(([r, n]) => `${r} ×${n}`).join(', ')})` });
      continue;
    }
    if (top![1] < min) {
      held.push({ question: text, why: `settled ${top![1]} time(s); --min is ${min}` });
      continue;
    }
    toTeach.set(top![0], [...(toTeach.get(top![0]) ?? []), text]);
  }
  unanswered.sort((a, b) => b.times - a.times);

  // knowledge.json — the adopter's, read raw so nothing they wrote is lost or reordered.
  const config = JSON.parse(stripBom(readFileSync(join(kit, CONFIG_FILE), 'utf8'))) as { knowledge?: string };
  const loaded = loadKnowledge(join(kit, CONFIG_FILE), config.knowledge);
  const knowledgeFile = loaded.path ?? join(kit, 'knowledge.json');
  const raw: Record<string, unknown> = existsSync(knowledgeFile) ? (JSON.parse(stripBom(readFileSync(knowledgeFile, 'utf8'))) as Record<string, unknown>) : {};
  const screensSection = (typeof raw.screens === 'object' && raw.screens !== null ? raw.screens : {}) as Record<string, Record<string, unknown>>;

  const taught: Taught[] = [];
  for (const [route, phrases] of toTeach) {
    const screen = screens.find((s) => s.route === route)!;
    // The adopter may have keyed the screen by its id rather than its route: add to theirs.
    const key = Object.hasOwn(screensSection, route) ? route : Object.hasOwn(screensSection, screen.id) ? screen.id : route;
    const entry = { ...(screensSection[key] ?? {}) };
    const existing = Array.isArray(entry.askedAs) ? entry.askedAs.filter((p): p is string => typeof p === 'string') : [];
    const known = new Set(existing.map(fold));
    const added = phrases.filter((p) => !known.has(fold(p))).slice(0, Math.max(0, MAX_ASKED_AS - existing.length));
    if (added.length === 0) continue;
    entry.askedAs = [...existing, ...added];
    screensSection[key] = entry;
    taught.push({ screen: route, phrases: added });
  }

  const wrote = Boolean(options.write) && taught.length > 0;
  if (wrote) writeFileSync(knowledgeFile, `${JSON.stringify({ ...raw, screens: screensSection }, null, 2)}\n`, 'utf8');

  const reportFile = join(kit, REVIEW_DIR, 'TAUGHT.md');
  writeFileSync(reportFile, taughtReport({ read: lessons.length, taught, unanswered, held, knowledgeFile, wrote }), 'utf8');
  return { read: lessons.length, taught, unanswered, held, knowledgeFile, wrote, reportFile };
}

function taughtReport(r: Omit<TeachResult, 'reportFile'>): string {
  const out: string[] = ['# What visitors taught the assistant', ''];
  out.push(`${r.read} lesson(s) read. ${r.wrote ? `Written to ${r.knowledgeFile}.` : 'Nothing was written: run teach again with --write once you have read this.'}`, '');
  out.push('Every phrase below becomes an example the assistant serves to every visitor who can reach that screen. Read each one.', '');
  out.push('## Taught — the screen visitors chose for these questions', '');
  if (r.taught.length === 0) out.push('Nothing new to teach.', '');
  for (const t of r.taught) {
    out.push(`- **${t.screen}**`);
    for (const p of t.phrases) out.push(`  - ${p}`);
  }
  out.push('', '## Unanswered — no screen answered these', '');
  out.push('Decide for each: a screen whose purpose was never written down (add it to that screen in knowledge.json),', 'something the app does not do (add it to `cannot`), or content the app\'s own search should find (`search`).', '');
  if (r.unanswered.length === 0) out.push('None.', '');
  for (const u of r.unanswered.slice(0, 50)) out.push(`- ${u.question}${u.times > 1 ? ` (×${u.times})` : ''}`);
  if (r.unanswered.length > 50) out.push(`- … and ${r.unanswered.length - 50} more`);
  out.push('', '## Held back', '');
  if (r.held.length === 0) out.push('None.', '');
  for (const h of r.held) out.push(`- ${h.question} — ${h.why}`);
  out.push('', 'Do not put these same questions in the calibration set: it would be graded on its own answers.', '');
  return out.join('\n');
}
