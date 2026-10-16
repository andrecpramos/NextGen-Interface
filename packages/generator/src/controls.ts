import ts from 'typescript';

import { aboutWho, INERT_CALL, INERT_HANDLER, isChrome } from './control-words.ts';
import type { RoleScope } from './discover.ts';
import {
  attributesOf,
  componentFile,
  importedComponents,
  literalAttr,
  localComponent,
  onlyShows,
  parse,
  SHARED_UI,
  tagNameOf,
  translationCalls,
  type ImportResolver,
} from './pages.ts';

/**
 * What a screen lets a visitor do, and who may (ADR-042).
 *
 * The first production integration found the assistant could name every screen of a 130-screen app and
 * say what almost none of them were *for*: "Academia · Tarefas — part of the academy area, at
 * /academy/tasks". A coach asking it to cancel tomorrow's session, or to tell the parents, was matched
 * against titles and section names, and the screen that does it shared no word with the request. The
 * words were in the app all along — in its controls: "Cancelar sessão", "Enviar comunicado". Most of them
 * are not in the page's own file but in what it renders: a toolbar, a sheet, a row's menu.
 *
 * So the controls are read from the page and from the application's own components it renders, two
 * levels down, never a design system's (`SHARED_UI`). A control is:
 *
 * - an **opener** when its only job is to show something (ADR-031, `onlyShows`, a `…Trigger`);
 * - an **action** when it does something: its handler calls anything other than state setters, navigation
 *   and event plumbing, it submits a form, or it asks to confirm something (`AlertDialogTrigger`);
 * - nothing at all when it moves, switches a view, closes, or is named by a lone word every dialog has
 *   (`isChrome`).
 *
 * ## Who may use it
 *
 * Real applications render most of what changes data only for some people: `{canWrite && <Button>…}`,
 * where `canWrite = hasCapability(roles, ...CAPABILITY_ROLES.communicationManage)`. A registry is its
 * role's entitlement (Rule 17), so a control is listed only for the roles every condition above it lets
 * through. Each condition is read against the permissions module discovery already reads for routes
 * (`RoleScope`): a role list it exports, a role named as a literal (`hasRole('MEDICAL')`, `role ===
 * 'COACH'`), and `&&`, `||`, `!`, ternaries, early returns and local constants and helpers built from
 * them. A condition about anything else — a tab, a loading state, a row's status — says nothing about who,
 * and narrows nothing.
 *
 * **A condition about who that cannot be read drops the control** — a flag from a hook (`const { canDelete }
 * = usePermissions()`), a `<Can>` whose rule is not a role list. The safe reading of a guard nobody can
 * read is the one discovery already holds: leave it out, and say so (`guarded`).
 *
 * Labels are the page's own text or the key of a translation call, exactly as openers are; a label that
 * is computed any other way is not guessed. Everything returned is untrusted adopter text (Rule 15).
 */

export interface Control {
  readonly label: string | null;
  readonly labelKey: string | null;
  /** The roles that may use it; absent when nothing above it says who. */
  readonly roles?: readonly string[];
}

export interface ControlReading {
  /** Controls that do something (ADR-042). */
  readonly actions: readonly Control[];
  /** Controls whose only job is to show something (ADR-031). */
  readonly openers: readonly Control[];
  /** Controls left out because a condition about who may use them could not be read — for the review, never a registry. */
  readonly guarded: readonly Control[];
}

const EMPTY: ControlReading = { actions: [], openers: [], guarded: [] };

/** How far below the page a control is still the page's: the page, what it renders, and what that renders. */
const DEPTH = 2;
/** Files read per screen, at most: a page that renders the whole app is not describing itself. */
const MAX_FILES = 40;
const MAX_CONTROLS = 20;

/** The attributes a control is pressed through, across React, Radix menus and React Aria. */
const HANDLERS = new Set(['onClick', 'onSelect', 'onPress', 'onAction']);

/** A wrapper element that renders its children only for some people. */
const GUARD_TAG = /^(Can|Cannot|Authori[sz]\w*|Require\w*|Protected\w*|IfAllowed|Restricted\w*|Permission\w*|\w*Guard|\w*Gate)$/;
/** An attribute that says who may see what is inside the element carrying it. */
const GUARD_ATTR = /^(allowedRoles|roles|role|requiredRoles?|anyOfRoles|permission|permissions|perform|can|ability|policy)$/;
/** An attribute on the control itself that, under such a condition, keeps some people from using it. */
const DISABLING_ATTR = new Set(['disabled', 'hidden', 'aria-disabled', 'aria-hidden']);

// What counts as chrome, as an inert call, and as a condition about who: shared with the markup reader.
export { isChrome };

function calleeName(call: ts.CallExpression): string | null {
  const callee = call.expression;
  if (ts.isIdentifier(callee)) return callee.text;
  if (ts.isPropertyAccessExpression(callee)) return callee.name.text;
  return null;
}

/** Does pressing this do something a visitor would name — anything but showing, moving, selecting? */
function doesSomething(handler: ts.Expression): boolean {
  while (ts.isParenthesizedExpression(handler)) handler = handler.expression;
  if (ts.isIdentifier(handler)) return !INERT_HANDLER.test(handler.text);
  if (ts.isPropertyAccessExpression(handler)) return !INERT_HANDLER.test(handler.name.text);
  if (ts.isCallExpression(handler)) {
    const name = calleeName(handler);
    return name !== null && !INERT_HANDLER.test(name);
  }
  if (!ts.isArrowFunction(handler) && !ts.isFunctionExpression(handler)) return false;
  let acts = false;
  const visit = (node: ts.Node): void => {
    if (acts) return;
    if (ts.isCallExpression(node)) {
      const name = calleeName(node);
      if (name !== null && !INERT_CALL.test(name)) acts = true;
    }
    ts.forEachChild(node, visit);
  };
  visit(handler.body);
  return acts;
}

type KeyOf = ReturnType<typeof translationCalls>['keyOf'];

/** A flag that is only true while a control is working: `pending`, `isSubmitting`, `mutation.isPending`. */
const BUSY = /^(is)?(pending|loading|submitting|saving|sending|busy|processing|fetching|inProgress|running)$/i;

/**
 * The expression a control is named by when it is idle (2026-10-16, rehearsing on a Next.js app): a submit
 * button reads `{pending ? t('common.loading') : t('auth.login.submit')}`, and a label computed any other
 * way is not guessed. Only a bare busy flag, or its negation, qualifies; anything else stays computed.
 */
function idleBranch(expression: ts.Expression): ts.Expression | null {
  if (!ts.isConditionalExpression(expression)) return null;
  let condition = expression.condition;
  let negated = false;
  while (ts.isParenthesizedExpression(condition)) condition = condition.expression;
  if (ts.isPrefixUnaryExpression(condition) && condition.operator === ts.SyntaxKind.ExclamationToken) {
    negated = true;
    condition = condition.operand;
  }
  const name = ts.isIdentifier(condition) ? condition.text : ts.isPropertyAccessExpression(condition) ? condition.name.text : null;
  if (!name || !BUSY.test(name)) return null;
  return negated ? expression.whenTrue : expression.whenFalse;
}

/**
 * An expression that renders only elements, or nothing — `{pending ? <Spinner /> : <Plus />}`, `{busy &&
 * <Spinner />}` — beside a control's words: an icon, which names nothing (a public Next.js app's "New
 * post"). Any text, a call, or a variable in it is not decoration, and the label stays computed.
 */
function decorative(expression: ts.Expression): boolean {
  let node = expression;
  while (ts.isParenthesizedExpression(node)) node = node.expression;
  if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node)) return true;
  if (node.kind === ts.SyntaxKind.NullKeyword || (ts.isIdentifier(node) && node.text === 'undefined')) return true;
  if (ts.isConditionalExpression(node)) return decorative(node.whenTrue) && decorative(node.whenFalse);
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) return decorative(node.right);
  return false;
}

/** A control's name: its own text, the key of its one translation call, its child's, or its `aria-label` — never a computed one. */
function labelOf(node: ts.Node, keyOf: KeyOf): Control | null {
  if (ts.isJsxElement(node)) {
    let literal = '';
    let key: string | null = null;
    let computed = false;
    for (const child of node.children) {
      if (ts.isJsxText(child)) literal += ` ${child.text}`;
      else if (ts.isJsxExpression(child) && child.expression) {
        if (decorative(child.expression)) continue;
        const idle = idleBranch(child.expression);
        if (idle && ts.isStringLiteralLike(idle)) {
          literal += ` ${idle.text}`;
          continue;
        }
        const found = keyOf(idle ?? child.expression, true);
        if (found && key === null) key = found;
        else computed = true;
      }
    }
    const text = literal.replace(/\s+/g, ' ').trim();
    if (!computed && text && key === null && /\p{L}/u.test(text) && text.length <= 80) return { label: text, labelKey: null };
    if (!computed && key && !text) return { label: null, labelKey: key };
    if (!computed && !text && !key) {
      // `<Trigger asChild><Button>New event</Button></Trigger>`, `<Button><Icon /></Button>`: the name is the child's.
      const inner = node.children.find((c): c is ts.JsxElement => ts.isJsxElement(c));
      const named = inner ? labelOf(inner, keyOf) : null;
      if (named) return named;
    }
    if (computed) return null;
  }
  const attributes = attributesOf(node);
  const aria = attributes ? literalAttr(attributes, 'aria-label') : null;
  return aria ? { label: aria, labelKey: null } : null;
}

function isFunctionLike(node: ts.Node): node is ts.FunctionLikeDeclaration {
  return ts.isArrowFunction(node) || ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isMethodDeclaration(node);
}

// ------------------------------------------------------------------ who may use it --

/** Who a control is for: everyone who can open its screen, some roles, or no one can tell. */
type Audience = 'all' | 'unknown' | ReadonlySet<string>;

const NOBODY: ReadonlySet<string> = new Set();

function both(a: Audience, b: Audience): Audience {
  if (a === 'unknown' || b === 'unknown') return 'unknown';
  if (a === 'all') return b;
  if (b === 'all') return a;
  return new Set([...a].filter((role) => b.has(role)));
}

function either(a: Audience, b: Audience): Audience {
  if (a === 'unknown' || b === 'unknown') return 'unknown';
  if (a === 'all' || b === 'all') return 'all';
  return new Set([...a, ...b]);
}

/** What one file knows for reading its conditions: who the app's roles are and what its role lists hold. */
interface Conditions {
  readonly scope: RoleScope | null;
  readonly file: string;
  readonly source: ts.SourceFile;
}

function others(roles: ReadonlySet<string>, scope: RoleScope | null): Audience {
  return scope ? new Set(scope.allRoles.filter((role) => !roles.has(role))) : 'unknown';
}

/**
 * A role list written as `CAPABILITY_ROLES.x`, `TEAM_SCOPE_ROLES` or a spread of one, read through this
 * file's imports into whichever module declares it (`RoleScope.listAt`).
 */
function roleList(expression: ts.Expression, ctx: Conditions): readonly string[] | null {
  return ctx.scope ? ctx.scope.listAt(ctx.file, expression) : null;
}

/** A role named as a literal: `'MEDICAL'`, when the application declares that role. */
function roleLiteral(expression: ts.Expression, ctx: Conditions): string | null {
  return ts.isStringLiteralLike(expression) && ctx.scope?.allRoles.includes(expression.text) ? expression.text : null;
}

/** The nearest `const name = …` in this file before `at`, or a local function of that name. */
function declarationOf(name: string, at: ts.Node, ctx: Conditions): ts.Expression | ts.FunctionDeclaration | null {
  let found: ts.Expression | ts.FunctionDeclaration | null = null;
  const visit = (node: ts.Node): void => {
    if (node.pos > at.pos) return;
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name && node.initializer) found = node.initializer;
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) found = node;
    ts.forEachChild(node, visit);
  };
  visit(ctx.source);
  return found;
}

/** The expression a local helper returns: `(id) => canManage || …`, or a one-`return` body. */
function returned(fn: ts.Node): ts.Expression | null {
  if (!isFunctionLike(fn) || !fn.body) return null;
  if (!ts.isBlock(fn.body)) return fn.body;
  const [only] = fn.body.statements;
  return fn.body.statements.length === 1 && only && ts.isReturnStatement(only) && only.expression ? only.expression : null;
}

/** Who the condition `expression` lets through — or, `negated`, who it keeps out. */
function audienceOf(expression: ts.Expression, ctx: Conditions, negated = false, seen: ReadonlySet<string> = new Set()): Audience {
  const flip = (roles: ReadonlySet<string>): Audience => (negated ? others(roles, ctx.scope) : roles);
  let node = expression;
  while (ts.isParenthesizedExpression(node) || ts.isNonNullExpression(node) || ts.isAsExpression(node)) node = node.expression;

  if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.ExclamationToken) {
    return audienceOf(node.operand, ctx, !negated, seen);
  }
  if (node.kind === ts.SyntaxKind.TrueKeyword) return negated ? NOBODY : 'all';
  if (node.kind === ts.SyntaxKind.FalseKeyword) return negated ? 'all' : NOBODY;

  if (ts.isBinaryExpression(node)) {
    const op = node.operatorToken.kind;
    if (op === ts.SyntaxKind.AmpersandAmpersandToken || op === ts.SyntaxKind.BarBarToken || op === ts.SyntaxKind.QuestionQuestionToken) {
      const left = audienceOf(node.left, ctx, negated, seen);
      const right = audienceOf(node.right, ctx, negated, seen);
      // De Morgan: `!(a && b)` is `!a || !b`.
      return (op === ts.SyntaxKind.AmpersandAmpersandToken) !== negated ? both(left, right) : either(left, right);
    }
    const equals = op === ts.SyntaxKind.EqualsEqualsEqualsToken || op === ts.SyntaxKind.EqualsEqualsToken;
    const differs = op === ts.SyntaxKind.ExclamationEqualsEqualsToken || op === ts.SyntaxKind.ExclamationEqualsToken;
    if (equals || differs) {
      const role = roleLiteral(node.right, ctx) ?? roleLiteral(node.left, ctx);
      if (role) return differs !== negated ? others(new Set([role]), ctx.scope) : new Set([role]);
    }
  }

  if (ts.isCallExpression(node)) {
    // `hasCapability(roles, ...CAPABILITY_ROLES.x)`, `hasRole('MEDICAL')`, `roles.includes('PARENT')`: whatever the
    // function is called, the roles it is asked about are the ones it lets through.
    const named: string[] = [];
    let unreadArgument = false;
    for (const argument of node.arguments) {
      const list = roleList(argument, ctx);
      const literal = roleLiteral(argument, ctx);
      if (list) named.push(...list);
      else if (literal) named.push(literal);
      else if (ts.isSpreadElement(argument)) unreadArgument = true;
    }
    if (named.length > 0 && !unreadArgument) return flip(new Set(named));
    // A helper of this file: `canManageTarget(c.teamId)` is what `canManageTarget` returns.
    if (ts.isIdentifier(node.expression) && !seen.has(node.expression.text)) {
      const declared = declarationOf(node.expression.text, node, ctx);
      const body = declared ? returned(declared) : null;
      if (body) return audienceOf(body, ctx, negated, new Set([...seen, node.expression.text]));
    }
  }

  if (ts.isIdentifier(node) && !seen.has(node.text)) {
    const declared = declarationOf(node.text, node, ctx);
    if (declared && !ts.isFunctionDeclaration(declared) && !isFunctionLike(declared)) {
      return audienceOf(declared, ctx, negated, new Set([...seen, node.text]));
    }
  }

  // Not readable as a statement about who: unknown if it is about who at all, and nothing to narrow if not.
  return aboutWho(node.getText(ctx.source)) ? 'unknown' : 'all';
}

/** `<Can roles={['ADMIN']}>`, `<RequireRole role="COACH">`: who the wrapper lets through, if it says so readably. */
function wrapperAudience(element: ts.JsxElement, ctx: Conditions): Audience {
  const tag = tagNameOf(element) ?? '';
  let audience: Audience = GUARD_TAG.test(tag) ? 'unknown' : 'all';
  for (const attribute of element.openingElement.attributes.properties) {
    if (!ts.isJsxAttribute(attribute) || !GUARD_ATTR.test(attribute.name.getText(ctx.source))) continue;
    const value = attribute.initializer;
    const expression = value && ts.isJsxExpression(value) ? value.expression : value && ts.isStringLiteral(value) ? value : undefined;
    let said: Audience = 'unknown';
    if (expression) {
      const literal = roleLiteral(expression, ctx);
      const list = roleList(expression, ctx);
      if (literal) said = new Set([literal]);
      else if (list) said = new Set(list);
      else if (ts.isArrayLiteralExpression(expression)) {
        const roles = expression.elements.map((e) => roleLiteral(e, ctx) ?? roleList(e, ctx));
        if (roles.every((r) => r !== null)) said = new Set(roles.flatMap((r) => (typeof r === 'string' ? [r] : [...r!])));
      }
    }
    audience = audience === 'unknown' && said !== 'unknown' ? said : both(audience, said);
  }
  return audience;
}

/** Who may use the element `node`: every condition above it, in its file, about who they are. */
function audienceAt(node: ts.Node, ctx: Conditions): Audience {
  let audience: Audience = 'all';
  const own = attributesOf(node);
  for (const attribute of own?.properties ?? []) {
    if (!ts.isJsxAttribute(attribute) || !DISABLING_ATTR.has(attribute.name.getText(ctx.source))) continue;
    const value = attribute.initializer;
    // Usable by whoever the disabling condition does not hold for.
    if (value && ts.isJsxExpression(value) && value.expression) audience = both(audience, audienceOf(value.expression, ctx, true));
  }
  for (let child: ts.Node = node, parent = node.parent; parent; child = parent, parent = parent.parent) {
    if (ts.isJsxElement(parent)) {
      audience = both(audience, wrapperAudience(parent, ctx));
    } else if (ts.isConditionalExpression(parent)) {
      if (child === parent.whenTrue) audience = both(audience, audienceOf(parent.condition, ctx));
      else if (child === parent.whenFalse) audience = both(audience, audienceOf(parent.condition, ctx, true));
    } else if (ts.isBinaryExpression(parent) && child === parent.right) {
      const op = parent.operatorToken.kind;
      if (op === ts.SyntaxKind.AmpersandAmpersandToken) audience = both(audience, audienceOf(parent.left, ctx));
      else if (op === ts.SyntaxKind.BarBarToken || op === ts.SyntaxKind.QuestionQuestionToken) audience = both(audience, audienceOf(parent.left, ctx, true));
    } else if (ts.isIfStatement(parent)) {
      if (child === parent.thenStatement) audience = both(audience, audienceOf(parent.expression, ctx));
      else if (child === parent.elseStatement) audience = both(audience, audienceOf(parent.expression, ctx, true));
    } else if (ts.isBlock(parent) && parent.parent && isFunctionLike(parent.parent)) {
      // Every `if (…) return` before the statement holding the control: it is reached only when that does not hold.
      for (const statement of parent.statements) {
        if (statement === child) break;
        if (ts.isIfStatement(statement) && returns(statement.thenStatement)) audience = both(audience, audienceOf(statement.expression, ctx, true));
      }
    }
    if (audience === 'unknown') return audience;
  }
  return audience;
}

function returns(statement: ts.Statement): boolean {
  let found = false;
  const visit = (node: ts.Node): void => {
    if (ts.isReturnStatement(node)) found = true;
    else if (!isFunctionLike(node)) ts.forEachChild(node, visit);
  };
  visit(statement);
  return found;
}

/** What one control is: an opener, an action, or neither. */
function kindOf(node: ts.Node, tag: string): 'opener' | 'action' | null {
  if (/Trigger$/.test(tag)) return /^AlertDialog/.test(tag) ? 'action' : 'opener';
  const attributes = attributesOf(node);
  for (const attribute of attributes?.properties ?? []) {
    if (!ts.isJsxAttribute(attribute) || !HANDLERS.has(attribute.name.getText())) continue;
    const value = attribute.initializer;
    if (!value || !ts.isJsxExpression(value) || !value.expression) continue;
    if (onlyShows(value.expression)) return 'opener';
    if (doesSomething(value.expression)) return 'action';
  }
  if (tag === 'button' || /Button$/.test(tag)) {
    const type = attributes ? literalAttr(attributes, 'type') : null;
    if (type === 'submit') return 'action';
    // A button with no type, and no handler of its own, inside a form submits it: HTML's default.
    if (type === null && !hasHandler(attributes) && insideForm(node)) return 'action';
  }
  return null;
}

function hasHandler(attributes: ts.JsxAttributes | null): boolean {
  return (attributes?.properties ?? []).some((a) => ts.isJsxAttribute(a) && HANDLERS.has(a.name.getText()));
}

/** Under a `<form>` element in the same component. */
function insideForm(node: ts.Node): boolean {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (isFunctionLike(parent)) return false;
    if (ts.isJsxElement(parent) && tagNameOf(parent) === 'form') return true;
  }
  return false;
}

/**
 * The controls a screen renders: its page file — or, for a page declared beside its route table, the
 * component `name` in that file — and the application's own components it renders, `DEPTH` levels down.
 * `scope` is what the permissions module says (`readRoleScope`); without it, any condition about who
 * leaves its control out. Fails soft: a file that cannot be read contributes nothing.
 */
export function readControls(file: string, resolveImport: ImportResolver, name?: string, scope: RoleScope | null = null): ControlReading {
  if (!/\.(tsx|jsx|ts|js)$/.test(file)) return EMPTY;
  const actions: Control[] = [];
  const openers: Control[] = [];
  const guardedOut: Control[] = [];
  const seenFiles = new Set<string>([file]);
  const at = new Map<Control[], Map<string, number>>([[actions, new Map()], [openers, new Map()], [guardedOut, new Map()]]);

  const keep = (into: Control[], control: Control, audience: ReadonlySet<string> | 'all'): void => {
    const name = control.label ?? `key:${control.labelKey}`;
    const roles = audience === 'all' ? undefined : [...audience].sort();
    const positions = at.get(into)!;
    const earlier = positions.get(name);
    if (earlier !== undefined) {
      // The same control twice under different conditions: whoever may use either may use one of them.
      const first = into[earlier]!;
      if (first.roles) {
        into[earlier] = roles
          ? { ...first, roles: [...new Set([...first.roles, ...roles])].sort() }
          : { label: first.label, labelKey: first.labelKey };
      }
      return;
    }
    if (into.length >= MAX_CONTROLS) return;
    positions.set(name, into.length);
    into.push({ label: control.label, labelKey: control.labelKey, ...(roles ? { roles } : {}) });
  };

  const walk = (path: string, rootName: string | undefined, depth: number, inherited: Audience): void => {
    let source: ts.SourceFile;
    try {
      source = parse(path);
    } catch {
      return;
    }
    const root = rootName ? localComponent(source, rootName) : source;
    if (!root) return;
    const { keyOf } = translationCalls(source);
    const imports = importedComponents(source);
    const ctx: Conditions = { scope, file: path, source };

    const visit = (node: ts.Node): void => {
      const tag = tagNameOf(node);
      if (tag && (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node))) {
        const kind = kindOf(node, tag);
        const label = kind ? labelOf(node, keyOf) : null;
        const imported = imports.get(tag);
        const reads = imported && depth < DEPTH && seenFiles.size < MAX_FILES;
        if ((kind && label) || reads) {
          const audience = both(inherited, audienceAt(node, ctx));
          // Shown to no role at all (`hasRole('X') && !hasRole('X')`): nothing to list, nothing to report.
          const nobody = audience !== 'all' && audience !== 'unknown' && audience.size === 0;
          if (kind && label && !nobody) {
            // A condition about who that cannot be read: reported, never listed.
            if (audience === 'unknown') keep(guardedOut, label, 'all');
            else if (label.label === null || !isChrome(label.label)) keep(kind === 'action' ? actions : openers, label, audience);
          }
          if (reads && !nobody) {
            // What it renders is shown to the same people, and is read with that inherited.
            const child = componentFile(resolveImport(imported.specifier, path), imported.name, resolveImport);
            if (child && !SHARED_UI.test(child) && !seenFiles.has(child)) {
              seenFiles.add(child);
              walk(child, undefined, depth + 1, audience);
            }
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(root);
  };

  walk(file, name, 0, 'all');
  return { actions, openers, guarded: guardedOut };
}
