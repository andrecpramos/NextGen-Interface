import { readFileSync } from 'node:fs';

import ts from 'typescript';

import { dedupeFieldRules, htmlFieldRules, localDeclaration, registerNameOf, schemaFieldRules } from './field-rules.ts';
import { inferredCandidates } from './inferred-rules.ts';
import { readAngularComponent, readMarkupPage } from './markup.ts';
import type { FormField, PageFacts } from './types.ts';

/**
 * What a page component's own body says about it.
 *
 * The first spike's single most consequential gap: the spike
 * decided whether a route was a real destination from the component's *name*,
 * and got it wrong in both directions — it dropped `GradebookRedirectPage` and
 * `GuardianChildRedirectPage`, which are the correct destinations for "the next
 * match" and "my child's medical page", while keeping `DashboardPage`, which is
 * a bookmark that bounces most roles somewhere else.
 *
 * A name is a label someone chose. The body is what happens. The distinction
 * that matters is narrow and mechanical: **does every branch of this component
 * render a redirect, or does it render a page?** A component that resolves a
 * target from data and renders a real view while it waits is a destination, no
 * matter what it is called.
 *
 * Everything this module returns from the adopter's source — headings, page
 * copy, doc comments — is untrusted text (Rule 15). It is quoted into the
 * skipped report and isolated before any of it reaches a prompt; see
 * `synthesise.ts`.
 */

const REDIRECT_COMPONENTS = new Set(['Navigate', 'Redirect']);

/** Elements that carry no meaning of their own for this judgement. */
const TRANSPARENT_COMPONENTS = new Set(['Fragment', 'React.Fragment', 'Suspense']);

function parse(file: string): ts.SourceFile {
  return ts.createSourceFile(
    file,
    readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX, // .js and .jsx pages parse the same way; JSX is the point
  );
}

function tagNameOf(node: ts.Node): string | null {
  if (ts.isJsxElement(node)) return node.openingElement.tagName.getText();
  if (ts.isJsxSelfClosingElement(node)) return node.tagName.getText();
  if (ts.isJsxFragment(node)) return 'Fragment';
  return null;
}

/** The JSX root of a returned expression, seeing through ternaries and `&&`. */
function jsxRoots(expression: ts.Expression | undefined, out: string[]): void {
  if (!expression) return;
  if (ts.isParenthesizedExpression(expression)) return jsxRoots(expression.expression, out);
  if (ts.isConditionalExpression(expression)) {
    jsxRoots(expression.whenTrue, out);
    jsxRoots(expression.whenFalse, out);
    return;
  }
  if (ts.isBinaryExpression(expression)) {
    jsxRoots(expression.right, out);
    return;
  }
  const tag = tagNameOf(expression);
  if (tag === null) return;
  if (TRANSPARENT_COMPONENTS.has(tag) && ts.isJsxElement(expression)) {
    for (const child of expression.children) {
      if (ts.isJsxExpression(child)) jsxRoots(child.expression, out);
      else if (tagNameOf(child) !== null) out.push(tagNameOf(child)!);
    }
    return;
  }
  out.push(tag);
}

/**
 * The part of a redirect target that is known at build time.
 *
 * `` `/competition/matches/${id}` `` is a route into the competition section
 * whatever `id` turns out to be, and that section — not the id — is what
 * decides whether the redirect leaves the page's own area. Returns `null` when
 * even the prefix is computed, which the caller treats as "leaves".
 */
function literalPrefix(expression: ts.Expression): string | null {
  if (ts.isStringLiteralLike(expression)) return expression.text;
  if (ts.isTemplateExpression(expression)) return expression.head.text;
  if (ts.isParenthesizedExpression(expression)) return literalPrefix(expression.expression);
  if (ts.isConditionalExpression(expression)) return literalPrefix(expression.whenTrue);
  return null;
}

/** `<Navigate to="/x" />` targets, for explaining where a bookmark leads. */
function redirectTargets(source: ts.SourceFile): string[] {
  const out: string[] = [];
  const visit = (node: ts.Node): void => {
    const tag = tagNameOf(node);
    if (tag !== null && REDIRECT_COMPONENTS.has(tag)) {
      const attributes = ts.isJsxElement(node) ? node.openingElement.attributes : (node as ts.JsxSelfClosingElement).attributes;
      for (const attribute of attributes.properties) {
        if (!ts.isJsxAttribute(attribute) || attribute.name.getText() !== 'to') continue;
        const value = attribute.initializer;
        if (value && ts.isStringLiteral(value)) out.push(value.text);
        else if (value && ts.isJsxExpression(value) && value.expression) {
          // A target whose prefix is not knowable stays in the list as its own
          // source text: it cannot be shown to be inside the page's section, so
          // it correctly reads as leaving it.
          out.push(literalPrefix(value.expression) ?? value.expression.getText());
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return [...new Set(out)];
}

/** A translation function bound by `const { t } = useTranslation('ns')`, and the block that binds it. */
interface TranslationBinding {
  readonly scope: ts.Node;
  readonly local: string;
  readonly namespace: string | null;
}

/** `'squad'`, the first of `['squad', 'common']`, or next-intl's `{ locale, namespace: 'squad' }`. */
function namespaceArgument(argument: ts.Expression | undefined): string | null {
  if (!argument) return null;
  if (ts.isStringLiteralLike(argument)) return argument.text;
  if (ts.isArrayLiteralExpression(argument)) {
    const [first] = argument.elements;
    return first && ts.isStringLiteralLike(first) ? first.text : null;
  }
  if (ts.isObjectLiteralExpression(argument)) {
    for (const property of argument.properties) {
      if (ts.isPropertyAssignment(property) && property.name.getText() === 'namespace' && ts.isStringLiteralLike(property.initializer)) {
        return property.initializer.text;
      }
    }
  }
  return null;
}

/**
 * next-intl, the i18n library of the Next.js app router: `const t = useTranslations('portal')` in a
 * client component, `const t = await getTranslations('portal')` in a server one. Its messages are a
 * nested object per language, so a namespace is a path into it — `portal.athlete` — and a key
 * `portal.athlete:title` resolves the way an i18next `ns:key` does.
 */
const NEXT_INTL_HOOKS = new Set(['useTranslations', 'getTranslations']);

/** A call's namespaced i18n key, or null when it is not a translation. `keyOnly` refuses a call that interpolates. */
type KeyOf = (node: ts.Node, keyOnly?: boolean) => string | null;

/**
 * How this page calls its translations: a function from a call to its namespaced key.
 *
 * `const { t } = useTranslation('classes')` binds `t` to one namespace, and a page that
 * reads a second binds it under another name: `const { t: ts } = useTranslation('student')`.
 * An announcements screen takes its title from `ts('announcements.title')`, and
 * reading only calls to `t` lost it — the screen was named after its component, "My
 * Announcements", in English, in a Portuguese application.
 *
 * A name is resolved in the block that binds it, so two components in one file that each
 * bind their own `t` keep their own namespaces. A bare `t` bound nowhere in the file (a
 * prop, an import) takes the page's first namespace, as it always did.
 */
function translationCalls(
  source: ts.SourceFile,
  props: ReadonlyMap<string, string> = new Map(),
): { namespace: string | null; keyOf: KeyOf; fromProps: ReadonlySet<string> } {
  const bindings: TranslationBinding[] = [];
  let namespace: string | null = null;
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'useTranslation') {
      const bound = namespaceArgument(node.arguments[0]);
      namespace ??= bound;
      const declaration = node.parent;
      if (declaration && ts.isVariableDeclaration(declaration) && ts.isObjectBindingPattern(declaration.name)) {
        let scope: ts.Node = declaration;
        while (scope.parent && !ts.isBlock(scope) && !ts.isSourceFile(scope)) scope = scope.parent;
        for (const element of declaration.name.elements) {
          const imported = element.propertyName ?? element.name;
          if (ts.isIdentifier(imported) && imported.text === 't' && ts.isIdentifier(element.name)) {
            bindings.push({ scope, local: element.name.text, namespace: bound });
          }
        }
      }
    }
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && NEXT_INTL_HOOKS.has(node.expression.text)) {
      const bound = namespaceArgument(node.arguments[0]);
      namespace ??= bound;
      // `const t = await getTranslations(...)`: the call sits under an `await`.
      const declaration = node.parent && ts.isAwaitExpression(node.parent) ? node.parent.parent : node.parent;
      if (declaration && ts.isVariableDeclaration(declaration) && ts.isIdentifier(declaration.name)) {
        let scope: ts.Node = declaration;
        while (scope.parent && !ts.isBlock(scope) && !ts.isSourceFile(scope)) scope = scope.parent;
        bindings.push({ scope, local: declaration.name.text, namespace: bound });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);

  const bindingOf = (identifier: ts.Identifier): TranslationBinding | null => {
    for (let scope: ts.Node | undefined = identifier.parent; scope; scope = scope.parent) {
      const found = bindings.find((binding) => binding.scope === scope && binding.local === identifier.text);
      if (found) return found;
    }
    return null;
  };

  const fromProps = new Set<string>();
  const keyOf: KeyOf = (node, keyOnly = false) => {
    if (!ts.isCallExpression(node) || !ts.isIdentifier(node.expression)) return null;
    const [first] = node.arguments;
    const written = first ? keyText(first, props) : null;
    if (!written || (keyOnly && node.arguments.length > 1)) return null;
    const binding = bindingOf(node.expression);
    if (!binding && node.expression.text !== 't') return null;
    const scoped = binding ? binding.namespace : namespace;
    const key = written.text.includes(':') || !scoped ? written.text : `${scoped}:${written.text}`;
    if (written.fromProps) fromProps.add(key);
    return key;
  };

  return { namespace, keyOf, fromProps };
}

/**
 * A key as written: a string, or a template whose every placeholder is a prop the component
 * was rendered with. A layout's `t(`sections.${active}`)`, rendered as `<Layout active="notif">`,
 * is `sections.notif`. Any other template is computed at run time, and is not guessed.
 */
function keyText(node: ts.Expression, props: ReadonlyMap<string, string>): { text: string; fromProps: boolean } | null {
  if (ts.isStringLiteralLike(node)) return { text: node.text, fromProps: false };
  if (!ts.isTemplateExpression(node) || props.size === 0) return null;
  let text = node.head.text;
  for (const span of node.templateSpans) {
    const expression = span.expression;
    const name = ts.isIdentifier(expression)
      ? expression.text
      : ts.isPropertyAccessExpression(expression)
        ? expression.name.text
        : null;
    const value = name === null ? undefined : props.get(name);
    if (value === undefined) return null;
    text += value + span.literal.text;
  }
  return { text, fromProps: true };
}

/** The i18n keys a page renders — the app's own vocabulary for this screen — namespaced. */
function i18nKeys(source: ts.SourceFile, keyOf: KeyOf): string[] {
  const keys: string[] = [];
  const visit = (node: ts.Node): void => {
    const key = keyOf(node);
    if (key) keys.push(key);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return [...new Set(keys)];
}

/** A page's own header: `<h1>`, or a component named as a header, heading, title or hero. */
const PAGE_HEADER = /^h1$|(?:Header|Heading|Title|Hero)$/;

/** …that belongs to something other than the page, whose title sits on the same attribute. */
const NOT_THE_PAGE = /Dialog|Modal|Card|Empty|Toast|Confirm|Drawer|Sheet|Section|Table|Column|Tooltip|Popover|Panel|Widget|Menu/;

/** Whether a node sits inside an `if` of the function that renders it: an early return, in a component. */
function insideIf(node: ts.Node): boolean {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (ts.isIfStatement(parent)) return true;
    if (ts.isFunctionLike(parent)) return false;
  }
  return false;
}

/**
 * The i18n keys a page renders as its own heading, in source order.
 *
 * What a user reads at the top of a screen is its name, and a page usually says it in one
 * place: its header's `title`, or its `<h1>`. That is told apart from the dozens of other
 * `*.title` keys a page renders — a dialog's, a card's, an empty state's — by where it is
 * rendered, rather than guessed from the shape of the key as `PAGE_TITLE_KEY` has to.
 *
 * A child's grades page may name itself through a variable,
 * `const title = childName ? tg('grades.titleFor', { name }) : tg('grades.title')`. The
 * variable is followed, and a call that interpolates a value is not a name: it is a
 * sentence with a child's name in it.
 *
 * A header rendered from inside an `if` is not read at all. That is an early return —
 * `if (isPending) return <PageHeader title={t('hub.loading')} />` — and it names a moment
 * rather than the screen: a gradebook came out as "Turma não encontrada" from its
 * not-found branch, and a class's page as "A carregar…".
 */
function titleKeys(source: ts.SourceFile, keyOf: KeyOf): string[] {
  const out: string[] = [];
  const collect = (node: ts.Node): void => {
    const key = keyOf(node, true);
    if (key) out.push(key);
    else ts.forEachChild(node, collect);
  };
  const fromExpression = (expression: ts.Expression): void => {
    if (ts.isIdentifier(expression)) {
      const declaration = localDeclaration(expression);
      if (declaration?.initializer) collect(declaration.initializer);
      return;
    }
    collect(expression);
  };
  const visit = (node: ts.Node): void => {
    if (ts.isJsxAttribute(node) && FALLBACK_ATTRIBUTES.test(node.name.getText())) return; // a failure state
    const tag = tagNameOf(node);
    if (tag && PAGE_HEADER.test(tag) && !NOT_THE_PAGE.test(tag) && !insideIf(node)) {
      if (tag === 'h1' && ts.isJsxElement(node)) {
        for (const child of node.children) {
          if (ts.isJsxExpression(child) && child.expression) fromExpression(child.expression);
        }
      }
      for (const attribute of attributesOf(node)?.properties ?? []) {
        if (!ts.isJsxAttribute(attribute) || !/^(title|heading)$/.test(attribute.name.getText())) continue;
        const value = attribute.initializer;
        if (value && ts.isJsxExpression(value) && value.expression) fromExpression(value.expression);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return [...new Set(out)];
}

/**
 * What a screen shows when it **fails**, which is not what the screen is.
 *
 * Found by auditing descriptions: bulletproof-react's discussion
 * screen has no doc comment, and the only literal text under it is an
 * `ErrorBoundary`'s fallback — "Failed to load comments. Try to refresh the
 * page." That was the entire on-screen text the model was given, so it
 * faithfully described the error: *"A user tries to view comments but sees an
 * error message and attempts to refresh the screen."* A user asking where the
 * discussion is would be sent to a screen the registry describes as a failure.
 *
 * A fallback is rendered exactly when the screen is not working. Reading it as
 * the screen's own copy is reading the wrong state.
 *
 * ⚠️ **Only the failure states.** The first version of this list also skipped
 * `forbiddenFallback`, and that made a description worse: bulletproof-react's
 * `/app/users` renders `forbiddenFallback={<div>Only admin can view this.</div>}`,
 * which was the only thing telling the model who the screen is for. Its
 * description went from *"An admin views a list of registered users"* to *"A
 * person views…"*. An authorization fallback describes the **audience**, which
 * is true of the screen; an error or loading fallback describes a **moment**,
 * which is not.
 */
const FALLBACK_ATTRIBUTES = /^(fallback|errorFallback|loadingFallback|errorElement)$/;

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', copy: '©', reg: '®', hellip: '…', ndash: '–', mdash: '—',
  laquo: '«', raquo: '»', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', euro: '€', middot: '·', bull: '•',
};

/**
 * JSX text is read raw, so `Match &amp; results` is what a page's source says and `Match & results` is what
 * a person reads. It was offered to visitors, and matched against, with the entity in it.
 */
function decodeEntities(text: string): string {
  return text.replace(/&(?:#(\d+)|#x([0-9a-f]+)|([a-z]+));/gi, (whole, decimal?: string, hex?: string, name?: string) => {
    if (name !== undefined) return NAMED_ENTITIES[name.toLowerCase()] ?? whole;
    const code = decimal !== undefined ? Number(decimal) : Number.parseInt(hex!, 16);
    return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
  });
}

/**
 * "Skip to the main content": a link to a place on the same page, which every accessible app has and
 * which says nothing about the page it is on. Only that — a link to a section (`#pricing`) is still
 * the page's own words.
 */
function isSkipLink(node: ts.Node): boolean {
  if (!ts.isJsxElement(node) || node.openingElement.tagName.getText() !== 'a') return false;
  const attributes = node.openingElement.attributes;
  const href = literalAttr(attributes, 'href');
  if (!href?.startsWith('#')) return false;
  return /skip/i.test(literalAttr(attributes, 'className') ?? literalAttr(attributes, 'class') ?? '') || /^#(?:main|content|skip)/i.test(href);
}

/** Literal user-visible text: headings, titles, and JSX text nodes. */
function headings(source: ts.Node): string[] {
  const out: string[] = [];
  const visit = (node: ts.Node): void => {
    if (isSkipLink(node)) return;
    if (ts.isJsxAttribute(node)) {
      const name = node.name.getText();
      if (FALLBACK_ATTRIBUTES.test(name)) return; // its subtree is the failure state, not the screen
      if (/^(title|subtitle|heading|label)$/.test(name)) {
        const value = node.initializer;
        if (value && ts.isStringLiteral(value) && value.text.trim()) out.push(value.text.trim());
      }
    }
    if (ts.isJsxText(node)) {
      const text = decodeEntities(node.text).replace(/\s+/g, ' ').trim();
      if (text.length > 2 && /[a-zA-ZÀ-ÿ]/.test(text)) out.push(text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return [...new Set(out)].slice(0, 12);
}

const CONTROL_TAGS = new Set(['input', 'select', 'textarea', 'button']);

/** A JSX element's attributes, if it has any. */
function attributesOf(node: ts.Node): ts.JsxAttributes | null {
  if (ts.isJsxElement(node)) return node.openingElement.attributes;
  if (ts.isJsxSelfClosingElement(node)) return node.attributes;
  return null;
}

/** A string-literal attribute's value — `name="x"` or `name={'x'}`. */
function literalAttr(attributes: ts.JsxAttributes, name: string): string | null {
  for (const attribute of attributes.properties) {
    if (!ts.isJsxAttribute(attribute) || attribute.name.getText() !== name) continue;
    const value = attribute.initializer;
    if (value && ts.isStringLiteral(value)) return value.text;
    if (value && ts.isJsxExpression(value) && value.expression && ts.isStringLiteralLike(value.expression)) {
      return value.expression.text;
    }
  }
  return null;
}

/**
 * The visible text of an element's children: literal text, or the key of a
 * single `t('…')` call. A label that is computed any other way is returned as
 * nothing rather than guessed — a step anchored to a guessed label would be
 * exactly the confident mispoint guided steps must never make.
 */
function childText(node: ts.Node): { text: string | null; key: string | null } {
  if (!ts.isJsxElement(node)) return { text: null, key: null };
  const literal = node.children
    .filter(ts.isJsxText)
    .map((c) => c.text)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (literal) return { text: literal, key: null };
  for (const child of node.children) {
    if (!ts.isJsxExpression(child) || !child.expression || !ts.isCallExpression(child.expression)) continue;
    const call = child.expression;
    const [first] = call.arguments;
    if (ts.isIdentifier(call.expression) && call.expression.text === 't' && first && ts.isStringLiteralLike(first)) {
      return { text: null, key: first.text };
    }
  }
  return { text: null, key: null };
}

/** `setOpen(true)`, `setShowForm(!showForm)`, `setOpen((v) => !v)`: state that shows something. */
function showsState(call: ts.CallExpression): boolean {
  if (!ts.isIdentifier(call.expression)) return false;
  const name = call.expression.text;
  if (/^(open|show|toggle)[A-Z]?\w*$/.test(name) && call.arguments.length === 0) return true;
  if (!/^set[A-Z]\w*$/.test(name) || call.arguments.length !== 1) return false;
  const [arg] = call.arguments as unknown as [ts.Expression];
  if (arg.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (ts.isPrefixUnaryExpression(arg) && arg.operator === ts.SyntaxKind.ExclamationToken) return true;
  return ts.isArrowFunction(arg) && !ts.isBlock(arg.body) && ts.isPrefixUnaryExpression(arg.body) && arg.body.operator === ts.SyntaxKind.ExclamationToken;
}

/** A handler that does nothing but show something: every statement in it is `showsState`. */
function onlyShows(handler: ts.Expression): boolean {
  if (ts.isIdentifier(handler)) return /^(open|show|toggle|handleOpen|handleShow)[A-Z]?\w*$/.test(handler.text);
  if (!ts.isArrowFunction(handler) && !ts.isFunctionExpression(handler)) return false;
  const body = handler.body;
  const calls = ts.isBlock(body)
    ? body.statements.map((s) => (ts.isExpressionStatement(s) && ts.isCallExpression(s.expression) ? s.expression : null))
    : [ts.isCallExpression(body) ? body : null];
  return calls.length > 0 && calls.every((call) => call !== null && showsState(call));
}

/**
 * The controls a page renders whose only job is to show something (ADR-031): a `…Trigger` (Radix, shadcn:
 * `DialogTrigger`, `SheetTrigger` — never an `AlertDialog`'s, which asks to confirm something), or an
 * element whose `onClick` does nothing but set state that shows something. Named by their own visible
 * text or `t('…')` key; a control named any other way is left out rather than guessed.
 */
function openers(source: ts.SourceFile): { label: string | null; labelKey: string | null }[] {
  const out: { label: string | null; labelKey: string | null }[] = [];
  const named = (node: ts.Node): void => {
    let { text, key } = childText(node);
    // `<DialogTrigger asChild><Button>New event</Button></DialogTrigger>`: the name is the child's.
    if (!text && !key && ts.isJsxElement(node)) {
      const inner = node.children.find((c): c is ts.JsxElement => ts.isJsxElement(c));
      if (inner) ({ text, key } = childText(inner));
    }
    // `<IconButton aria-label="New event" onClick={…} />`: named by its label.
    const attributes = attributesOf(node);
    if (!text && !key && attributes) text = literalAttr(attributes, 'aria-label');
    if (text || key) out.push({ label: text, labelKey: key });
  };
  const visit = (node: ts.Node): void => {
    const tag = tagNameOf(node);
    if (tag && /Trigger$/.test(tag) && !/^AlertDialog/.test(tag)) {
      named(node);
    } else if (tag) {
      const attributes = attributesOf(node);
      for (const attribute of attributes?.properties ?? []) {
        if (!ts.isJsxAttribute(attribute) || attribute.name.getText() !== 'onClick') continue;
        const value = attribute.initializer;
        if (value && ts.isJsxExpression(value) && value.expression && onlyShows(value.expression)) named(node);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return out.slice(0, 20);
}

/**
 * The form controls a page renders, with whatever names them.
 *
 * A control's name comes from, in order: its own `aria-label`, a `<label
 * htmlFor>` pointing at its `id`, its `placeholder`, and — for a button — its own
 * text. That is the accessible-name order a screen reader uses, which is also
 * the order `packages/embed`'s runtime resolver matches in; the two have to agree or
 * a generated anchor would name a field the page does not.
 *
 * Hidden inputs are skipped, and so is any control nothing names: a step that
 * cannot say which field it means is not guidance.
 */
function formFields(source: ts.SourceFile): FormField[] {
  const labels = new Map<string, { text: string | null; key: string | null }>();
  const controls: ts.Node[] = [];

  const visit = (node: ts.Node): void => {
    const tag = tagNameOf(node);
    const attributes = attributesOf(node);
    if (tag && attributes) {
      const lower = tag.toLowerCase();
      if (lower === 'label') {
        const target = literalAttr(attributes, 'htmlFor');
        if (target) labels.set(target, childText(node));
      } else if (CONTROL_TAGS.has(lower)) {
        controls.push(node);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);

  // Whatever a zod/yup schema constrains, read once for the whole file
  // and joined to each control below by the same key `register('…')` and a
  // literal `name="…"` both resolve to.
  const schemaRules = schemaFieldRules(source);

  const out: FormField[] = [];
  for (const node of controls) {
    const attributes = attributesOf(node)!;
    const tag = tagNameOf(node)!.toLowerCase();
    const type = literalAttr(attributes, 'type');
    if (type === 'hidden') continue;
    // A button that is not a submit is usually an icon toggle or a row action;
    // "press the button" with no destination is not a step.
    if (tag === 'button' && type !== 'submit') continue;

    const id = literalAttr(attributes, 'id');
    const name = literalAttr(attributes, 'name') ?? registerNameOf(attributes);

    let named: { text: string | null; key: string | null } = {
      text: literalAttr(attributes, 'aria-label'),
      key: null,
    };
    if (!named.text && id && labels.has(id)) named = labels.get(id)!;
    if (!named.text && !named.key) named = { text: literalAttr(attributes, 'placeholder'), key: null };
    if (!named.text && !named.key && tag === 'button') named = childText(node);

    if (!named.text && !named.key) continue;
    const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
    const rules = dedupeFieldRules([...(schemaRules.get(name ?? '') ?? []), ...htmlFieldRules(attributes, line + 1)]);
    out.push({ tag, label: named.text, labelKey: named.key, id, name, type, rules });
  }
  return out;
}

/**
 * The title a page declares for itself, when it spells it out.
 *
 *   export const metadata = { title: 'Pricing' }          Next.js app router
 *   export const meta = () => [{ title: 'Sign Up' }]      Remix
 *
 * A string literal only. `generateMetadata`, a `{ default, template }` object, or a
 * title built from data is code, and evaluating it would be guessing — the same
 * rule discover.ts keeps for a route path it cannot evaluate.
 */
function declaredTitle(source: ts.SourceFile): string | null {
  const nameOf = (property: ts.ObjectLiteralElementLike): string | null =>
    ts.isPropertyAssignment(property) && (ts.isIdentifier(property.name) || ts.isStringLiteralLike(property.name))
      ? property.name.text
      : null;
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    if (!statement.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue;
      let initializer: ts.Expression = declaration.initializer;
      while (ts.isSatisfiesExpression(initializer) || ts.isAsExpression(initializer) || ts.isParenthesizedExpression(initializer)) {
        initializer = initializer.expression;
      }
      if (declaration.name.text === 'metadata' && ts.isObjectLiteralExpression(initializer)) {
        const title = initializer.properties.find((p) => nameOf(p) === 'title');
        if (title && ts.isPropertyAssignment(title) && ts.isStringLiteralLike(title.initializer)) {
          return title.initializer.text.trim() || null;
        }
      }
      if (declaration.name.text === 'meta') {
        let found: string | null = null;
        const visit = (node: ts.Node): void => {
          if (found !== null) return;
          if (ts.isObjectLiteralExpression(node)) {
            const title = node.properties.find((p) => nameOf(p) === 'title');
            if (title && ts.isPropertyAssignment(title) && ts.isStringLiteralLike(title.initializer) && title.initializer.text.trim()) {
              found = title.initializer.text.trim();
              return;
            }
          }
          ts.forEachChild(node, visit);
        };
        visit(initializer);
        if (found !== null) return found;
      }
    }
  }
  return null;
}

/** The block comment above the component — usually why the page exists. */
function componentDoc(source: ts.SourceFile): string | null {
  const text = source.getFullText();
  for (const statement of source.statements) {
    const isComponent =
      (ts.isFunctionDeclaration(statement) || ts.isVariableStatement(statement)) &&
      statement.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
    if (!isComponent) continue;
    const ranges = ts.getLeadingCommentRanges(text, statement.getFullStart());
    const block = ranges?.filter((r) => r.kind === ts.SyntaxKind.MultiLineCommentTrivia).at(-1);
    if (!block) continue;
    const doc = text
      .slice(block.pos, block.end)
      .replace(/^\s*(\/\*+|\*+\/|\*)/gm, '')
      .replace(/\s+/g, ' ')
      // A one-line comment closes on the same line as its text, so the line-start
      // strip above never sees it: `/** The signed-in shell. */` kept its `*/`,
      // and the model was handed it as part of the sentence.
      .replace(/\s*\*+\/\s*$/, '')
      .trim();
    if (doc.length > 0) return doc;
  }
  return null;
}

/**
 * Read a page component.
 *
 * A component is a *pure redirect* when it renders at least one redirect and
 * nothing else — every branch sends the user away. One that renders a loading
 * state, an empty state or any real view alongside its redirect is resolving a
 * destination, not replacing one.
 */
export function readPage(file: string): PageFacts {
  return readComponent(file, new Map()).facts;
}

/** A component's facts, and the title keys it builds from the props it was rendered with. */
interface ComponentReading {
  readonly facts: PageFacts;
  readonly titleKeysFromProps: readonly string[];
}

function readComponent(file: string, props: ReadonlyMap<string, string>): ComponentReading {
  // A Svelte or Vue component, or an HTML template, is markup rather than TSX.
  if (/\.(vue|svelte|html)$/.test(file)) return { facts: readMarkupPage(file), titleKeysFromProps: [] };
  // An Angular component is a class whose page is its template.
  if (/\.ts$/.test(file)) {
    const angular = readAngularComponent(file);
    if (angular) return { facts: angular, titleKeysFromProps: [] };
  }
  const source = parse(file);

  const roots: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isReturnStatement(node)) jsxRoots(node.expression, roots);
    if (ts.isArrowFunction(node) && !ts.isBlock(node.body)) jsxRoots(node.body, roots);
    ts.forEachChild(node, visit);
  };
  visit(source);

  const rendered = roots.filter((tag) => !TRANSPARENT_COMPONENTS.has(tag));
  const redirects = rendered.filter((tag) => REDIRECT_COMPONENTS.has(tag));
  const { namespace, keyOf, fromProps } = translationCalls(source, props);
  const fields = formFields(source);

  const facts: PageFacts = {
    isPureRedirect: redirects.length > 0 && redirects.length === rendered.length,
    redirectTargets: redirectTargets(source),
    i18nKeys: i18nKeys(source, keyOf),
    titleKeys: titleKeys(source, keyOf),
    headings: headings(source),
    doc: componentDoc(source),
    title: declaredTitle(source),
    // Same namespace rule as `i18nKeys`, so a label written as t('x.y') resolves
    // against the page's own namespace exactly as its other copy does.
    fields: fields.map((f) =>
      f.labelKey && namespace && !f.labelKey.includes(':') ? { ...f, labelKey: `${namespace}:${f.labelKey}` } : f,
    ),
    // ADR-020's inferred tier: matched against the same, un-namespaced
    // fields — a candidate's `field` is a `name`/`id`, never a label key.
    inferredCandidates: inferredCandidates(source, fields),
    // ADR-031. Namespaced as the fields are, so a `t('events.new')` resolves against the page's own copy.
    openers: openers(source).map((o) =>
      o.labelKey && namespace && !o.labelKey.includes(':') ? { ...o, labelKey: `${namespace}:${o.labelKey}` } : o,
    ),
  };
  return { facts, titleKeysFromProps: titleKeysFromProps(source, keyOf, fromProps) };
}

/**
 * Keys a component titles something with, built from its props: the one part of a shared
 * layout that belongs to the page rendering it. A card's title counts here, unlike in
 * `titleKeys` — a layout's card titled from the active tab names that tab and nothing else.
 */
function titleKeysFromProps(source: ts.SourceFile, keyOf: KeyOf, fromProps: ReadonlySet<string>): string[] {
  const out: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isJsxAttribute(node) && /^(title|heading)$/.test(node.name.getText())) {
      const value = node.initializer;
      const key = value && ts.isJsxExpression(value) && value.expression ? keyOf(value.expression, true) : null;
      if (key && fromProps.has(key)) out.push(key);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return [...new Set(out)];
}

/** Resolves an import, from the file that wrote it, to a source file of the application — or null. */
export type ImportResolver = (specifier: string, fromFile: string) => string | null;

/** A design system or shared UI kit: a wrapper page's words are never in its buttons. */
const SHARED_UI = /[\\/](?:ui|design-system|primitives)[\\/]/i;

/**
 * A screen, read through the components it renders when its own file says nothing.
 *
 * In one real app, 19 of 141 declared screens were wrappers. `/settings/notifications` is
 * `<PersonalSettingsLayout active="notif"><PersonalNotificationsSection /></PersonalSettingsLayout>`
 * and nothing more. Read alone, such a page has no heading, no copy and no form: it was
 * named after its component, "Personal Notifications", and described from nothing. Its
 * words are one step away, in the components it renders — and a layout that titles the
 * active tab from a prop, `t(`sections.${active}`)`, names this page exactly, once the
 * page's own `active="notif"` is put into the key.
 *
 * One level, and only the application's own components: a design system's button knows
 * nothing about the screen it sits on. A page that says anything about itself is read as
 * it always was, so its facts — and the prose cached against them — do not move.
 */
export function readScreen(file: string, resolveImport: ImportResolver): PageFacts {
  const own = readPage(file);
  const saysNothing = own.titleKeys.length === 0 && own.i18nKeys.length === 0 && own.headings.length === 0;
  if (!saysNothing || !/\.(tsx|jsx)$/.test(file)) return own;
  const source = parse(file);
  return readThrough(file, source, source, own, resolveImport);
}

/** Nothing said about a screen yet. */
export const EMPTY_FACTS: PageFacts = {
  isPureRedirect: false,
  fields: [],
  redirectTargets: [],
  i18nKeys: [],
  headings: [],
  titleKeys: [],
  doc: null,
  title: null,
  inferredCandidates: [],
};

/** The component `name` declared at the top level of a file — `function X() {}` or `const X = () => …` — or null. */
function localComponent(source: ts.SourceFile, name: string): ts.Node | null {
  for (const statement of source.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name?.text === name) return statement;
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && declaration.name.text === name && declaration.initializer) return declaration.initializer;
    }
  }
  return null;
}

/**
 * A screen whose component is declared in the very file that routes to it.
 *
 *     function MainPage() { return <main><Hero /><Pricing /><Team /></main>; }
 *     …
 *     <Route path="/" element={<MainPage />} />
 *
 * Common in a small app, and it is the whole of a one-page site: discovery follows imports, so a
 * component with no import had no file, and the screen everything is on was described from nothing.
 * It is read like a wrapper page — through the sections it composes, one level, the application's own
 * components only — and *only* that declaration is read: the header and footer the app renders
 * around its routes are chrome, and are nobody's page.
 *
 * `null` when it says nothing readable, so the caller keeps what it always did and does not point
 * "where this description came from" at a file that contributed none of it.
 */
export function readLocalScreen(file: string, name: string, resolveImport: ImportResolver): PageFacts | null {
  if (!/\.(tsx|jsx)$/.test(file)) return null;
  const source = parse(file);
  const declaration = localComponent(source, name);
  if (!declaration) return null;
  const ownWords = headings(declaration);
  const through = readThrough(file, source, declaration, EMPTY_FACTS, resolveImport);
  const facts = { ...through, headings: [...new Set([...ownWords, ...through.headings])].slice(0, 12) };
  const saysSomething = facts.headings.length > 0 || facts.titleKeys.length > 0 || facts.i18nKeys.length > 0 || facts.fields.length > 0;
  return saysSomething ? facts : null;
}

/** `own`, or — when `own` says nothing — what the application's own components rendered under `root` say. */
function readThrough(file: string, source: ts.SourceFile, root: ts.Node, own: PageFacts, resolveImport: ImportResolver): PageFacts {
  const imports = importedComponents(source);
  const children: ComponentReading[] = [];
  const seen = new Set<string>();
  const visit = (node: ts.Node): void => {
    const tag = tagNameOf(node);
    const imported = tag ? imports.get(tag) : undefined;
    if (imported) {
      const child = componentFile(resolveImport(imported.specifier, file), imported.name, resolveImport);
      if (child && !SHARED_UI.test(child)) {
        const props = literalProps(node);
        const key = `${child}?${[...props].map(([name, value]) => `${name}=${value}`).join('&')}`;
        if (!seen.has(key)) {
          seen.add(key);
          children.push(readComponent(child, props));
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(root);
  if (children.length === 0) return own;

  const flat = (pick: (reading: ComponentReading) => readonly string[]): string[] => [...new Set(children.flatMap(pick))];
  const specific = flat((reading) => reading.titleKeysFromProps);
  const headers = flat((reading) => reading.facts.titleKeys).filter((key) => !specific.includes(key));
  return {
    ...own,
    titleKeys: specific.length > 0 ? specific : headers,
    ...(specific.length > 0 && headers.length > 0 ? { sectionTitleKeys: headers } : {}),
    i18nKeys: flat((reading) => reading.facts.i18nKeys),
    headings: flat((reading) => reading.facts.headings).slice(0, 12),
    fields: own.fields.length > 0 ? own.fields : children.flatMap((reading) => reading.facts.fields),
    // What opens something may be in the page or in what it renders: a toolbar, a list's header.
    openers: [...(own.openers ?? []), ...children.flatMap((reading) => reading.facts.openers ?? [])].slice(0, 20),
    doc: own.doc ?? children.find((reading) => reading.facts.doc)?.facts.doc ?? null,
  };
}

/** The components a file imports: local name -> the module, and the name it is exported under there. */
function importedComponents(source: ts.SourceFile): Map<string, { specifier: string; name: string }> {
  const out = new Map<string, { specifier: string; name: string }>();
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteralLike(statement.moduleSpecifier)) continue;
    const clause = statement.importClause;
    if (!clause || clause.isTypeOnly) continue;
    const specifier = statement.moduleSpecifier.text;
    if (clause.name) out.set(clause.name.text, { specifier, name: 'default' });
    if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
      for (const element of clause.namedBindings.elements) {
        out.set(element.name.text, { specifier, name: (element.propertyName ?? element.name).text });
      }
    }
  }
  return out;
}

/**
 * The file that defines an imported component, through one barrel when the import names one:
 * `import { TutorialsSettingsPanel } from '@/features/tutorial'` is an `index.ts` re-exporting it.
 */
function componentFile(resolved: string | null, name: string, resolveImport: ImportResolver): string | null {
  if (!resolved || !/[\\/]index\.[jt]sx?$/.test(resolved)) return resolved;
  const barrel = parse(resolved);
  for (const statement of barrel.statements) {
    if (!ts.isExportDeclaration(statement) || !statement.moduleSpecifier || !ts.isStringLiteralLike(statement.moduleSpecifier)) continue;
    const clause = statement.exportClause;
    if (clause && ts.isNamedExports(clause) && clause.elements.some((element) => element.name.text === name)) {
      return resolveImport(statement.moduleSpecifier.text, resolved);
    }
  }
  // An index file with a component of its own in it, rather than only re-exports.
  return barrel.statements.some((statement) => !ts.isExportDeclaration(statement) && !ts.isImportDeclaration(statement))
    ? resolved
    : null;
}

/** The string props a component is rendered with: `active="notif"`, `mode={'page'}`. */
function literalProps(node: ts.Node): Map<string, string> {
  const out = new Map<string, string>();
  const attributes = attributesOf(node);
  for (const attribute of attributes?.properties ?? []) {
    if (!ts.isJsxAttribute(attribute)) continue;
    const name = attribute.name.getText();
    const value = literalAttr(attributes!, name);
    if (value !== null) out.set(name, value);
  }
  return out;
}
