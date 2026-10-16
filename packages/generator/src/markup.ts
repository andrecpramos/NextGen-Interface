import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { aboutWho, INERT_CALL, INERT_HANDLER, isChrome } from './control-words.ts';
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

const EMPTY: PageFacts = {
  isPureRedirect: false,
  redirectTargets: [],
  i18nKeys: [],
  headings: [],
  doc: null,
  fields: [],
  title: null,
  titleKeys: [],
  inferredCandidates: [],
};

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
 * the screen looks like when it is not working. An audit found the TSX version of this
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

/** Form controls and what names them, in the accessible-name order pages.ts uses. */
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
    // Schema/JSX-attribute extraction is TSX-specific (`field-rules.ts`
    // walks a TypeScript AST); this regex-based reader for Vue/Svelte/HTML
    // markup does not have rules to attach yet.
    out.push({ tag, label: label.text, labelKey: label.key, id, name, type, rules: [] });
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

/**
 * A handler that does nothing but show something (ADR-031), in the idioms of Vue (`@click="open = true"`),
 * Svelte (`on:click={() => (open = true)}`) and Angular (`(click)="openDialog()"`): every statement sets a
 * flag true or toggles it, or calls `open…()`/`show…()`/`toggle…()` with nothing, or `setX(true)`.
 */
function onlyShows(handler: string): boolean {
  const body = handler.trim().replace(/^\(\s*\)\s*=>\s*/, '').replace(/^\{([\s\S]*)\}$/, '$1').trim().replace(/^\(([\s\S]*)\)$/, '$1');
  const statements = body.split(';').map((s) => s.trim()).filter(Boolean);
  return (
    statements.length > 0 &&
    statements.every(
      (s) =>
        /^[\w$.]+\s*=\s*(true|!\s*[\w$.]+)$/.test(s) ||
        /^(open|show|toggle)[A-Z]?\w*\s*\(\s*\)$/.test(s) ||
        /^set[A-Z]\w*\s*\(\s*true\s*\)$/.test(s),
    )
  );
}

/** An opening tag, skipping `>` inside quoted or braced values (`on:click={() => …}`). */
const OPEN_TAG = /<([a-zA-Z][\w-]*)((?:[^>"'{]|"[^"]*"|'[^']*'|\{[^}]*\})*)>/g;
// Svelte 4's `on:click={…}` and Svelte 5's `onclick={…}` both take an expression in braces.
const CLICK_HANDLER = /(?:@click|v-on:click|\(click\)|onclick)(?:\.[\w.]+)?\s*=\s*(?:"([^"]*)"|'([^']*)')|(?:on:click|onclick)\s*=\s*\{([^}]*(?:\}[^}]*)?)\}/;

/** Controls whose only job is to show something, named by their text, a translation key, or `aria-label` (ADR-031). */
function openersOf(markup: string): { label: string | null; labelKey: string | null }[] {
  const out: { label: string | null; labelKey: string | null }[] = [];
  for (const match of markup.matchAll(OPEN_TAG)) {
    const handler = CLICK_HANDLER.exec(match[2]!);
    const code = handler ? (handler[1] ?? handler[2] ?? handler[3] ?? '') : '';
    if (!handler || !onlyShows(code)) continue;
    // What the control wraps: up to its own closing tag.
    const after = match.index! + match[0].length;
    const close = markup.indexOf(`</${match[1]}>`, after);
    let { text, key } = textOrKey(close > after ? markup.slice(after, close) : '');
    if (!text && !key) ({ text, key } = named(attributesOf(match[2]!), 'aria-label'));
    if (text || key) out.push({ label: text, labelKey: key });
    if (out.length === 20) break;
  }
  return out;
}

type Control = { label: string | null; labelKey: string | null };

/** Elements with no closing tag: never open in the stack below. */
const VOID = new Set(['input', 'br', 'img', 'hr', 'meta', 'link', 'area', 'base', 'col', 'embed', 'source', 'track', 'wbr']);
/** On the element itself: shown or usable only when the condition holds. */
const CONDITION_ATTR = /(?:^|\s)(?:v-if|v-else-if|v-show|\*ngIf|\[hidden\]|:disabled|\[disabled\]|disabled|hidden)\s*=\s*(?:"([^"]*)"|'([^']*)'|\{([^}]*)\})/g;

/**
 * Does pressing a markup control do something a visitor would name? Its handler — Vue `@click="save()"`,
 * Angular `(click)="remove(id)"`, Svelte `on:click={publish}` — calls anything but state, navigation and
 * event plumbing (`INERT_CALL`), or is a bare handler named for something else (`INERT_HANDLER`). Assigning
 * a flag does nothing a visitor would name.
 */
function markupDoesSomething(code: string): boolean {
  const calls = [...code.matchAll(/([\w$]+)\s*\(/g)].map((m) => m[1]!).filter((name) => name !== 'function');
  if (calls.length > 0) return calls.some((name) => !INERT_CALL.test(name.replace(/^\$/, '')));
  const bare = code.trim().replace(/^\{|\}$/g, '').trim();
  return /^[\w$.]+$/.test(bare) && !INERT_HANDLER.test(bare.split('.').pop()!);
}

/**
 * What a markup page's controls do (ADR-042), as `controls.ts` reads TSX — conservatively, because nothing
 * here is evaluated: no role is read, so a control under a condition about who the visitor is (`v-if=
 * "canDelete"`, `{#if $user.isAdmin}`, `@if (auth.isAdmin()) {`, `*ngIf`, `:disabled="!canEdit"`) is left
 * out and reported, never listed for everyone. A condition about anything else narrows nothing.
 *
 * The text is scanned once, keeping a stack of open elements and conditional blocks (Svelte's `{#if}`,
 * Angular's `@if (…) {`); scripts, styles, comments and `{{ … }}` are blanked first, position for position,
 * so a label is still read from the original text.
 */
function controlsOfMarkup(text: string): { actions: Control[]; guarded: Control[]; children: { tag: string; guarded: boolean }[] } {
  const blank = (s: string) => s.replace(/[^\n]/g, ' ');
  const masked = text
    .replace(/<script\b[\s\S]*?<\/script>|<style\b[\s\S]*?<\/style>|<!--[\s\S]*?-->/gi, blank)
    .replace(/\{\{[\s\S]*?\}\}/g, blank);
  const TOKEN =
    /<\/([\w-]+)\s*>|<([\w-]+)((?:[^>"'{]|"[^"]*"|'[^']*'|\{[^}]*\})*?)(\/?)>|\{#(?:if|each|await|key)\s+([^}]*)\}|\{:else[^}]*\}|\{\/(?:if|each|await|key)\}|@(else\s+if|else|if|for|switch|case|default|defer|placeholder|loading|error|empty)\s*(?:\(((?:[^()]|\([^()]*\))*)\))?\s*\{|\}/g;
  type Open = { readonly name: string; readonly guarded: boolean; readonly angular: boolean };
  const stack: Open[] = [];
  let lastAngular = false;
  const actions: Control[] = [];
  const guarded: Control[] = [];
  const children: { tag: string; guarded: boolean }[] = [];
  const seen = new Set<string>();
  const about = (condition: string | undefined) => !!condition && aboutWho(condition);
  const under = () => stack.some((open) => open.guarded);

  for (const match of masked.matchAll(TOKEN)) {
    const [whole, closing, tag, attrs, selfClose, svelteIf, angularKind, angularCondition] = match;
    if (closing) {
      const at = stack.map((open) => open.name).lastIndexOf(closing.toLowerCase());
      if (at > -1) stack.length = at;
      continue;
    }
    if (whole.startsWith('{#')) {
      stack.push({ name: '{#', guarded: about(svelteIf), angular: false });
      continue;
    }
    if (whole.startsWith('{:')) continue; // the else of a block keeps its block's condition
    if (whole.startsWith('{/')) {
      const at = stack.map((open) => open.name).lastIndexOf('{#');
      if (at > -1) stack.length = at;
      continue;
    }
    if (angularKind) {
      // `} @else {` reopens what the `@if` before it was about.
      const inherits = /^else/.test(angularKind) && lastAngular;
      stack.push({ name: '@', guarded: inherits || about(angularCondition), angular: true });
      continue;
    }
    if (whole === '}') {
      const at = stack.map((open) => open.name).lastIndexOf('@');
      if (at > -1 && stack.slice(at + 1).every((open) => !open.angular)) {
        lastAngular = stack[at]!.guarded;
        stack.length = at;
      }
      continue;
    }
    if (!tag) continue;
    const original = text.slice(match.index!, match.index! + whole.length);
    const own = [...original.matchAll(CONDITION_ATTR)].some((m) => about(m[1] ?? m[2] ?? m[3]));
    const name = tag.toLowerCase();
    // A component the page renders (`<Editor />`, `<article-form>`), and whether a condition about who
    // stands above it — for `readMarkupControls` to read through.
    if (/^[A-Z]/.test(tag) || tag.includes('-')) children.push({ tag, guarded: own || under() });
    const handler = CLICK_HANDLER.exec(attrs ?? '');
    const code = handler ? (CLICK_HANDLER.exec(original)?.slice(1).find((g) => g !== undefined) ?? '') : '';
    const buttonLike = name === 'button' || /(button|btn)$/.test(name);
    const typed = /(?:^|\s)type\s*=/.test(attrs ?? '');
    // `type="submit"`, or no type at all inside a form — which submits it, by HTML's default (SvelteKit's
    // form actions are written this way).
    const submit =
      buttonLike && (/(?:^|\s)type\s*=\s*["']submit["']/.test(attrs ?? '') || (!typed && stack.some((open) => open.name === 'form')));
    const isAction = (handler && !onlyShows(code) && markupDoesSomething(code)) || (!handler && submit);
    if (isAction) {
      const after = match.index! + whole.length;
      const close = text.indexOf(`</${tag}>`, after);
      let { text: label, key } = textOrKey(close > after ? text.slice(after, close) : '');
      if (!label && !key) ({ text: label, key } = named(attributesOf(attrs ?? ''), 'aria-label'));
      const id = label ?? `key:${key}`;
      if ((label || key) && !seen.has(id)) {
        seen.add(id);
        if (own || under()) guarded.push({ label, labelKey: key });
        else if (key || !isChrome(label!)) actions.push({ label, labelKey: key });
      }
    }
    if (!selfClose && !VOID.has(name)) stack.push({ name, guarded: own, angular: false });
  }
  return { actions: actions.slice(0, 20), guarded, children };
}

/** `<article-form>` and `<ArticleForm>` are the same imported `ArticleForm`. */
const pascal = (tag: string) => tag.replace(/(^|-)(\w)/g, (_, __, c: string) => c.toUpperCase());

/**
 * What a Vue or Svelte page lets a visitor do, read through the components it renders (ADR-042) — the
 * markup counterpart of `readControls`. SvelteKit's `/editor` renders `<Editor />`, and the form is in
 * there. A component is followed when the page imports it by name from a file the app owns
 * (`resolveImport`), two levels down; one rendered under a condition about who passes that on to every
 * control in it, which is then reported, never listed. An Angular template names components by selector,
 * which is not followed. Fails soft: a file that cannot be read contributes nothing.
 */
export function readMarkupControls(
  file: string,
  resolveImport: (specifier: string, from: string) => string | null,
): { actions: Control[]; guarded: Control[] } {
  const actions: Control[] = [];
  const guarded: Control[] = [];
  const seenNames = new Set<string>();
  const seenFiles = new Set<string>();
  const keep = (into: Control[], control: Control) => {
    const id = control.label ?? `key:${control.labelKey}`;
    if (seenNames.has(id) || into.length >= 20) return;
    seenNames.add(id);
    into.push(control);
  };
  const walk = (path: string, depth: number, underGuard: boolean): void => {
    if (seenFiles.has(path)) return;
    seenFiles.add(path);
    let text: string;
    try {
      text = readFileSync(path, 'utf8');
    } catch {
      return;
    }
    const found = controlsOfMarkup(text);
    for (const control of found.actions) keep(underGuard ? guarded : actions, control);
    for (const control of found.guarded) keep(guarded, control);
    if (depth >= 2) return;
    const imports = new Map<string, string>();
    for (const m of scriptsOf(text).matchAll(/import\s+([A-Z][\w$]*)\s+from\s+['"]([^'"]+)['"]/g)) imports.set(m[1]!, m[2]!);
    for (const child of found.children) {
      const specifier = imports.get(pascal(child.tag));
      const target = specifier ? resolveImport(specifier, path) : null;
      if (target && /\.(vue|svelte)$/.test(target)) walk(target, depth + 1, underGuard || child.guarded);
    }
  };
  walk(file, 0, false);
  return { actions, guarded };
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
    // The inferred-tier extractor walks a TypeScript AST (`inferred-rules.ts`); this
    // regex-based reader for Vue/Svelte/HTML markup has no candidates to offer.
    inferredCandidates: [],
    // Read from the raw text: `visibleMarkup` drops what a handler says.
    openers: openersOf(text),
    // ADR-042: what the screen lets a visitor do, and what a condition about who left out.
    ...(() => {
      const { actions, guarded } = controlsOfMarkup(text);
      return { actions, guardedControls: guarded };
    })(),
  };
}
