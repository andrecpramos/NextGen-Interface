import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import ts from 'typescript';

import type { DiscoveredRoute, GeneratorConfig, RoleName } from './types.ts';

/**
 * Route and role discovery, from the application's own route table.
 *
 * The WP-30 spike did this with regular expressions and said so: "good enough
 * for a spike; a real parser would use the TS AST". This is that parser. The
 * difference is not tidiness — a regex cannot tell a route registered inside
 * `import.meta.env.DEV ? [...] : []` from one registered unconditionally, and
 * cannot follow `roles: ROUTE_ROLES.x` to a named list that is itself an alias
 * for another one. Both distinctions changed the output.
 *
 * **Every unresolvable guard drops its route.** Rule 17's kill criterion is
 * zero role mis-assignments, so there is no "probably open to everyone" branch
 * anywhere below: an expression this file cannot evaluate yields `null`, and a
 * `null` role set is a skip with a reason, never a default.
 */

// ------------------------------------------------------------------- parsing --

function parse(file: string): ts.SourceFile {
  return ts.createSourceFile(
    file,
    readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    /\.[jt]sx$/.test(file) ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

/** Strip `as const`, `satisfies`, parentheses and non-null assertions. */
function unwrap(node: ts.Expression): ts.Expression {
  let current = node;
  for (;;) {
    if (ts.isAsExpression(current) || ts.isSatisfiesExpression(current) || ts.isNonNullExpression(current)) {
      current = current.expression;
    } else if (ts.isParenthesizedExpression(current)) {
      current = current.expression;
    } else {
      return current;
    }
  }
}

/** Every `const x = <expr>` at module level, by name. */
function moduleConstants(source: ts.SourceFile): Map<string, ts.Expression> {
  const out = new Map<string, ts.Expression>();
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && declaration.initializer) {
        out.set(declaration.name.text, declaration.initializer);
      }
    }
  }
  return out;
}

/**
 * The comment a developer left above a node, verbatim.
 *
 * Untrusted text (Rule 15) — it is read for markers and quoted back in the
 * skipped report, never interpolated into a prompt without isolation.
 */
function leadingComment(source: ts.SourceFile, node: ts.Node): string | null {
  const text = source.getFullText();
  const ranges = ts.getLeadingCommentRanges(text, node.getFullStart());
  if (!ranges || ranges.length === 0) return null;
  const comment = ranges
    .map((r) => text.slice(r.pos, r.end))
    .join('\n')
    .replace(/^\s*(\/\*+|\*+\/|\/\/|\*)/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
  return comment.length > 0 ? comment : null;
}

// ------------------------------------------------------- evaluating role sets --

interface RoleEnv {
  readonly constants: Map<string, ts.Expression>;
  /** Helpers proven to be `(...xs) => [...xs]`, and therefore safe to inline. */
  readonly identityHelpers: ReadonlySet<string>;
}

/**
 * Is this arrow function exactly `(...xs) => [...xs]`?
 *
 * `readRoles` in the pilot target is such a helper. Treating *any* call as
 * "its string arguments are the roles" would misread something like
 * `except(APP_ROLES, 'PLAYER')` as granting the one role it removes — a role
 * mis-assignment, which is the one error this generator may not make. So the
 * helper's body is checked rather than its name.
 */
function isIdentitySpread(expression: ts.Expression): boolean {
  const fn = unwrap(expression);
  if (!ts.isArrowFunction(fn)) return false;
  const [parameter] = fn.parameters;
  if (!parameter?.dotDotDotToken || !ts.isIdentifier(parameter.name)) return false;
  const body = ts.isBlock(fn.body)
    ? (fn.body.statements.length === 1 && ts.isReturnStatement(fn.body.statements[0]!)
        ? fn.body.statements[0].expression
        : undefined)
    : fn.body;
  if (!body || !ts.isArrayLiteralExpression(unwrap(body))) return false;
  const array = unwrap(body) as ts.ArrayLiteralExpression;
  if (array.elements.length !== 1) return false;
  const [element] = array.elements;
  return (
    !!element &&
    ts.isSpreadElement(element) &&
    ts.isIdentifier(element.expression) &&
    element.expression.text === parameter.name.text
  );
}

function identityHelpers(constants: Map<string, ts.Expression>): Set<string> {
  const out = new Set<string>();
  for (const [name, expression] of constants) {
    if (isIdentitySpread(expression)) out.add(name);
  }
  return out;
}

/**
 * Evaluate an expression to a list of role names, or `null` if it cannot be
 * evaluated with certainty.
 *
 * `null` is not an error — it is the safe answer, and the caller turns it into
 * a recorded skip. The spike behaved the same way and WP-30's verdict called
 * that disposition out as the right one.
 */
function evaluateRoles(
  expression: ts.Expression,
  env: RoleEnv,
  seen: ReadonlySet<string> = new Set(),
): string[] | null {
  const node = unwrap(expression);

  if (ts.isStringLiteralLike(node)) return [node.text];

  if (ts.isArrayLiteralExpression(node)) {
    const out: string[] = [];
    for (const element of node.elements) {
      if (ts.isSpreadElement(element)) {
        const nested = evaluateRoles(element.expression, env, seen);
        if (nested === null) return null;
        out.push(...nested);
        continue;
      }
      const value = evaluateRoles(element, env, seen);
      if (value === null) return null;
      out.push(...value);
    }
    return out;
  }

  if (ts.isIdentifier(node)) {
    if (seen.has(node.text)) return null; // a cycle proves nothing
    const target = env.constants.get(node.text);
    if (!target) return null;
    return evaluateRoles(target, env, new Set([...seen, node.text]));
  }

  if (ts.isPropertyAccessExpression(node)) {
    const object = evaluateObject(node.expression, env, seen);
    const value = object?.get(node.name.text);
    return value ? evaluateRoles(value, env, new Set([...seen, node.name.text])) : null;
  }

  if (ts.isCallExpression(node)) {
    if (!ts.isIdentifier(node.expression) || !env.identityHelpers.has(node.expression.text)) return null;
    const out: string[] = [];
    for (const argument of node.arguments) {
      const value = evaluateRoles(argument, env, seen);
      if (value === null) return null;
      out.push(...value);
    }
    return out;
  }

  return null;
}

function evaluateObject(
  expression: ts.Expression,
  env: RoleEnv,
  seen: ReadonlySet<string>,
): Map<string, ts.Expression> | null {
  const node = unwrap(expression);
  if (ts.isObjectLiteralExpression(node)) return objectProperties(node);
  if (ts.isIdentifier(node)) {
    if (seen.has(node.text)) return null;
    const target = env.constants.get(node.text);
    return target ? evaluateObject(target, env, new Set([...seen, node.text])) : null;
  }
  return null;
}

function objectProperties(node: ts.ObjectLiteralExpression): Map<string, ts.Expression> {
  const out = new Map<string, ts.Expression>();
  for (const property of node.properties) {
    if (!ts.isPropertyAssignment(property)) continue;
    const key = ts.isIdentifier(property.name) || ts.isStringLiteralLike(property.name)
      ? property.name.text
      : null;
    if (key !== null) out.set(key, property.initializer);
  }
  return out;
}

export interface RoleModel {
  /** Every role the application declares. */
  readonly allRoles: readonly RoleName[];
  /** Named role set -> roles, or `null` where the expression was unreadable. */
  readonly namedSets: ReadonlyMap<string, readonly RoleName[] | null>;
}

/**
 * An application with no roles at all has one audience, not none.
 *
 * A three-page marketing site has no permissions module to read, and Rule 17
 * still has to mean something there: it means every visitor gets the same
 * registry, and that registry is named for the single audience it serves.
 */
export const SINGLE_AUDIENCE = 'PUBLIC';

export function readRoleModel(config: GeneratorConfig): RoleModel {
  const permissions = config.permissionsFile ? resolve(config.appRoot, config.permissionsFile) : null;
  if (!permissions || !existsSync(permissions)) {
    return { allRoles: [SINGLE_AUDIENCE], namedSets: new Map() };
  }
  const source = parse(permissions);
  const constants = moduleConstants(source);
  const env: RoleEnv = { constants, identityHelpers: identityHelpers(constants) };

  const all = constants.get(config.allRolesExport);
  const allRoles = all ? evaluateRoles(all, env) : null;

  const namedSets = new Map<string, readonly RoleName[] | null>();
  const roleSets = constants.get(config.roleSetExport);
  const properties = roleSets ? evaluateObject(roleSets, env, new Set()) : null;
  if (properties) {
    for (const [key, expression] of properties) {
      namedSets.set(key, evaluateRoles(expression, env));
    }
  }

  return { allRoles: allRoles && allRoles.length > 0 ? allRoles : [SINGLE_AUDIENCE], namedSets };
}

// --------------------------------------------------------------- route tables --

/**
 * Component name -> the file it comes from.
 *
 * Both spellings: `const X = lazy(() => import('./x'))`, which a code-split app
 * uses for every page, and a plain `import X from './x'`, which a small one
 * uses for all of them.
 */
function componentSources(source: ts.SourceFile, sourceFile: string): Map<string, string> {
  const out = new Map<string, string>();
  const record = (name: string, specifier: string | null | undefined): void => {
    if (!specifier?.startsWith('.')) return;
    const file = resolveComponentFile(resolve(dirname(sourceFile), specifier));
    if (file) out.set(name, file);
  };

  for (const [name, expression] of moduleConstants(source)) {
    record(name, importSpecifierOf(expression));
  }

  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteralLike(statement.moduleSpecifier)) continue;
    const specifier = statement.moduleSpecifier.text;
    const bindings = statement.importClause;
    if (bindings?.name) record(bindings.name.text, specifier);
    if (bindings?.namedBindings && ts.isNamedImports(bindings.namedBindings)) {
      for (const element of bindings.namedBindings.elements) record(element.name.text, specifier);
    }
  }

  return out;
}

function importSpecifierOf(expression: ts.Expression): string | null {
  let found: string | null = null;
  const visit = (node: ts.Node): void => {
    if (found !== null) return;
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const [argument] = node.arguments;
      if (argument && ts.isStringLiteralLike(argument)) found = argument.text;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(expression);
  return found;
}

/** `features/<name>/...` from a resolved component path. */
function featureOf(componentFile: string | null): string | null {
  if (!componentFile) return null;
  const match = /[\\/]features[\\/]([^\\/]+)[\\/]/.exec(componentFile);
  return match?.[1] ?? null;
}

function joinPath(parent: string, child: string): string {
  const cleaned = child.replace(/^\/+/, '');
  const base = parent.replace(/\/+$/, '');
  return cleaned.length === 0 ? base || '/' : `${base}/${cleaned}`;
}

/**
 * Is this route entry registered only in a development build?
 *
 * The pilot target spreads such routes in behind `import.meta.env.DEV ? [...]
 * : []`. That is a structural fact, visible in the AST — unlike the "this is a
 * legacy duplicate" judgement, which lives in prose and is handled elsewhere.
 */
function isDevGuarded(node: ts.Node): boolean {
  for (let current: ts.Node | undefined = node; current; current = current.parent) {
    if (ts.isConditionalExpression(current)) {
      const condition = current.condition.getText();
      if (/\bimport\.meta\.env\.(DEV|MODE)\b|process\.env\.NODE_ENV/.test(condition)) return true;
    }
  }
  return false;
}

interface RouteObject {
  readonly node: ts.Node;
  readonly properties: Map<string, ts.Expression>;
  /** Nested routes, however this dialect spells them. */
  readonly children: ts.Node | null;
}

/** `<Route path="x" element={<X />}>` — attributes read as properties. */
function jsxRouteProperties(element: ts.JsxElement | ts.JsxSelfClosingElement): Map<string, ts.Expression> {
  const opening = ts.isJsxElement(element) ? element.openingElement : element;
  const out = new Map<string, ts.Expression>();
  for (const attribute of opening.attributes.properties) {
    if (!ts.isJsxAttribute(attribute) || !ts.isIdentifier(attribute.name)) continue;
    const value = attribute.initializer;
    if (!value) continue;
    if (ts.isStringLiteral(value)) out.set(attribute.name.text, value);
    else if (ts.isJsxExpression(value) && value.expression) out.set(attribute.name.text, value.expression);
  }
  return out;
}

function isRouteElement(node: ts.Node): node is ts.JsxElement | ts.JsxSelfClosingElement {
  const tag = ts.isJsxElement(node)
    ? node.openingElement.tagName
    : ts.isJsxSelfClosingElement(node)
      ? node.tagName
      : null;
  return tag !== null && tag.getText().split('.').pop() === 'Route';
}

/**
 * Route entries, in either of React Router's two dialects.
 *
 * A route config is an array of objects; the older and still entirely current
 * JSX form is `<Route path element />` nested inside `<Routes>`. The pilot
 * target uses the first and the smoke-test app uses the second, and an adapter
 * that only read one of them would be an adapter for one application.
 */
function routeObjectsIn(node: ts.Node): RouteObject[] {
  const out: RouteObject[] = [];
  const visit = (current: ts.Node): void => {
    if (isRouteElement(current)) {
      out.push({
        node: current,
        properties: jsxRouteProperties(current),
        children: ts.isJsxElement(current) ? current : null,
      });
      return; // nested <Route>s are walked with the parent path in hand
    }
    if (ts.isObjectLiteralExpression(current)) {
      const properties = objectProperties(current);
      if (properties.has('path') || properties.has('children') || properties.has('index')) {
        out.push({ node: current, properties, children: properties.get('children') ?? null });
        return;
      }
    }
    ts.forEachChild(current, visit);
  };
  visit(node);
  return out;
}

/** Nested routes, skipping the element that owns them. */
function childRoutesOf(container: ts.Node, self: ts.Node): RouteObject[] {
  const out: RouteObject[] = [];
  if (ts.isJsxElement(container) && container === self) {
    for (const child of container.children) out.push(...routeObjectsIn(child));
    return out;
  }
  return routeObjectsIn(container);
}

/** The component name in `element: <Thing prop="x" />` or `Component: Thing`. */
function elementComponent(expression: ts.Expression | undefined): string | null {
  if (!expression) return null;
  const node = unwrap(expression);
  if (ts.isIdentifier(node)) return node.text;
  const opening = ts.isJsxElement(node)
    ? node.openingElement
    : ts.isJsxSelfClosingElement(node)
      ? node
      : null;
  if (!opening) return null;
  const tag = opening.tagName;
  return ts.isIdentifier(tag) ? tag.text : tag.getText();
}

function collect(
  entries: readonly RouteObject[],
  parentPath: string,
  context: {
    source: ts.SourceFile;
    components: Map<string, string>;
    roles: RoleModel;
    out: DiscoveredRoute[];
  },
): void {
  for (const { node, properties, children } of entries) {
    const pathExpression = properties.get('path');
    const pathNode = pathExpression ? unwrap(pathExpression) : undefined;
    const segment = pathNode && ts.isStringLiteralLike(pathNode) ? pathNode.text : '';
    const path = joinPath(parentPath, segment);

    if (children) {
      collect(childRoutesOf(children, node), path, context);
    }

    // A catch-all is the app's own 404, not a place anyone asks to go.
    if (segment === '*' || segment.includes('*')) continue;

    // A layout wrapper (children but no element of its own) is not a destination.
    if (!properties.has('element') && !properties.has('Component')) continue;
    if (!pathExpression && !properties.has('index')) continue;

    const component = elementComponent(properties.get('element') ?? properties.get('Component'));
    const componentFile = component ? (context.components.get(component) ?? null) : null;

    const rolesExpression = properties.get('roles');
    let roles: readonly RoleName[] | null;
    let roleKey: string | null = null;
    if (!rolesExpression) {
      // No guard at all: reachable by every authenticated role. This is the one
      // place a missing guard means "everyone", and it is a fact about the route
      // table's own contract, not an inference about an unreadable expression.
      roles = context.roles.allRoles;
    } else {
      const accessed = unwrap(rolesExpression);
      roleKey = ts.isPropertyAccessExpression(accessed) ? accessed.name.text : null;
      const named = roleKey !== null ? context.roles.namedSets.get(roleKey) : undefined;
      roles = named !== undefined ? named : evaluateRoles(rolesExpression, {
        constants: new Map(),
        identityHelpers: new Set(),
      });
    }

    context.out.push({
      path,
      component,
      componentFile,
      feature: featureOf(componentFile),
      roles: roles && roles.length > 0 ? [...new Set(roles)] : roles === null ? null : [],
      roleKey,
      devOnly: isDevGuarded(node),
      comment: leadingComment(context.source, node),
    });
  }
}

/**
 * Every route the application registers, with the roles that may reach it.
 *
 * Reads only. Nothing under `config.appRoot` is opened for writing anywhere in
 * this package — Rule 16, and `emit.test.ts` asserts it.
 */
export function discoverRoutes(config: GeneratorConfig): {
  routes: readonly DiscoveredRoute[];
  roles: RoleModel;
} {
  const routesFile = resolve(config.appRoot, config.routesFile);
  const source = parse(routesFile);
  const roles = readRoleModel(config);
  const out: DiscoveredRoute[] = [];

  collect(routeObjectsIn(source), '', {
    source,
    components: componentSources(source, routesFile),
    roles,
    out,
  });

  return { routes: out, roles };
}

/** Resolve a component import to a file on disk, trying the usual extensions. */
export function resolveComponentFile(base: string | null): string | null {
  if (!base) return null;
  const extensions = ['.tsx', '.ts', '.jsx', '.js'];
  const candidates = [
    ...extensions.map((extension) => `${base}${extension}`),
    ...extensions.map((extension) => join(base, `index${extension}`)),
  ];
  for (const candidate of candidates) {
    try {
      readFileSync(candidate, 'utf8');
      return candidate;
    } catch {
      continue;
    }
  }
  return null;
}
