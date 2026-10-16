import { relative } from 'node:path';

import type { ExtractedRule } from '@nextgen/core-capability';
import ts from 'typescript';

import { localDeclaration } from './field-rules.ts';
import { visibleLabel } from './steps.ts';
import type { Translations } from './labels.ts';
import type { FormField, InferredCandidate, ReviewInferredEntry } from './types.ts';

/**
 * ADR-020's **inferred** tier — "the risky one". Everything `field-rules.ts`
 * reads is written down; everything here is read from what the code *does*: a submit
 * button disabled until a field is filled, a handler that bails out and tells the user
 * why. Both are real signal — an audit of descriptions never had this before it, and it is exactly the
 * knowledge that turns "take me to the expense form" into "take me to the expense form,
 * and it needs a receipt before it will let you submit".
 *
 * **The asymmetry with `field-rules.ts` that this whole module exists to respect:** a
 * validation schema cannot be almost right — it either says `.min(0)` or it does not. A
 * condition in a handler can look exactly like a validation guard and mean something
 * else entirely. So every candidate this file finds carries `recognized: boolean`, and
 * only `true` ever reaches a shipped registry (`inferredRulesEntry`, called from
 * `generate.ts` the same way `rulesEntry` is). Everything else is `reviewOnlyEntries`'
 * job: named in `review/INFERRED.md`, never in a bundle a browser receives.
 *
 * TWO PATTERNS, BOTH FROM ADR-020'S OWN LIST, AND NOTHING ELSE
 *
 *   1. `disabled-submit` — a submit control's own `disabled` expression: a bare
 *      `!field`, or an `||`-chain of them. `&&` is never decomposed — it changes what
 *      the condition means, not just how it is written — so a mixed expression yields
 *      whatever `!field` terms it has and treats the rest as opaque, unrecognised.
 *   2. `guard-message` — the page's submit handler's *first* statement (skipping a
 *      leading `preventDefault()`), when it is exactly `if (<presence check on a field>)
 *      { <one message call>; return; }` or `if (<check>) throw new Error('…')`. Anything
 *      else at that position — another statement first, an `else` branch, more than one
 *      statement in the guard, a message with no string literal — is still evidence
 *      *something* is being guarded, so it becomes a review-only candidate; it never
 *      becomes a shipped rule on a guess.
 *
 * A guard not in that first position is not read at all, on purpose: walking a whole
 * handler for anything that looks like an early return turns review/INFERRED.md into
 * noise from ordinary control flow that has nothing to do with what a form requires.
 */

// ------------------------------------------------------------ shared JSX reading --

function tagNameOf(node: ts.Node): string | null {
  if (ts.isJsxElement(node)) return node.openingElement.tagName.getText();
  if (ts.isJsxSelfClosingElement(node)) return node.tagName.getText();
  return null;
}

function attributesOf(node: ts.Node): ts.JsxAttributes | null {
  if (ts.isJsxElement(node)) return node.openingElement.attributes;
  if (ts.isJsxSelfClosingElement(node)) return node.attributes;
  return null;
}

function literalAttr(attributes: ts.JsxAttributes, name: string): string | null {
  for (const attribute of attributes.properties) {
    if (!ts.isJsxAttribute(attribute) || attribute.name.getText() !== name) continue;
    const value = attribute.initializer;
    if (value && ts.isStringLiteral(value)) return value.text;
  }
  return null;
}

function eventAttr(attributes: ts.JsxAttributes, name: string): ts.Expression | null {
  for (const attribute of attributes.properties) {
    if (!ts.isJsxAttribute(attribute) || attribute.name.getText() !== name) continue;
    const value = attribute.initializer;
    if (value && ts.isJsxExpression(value) && value.expression) return value.expression;
  }
  return null;
}

function matchField(name: string, fields: readonly FormField[]): FormField | null {
  return fields.find((f) => f.name === name || f.id === name) ?? null;
}

function lineOf(source: ts.SourceFile, node: ts.Node): number {
  return source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
}

// --------------------------------------------------------------- disabled-submit --

/** Splits only on `||`, at any depth. A `&&` subexpression is one opaque term, never entered. */
function orTerms(expression: ts.Expression): ts.Expression[] {
  if (ts.isParenthesizedExpression(expression)) return orTerms(expression.expression);
  if (ts.isBinaryExpression(expression) && expression.operatorToken.kind === ts.SyntaxKind.BarBarToken) {
    return [...orTerms(expression.left), ...orTerms(expression.right)];
  }
  return [expression];
}

/** `!identifier`, and nothing else — the one shape this pattern trusts. */
function negatedIdentifier(term: ts.Expression): string | null {
  const unwrapped = ts.isParenthesizedExpression(term) ? term.expression : term;
  return ts.isPrefixUnaryExpression(unwrapped) &&
    unwrapped.operator === ts.SyntaxKind.ExclamationToken &&
    ts.isIdentifier(unwrapped.operand)
    ? unwrapped.operand.text
    : null;
}

function disabledSubmitCandidates(source: ts.SourceFile, fields: readonly FormField[]): InferredCandidate[] {
  const out: InferredCandidate[] = [];
  const visit = (node: ts.Node): void => {
    const tag = tagNameOf(node)?.toLowerCase();
    const attributes = attributesOf(node);
    if ((tag === 'button' || tag === 'input') && attributes && literalAttr(attributes, 'type') === 'submit') {
      const disabled = eventAttr(attributes, 'disabled');
      if (disabled) {
        const line = lineOf(source, disabled);
        const detail = disabled.getText(source).slice(0, 200);
        const terms = orTerms(disabled);
        const names = terms.map(negatedIdentifier).filter((n): n is string => n !== null);
        const matched = [...new Set(names)]
          .map((name) => matchField(name, fields))
          .filter((f): f is FormField => f !== null);
        if (matched.length > 0) {
          for (const field of matched) {
            out.push({ pattern: 'disabled-submit', field: field.name ?? field.id, statement: null, recognized: true, detail, line });
          }
        } else {
          out.push({ pattern: 'disabled-submit', field: null, statement: null, recognized: false, detail, line });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return out;
}

// ----------------------------------------------------------------- guard-message --

/** `identifier === null/undefined/''`, either side, loose or strict — nothing more exotic. */
function recognizedGuardField(expression: ts.Expression): string | null {
  const negated = negatedIdentifier(expression);
  if (negated) return negated;
  if (!ts.isBinaryExpression(expression)) return null;
  const op = expression.operatorToken.kind;
  if (op !== ts.SyntaxKind.EqualsEqualsEqualsToken && op !== ts.SyntaxKind.EqualsEqualsToken) return null;
  const [identifier, other] = ts.isIdentifier(expression.left)
    ? [expression.left, expression.right]
    : ts.isIdentifier(expression.right)
      ? [expression.right, expression.left]
      : [null, null];
  if (!identifier) return null;
  const isNullish = other.kind === ts.SyntaxKind.NullKeyword || (ts.isIdentifier(other) && other.text === 'undefined');
  const isEmptyString = ts.isStringLiteralLike(other) && other.text === '';
  return isNullish || isEmptyString ? identifier.text : null;
}

const MESSAGE_CALLEE = /^(set\w*error|toast\.\w+|notify\w*|alert)$/i;

function calleeText(expression: ts.Expression): string | null {
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression) && ts.isIdentifier(expression.expression)) {
    return `${expression.expression.text}.${expression.name.text}`;
  }
  return null;
}

/**
 * The literal message argument of a recognised call — `setError('…')`,
 * `toast.error('…')`. The LAST string-literal argument, not the first:
 * `setFieldError('email', 'Email is required.')` names the field before the
 * message, and reading the first literal would have shipped the field's own
 * name, `'email'`, as if it were the sentence — found by walking through this
 * exact call shape before trusting the mechanism, the same way `field-rules.ts`
 * found its bare-participle false positive.
 */
function messageFromCall(call: ts.CallExpression): string | null {
  const name = calleeText(call.expression);
  if (!name || !MESSAGE_CALLEE.test(name)) return null;
  const literal = [...call.arguments].reverse().find(ts.isStringLiteralLike);
  return literal ? literal.text : null;
}

function messageFromThrow(statement: ts.Statement): string | null {
  if (!ts.isThrowStatement(statement) || !statement.expression || !ts.isNewExpression(statement.expression)) return null;
  const { expression: ctor, arguments: args } = statement.expression;
  if (!ts.isIdentifier(ctor) || ctor.text !== 'Error') return null;
  const [arg] = args ?? [];
  return arg && ts.isStringLiteralLike(arg) ? arg.text : null;
}

/**
 * The message a guard's consequent delivers, in the two shapes this trusts:
 * `if (guard) throw new Error('…')` (braced or not), or a block of EXACTLY a
 * message call followed by a bare `return;` — nothing else, in either case.
 */
function messageFromConsequent(consequent: ts.Statement): string | null {
  const thrown = messageFromThrow(consequent);
  if (thrown !== null) return thrown;
  if (!ts.isBlock(consequent)) return null;
  const { statements } = consequent;
  if (statements.length === 1) return messageFromThrow(statements[0]!);
  if (statements.length !== 2) return null;
  const [first, second] = statements;
  if (!ts.isExpressionStatement(first!) || !ts.isCallExpression(first!.expression)) return null;
  if (!ts.isReturnStatement(second!) || second!.expression) return null;
  return messageFromCall(first!.expression);
}

/** An if-statement's consequent that provably does not fall through — a return or a throw. */
function isEarlyExit(consequent: ts.Statement): boolean {
  if (ts.isReturnStatement(consequent) || ts.isThrowStatement(consequent)) return true;
  if (!ts.isBlock(consequent)) return false;
  const last = consequent.statements.at(-1);
  return !!last && (ts.isReturnStatement(last) || ts.isThrowStatement(last));
}

const NAVIGATION_CALL = /^(preventdefault|stoppropagation)$/i;

/** A bare `event.preventDefault()` / `event.stopPropagation()` — skipped, never the guard itself. */
function isNavigationCall(statement: ts.Statement): boolean {
  if (!ts.isExpressionStatement(statement) || !ts.isCallExpression(statement.expression)) return false;
  const callee = statement.expression.expression;
  const name = ts.isPropertyAccessExpression(callee) ? callee.name.text : ts.isIdentifier(callee) ? callee.text : null;
  return !!name && NAVIGATION_CALL.test(name);
}

/** The function a JSX event attribute points at, resolved to its braced body — or null. */
function eventHandlerBody(expression: ts.Expression, source: ts.SourceFile): ts.Block | null {
  let target: ts.Expression = expression;
  if (ts.isIdentifier(target)) {
    const declared = localDeclaration(target);
    if (declared?.initializer) {
      target = declared.initializer;
    } else {
      const found = functionDeclarationNamed(source, target.text);
      if (!found) return null;
      return found.body ?? null;
    }
  }
  if ((ts.isArrowFunction(target) || ts.isFunctionExpression(target)) && ts.isBlock(target.body)) return target.body;
  return null;
}

function functionDeclarationNamed(source: ts.SourceFile, name: string): ts.FunctionDeclaration | null {
  let found: ts.FunctionDeclaration | null = null;
  const visit = (node: ts.Node): void => {
    if (!found && ts.isFunctionDeclaration(node) && node.name?.text === name) found = node;
    else ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

/** The page's own submit action: a form's `onSubmit`, or its submit control's `onClick`. */
function submitHandlerBody(source: ts.SourceFile): ts.Block | null {
  let formHandler: ts.Expression | null = null;
  let buttonHandler: ts.Expression | null = null;
  const visit = (node: ts.Node): void => {
    const tag = tagNameOf(node)?.toLowerCase();
    const attributes = attributesOf(node);
    if (tag && attributes) {
      if (tag === 'form') formHandler ??= eventAttr(attributes, 'onSubmit');
      else if ((tag === 'button' || tag === 'input') && literalAttr(attributes, 'type') === 'submit') {
        buttonHandler ??= eventAttr(attributes, 'onClick');
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  const handler = formHandler ?? buttonHandler;
  return handler ? eventHandlerBody(handler, source) : null;
}

function guardMessageCandidates(source: ts.SourceFile, fields: readonly FormField[]): InferredCandidate[] {
  const body = submitHandlerBody(source);
  if (!body) return [];
  const statements = body.statements.filter((s) => !isNavigationCall(s));
  const first = statements[0];
  if (!first || !ts.isIfStatement(first) || first.elseStatement || !isEarlyExit(first.thenStatement)) return [];

  const line = lineOf(source, first);
  const detail = first.getText(source).slice(0, 200);
  const guardField = recognizedGuardField(first.expression);
  const message = messageFromConsequent(first.thenStatement);

  if (guardField && message !== null) {
    const field = matchField(guardField, fields);
    // A message with nothing to attach it to is not shippable — recognized stays false,
    // and the statement it would have carried is withheld along with it (never partially
    // trusted data: `recognized: false` must mean nothing here is ready to ship, not
    // "ready, but held back for an unrelated reason").
    return field
      ? [{ pattern: 'guard-message', field: field.name ?? field.id, statement: message, recognized: true, detail, line }]
      : [{ pattern: 'guard-message', field: null, statement: null, recognized: false, detail, line }];
  }
  return [{ pattern: 'guard-message', field: null, statement: null, recognized: false, detail, line }];
}

// -------------------------------------------------------------------- entry point --

/** Every inferred-tier candidate this page's own source offers, recognised or not. */
export function inferredCandidates(source: ts.SourceFile, fields: readonly FormField[]): InferredCandidate[] {
  return [...disabledSubmitCandidates(source, fields), ...guardMessageCandidates(source, fields)];
}

// ------------------------------------------------------------------ phrasing --

/**
 * ADR-020: "an inferred rule is phrased as an observation, not a law" — this is that
 * distinction, for the one pattern that needs any phrasing at all. `guard-message`
 * already found its statement verbatim in the source (the app's own words to its own
 * user); this is only for `disabled-submit`, which found a fact but no sentence.
 *
 * A checkbox's label reads as a sentence already — "I accept the terms" — and "the
 * form asks for I accept the terms" reads as a run-on. Found in the read-sample
 * measurement before it shipped: `steps.ts` already makes the
 * same distinction for guided steps ("Tick … if it applies"), so a checkbox is
 * phrased the same way here instead of through the noun-phrase template.
 */
function phraseDisabledSubmit(field: FormField, label: string, language: string): string {
  const pt = (language.split('-')[0] ?? '').toLowerCase() === 'pt';
  if (field.type === 'checkbox' || field.type === 'radio') {
    return pt ? `"${label}" tem de estar marcado antes de submeter.` : `"${label}" must be checked before this can be submitted.`;
  }
  return pt ? `O formulário pede "${label}" antes de submeter.` : `The form asks for "${label}" before it will submit.`;
}

/**
 * Every recognised candidate, as an `ExtractedRule` with `tier: 'inferred'` — spread-ready,
 * the same shape `rulesEntry` returns for the read tier. A recognised `disabled-submit`
 * candidate still needs a label resolved before it can be phrased and is dropped if none
 * is resolvable — the same principle `rulesFor` applies for the same reason.
 */
export function inferredRulesEntry(
  candidates: readonly InferredCandidate[],
  fields: readonly FormField[],
  dictionary: Translations | undefined,
  language: string,
  appRoot: string,
  pageFile: string,
): { readonly rules?: readonly ExtractedRule[] } {
  const file = relative(appRoot, pageFile).replace(/\\/g, '/');
  const rules: ExtractedRule[] = [];
  for (const candidate of candidates) {
    if (!candidate.recognized) continue;
    if (candidate.pattern === 'guard-message') {
      if (!candidate.field || !candidate.statement) continue;
      rules.push({ field: candidate.field, statement: candidate.statement, tier: 'inferred', source: `${file}:${candidate.line}` });
      continue;
    }
    // disabled-submit
    if (!candidate.field) continue;
    const matched = fields.find((f) => f.name === candidate.field || f.id === candidate.field);
    const label = matched && visibleLabel(matched, dictionary);
    if (!matched || !label) continue;
    rules.push({
      field: candidate.field,
      statement: phraseDisabledSubmit(matched, label, language),
      tier: 'inferred',
      source: `${file}:${candidate.line}`,
    });
  }
  return rules.length > 0 ? { rules } : {};
}

/** Every candidate found but not confident enough to ship — `review/INFERRED.md`'s own source. */
export function reviewInferredEntries(
  candidates: readonly InferredCandidate[],
  route: string,
  appRoot: string,
  pageFile: string,
): ReviewInferredEntry[] {
  const file = relative(appRoot, pageFile).replace(/\\/g, '/');
  return candidates
    .filter((c) => !c.recognized)
    .map((c) => ({ route, pattern: c.pattern, source: `${file}:${c.line}`, detail: c.detail }));
}
