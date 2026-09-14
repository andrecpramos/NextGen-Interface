import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import type { FormField, PageFacts } from './types.ts';

/**
 * What a markup page says about itself: a Svelte or Vue single-file component, or an
 * HTML template (readiness item 3b).
 *
 * pages.ts reads TSX with the TypeScript parser. These files are HTML with
 * expressions in them, so they are read as text, and conservatively: only what is
 * literally written counts. A heading built from data (`{data.title}`,
 * `{{ item.name }}`) is skipped rather than guessed, exactly as pages.ts skips a
 * computed title.
 *
 * Everything returned is the adopter's own text and untrusted (Rule 15).
 */

const EMPTY: PageFacts = { isPureRedirect: false, redirectTargets: [], i18nKeys: [], headings: [], doc: null, fields: [], title: null, titleKeys: [] };

/** `{x}` (Svelte), `{{ x }}` (Vue, Angular), `${x}`: text that depends on data. */
const EXPRESSION = /\{\{|\{[^}]*\}|\$\{/;

/** `$t('…')`, `t('…')`, `$_('…')`, `i18n.t('…')`: the common translation calls. */
const TRANSLATION_CALL = /(?:\$t|\bt|\$_|\bi18n\.t)\(\s*(['"`])((?:(?!\1).)+)\1/g;

/** A key written as the words it stands for — `$t('Type to search...')` — reads as is. */
const PROSE_KEY = /\s/;

function decode(text: string): string {
  return text
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function scriptsOf(text: string): string {
  return [...text.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1] ?? '').join('\n');
}

/**
 * The markup a user sees, without scripts, styles, comments, the document head, or a
 * failure state.
 *
 * A block shown only when something went wrong (`v-if="error"`, `{#if error}`) is what
 * the screen looks like when it is not working. WP-42 found the TSX version of this
 * mistake describing a discussion screen as its own error message; the same rule
 * applies here. The match is approximate — the first closing tag of the same name — and
 * errs towards removing too little rather than guessing structure.
 */
function visibleMarkup(text: string): string {
  return text
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<svelte:head\b[\s\S]*?<\/svelte:head>/gi, ' ')
    .replace(/<title\b[\s\S]*?<\/title>/gi, ' ')
    .replace(/<(\w+)\b[^>]*\b(?:v-if|v-else-if|\*ngIf)="[^"]*\berror\b[^"]*"[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/\{#if[^}]*\berror\b[^}]*\}[\s\S]*?\{\/if\}/gi, ' ')
    // Angular's control flow: `@if (error) { ... }`.
    .replace(/@if\s*\([^)]*\berror\b[^)]*\)\s*\{[^}]*\}/gi, ' ');
}

/** One `$t('prose key')` call alone is readable; any other expression is not; plain text is. */
function literalText(inner: string): string | null {
  const call = /^\s*\{\{?\s*(?:\$t|t|\$_)\(\s*(['"])(.+?)\1[^)]*\)\s*\}?\}\s*$/.exec(inner);
  if (call) return PROSE_KEY.test(call[2]!) ? call[2]! : null;
  if (EXPRESSION.test(inner)) return null;
  const plain = decode(inner.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
  return plain && /[a-zA-ZÀ-ÿ]/.test(plain) ? plain : null;
}

function declaredTitle(text: string, script: string): string | null {
  const head = /<title>([^<]*)<\/title>/i.exec(text);
  if (head && !EXPRESSION.test(head[1]!)) {
    const value = decode(head[1]!).trim();
    if (value) return value;
  }
  // Nuxt and Vue: a literal title handed to the head or the page meta. A conditional,
  // `computed(...)` or data is code, and not evaluated.
  const call = /\b(?:useHead|useSeoMeta|definePageMeta)\s*\(\s*\{[^}]*?\btitle\s*:\s*(['"])([^'"]+)\1\s*[,}]/.exec(script);
  return call ? call[2]!.trim() || null : null;
}

function headingsOf(markup: string): string[] {
  const out: string[] = [];
  for (const match of markup.matchAll(/<h([1-3])\b[^>]*>([\s\S]*?)<\/h\1>/gi)) {
    const text = literalText(match[2]!);
    if (text) out.push(text);
  }
  // Other literal text between tags, as pages.ts takes JSX text.
  for (const match of markup.matchAll(/>([^<>]+)</g)) {
    const raw = match[1]!;
    if (EXPRESSION.test(raw)) continue;
    const text = decode(raw).replace(/\s+/g, ' ').trim();
    if (text.length > 2 && /[a-zA-ZÀ-ÿ]/.test(text)) out.push(text);
  }
  return [...new Set(out)].slice(0, 12);
}

function attributesOf(openTag: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const match of openTag.matchAll(/([:@\w.[\]-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    out.set(match[1]!, match[2] ?? match[3] ?? '');
  }
  return out;
}

/** An attribute's literal value, or the key of a single translation call bound to it. */
function named(attributes: Map<string, string>, name: string): { text: string | null; key: string | null } {
  const literal = attributes.get(name);
  if (literal !== undefined && !EXPRESSION.test(literal)) return { text: decode(literal).trim() || null, key: null };
  const bound = attributes.get(`:${name}`) ?? attributes.get(`v-bind:${name}`) ?? attributes.get(`[${name}]`);
  const call = bound ? /^\s*(?:\$t|t|\$_)\(\s*(['"])(.+?)\1/.exec(bound) : null;
  return call ? { text: null, key: call[2]! } : { text: null, key: null };
}

function textOrKey(inner: string): { text: string | null; key: string | null } {
  const text = literalText(inner);
  if (text) return { text, key: null };
  const call = /(?:\$t|\bt|\$_)\(\s*(['"])(.+?)\1/.exec(inner);
  return call ? { text: null, key: call[2]! } : { text: null, key: null };
}

/** Form controls and what names them, in the accessible-name order pages.ts uses (WP-27). */
function fieldsOf(markup: string): FormField[] {
  const labels = new Map<string, { text: string | null; key: string | null }>();
  for (const match of markup.matchAll(/<label\b([^>]*)>([\s\S]*?)<\/label>/gi)) {
    const attributes = attributesOf(match[1]!);
    const target = attributes.get('for') ?? attributes.get('htmlFor');
    if (target) labels.set(target, textOrKey(match[2]!));
  }

  const out: FormField[] = [];
  for (const match of markup.matchAll(/<(input|textarea|select|button)\b([^>]*?)\/?>(?:([\s\S]*?)<\/\1>)?/gi)) {
    const tag = match[1]!.toLowerCase();
    const attributes = attributesOf(match[2]!);
    const type = attributes.get('type') ?? null;
    if (type === 'hidden') continue;
    if (tag === 'button' && type !== 'submit') continue;
    const id = attributes.get('id') ?? null;
    const name = attributes.get('name') ?? null;

    let label = named(attributes, 'aria-label');
    if (!label.text && !label.key && id && labels.has(id)) label = labels.get(id)!;
    if (!label.text && !label.key) label = named(attributes, 'placeholder');
    if (!label.text && !label.key && tag === 'button' && match[3]) label = textOrKey(match[3]);
    if (!label.text && !label.key) continue;
    out.push({ tag, label: label.text, labelKey: label.key, id, name, type });
  }
  return out;
}

export function readMarkupPage(file: string): PageFacts {
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    return EMPTY;
  }
  return readMarkupText(text);
}

/**
 * An Angular component: the markup of its `templateUrl` file, or of its inline `template`.
 * `null` when the file is not an Angular component, so the caller reads it as TypeScript.
 */
export function readAngularComponent(file: string): PageFacts | null {
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    return null;
  }
  if (!/@Component\s*\(/.test(text)) return null;
  const url = /templateUrl\s*:\s*['"]([^'"]+)['"]/.exec(text);
  if (url) return readMarkupPage(join(dirname(file), url[1]!));
  const inline = /\btemplate\s*:\s*`([\s\S]*?)`/.exec(text);
  return inline ? readMarkupText(inline[1]!) : EMPTY;
}

function readMarkupText(text: string): PageFacts {
  const markup = visibleMarkup(text);
  const keys = [...text.matchAll(TRANSLATION_CALL)].map((m) => m[2]!).filter((key) => !key.includes('${'));
  return {
    // A redirect in a load function or middleware is not visible in markup, and is not guessed.
    isPureRedirect: false,
    redirectTargets: [],
    i18nKeys: [...new Set(keys)],
    titleKeys: [],
    headings: headingsOf(markup),
    doc: null,
    fields: fieldsOf(markup),
    title: declaredTitle(text, scriptsOf(text)),
  };
}
