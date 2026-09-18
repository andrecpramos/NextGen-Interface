import { relative } from 'node:path';

import type { ExtractedRule } from '@nextgen/core-capability';
import ts from 'typescript';

import { visibleLabel } from './steps.ts';
import type { Translations } from './labels.ts';
import type { FieldRule, FormField } from './types.ts';

/**
 * ADR-020's **read** tier — constraints an application writes down rather than
 * ones this generator would have to infer (WP-54).
 *
 * Two sources, both mechanical:
 *
 *   - a native HTML attribute on a real control (`required`, `min`, `max`,
 *     `minLength`, `maxLength`, `pattern`);
 *   - a validation schema — zod or yup — bound to the form through
 *     `useForm({ resolver: zodResolver(schema) })` / `yupResolver(schema)`,
 *     the react-hook-form idiom ADR-020 names explicitly.
 *
 * Each rule keeps the line it was read from, in the same file `pages.ts` was
 * already reading for the control itself. Nothing here is a law until
 * `generate.ts` phrases it and attaches the file: this module only reads.
 *
 * WHAT THIS DOES NOT DO, ON PURPOSE (the stop-if in PLAN.md §7.8 WP-54)
 *   Only `z`/`yup` as the namespace identifier is recognised — a schema built
 *   through a re-exported wrapper (`import { schema as z } from './zod-setup'`)
 *   is not found, and neither is a schema assembled with `.extend()` or
 *   `.merge()`. Widening either is a bigger, separate piece of work; ADR-020's
 *   own escape valve is to reopen the decision rather than absorb it here.
 */

function numericArg(args: readonly ts.Expression[]): number | undefined {
  const [first] = args;
  return first && ts.isNumericLiteral(first) ? Number(first.text) : undefined;
}

/** A regex literal's source text, `/^[a-z]+$/` verbatim — never evaluated, only quoted. */
function regexArg(args: readonly ts.Expression[]): string | undefined {
  const [first] = args;
  return first && ts.isRegularExpressionLiteral(first) ? first.text : undefined;
}

function stringArrayArg(args: readonly ts.Expression[]): readonly string[] | undefined {
  const [first] = args;
  if (!first || !ts.isArrayLiteralExpression(first)) return undefined;
  const values = first.elements.filter(ts.isStringLiteralLike).map((e) => e.text);
  return values.length > 0 ? values : undefined;
}

/** One `.method(args)` link in a validation chain, outermost call first when walked from the top. */
interface ChainCall {
  readonly name: string;
  readonly args: readonly ts.Expression[];
}

/**
 * Walks `z.string().min(3).max(50).optional()` from the outside in, returning
 * the base type (`string`) and every method called on it, in the order they
 * were written. `null` when `expression` is not a `<namespace>.<method>(...)`
 * chain at all — an inline value, a spread, a reference this cannot follow.
 */
function walkChain(
  expression: ts.Expression,
  namespace: string,
): { base: string; baseArgs: readonly ts.Expression[]; calls: readonly ChainCall[] } | null {
  const calls: ChainCall[] = [];
  let current = expression;
  while (ts.isCallExpression(current) && ts.isPropertyAccessExpression(current.expression)) {
    const callee = current.expression;
    if (ts.isIdentifier(callee.expression) && callee.expression.text === namespace) {
      return { base: callee.name.text, baseArgs: [...current.arguments], calls: calls.reverse() };
    }
    calls.push({ name: callee.name.text, args: [...current.arguments] });
    current = callee.expression;
  }
  return null;
}

/** `zod` chain method names -> a `FieldRule` for the given base type, or nothing if not recognised. */
function zodRule(base: string, call: ChainCall): FieldRule | null {
  if (base === 'string') {
    if (call.name === 'min') return withNumeric('minLength', call.args);
    if (call.name === 'max') return withNumeric('maxLength', call.args);
    if (call.name === 'email') return { kind: 'email', line: 0 };
    if (call.name === 'regex') return withPattern(call.args);
  }
  if (base === 'number') {
    if (call.name === 'min') return withNumeric('min', call.args);
    if (call.name === 'max') return withNumeric('max', call.args);
  }
  return null;
}

/** `yup` chain method names -> a `FieldRule`. Same shape, different vocabulary from zod's. */
function yupRule(base: string, call: ChainCall): FieldRule | null {
  if (base === 'string') {
    if (call.name === 'min') return withNumeric('minLength', call.args);
    if (call.name === 'max') return withNumeric('maxLength', call.args);
    if (call.name === 'email') return { kind: 'email', line: 0 };
    if (call.name === 'matches') return withPattern(call.args);
  }
  if (base === 'number') {
    if (call.name === 'min') return withNumeric('min', call.args);
    if (call.name === 'max') return withNumeric('max', call.args);
  }
  return null;
}

function withNumeric(kind: 'min' | 'max' | 'minLength' | 'maxLength', args: readonly ts.Expression[]): FieldRule | null {
  const value = numericArg(args);
  return value === undefined ? null : { kind, value, line: 0 };
}

function withPattern(args: readonly ts.Expression[]): FieldRule | null {
  const value = regexArg(args);
  return value === undefined ? null : { kind: 'pattern', value, line: 0 };
}

/**
 * Every rule one schema property declares — required-ness, plus whatever
 * `zodRule`/`yupRule` recognise in its chain, plus an enum when the base call
 * itself is one (`z.enum([...])`, `yup.string().oneOf([...])`).
 */
function rulesForProperty(
  expression: ts.Expression,
  library: 'zod' | 'yup',
  namespace: string,
  line: number,
): FieldRule[] {
  const chain = walkChain(expression, namespace);
  if (!chain) return [];
  const { base, baseArgs, calls } = chain;
  const out: FieldRule[] = [];

  const names = calls.map((c) => c.name);
  const required = library === 'zod' ? !names.includes('optional') && !names.includes('nullable') : names.includes('required');
  if (required) out.push({ kind: 'required', line });

  // zod declares an enum as the base call itself — `z.enum([...])` — while yup
  // chains `.oneOf([...])` onto a base type, so the two libraries look in
  // different places for the same fact.
  const oneOfCall = calls.find((c) => c.name === 'oneOf');
  const enumValues = library === 'zod' && base === 'enum' ? stringArrayArg(baseArgs) : oneOfCall ? stringArrayArg(oneOfCall.args) : undefined;
  if (enumValues) out.push({ kind: 'enum', values: enumValues, line });

  const rule = library === 'zod' ? zodRule : yupRule;
  for (const call of calls) {
    const found = rule(base, call);
    if (found) out.push({ ...found, line });
  }
  return out;
}

/**
 * The `const` an identifier names, looked up through the blocks around it.
 *
 * Shared with `pages.ts`'s own title-key resolution, which follows a variable
 * the same way for a different reason; kept here rather than there so this
 * module has no dependency on it (`pages.ts` depends on this one, not the
 * other way round).
 */
export function localDeclaration(identifier: ts.Identifier): ts.VariableDeclaration | null {
  for (let scope: ts.Node | undefined = identifier.parent; scope; scope = scope.parent) {
    if (!ts.isBlock(scope) && !ts.isSourceFile(scope)) continue;
    for (const statement of scope.statements) {
      if (!ts.isVariableStatement(statement)) continue;
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name) && declaration.name.text === identifier.text) return declaration;
      }
    }
  }
  return null;
}

/** `resolver: zodResolver(schema)` / `yupResolver(schema)` -> which library, and the schema expression. */
function resolverSchema(resolverExpression: ts.Expression): { library: 'zod' | 'yup'; schema: ts.Expression } | null {
  if (!ts.isCallExpression(resolverExpression) || !ts.isIdentifier(resolverExpression.expression)) return null;
  const name = resolverExpression.expression.text;
  const [schema] = resolverExpression.arguments;
  if (!schema) return null;
  if (name === 'zodResolver') return { library: 'zod', schema };
  if (name === 'yupResolver') return { library: 'yup', schema };
  return null;
}

/** The object literal a schema resolves to: `z.object({...})`, or yup's `.object().shape({...})`. */
function shapeOf(expression: ts.Expression): ts.ObjectLiteralExpression | null {
  let current = expression;
  while (ts.isCallExpression(current)) {
    const [arg] = current.arguments;
    if (
      ts.isPropertyAccessExpression(current.expression) &&
      (current.expression.name.text === 'object' || current.expression.name.text === 'shape') &&
      arg &&
      ts.isObjectLiteralExpression(arg)
    ) {
      return arg;
    }
    // `yup.object().shape({...})`: descend into the receiver and keep looking.
    if (ts.isPropertyAccessExpression(current.expression)) {
      current = current.expression.expression;
      continue;
    }
    return null;
  }
  return null;
}

/**
 * Every field a zod/yup schema constrains, bound through a react-hook-form
 * `resolver`, keyed by the schema's own property name — which is the form
 * field's `name`, the same key `register('name')` and a literal `name="…"`
 * attribute both use.
 *
 * Reads the whole file for every `useForm(...)` call it contains: the schema
 * is very often declared above the component, not inside it, and `pages.ts`
 * already parses the file once per page, so a second read here costs nothing
 * a fresh `ts.createSourceFile` would not have cost anyway.
 */
export function schemaFieldRules(source: ts.SourceFile): Map<string, FieldRule[]> {
  const out = new Map<string, FieldRule[]>();

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'useForm') {
      const [options] = node.arguments;
      if (options && ts.isObjectLiteralExpression(options)) {
        const resolverProperty = options.properties.find(
          (p): p is ts.PropertyAssignment => ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === 'resolver',
        );
        const resolved = resolverProperty && resolverSchema(resolverProperty.initializer);
        if (resolved) {
          let schemaExpression = resolved.schema;
          if (ts.isIdentifier(schemaExpression)) {
            const declaration = localDeclaration(schemaExpression);
            if (declaration?.initializer) schemaExpression = declaration.initializer;
          }
          const shape = shapeOf(schemaExpression);
          const namespace = resolved.library === 'zod' ? 'z' : 'yup';
          if (shape) {
            for (const property of shape.properties) {
              if (!ts.isPropertyAssignment(property)) continue;
              const key = ts.isIdentifier(property.name) || ts.isStringLiteralLike(property.name) ? property.name.text : null;
              if (!key) continue;
              const { line } = source.getLineAndCharacterOfPosition(property.getStart(source));
              const rules = rulesForProperty(property.initializer, resolved.library, namespace, line + 1);
              if (rules.length > 0) out.set(key, [...(out.get(key) ?? []), ...rules]);
            }
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return out;
}

// -------------------------------------------------------------- HTML attributes --

function boolAttr(attributes: ts.JsxAttributes, name: string): boolean {
  for (const attribute of attributes.properties) {
    if (!ts.isJsxAttribute(attribute) || attribute.name.getText() !== name) continue;
    if (!attribute.initializer) return true; // bare `required`
    if (ts.isJsxExpression(attribute.initializer) && attribute.initializer.expression?.kind === ts.SyntaxKind.TrueKeyword) return true;
  }
  return false;
}

function valueOf(attributes: ts.JsxAttributes, name: string): ts.Expression | null {
  for (const attribute of attributes.properties) {
    if (!ts.isJsxAttribute(attribute) || attribute.name.getText() !== name) continue;
    const value = attribute.initializer;
    if (!value) return null;
    if (ts.isStringLiteral(value)) return value;
    if (ts.isJsxExpression(value) && value.expression) return value.expression;
  }
  return null;
}

function numAttr(attributes: ts.JsxAttributes, name: string): number | undefined {
  const value = valueOf(attributes, name);
  if (!value) return undefined;
  if (ts.isNumericLiteral(value)) return Number(value.text);
  if (ts.isStringLiteralLike(value) && /^-?\d+(\.\d+)?$/.test(value.text)) return Number(value.text);
  return undefined;
}

function strAttr(attributes: ts.JsxAttributes, name: string): string | undefined {
  const value = valueOf(attributes, name);
  return value && ts.isStringLiteralLike(value) ? value.text : undefined;
}

/**
 * The constraints a control declares on itself, whatever a validation schema
 * separately says — a page can, and often does, have both, and a visitor is
 * told whichever fires: nothing here dedupes against `schemaFieldRules`, that
 * happens once in `pages.ts` where the two lists are combined.
 */
export function htmlFieldRules(attributes: ts.JsxAttributes, line: number): FieldRule[] {
  const out: FieldRule[] = [];
  if (boolAttr(attributes, 'required')) out.push({ kind: 'required', line });
  const min = numAttr(attributes, 'min');
  if (min !== undefined) out.push({ kind: 'min', value: min, line });
  const max = numAttr(attributes, 'max');
  if (max !== undefined) out.push({ kind: 'max', value: max, line });
  const minLength = numAttr(attributes, 'minLength');
  if (minLength !== undefined) out.push({ kind: 'minLength', value: minLength, line });
  const maxLength = numAttr(attributes, 'maxLength');
  if (maxLength !== undefined) out.push({ kind: 'maxLength', value: maxLength, line });
  const pattern = strAttr(attributes, 'pattern');
  if (pattern !== undefined) out.push({ kind: 'pattern', value: pattern, line });
  return out;
}

/**
 * `{...register('amount')}` — react-hook-form's own way of naming a field,
 * which never appears as a literal `name="amount"` attribute at all. Reading
 * only the plain attribute would silently lose the name (and therefore every
 * rule keyed by it) on any form built this way, which is most of them.
 */
export function registerNameOf(attributes: ts.JsxAttributes): string | null {
  for (const attribute of attributes.properties) {
    if (!ts.isJsxSpreadAttribute(attribute)) continue;
    const expression = attribute.expression;
    if (
      ts.isCallExpression(expression) &&
      ts.isIdentifier(expression.expression) &&
      expression.expression.text === 'register' &&
      expression.arguments[0] &&
      ts.isStringLiteralLike(expression.arguments[0])
    ) {
      return expression.arguments[0].text;
    }
  }
  return null;
}

/** Same kind + value/values collapse into one: a schema and an attribute agreeing say nothing twice. */
export function dedupeFieldRules(rules: readonly FieldRule[]): FieldRule[] {
  const seen = new Set<string>();
  const out: FieldRule[] = [];
  for (const rule of rules) {
    const key = `${rule.kind}:${rule.value ?? ''}:${(rule.values ?? []).join(',')}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(rule);
  }
  return out;
}

// --------------------------------------------------------------- phrasing --

/**
 * A rule, in words, in the application's own language — the same "template,
 * not a model" move `steps.ts` makes for guided steps (Rule 9): fixed text per
 * rule kind, filled in with the field's own label, never generated per turn.
 */
function phrase(rule: FieldRule, label: string, language: string): string {
  const pt = (language.split('-')[0] ?? '').toLowerCase() === 'pt';
  switch (rule.kind) {
    case 'required':
      return pt ? `${label} é obrigatório.` : `${label} is required.`;
    case 'min':
      return pt ? `${label} tem de ser pelo menos ${rule.value}.` : `${label} must be at least ${rule.value}.`;
    case 'max':
      return pt ? `${label} tem de ser no máximo ${rule.value}.` : `${label} must be at most ${rule.value}.`;
    case 'minLength':
      return pt
        ? `${label} tem de ter pelo menos ${rule.value} caracteres.`
        : `${label} must be at least ${rule.value} characters.`;
    case 'maxLength':
      return pt
        ? `${label} tem de ter no máximo ${rule.value} caracteres.`
        : `${label} must be at most ${rule.value} characters.`;
    case 'pattern':
      // The regex itself is never shown — it is source syntax, not something a
      // visitor asked to read, and quoting it verbatim would be exactly the
      // "shows the wrong state" failure WP-42 found in a different reader.
      return pt ? `${label} tem de seguir um formato específico.` : `${label} must match a specific format.`;
    case 'email':
      return pt ? `${label} tem de ser um email válido.` : `${label} must be a valid email address.`;
    case 'enum':
      return pt
        ? `${label} tem de ser um destes: ${(rule.values ?? []).join(', ')}.`
        : `${label} must be one of: ${(rule.values ?? []).join(', ')}.`;
  }
}

/** One phrased rule, still missing the file — `generate.ts` attaches that, the same way it does for `explanationSource`. */
export interface PhrasedRule {
  readonly field: string;
  readonly statement: string;
  readonly line: number;
}

/**
 * Every stateable rule a page's fields carry, in source order.
 *
 * A field with no name (`name`/`id` both null) or no resolvable label is
 * dropped — the same principle `stepsFor` applies, for the same reason: a rule
 * that cannot say which field it means, or how to find it again, is not a
 * fact, it is a guess wearing the read tier's clothing.
 */
export function rulesFor(fields: readonly FormField[], dictionary: Translations | undefined, language: string): PhrasedRule[] {
  const out: PhrasedRule[] = [];
  for (const field of fields) {
    if (field.rules.length === 0) continue;
    const key = field.name ?? field.id;
    const label = visibleLabel(field, dictionary);
    if (!key || !label) continue;
    for (const rule of field.rules) out.push({ field: key, statement: phrase(rule, label, language), line: rule.line });
  }
  return out;
}

/**
 * Spread-ready: `{ rules }` when there are any, nothing otherwise — the same
 * shape `stepsEntry` returns, for the same reason.
 *
 * `source` is built here rather than in `rulesFor` because it needs the
 * application's root and the page's own file, which `generate.ts` already
 * has in hand for `explanationSource`; this is that same computation, once
 * per rule instead of once per capability.
 */
export function rulesEntry(
  fields: readonly FormField[],
  dictionary: Translations | undefined,
  language: string,
  appRoot: string,
  pageFile: string,
): { readonly rules?: readonly ExtractedRule[] } {
  const phrased = rulesFor(fields, dictionary, language);
  if (phrased.length === 0) return {};
  const file = relative(appRoot, pageFile).replace(/\\/g, '/');
  return {
    rules: phrased.map((rule) => ({
      field: rule.field,
      statement: rule.statement,
      tier: 'read' as const,
      source: `${file}:${rule.line}`,
    })),
  };
}
