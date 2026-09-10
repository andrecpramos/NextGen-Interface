import { readFileSync } from 'node:fs';

import ts from 'typescript';

import type { PageFacts } from './types.ts';

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

/** Literal user-visible text: headings, titles, and JSX text nodes. */
function headings(source: ts.SourceFile): string[] {
  const out: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isJsxAttribute(node)) {
      const name = node.name.getText();
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
  };
}
