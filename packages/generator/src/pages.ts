import { readFileSync } from 'node:fs';

import ts from 'typescript';

import type { FormField, PageFacts } from './types.ts';

/**
 * What a page component's own body says about it.
 *
 * WP-30's verdict named this the single most consequential gap: the spike
 * decided whether a route was a real destination from the component's *name*,
 * and got it wrong in both directions — it dropped `MatchHubRedirectPage` and
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

/** The i18n keys a page renders — the app's own vocabulary for this screen. */
function i18nKeys(source: ts.SourceFile): { namespace: string | null; keys: string[] } {
  let namespace: string | null = null;
  const keys: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const name = ts.isIdentifier(callee) ? callee.text : null;
      const [first] = node.arguments;
      if (name === 'useTranslation' && first && ts.isStringLiteralLike(first) && namespace === null) {
        namespace = first.text;
      }
      if (name === 't' && first && ts.isStringLiteralLike(first)) {
        keys.push(first.text);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return { namespace, keys: [...new Set(keys)] };
}

/**
 * What a screen shows when it **fails**, which is not what the screen is.
 *
 * WP-42 found this by auditing descriptions: bulletproof-react's discussion
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

/** Literal user-visible text: headings, titles, and JSX text nodes. */
function headings(source: ts.SourceFile): string[] {
  const out: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isJsxAttribute(node)) {
      const name = node.name.getText();
      if (FALLBACK_ATTRIBUTES.test(name)) return; // its subtree is the failure state, not the screen
      if (/^(title|subtitle|heading|label)$/.test(name)) {
        const value = node.initializer;
        if (value && ts.isStringLiteral(value) && value.text.trim()) out.push(value.text.trim());
      }
    }
    if (ts.isJsxText(node)) {
      const text = node.text.trim();
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
 * exactly the confident mispoint WP-27 forbids.
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

/**
 * The form controls a page renders, with whatever names them (WP-27).
 *
 * A control's name comes from, in order: its own `aria-label`, a `<label
 * htmlFor>` pointing at its `id`, its `placeholder`, and — for a button — its own
 * text. That is the accessible-name order a screen reader uses, which is also
 * the order `packages/ui`'s runtime resolver matches in; the two have to agree or
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
    const name = literalAttr(attributes, 'name');

    let named: { text: string | null; key: string | null } = {
      text: literalAttr(attributes, 'aria-label'),
      key: null,
    };
    if (!named.text && id && labels.has(id)) named = labels.get(id)!;
    if (!named.text && !named.key) named = { text: literalAttr(attributes, 'placeholder'), key: null };
    if (!named.text && !named.key && tag === 'button') named = childText(node);

    if (!named.text && !named.key) continue;
    out.push({ tag, label: named.text, labelKey: named.key, id, name, type });
  }
  return out;
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
      // and the model was handed it as part of the sentence (WP-42).
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
  const { namespace, keys } = i18nKeys(source);

  return {
    isPureRedirect: redirects.length > 0 && redirects.length === rendered.length,
    redirectTargets: redirectTargets(source),
    i18nKeys: namespace ? keys.map((k) => (k.includes(':') ? k : `${namespace}:${k}`)) : keys,
    headings: headings(source),
    doc: componentDoc(source),
    // Same namespace rule as `i18nKeys`, so a label written as t('x.y') resolves
    // against the page's own namespace exactly as its other copy does.
    fields: formFields(source).map((f) =>
      f.labelKey && namespace && !f.labelKey.includes(':') ? { ...f, labelKey: `${namespace}:${f.labelKey}` } : f,
    ),
  };
}
