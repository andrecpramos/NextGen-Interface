import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import ts from 'typescript';

import { discoverNextRoutes, discoverNuxtRoutes, discoverRemixRoutes, discoverSvelteKitRoutes } from './filesystem.ts';
import { navPlacements } from './labels.ts';
import { findWorkspace, type Workspace } from './workspace.ts';

import type { DiscoveredRoute, GeneratorConfig, RoleName } from './types.ts';

/**
 * Route and role discovery, from the application's own route table.
 *
 * The first spike did this with regular expressions and said so: "good enough
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

/**
 * The names a role expression can see, and how to read what each stands for.
 *
 * A role set is read in the module that declares it: `SPORT_ROUTE_ROLES.x` in a
 * route file of a sibling package is followed through that file's import into
 * the module that declares the set, and evaluated there, with that module's own
 * constants and helpers.
 */
interface RoleEnv {
  /** Tells the same name apart in two modules, for the cycle check. */
  readonly key: string;
  /** The expression `name` stands for here, and the scope to read it in — or null. */
  lookup(name: string): { readonly expression: ts.Expression; readonly env: RoleEnv } | null;
  /** Is `name` a helper proven to be `(...xs) => [...xs]`, and therefore safe to inline? */
  isIdentityHelper(name: string): boolean;
}

/** A scope made of one file's constants, and nothing it imports. */
function constantsEnv(constants: Map<string, ts.Expression>, key = ''): RoleEnv {
  const helpers = identityHelpers(constants);
  const env: RoleEnv = {
    key,
    lookup: (name) => {
      const expression = constants.get(name);
      return expression ? { expression, env } : null;
    },
    isIdentityHelper: (name) => helpers.has(name),
  };
  return env;
}

/** No names at all: only literals can be read. */
const LITERAL_ENV: RoleEnv = constantsEnv(new Map());

/**
 * Is this function exactly `(...xs) => [...xs]`?
 *
 * `readRoles` in the fixture app is such a helper. Treating *any* call as
 * "its string arguments are the roles" would misread something like
 * `except(APP_ROLES, 'STUDENT')` as granting the one role it removes — a role
 * mis-assignment, which is the one error this generator may not make. So the
 * helper's body is checked rather than its name.
 */
function isIdentitySpread(expression: ts.Expression | ts.FunctionDeclaration): boolean {
  const fn = ts.isFunctionDeclaration(expression) ? expression : unwrap(expression);
  if (!ts.isArrowFunction(fn) && !ts.isFunctionExpression(fn) && !ts.isFunctionDeclaration(fn)) return false;
  if (!fn.body) return false;
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
 * a recorded skip. The first spike behaved the same way, and that
 * disposition was judged the right one.
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
    const key = `${env.key}#${node.text}`;
    if (seen.has(key)) return null; // a cycle proves nothing
    // `function make(roles) { return [{ …, roles }] }`: the parameter, not the module's `roles`.
    if (isShadowed(node)) return null;
    const target = env.lookup(node.text);
    if (!target) return null;
    return evaluateRoles(target.expression, target.env, new Set([...seen, key]));
  }

  if (ts.isPropertyAccessExpression(node)) {
    const object = evaluateObject(node.expression, env, seen);
    const value = object?.properties.get(node.name.text);
    if (!value || !object) return null;
    // One key per property written, so a cycle through two modules' tables — `R = { a: [...S.b] }`,
    // `S = { b: [...R.a] }` — comes back to a key already seen, and proves nothing.
    const key = `${object.env.key}@${value.pos}`;
    if (seen.has(key)) return null;
    return evaluateRoles(value, object.env, new Set([...seen, key]));
  }

  if (ts.isCallExpression(node)) {
    if (!ts.isIdentifier(node.expression) || isShadowed(node.expression) || !env.isIdentityHelper(node.expression.text)) return null;
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
): { readonly properties: Map<string, ts.Expression>; readonly env: RoleEnv } | null {
  const node = unwrap(expression);
  if (ts.isObjectLiteralExpression(node)) return { properties: objectProperties(node), env };
  if (ts.isIdentifier(node)) {
    const key = `${env.key}#${node.text}`;
    if (seen.has(key) || isShadowed(node)) return null;
    const target = env.lookup(node.text);
    return target ? evaluateObject(target.expression, target.env, new Set([...seen, key])) : null;
  }
  return null;
}

/**
 * Is this name declared between where it is written and its module — a parameter of a function it
 * sits in, or a local of a block or function around it? Then it does not read the module-level name
 * of the same spelling, which is all `lookup` can find: `const roles = [ALL]` at the top of a file
 * says nothing about `function make(roles) { return [{ …, roles }] }`.
 */
function isShadowed(identifier: ts.Identifier): boolean {
  const name = identifier.text;
  const binds = (binding: ts.BindingName): boolean =>
    ts.isIdentifier(binding)
      ? binding.text === name
      : binding.elements.some((element) => !ts.isOmittedExpression(element) && binds(element.name));
  const declares = (statement: ts.Node): boolean =>
    (ts.isVariableStatement(statement) && statement.declarationList.declarations.some((declaration) => binds(declaration.name))) ||
    ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement) || ts.isEnumDeclaration(statement)) &&
      statement.name?.text === name);
  /** A `var` anywhere in a function body belongs to the whole function. */
  const hoists = (node: ts.Node): boolean => {
    if (ts.isFunctionLike(node) || ts.isClassLike(node)) return false;
    if (ts.isVariableDeclarationList(node) && !(node.flags & ts.NodeFlags.BlockScoped) && node.declarations.some((d) => binds(d.name))) return true;
    return ts.forEachChild(node, hoists) === true;
  };
  for (let node: ts.Node | undefined = identifier.parent; node && !ts.isSourceFile(node); node = node.parent) {
    if (ts.isFunctionLike(node)) {
      if (node.parameters.some((parameter) => binds(parameter.name))) return true;
      if (ts.isFunctionExpression(node) && node.name?.text === name) return true;
      const body = (node as ts.FunctionLikeDeclaration).body;
      if (body && ts.forEachChild(body, hoists) === true) return true;
    }
    if (ts.isClassExpression(node) && node.name?.text === name) return true;
    if (ts.isBlock(node) || ts.isModuleBlock(node) || ts.isCaseClause(node) || ts.isDefaultClause(node)) {
      if (node.statements.some(declares)) return true;
    }
    if (
      (ts.isForStatement(node) || ts.isForInStatement(node) || ts.isForOfStatement(node)) &&
      node.initializer &&
      ts.isVariableDeclarationList(node.initializer) &&
      node.initializer.declarations.some((declaration) => binds(declaration.name))
    ) {
      return true;
    }
    if (ts.isCatchClause(node) && node.variableDeclaration && binds(node.variableDeclaration.name)) return true;
  }
  return false;
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
  const env = constantsEnv(constants, permissions);

  const all = constants.get(config.allRolesExport);
  const allRoles = all ? evaluateRoles(all, env) : null;

  const namedSets = new Map<string, readonly RoleName[] | null>();
  const roleSets = constants.get(config.roleSetExport);
  const object = roleSets ? evaluateObject(roleSets, env, new Set()) : null;
  if (object) {
    for (const [key, expression] of object.properties) {
      namedSets.set(key, evaluateRoles(expression, object.env));
    }
  }

  return { allRoles: allRoles && allRoles.length > 0 ? allRoles : [SINGLE_AUDIENCE], namedSets };
}

/**
 * What a page's own `hasCapability(roles, ...CAPABILITY_ROLES.trainingManage)` means (ADR-042): the role
 * list an expression names, read the way the route table's role sets are — through the page's imports and
 * re-exports, into the app's permissions module or a pack's own (`FOOTBALL_CAPABILITY_ROLES`) — and with
 * the same rule: a list that cannot be evaluated with certainty is absent, never guessed.
 */
export interface RoleScope {
  readonly allRoles: readonly RoleName[];
  /**
   * The roles `expression`, written in `file`, lists — `TEAM_SCOPE_ROLES`, `CAPABILITY_ROLES.x`, a spread
   * of either — or null when it is not a list of this application's roles that can be read.
   */
  listAt(file: string, expression: ts.Expression): readonly RoleName[] | null;
}

export function readRoleScope(config: GeneratorConfig): RoleScope {
  const { allRoles } = readRoleModel(config);
  const known = new Set(allRoles);
  const modules = createModules(readAliases(config.appRoot));
  return {
    allRoles,
    listAt(file, expression) {
      if (allRoles.length === 1 && allRoles[0] === SINGLE_AUDIENCE) return null;
      const node = ts.isSpreadElement(expression) ? expression.expression : expression;
      // A string is a role named as a literal, read by the caller; here, only a list another module holds.
      if (ts.isStringLiteralLike(node)) return null;
      const roles = evaluateRoles(node, modules.roleEnv(file));
      // A list of anything but the app's roles — locales, statuses — is not who may do something.
      return roles && roles.length > 0 && roles.every((role) => known.has(role)) ? [...new Set(roles)] : null;
    },
  };
}

// --------------------------------------------------------------- route tables --

/**
 * Component name -> the file it comes from.
 *
 * Both spellings: `const X = lazy(() => import('./x'))`, which a code-split app
 * uses for every page, and a plain `import X from './x'`, which a small one
 * uses for all of them.
 */
function componentSources(source: ts.SourceFile, sourceFile: string, aliases: Aliases): Map<string, string> {
  const out = new Map<string, string>();
  const record = (name: string, specifier: string | null | undefined): void => {
    const file = resolveSpecifierFile(specifier, sourceFile, aliases);
    if (file) out.set(name, file);
  };

  // A constant only when it loads a page and does nothing else to it: `const Users = requireAdmin(() =>
  // import('./Users'))` names no page here (see `lazyComponentProperty`, and `collect`).
  for (const [name, expression] of moduleConstants(source)) {
    if (lazyComponentProperty(expression)) record(name, importSpecifierOf(expression));
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
 * Apps commonly spread such routes in behind `import.meta.env.DEV ? [...]
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
 * JSX form is `<Route path element />` nested inside `<Routes>`. Real apps
 * use both, and an adapter
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

interface RouteSpread {
  /** `...x` in an array of routes, or a route's `children` given as anything but an array written out. */
  readonly node: ts.SpreadElement | ts.PropertyAssignment;
  /** The routes it stands for: `x`, or the `children` value. */
  readonly expression: ts.Expression;
  /** Inside a route's own `children`: there a parent's path and guard apply, and are not carried in. */
  readonly nested: boolean;
}

/**
 * `...x` inside an array that holds route objects — `[{ path: '/a', … }, ...extraRoutes]` — or inside
 * a route's `children`, which holds routes whatever else it holds: `children: [...adminRoutes]`. And a
 * route's `children` that is not an array written out at all — `children: adminRoutes`,
 * `children: extra.filter((r) => r.admin)` — which is nested routes in the same way.
 */
function routeSpreads(root: ts.Node): RouteSpread[] {
  const out: RouteSpread[] = [];
  const isRoute = (element: ts.Node): boolean => {
    if (!ts.isObjectLiteralExpression(element)) return false;
    const properties = objectProperties(element);
    return properties.has('path') || properties.has('children') || properties.has('index');
  };
  const isChildren = (array: ts.Node): boolean => {
    let holder = array.parent;
    while (holder && (ts.isParenthesizedExpression(holder) || ts.isAsExpression(holder) || ts.isSatisfiesExpression(holder))) holder = holder.parent;
    return !!holder && ts.isPropertyAssignment(holder) && keyOf(holder.name) === 'children';
  };
  /** `{ element: <Layout />, children: x }`: `children` beside another key a route has. */
  const isRouteChildren = (property: ts.PropertyAssignment): boolean =>
    keyOf(property.name) === 'children' &&
    ts.isObjectLiteralExpression(property.parent) &&
    [...objectProperties(property.parent).keys()].some((key) => key !== 'children' && ROUTE_KEYS.has(key));
  const visit = (node: ts.Node, nested: boolean): void => {
    if (ts.isArrayLiteralExpression(node) && (node.elements.some(isRoute) || isChildren(node))) {
      for (const element of node.elements) if (ts.isSpreadElement(element)) out.push({ node: element, expression: element.expression, nested });
    }
    if (ts.isPropertyAssignment(node) && isRouteChildren(node) && !ts.isArrayLiteralExpression(unwrap(node.initializer))) {
      out.push({ node, expression: node.initializer, nested: true });
    }
    const inChildren = ts.isPropertyAssignment(node) && node.name.getText() === 'children';
    ts.forEachChild(node, (child) => visit(child, nested || inChildren));
  };
  visit(root, false);
  return out;
}

type CollectContext = Parameters<typeof collect>[2];

/**
 * Route entries written out in a spread expression itself — `...(DEV ? [{ path: '/dev', … }] : [])`.
 * An object inside a callback (`.map((route) => ({ ...route, path: … }))`) is a template applied to
 * routes from elsewhere, not a route, so it does not count.
 */
function routesWrittenIn(expression: ts.Expression): RouteObject[] {
  return routeObjectsIn(expression).filter((route) => {
    for (let node = route.node.parent; node && node !== expression; node = node.parent) {
      if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) return false;
    }
    return true;
  });
}

/**
 * A spread of routes from another module: followed, or reported — never silently dropped.
 *
 * A real app's route table ended `...workspaces`, and before this the routes it named were simply not
 * there, with nothing in `SKIPPED.md` to say so: under-discovery no skip report can mention.
 * An array of routes from another module is read in the module that declares it, with *that* module's
 * imports — also when it is built, as a composition root builds one from installed workspaces:
 *
 *   ...workspaces.flatMap((workspace) => workspace.routes).filter(…).map(({ element: Page, ...route }) => …)
 *
 * (`followArray` says which steps are followed). A spread that cannot be followed, and any inside a
 * nested route — where a parent's path and guard would have to be carried in, and a guess there is a role
 * leak (Rule 17) — is reported with the expression quoted.
 */
function followSpreads(root: ts.Node, source: ts.SourceFile, sourceFile: string, context: CollectContext, seen: Set<string>): void {
  const module = context.modules.scope(sourceFile);
  const spreads = routeSpreads(root);
  // What is spread under a nested route is recorded before anything is followed: a `.filter` over the
  // same routes elsewhere is what keeps them apart, and it cannot be read (see `followArray`).
  if (module) {
    for (const { expression, nested } of spreads) if (nested) guard(expression, module, context.modules, context.guarded);
  }
  for (const { node: spread, expression: spreadExpression, nested } of spreads) {
    const quoted = spread.getText(source).replace(/\s+/g, ' ').slice(0, 90);
    const given = ts.isSpreadElement(spread) ? 'routes spread into the route table' : 'a nested route\'s children, not written out';
    const report = (why: string): void => {
      context.unreadable.push({ path: quoted, detail: `${given} (${why}) — none of them are declared` });
    };
    const expression = unwrap(spreadExpression);
    // `...(import.meta.env.DEV ? [{ path: '/dev', … }] : [])`: the routes are written out right here and
    // the whole file is already read for them.
    if (!ts.isIdentifier(expression) && routesWrittenIn(expression).length > 0) continue;
    if (nested) {
      report('inside a nested route, whose path and guard would apply');
      continue;
    }
    const followed = module ? followArray(expression, module, context.modules, seen, context.guarded) : { problem: 'its file cannot be read' };
    if ('problem' in followed) {
      report(followed.problem);
      continue;
    }
    collectFollowed(followed.entries, { ...context, devOnly: context.devOnly === true || isDevGuarded(spread) }, seen);
  }
}

/** Followed route entries, each read in the module that declares it — its imports, its role sets. */
function collectFollowed(entries: readonly Located[], context: CollectContext, seen: Set<string>): void {
  const contexts = new Map<string, CollectContext>();
  const contextFor = (module: ModuleScope): CollectContext => {
    let found = contexts.get(module.file);
    if (!found) {
      found = {
        ...context,
        source: module.source,
        sourceFile: module.file,
        components: componentSources(module.source, module.file, context.aliases),
        scope: stringScope(module.source, module.file, context.aliases),
      };
      contexts.set(module.file, found);
    }
    return found;
  };
  for (const entry of entries) {
    const object = objectAt(entry, context.modules, new Set());
    if (!object) {
      context.unreadable.push({
        path: entry.node.getText(entry.module.source).replace(/\s+/g, ' ').slice(0, 90),
        detail: 'an entry spread into the route table is not a route written out — it is not declared',
      });
      continue;
    }
    const properties = objectProperties(object.node);
    const own = contextFor(object.module);
    collect([{ node: object.node, properties, children: properties.get('children') ?? null }], '', own);
    followSpreads(object.node, object.module.source, object.module.file, own, seen);
  }
}

/**
 * The roles an application names, when it has no permissions module to read.
 *
 * `readRoleModel` answers `[PUBLIC]` for an app with no permissions file, and for a
 * three-page marketing site that is right: one audience, named for who it serves.
 * It was wrong for an app that gates its routes inline — every screen, including
 * four admin-only ones, came out as one PUBLIC audience with nothing reported.
 *
 * So when there is no permissions module but the route table itself names roles,
 * those roles are the universe. An unguarded route then means "any role this
 * application has", which is what the router enforces, instead of inventing an
 * audience the application never mentions.
 */
function rolesFromRouteTable(source: ts.SourceFile, declared: RoleModel): RoleModel {
  if (declared.allRoles.length > 0 && declared.allRoles[0] !== SINGLE_AUDIENCE) return declared;

  const found = new Set<RoleName>();
  const visit = (node: ts.Node): void => {
    if (ts.isJsxAttribute(node) && ts.isIdentifier(node.name) && (ROLE_PROPS as readonly string[]).includes(node.name.text)) {
      const value = node.initializer;
      const expression = value && ts.isJsxExpression(value) ? value.expression : undefined;
      const roles = expression
        ? evaluateRoles(expression, LITERAL_ENV)
        : null;
      for (const role of roles ?? []) found.add(role);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);

  return found.size > 0 ? { allRoles: [...found].sort(), namedSets: declared.namedSets } : declared;
}

/** A route discovery found but could not read — reported, never silently dropped. */
export interface UnreadableRoute {
  readonly path: string;
  readonly detail: string;
  /** Why it is left out, when that is not simply "unreadable" — a catch-all. */
  readonly reason?: import('./types.ts').SkipReason;
}

/** Module specifier prefixes the app's own tsconfig maps, e.g. `@/` -> `<appRoot>/`. */
type Aliases = ReadonlyMap<string, string>;

/**
 * The path aliases the application's own tsconfig declares.
 *
 * A code-split app imports its pages and its path table through aliases like
 * `@/config/paths`. Without them discovery cannot follow the import. Read from
 * the nearest tsconfig at or above `appRoot`, so nobody restates what the app
 * already declared — which would be a human step.
 */
function readAliases(appRoot: string): Aliases {
  const aliases = readDeclaredAliases(appRoot);
  // The monorepo the app sits in, if any. It rides on the aliases object — every place that resolves a
  // specifier already carries one — so a bare import of a sibling package resolves without a new
  // parameter on every function between here and there.
  const workspace = findWorkspace(appRoot, resolveComponentFile);
  if (workspace) WORKSPACES.set(aliases, workspace);
  return aliases;
}

/**
 * The project an app root sits in: the nearest folder at or above it with a package.json, a few levels
 * up at most. Never `node_modules` — specifiers resolve only through relative paths, the app's aliases
 * and the workspace's own packages — so widening the root to it reads only the adopter's code.
 */
function projectRoot(appRoot: string): string | null {
  let dir = resolve(appRoot);
  for (let depth = 0; depth < 5; depth++) {
    if (existsSync(join(dir, 'package.json'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/** The workspace an alias set belongs to (see `readAliases`). */
const WORKSPACES = new WeakMap<Aliases, Workspace>();

function readDeclaredAliases(appRoot: string): Aliases {
  const out = new Map<string, string>();
  let dir = resolve(appRoot);
  for (let depth = 0; depth < 5; depth++) {
    const read = ts.readConfigFile(join(dir, 'tsconfig.json'), (p) => {
      try {
        return readFileSync(p, 'utf8');
      } catch {
        return undefined;
      }
    });
    const options = !read.error && read.config ? (read.config.compilerOptions ?? {}) : null;
    if (options?.paths) {
      const baseUrl = resolve(dir, options.baseUrl ?? '.');
      for (const [pattern, targets] of Object.entries(options.paths as Record<string, unknown>)) {
        const target = Array.isArray(targets) ? targets[0] : undefined;
        if (typeof target !== 'string' || !pattern.endsWith('/*') || !target.endsWith('/*')) continue;
        out.set(pattern.slice(0, -1), resolve(baseUrl, target.slice(0, -1)));
      }
      return out;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return viteAliases(appRoot, out);
}

/**
 * The aliases a Vite config declares, when no tsconfig does.
 *
 * A Vue app imports its views as `@/views/Home`, with `"@"` mapped to `src` in
 * `vite.config.js` rather than in a tsconfig it may not have. Only the literal forms
 * are read — `fileURLToPath(new URL("./src", import.meta.url))` and
 * `path.resolve(__dirname, "src")` — and a computed one is left alone.
 */
function viteAliases(appRoot: string, out: Map<string, string>): Aliases {
  if (out.size > 0) return out;
  let dir = resolve(appRoot);
  for (let depth = 0; depth < 4; depth++) {
    for (const name of ['vite.config.ts', 'vite.config.js', 'vite.config.mjs', 'vite.config.mts']) {
      const file = join(dir, name);
      if (!existsSync(file)) continue;
      const text = readFileSync(file, 'utf8');
      const pattern =
        /['"]([@~][\w-]*)['"]\s*:\s*(?:fileURLToPath\(\s*new URL\(\s*|path\.resolve\(\s*__dirname\s*,\s*|resolve\(\s*__dirname\s*,\s*)['"]\.?\/?([^'"]*)['"]/g;
      for (const match of text.matchAll(pattern)) out.set(`${match[1]}/`, resolve(dir, match[2]!));
      return out;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return out;
}

/** A specifier resolved to a file: relative, or through one of the app's aliases. */
function resolveSpecifierFile(specifier: string | null | undefined, fromFile: string, aliases: Aliases): string | null {
  if (!specifier) return null;
  if (specifier.startsWith('.')) return resolveComponentFile(resolve(dirname(fromFile), specifier));
  for (const [prefix, dir] of aliases) {
    if (specifier.startsWith(prefix)) return resolveComponentFile(join(dir, specifier.slice(prefix.length)));
  }
  // A package the workspace declares is the adopter's own code; any other package is not.
  return WORKSPACES.get(aliases)?.resolve(specifier) ?? null;
}

// ------------------------------------------------------------- module scopes --

/** What one source file declares, imports and re-exports, by name. */
interface ModuleScope {
  readonly file: string;
  readonly source: ts.SourceFile;
  readonly constants: Map<string, ts.Expression>;
  readonly functions: Map<string, ts.FunctionDeclaration>;
  /** Local name -> the file it is imported from and the name it has there (`default` for a default import). */
  readonly imports: Map<string, { readonly file: string; readonly name: string }>;
  /** `export { a as b }` and `export { a as b } from './x'`: exported name -> where it is declared. */
  readonly exports: Map<string, { readonly file: string; readonly name: string }>;
  /** `export * from './x'`. */
  readonly stars: readonly string[];
  readonly defaultExport: ts.Expression | ts.FunctionDeclaration | null;
}

/** A name, followed to its declaration: the value and the module it is written in. */
interface Binding {
  readonly value: ts.Expression | ts.FunctionDeclaration;
  readonly module: ModuleScope;
}

interface Modules {
  /** The file, read once; null when it cannot be read. */
  scope(file: string): ModuleScope | null;
  /** What `name` stands for inside `module`: its own declaration, or an import followed through re-exports. */
  lookup(module: ModuleScope, name: string): Binding | null;
  /** What `file` exports as `name` (`default` for its default export), followed to its declaration. */
  exported(file: string, name: string): Binding | null;
  /** The role scope of a file: its constants, and the role sets and helpers it imports. */
  roleEnv(file: string): RoleEnv;
}

function readScope(file: string, source: ts.SourceFile, aliases: Aliases): ModuleScope {
  const functions = new Map<string, ts.FunctionDeclaration>();
  const imports = new Map<string, { file: string; name: string }>();
  const exports = new Map<string, { file: string; name: string }>();
  const stars: string[] = [];
  let defaultExport: ts.Expression | ts.FunctionDeclaration | null = null;
  for (const statement of source.statements) {
    if (ts.isFunctionDeclaration(statement)) {
      if (statement.name) functions.set(statement.name.text, statement);
      const modifiers = ts.canHaveModifiers(statement) ? ts.getModifiers(statement) ?? [] : [];
      if (modifiers.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword)) defaultExport = statement;
    } else if (ts.isImportDeclaration(statement) && ts.isStringLiteralLike(statement.moduleSpecifier)) {
      const from = resolveSpecifierFile(statement.moduleSpecifier.text, file, aliases);
      const clause = statement.importClause;
      if (!from || !clause) continue;
      if (clause.name) imports.set(clause.name.text, { file: from, name: 'default' });
      if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
        for (const element of clause.namedBindings.elements) {
          imports.set(element.name.text, { file: from, name: (element.propertyName ?? element.name).text });
        }
      }
    } else if (ts.isExportDeclaration(statement)) {
      const specifier = statement.moduleSpecifier && ts.isStringLiteralLike(statement.moduleSpecifier) ? statement.moduleSpecifier.text : null;
      const from = specifier === null ? file : resolveSpecifierFile(specifier, file, aliases);
      if (!from) continue;
      const clause = statement.exportClause;
      if (!clause) {
        if (specifier !== null) stars.push(from);
      } else if (ts.isNamedExports(clause)) {
        for (const element of clause.elements) {
          exports.set(element.name.text, { file: from, name: (element.propertyName ?? element.name).text });
        }
      }
    } else if (ts.isExportAssignment(statement) && !statement.isExportEquals) {
      defaultExport = statement.expression;
    }
  }
  return { file, source, constants: moduleConstants(source), functions, imports, exports, stars, defaultExport };
}

/** `read`: files already parsed, kept so that a node read from one is the same node read from the other. */
function createModules(aliases: Aliases, read: ReadonlyMap<string, ts.SourceFile> = new Map()): Modules {
  const scopes = new Map<string, ModuleScope | null>([...read].map(([file, source]) => [file, readScope(file, source, aliases)]));
  const envs = new Map<string, RoleEnv>();

  const scope = (file: string): ModuleScope | null => {
    if (scopes.has(file)) return scopes.get(file)!;
    let read: ModuleScope | null = null;
    try {
      read = readScope(file, parse(file), aliases);
    } catch {
      read = null;
    }
    scopes.set(file, read);
    return read;
  };

  const local = (module: ModuleScope, name: string, seen: Set<string>): Binding | null => {
    const constant = module.constants.get(name);
    if (constant) return { value: constant, module };
    const fn = module.functions.get(name);
    if (fn) return { value: fn, module };
    const imported = module.imports.get(name);
    return imported ? exported(imported.file, imported.name, seen) : null;
  };

  const exported = (file: string, name: string, seen: Set<string>): Binding | null => {
    const key = `${file}#${name}`;
    if (seen.has(key)) return null; // a cycle proves nothing
    seen.add(key);
    const module = scope(file);
    if (!module) return null;
    if (name === 'default') {
      const value = module.defaultExport;
      if (!value) return null;
      return !ts.isFunctionDeclaration(value) && ts.isIdentifier(unwrap(value))
        ? local(module, (unwrap(value) as ts.Identifier).text, seen)
        : { value, module };
    }
    const forwarded = module.exports.get(name);
    if (forwarded) {
      return forwarded.file === file ? local(module, forwarded.name, seen) : exported(forwarded.file, forwarded.name, seen);
    }
    const constant = module.constants.get(name);
    if (constant) return { value: constant, module };
    const fn = module.functions.get(name);
    if (fn) return { value: fn, module };
    for (const star of module.stars) {
      const found = exported(star, name, seen);
      if (found) return found;
    }
    return null;
  };

  const modules: Modules = {
    scope,
    lookup: (module, name) => local(module, name, new Set()),
    exported: (file, name) => exported(file, name, new Set()),
    roleEnv(file) {
      const cached = envs.get(file);
      if (cached) return cached;
      const module = scope(file);
      if (!module) return LITERAL_ENV;
      const env: RoleEnv = {
        key: file,
        lookup: (name) => {
          const binding = modules.lookup(module, name);
          return binding && !ts.isFunctionDeclaration(binding.value)
            ? { expression: binding.value, env: modules.roleEnv(binding.module.file) }
            : null;
        },
        isIdentityHelper: (name) => {
          const binding = modules.lookup(module, name);
          return binding !== null && isIdentitySpread(binding.value);
        },
      };
      envs.set(file, env);
      return env;
    },
  };
  return modules;
}

// ---------------------------------------------------- composed route tables --

/** An expression in the module it is written in. */
interface Located {
  readonly node: ts.Expression;
  readonly module: ModuleScope;
}

type Followed = { readonly entries: readonly Located[] } | { readonly problem: string };

/** `({ ... }) => <expr>` or `function (...) { return <expr> }`: the one expression it returns, or null. */
function returnedExpression(fn: ts.SignatureDeclaration): ts.Expression | null {
  const body = (fn as ts.FunctionLikeDeclaration).body;
  if (!body) return null;
  if (!ts.isBlock(body)) return unwrap(body);
  const [only] = body.statements;
  return body.statements.length === 1 && only && ts.isReturnStatement(only) && only.expression ? unwrap(only.expression) : null;
}

/** A property key written as a name or a string. */
function keyOf(name: ts.PropertyName | ts.BindingName | undefined): string | null {
  if (!name) return null;
  return ts.isIdentifier(name) || ts.isStringLiteralLike(name) ? name.text : null;
}

/** Properties of an object literal, `{ routes }` shorthand included (its value is the name itself). */
function propertiesWithShorthand(node: ts.ObjectLiteralExpression): Map<string, ts.Expression> {
  const out = objectProperties(node);
  for (const property of node.properties) {
    if (ts.isShorthandPropertyAssignment(property)) out.set(property.name.text, property.name);
  }
  return out;
}

/**
 * `(w) => w.routes`, `(w) => w['routes']` or `({ routes }) => routes`: the one property the
 * callback reads from its argument, or null when it does anything else.
 */
function projectedProperty(callback: ts.Expression | undefined): string | null {
  const fn = callback ? unwrap(callback) : undefined;
  if (!fn || (!ts.isArrowFunction(fn) && !ts.isFunctionExpression(fn)) || fn.parameters.length !== 1) return null;
  const parameter = fn.parameters[0]!.name;
  const body = returnedExpression(fn);
  if (!body) return null;
  if (ts.isIdentifier(parameter)) {
    if (ts.isPropertyAccessExpression(body) && ts.isIdentifier(body.expression) && body.expression.text === parameter.text) {
      return body.name.text;
    }
    if (
      ts.isElementAccessExpression(body) &&
      ts.isIdentifier(body.expression) &&
      body.expression.text === parameter.text &&
      ts.isStringLiteralLike(body.argumentExpression)
    ) {
      return body.argumentExpression.text;
    }
    return null;
  }
  if (ts.isObjectBindingPattern(parameter) && parameter.elements.length === 1) {
    const [element] = parameter.elements;
    if (!element || element.dotDotDotToken || element.initializer || !ts.isIdentifier(element.name)) return null;
    return ts.isIdentifier(body) && body.text === element.name.text ? keyOf(element.propertyName ?? element.name) : null;
  }
  return null;
}

/**
 * The keys this file reads from a route entry. A `.map` over routes may rewrite any other key — a
 * licence tag, a nav placement — but one that changed one of these would make the route read here
 * a different route from the one the application registers.
 */
const ROUTE_KEYS = new Set([
  'path', 'index', 'children', 'element', 'Component', 'component', 'lazy', 'loadComponent', 'loadChildren',
  'roles', 'redirect', 'redirectTo', 'data', 'meta',
]);
const COMPONENT_KEYS = new Set(['element', 'Component', 'component']);

/**
 * Why a `.map` callback over route entries cannot be looked through, or null when it can.
 *
 * It can when every route keeps its path, its page and its guard:
 *
 *   .map(({ element: Page, module, ...route }) => ({ ...route, element: <Page />, module }))
 *
 * carries the rest of each route through, and puts the page it took out back as an element.
 * A callback that drops `roles` — `({ roles, ...route }) => route` — would turn a guarded route
 * into an open one, so it is refused, as is one that writes any route key of its own.
 */
function reshapesRoutes(callback: ts.Expression | undefined): string | null {
  const fn = callback ? unwrap(callback) : undefined;
  if (!fn || (!ts.isArrowFunction(fn) && !ts.isFunctionExpression(fn))) return 'its callback is not written out';
  if (fn.parameters.length !== 1) return 'its callback does not take one route at a time';
  const parameter = fn.parameters[0]!.name;
  const body = returnedExpression(fn);
  if (!body || !ts.isObjectLiteralExpression(body)) return 'its callback does not return a route written out';

  const taken = new Map<string, string>(); // route key -> the local name it was destructured into
  let rest: string | null = null;
  let whole: string | null = null;
  if (ts.isIdentifier(parameter)) {
    rest = parameter.text;
    whole = parameter.text;
  } else if (ts.isObjectBindingPattern(parameter)) {
    for (const element of parameter.elements) {
      if (!ts.isIdentifier(element.name)) return 'its callback destructures a route in a way that cannot be read';
      if (element.dotDotDotToken) {
        rest = element.name.text;
        continue;
      }
      const key = keyOf(element.propertyName ?? element.name);
      if (key === null) return 'its callback destructures a computed key';
      if (element.initializer && ROUTE_KEYS.has(key)) return `its callback gives each route's ${key} a default`;
      taken.set(key, element.name.text);
    }
  } else {
    return 'its callback destructures a route in a way that cannot be read';
  }
  if (rest === null) return 'its callback does not carry the rest of each route through';

  let carried = false;
  const written = new Map<string, ts.Expression>();
  for (const property of body.properties) {
    if (ts.isSpreadAssignment(property)) {
      const spread = unwrap(property.expression);
      if (ts.isIdentifier(spread) && spread.text === rest) {
        carried = true;
        continue;
      }
      return 'its callback spreads something other than the route into it';
    }
    if (ts.isShorthandPropertyAssignment(property)) {
      written.set(property.name.text, property.name);
      continue;
    }
    const key = ts.isPropertyAssignment(property) ? keyOf(property.name) : null;
    if (key === null) return 'its callback writes a key that cannot be read';
    written.set(key, (property as ts.PropertyAssignment).initializer);
  }
  if (!carried) return 'its callback does not carry the rest of each route through';

  const components = new Set([...taken].filter(([key]) => COMPONENT_KEYS.has(key)).map(([, name]) => name));
  const passesThrough = (key: string, value: ts.Expression): boolean => {
    const node = unwrap(value);
    if (ts.isIdentifier(node)) return taken.get(key) === node.text;
    if (ts.isPropertyAccessExpression(node)) {
      return whole !== null && ts.isIdentifier(node.expression) && node.expression.text === whole && node.name.text === key;
    }
    // `element: <Page />`, where `Page` is the route's own element, taken out above.
    if (COMPONENT_KEYS.has(key) && ts.isJsxSelfClosingElement(node) && node.attributes.properties.length === 0) {
      return ts.isIdentifier(node.tagName) && components.has(node.tagName.text);
    }
    return false;
  };
  for (const [key, value] of written) {
    if (ROUTE_KEYS.has(key) && !passesThrough(key, value)) return `its callback rewrites each route's ${key}`;
  }
  for (const key of taken.keys()) {
    if (ROUTE_KEYS.has(key) && !written.has(key)) return `its callback drops each route's ${key}`;
  }
  return null;
}

/** An entry followed to the object literal it stands for, when it is one. */
function objectAt(entry: Located, modules: Modules, seen: Set<string>): { readonly node: ts.ObjectLiteralExpression; readonly module: ModuleScope } | null {
  const node = unwrap(entry.node);
  if (ts.isObjectLiteralExpression(node)) return { node, module: entry.module };
  if (!ts.isIdentifier(node)) return null;
  const key = `${entry.module.file}#${node.text}`;
  if (seen.has(key)) return null;
  seen.add(key);
  const binding = modules.lookup(entry.module, node.text);
  return binding && !ts.isFunctionDeclaration(binding.value) ? objectAt({ node: binding.value, module: binding.module }, modules, seen) : null;
}

/**
 * The entries of an array of routes that is built rather than written out (see `followSpreads`).
 *
 * Followed: an array literal, spreads in it, a name (through imports and re-exports, to the module
 * that declares it), and the array methods a composition root uses — `.flatMap((w) => w.routes)` over
 * workspace objects, `.map((w) => w.routes)` then `.flat()`, a `.map` that keeps every route's path,
 * page and guard, and `.filter`. A filter only removes entries; it never changes a route's path or
 * guard, so looking through it can offer a screen the filter set aside for another table (a fullscreen
 * route, say), never a screen to a role its guard refuses — unless the routes it sets aside are spread
 * under a nested route, whose guard is then what the filter keeps them behind:
 *
 *   [{ element: <ProtectedRoute allowedRoles={['ADMIN']} />, children: [...extra.filter((r) => r.admin)] },
 *    ...extra.filter((r) => !r.admin)]
 *
 * So a filter over routes that are also spread under a nested route (`guarded`) is a problem. Anything
 * else is a problem, quoted.
 */
function followArray(
  expression: ts.Expression,
  module: ModuleScope,
  modules: Modules,
  seen: Set<string>,
  guarded: Guarded | null = null,
): Followed {
  const node = unwrap(expression);

  if (ts.isArrayLiteralExpression(node)) {
    const entries: Located[] = [];
    for (const element of node.elements) {
      if (ts.isOmittedExpression(element)) continue;
      if (!ts.isSpreadElement(element)) {
        entries.push({ node: element, module });
        continue;
      }
      const inner = followArray(element.expression, module, modules, seen, guarded);
      if ('problem' in inner) {
        // `...(import.meta.env.DEV ? [{ path: '/dev', … }] : [])`: the routes are written out right there.
        const written = routesWrittenIn(element.expression);
        if (written.length === 0) return inner;
        entries.push(...written.map((route) => ({ node: route.node as ts.Expression, module })));
        continue;
      }
      entries.push(...inner.entries);
    }
    return { entries };
  }

  if (ts.isIdentifier(node)) {
    const key = `${module.file}#${node.text}`;
    if (seen.has(key)) return { entries: [] }; // already followed: a cycle proves nothing
    seen.add(key);
    if (isShadowed(node)) return { problem: `${node.text} is a local name the scanner does not follow` };
    const binding = modules.lookup(module, node.text);
    if (!binding || ts.isFunctionDeclaration(binding.value)) {
      return { problem: `${node.text} is not declared in, or imported from, a file the scanner can read` };
    }
    return followArray(binding.value, binding.module, modules, seen, guarded);
  }

  if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
    const method = node.expression.name.text;
    if (!['flatMap', 'map', 'filter', 'flat'].includes(method)) return { problem: `.${method}(…) is not a step the scanner can follow` };
    const base = followArray(node.expression.expression, module, modules, seen, guarded);
    if ('problem' in base) return base;
    if (method === 'filter') {
      return guarded && isGuarded(node.expression.expression, base.entries, module, modules, guarded)
        ? { problem: '.filter(…) over routes also spread under a nested route, whose guard the filter may be all that keeps them behind' }
        : base;
    }

    const flatten = (entries: readonly Located[]): Followed => {
      const out: Located[] = [];
      for (const entry of entries) {
        const inner = followArray(entry.node, entry.module, modules, seen, guarded);
        if ('problem' in inner) return inner;
        out.push(...inner.entries);
      }
      return { entries: out };
    };
    if (method === 'flat') {
      const [depth] = node.arguments;
      if (depth && !(ts.isNumericLiteral(depth) && depth.text === '1')) return { problem: '.flat() deeper than one level' };
      return flatten(base.entries);
    }

    const [callback] = node.arguments;
    const property = projectedProperty(callback);
    if (property !== null) {
      // `.flatMap((w) => w.routes)`, or `.map((w) => w.routes)` for a later `.flat()`: each entry's own
      // array, read in the module that declares the entry.
      const projected: Located[] = [];
      for (const entry of base.entries) {
        const object = objectAt(entry, modules, new Set());
        const value = object ? propertiesWithShorthand(object.node).get(property) : undefined;
        if (!object || !value) return { problem: `an entry has no ${property} the scanner can read` };
        projected.push({ node: value, module: object.module });
      }
      return method === 'flatMap' ? flatten(projected) : { entries: projected };
    }
    if (method === 'flatMap') return { problem: 'its .flatMap callback does more than read one property of each entry' };
    const reshaped = reshapesRoutes(callback);
    return reshaped === null ? base : { problem: `.map(…) — ${reshaped}` };
  }

  return { problem: 'a computed expression cannot be read' };
}

/** Route arrays spread under a nested route: the route entries they hold, and the declarations they are read from. */
interface Guarded {
  readonly entries: Set<ts.Node>;
  readonly sources: Set<string>;
}

/** The route object an entry stands for, or the entry itself when it is not one the scanner can find. */
function entryNode(entry: Located, modules: Modules): ts.Node {
  return objectAt(entry, modules, new Set())?.node ?? entry.node;
}

/**
 * The declarations a route array is read from — every name followed, through imports, spreads,
 * conditionals and the array methods called on it — keyed by where each is declared. Also for an array
 * the scanner cannot follow to its entries: `[...extra.filter(a).sort(by)]` is still read from `extra`.
 */
function routeSources(expression: ts.Expression, module: ModuleScope, modules: Modules, out = new Set<string>()): Set<string> {
  const node = unwrap(expression);
  if (ts.isArrayLiteralExpression(node)) {
    for (const element of node.elements) {
      if (ts.isSpreadElement(element)) routeSources(element.expression, module, modules, out);
    }
  } else if (ts.isIdentifier(node)) {
    if (isShadowed(node)) return out;
    const binding = modules.lookup(module, node.text);
    if (!binding || ts.isFunctionDeclaration(binding.value)) return out;
    const key = `${binding.module.file}@${binding.value.pos}`;
    if (out.has(key)) return out;
    out.add(key);
    routeSources(binding.value, binding.module, modules, out);
  } else if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
    routeSources(node.expression.expression, module, modules, out);
  } else if (ts.isConditionalExpression(node)) {
    routeSources(node.whenTrue, module, modules, out);
    routeSources(node.whenFalse, module, modules, out);
  }
  return out;
}

/** Record a route array spread under a nested route (see `followArray`). */
function guard(expression: ts.Expression, module: ModuleScope, modules: Modules, guarded: Guarded): void {
  routeSources(expression, module, modules, guarded.sources);
  const followed = followArray(expression, module, modules, new Set());
  if ('entries' in followed) for (const entry of followed.entries) guarded.entries.add(entryNode(entry, modules));
}

/** Are any of the routes a `.filter` chooses among also spread under a nested route? */
function isGuarded(base: ts.Expression, entries: readonly Located[], module: ModuleScope, modules: Modules, guarded: Guarded): boolean {
  if (guarded.entries.size === 0 && guarded.sources.size === 0) return false;
  if (entries.some((entry) => guarded.entries.has(entryNode(entry, modules)))) return true;
  for (const source of routeSources(base, module, modules)) if (guarded.sources.has(source)) return true;
  return false;
}

/**
 * The page a route takes from a helper spread into it — `...page(() => import('./Users'))` — and
 * whether the spread leaves its guard in doubt.
 *
 * The helper is read where it is declared (`function page(load) { return { element: lazy(load), … } }`).
 * Only a lazy import the helper puts into the route's element is taken as its page: an import it uses
 * for anything else (data, a loader) is not a screen. A helper that cannot be read, that has a member
 * that cannot be read, that writes the route's guard from anything but its own argument, or that writes
 * any other route key of its own (an element that is not that lazy page, a path, children) could be
 * granting or narrowing roles — so its route's roles are in doubt, unless the route names them after it.
 */
function spreadHelper(
  expression: ts.Expression,
  file: string,
  modules: Modules,
): { readonly properties: Map<string, ts.Expression>; readonly rolesInDoubt: boolean } | null {
  const call = unwrap(expression);
  if (!ts.isCallExpression(call) || !ts.isIdentifier(call.expression) || isShadowed(call.expression)) return null;
  const module = modules.scope(file);
  const binding = module ? modules.lookup(module, call.expression.text) : null;
  if (!binding) return null;
  const fn = ts.isFunctionDeclaration(binding.value) ? binding.value : unwrap(binding.value);
  if (!ts.isFunctionDeclaration(fn) && !ts.isArrowFunction(fn) && !ts.isFunctionExpression(fn)) return null;
  const parameters = fn.parameters.map((p) => (ts.isIdentifier(p.name) && !p.dotDotDotToken ? p.name.text : null));
  const returned = returnedExpression(fn);
  if (!returned || !ts.isObjectLiteralExpression(returned)) return null;

  /** The argument a parameter named here was given at the call. */
  const argumentFor = (value: ts.Expression): ts.Expression | undefined => {
    const node = unwrap(value);
    const index = ts.isIdentifier(node) ? parameters.indexOf(node.text) : -1;
    return index >= 0 ? call.arguments[index] : undefined;
  };

  const properties = new Map<string, ts.Expression>();
  let rolesInDoubt = false;
  for (const property of returned.properties) {
    // A spread, a method, a getter (`get roles() { … }`) or a computed key (`[K]: …`) could write
    // any route key, `roles` and `element` included.
    if (!ts.isPropertyAssignment(property) && !ts.isShorthandPropertyAssignment(property)) {
      rolesInDoubt = true;
      continue;
    }
    const key = keyOf(property.name);
    if (key === null) {
      rolesInDoubt = true;
      continue;
    }
    const value = ts.isPropertyAssignment(property) ? property.initializer : property.name;
    if (COMPONENT_KEYS.has(key)) {
      // `element: lazy(load)` or `element: load`, where `load` is the helper's own parameter. An element
      // of the helper's own — `element: requireAdmin(load)`, `element: <Guard />` — may be a guard.
      const node = unwrap(value);
      const fed = ts.isCallExpression(node) && isLazyWrapper(node.expression) && node.arguments.length === 1
        ? argumentFor(node.arguments[0]!)
        : argumentFor(node);
      const loader = fed ? lazyComponentProperty(fed) : undefined;
      if (loader) properties.set('lazy', loader);
      else rolesInDoubt = true;
    } else if (key === 'roles' || key === 'data' || key === 'meta') {
      const passed = argumentFor(value);
      if (passed) properties.set(key, passed);
      else rolesInDoubt = true;
    } else if (ROUTE_KEYS.has(key)) {
      // A path, children, loader or redirect of the helper's own: not the route read here.
      rolesInDoubt = true;
    }
  }
  return { properties, rolesInDoubt };
}

/**
 * The keys of a route entry as the application reads them: what is written, plus what a helper
 * spread into it contributes (see `spreadHelper`), in source order — a later key wins, as in
 * JavaScript. `rolesInDoubt` when something that may carry a guard — a spread not read, a computed
 * key, a getter — comes after the last `roles`. `guardInDoubt` when there is any such thing at all:
 * a `roles` written after it settles the route's own roles, but not the element it may have put
 * around the routes beneath it.
 */
function entryProperties(
  node: ts.ObjectLiteralExpression,
  file: string,
  modules: Modules,
): { readonly properties: Map<string, ts.Expression>; readonly rolesInDoubt: boolean; readonly guardInDoubt: boolean } {
  const properties = new Map<string, ts.Expression>();
  let rolesInDoubt = false;
  let guardInDoubt = false;
  const doubt = (): void => {
    rolesInDoubt = true;
    guardInDoubt = true;
  };
  for (const property of node.properties) {
    if (ts.isPropertyAssignment(property)) {
      const key = keyOf(property.name);
      if (key === null) {
        doubt(); // `[K]: ['ADMIN']` could be `roles`, or `element`
        continue;
      }
      properties.set(key, property.initializer);
      if (key === 'roles') rolesInDoubt = false;
    } else if (ts.isShorthandPropertyAssignment(property)) {
      if (property.name.text !== 'roles') continue;
      properties.set('roles', property.name);
      rolesInDoubt = false;
    } else if (ts.isSpreadAssignment(property)) {
      const helper = spreadHelper(property.expression, file, modules);
      if (!helper) {
        doubt();
        continue;
      }
      for (const [key, value] of helper.properties) properties.set(key, value);
      if (helper.rolesInDoubt) doubt();
      else if (helper.properties.has('roles')) rolesInDoubt = false;
    } else {
      doubt(); // a method or an accessor: `get roles() { … }`
    }
  }
  return { properties, rolesInDoubt, guardInDoubt };
}

/**
 * `element: <Navigate to="/x" />` written straight into a route table: where it sends the
 * user — the literal target, or a template's known prefix — or null for a real page.
 */
function elementRedirect(expression: ts.Expression | undefined): string | null {
  let node: ts.Node | undefined = expression;
  while (node && ts.isParenthesizedExpression(node)) node = node.expression;
  if (!node) return null;
  const element = ts.isJsxSelfClosingElement(node) ? node : ts.isJsxElement(node) ? node.openingElement : null;
  if (!element || !/^(Navigate|Redirect)$/.test(element.tagName.getText())) return null;
  for (const attribute of element.attributes.properties) {
    if (!ts.isJsxAttribute(attribute) || attribute.name.getText() !== 'to') continue;
    const value = attribute.initializer;
    if (value && ts.isStringLiteral(value)) return value.text;
    if (value && ts.isJsxExpression(value) && value.expression) {
      if (ts.isStringLiteralLike(value.expression)) return value.expression.text;
      if (ts.isTemplateExpression(value.expression)) return value.expression.head.text;
    }
  }
  return null;
}

/**
 * Resolve an import written anywhere in the application the way a route's page is resolved:
 * relative, through the app's own path aliases, or — in a monorepo — by bare name into a
 * package the workspace declares (see `workspace.ts`). Any other package, and any file outside
 * the application and those packages, is null — the generator reads the adopter's code and
 * nothing else.
 */
export function importResolver(appRoot: string): (specifier: string, fromFile: string) => string | null {
  const aliases = readAliases(appRoot);
  // The application, the project it sits in, and the packages of the workspace around it: the
  // generator reads the adopter's code and nothing else. The project matters for a framework whose
  // routes are a folder of the app — Next.js reads `src/app`, and imports `@/components/…` from beside
  // it; with only `appRoot` here, every component of a Next.js app was refused (2026-10-16).
  const project = projectRoot(appRoot);
  const roots = [resolve(appRoot), ...(project ? [project] : []), ...(WORKSPACES.get(aliases)?.roots ?? [])];
  return (specifier, fromFile) => {
    const file = resolveSpecifierFile(specifier, fromFile, aliases);
    return file && roots.some((root) => resolve(file).startsWith(root)) ? file : null;
  };
}

interface StringScope {
  resolveIdentifier(name: string): ts.Expression | undefined;
}

/** Identifiers the routes file can see: its own constants, and the named imports it can follow. */
function stringScope(source: ts.SourceFile, sourceFile: string, aliases: Aliases): StringScope {
  const local = moduleConstants(source);
  const imported = new Map<string, { file: string; name: string }>();
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteralLike(statement.moduleSpecifier)) continue;
    const file = resolveSpecifierFile(statement.moduleSpecifier.text, sourceFile, aliases);
    const named = statement.importClause?.namedBindings;
    if (!file || !named || !ts.isNamedImports(named)) continue;
    for (const element of named.elements) {
      imported.set(element.name.text, { file, name: (element.propertyName ?? element.name).text });
    }
  }
  const cache = new Map<string, Map<string, ts.Expression>>();
  return {
    resolveIdentifier(name) {
      const own = local.get(name);
      if (own) return own;
      const target = imported.get(name);
      if (!target) return undefined;
      let constants = cache.get(target.file);
      if (!constants) {
        try {
          constants = moduleConstants(parse(target.file));
        } catch {
          constants = new Map();
        }
        cache.set(target.file, constants);
      }
      return constants.get(target.name);
    },
  };
}

/**
 * A route path written as data rather than a literal — `paths.app.users.path`
 * — followed through module constants and one level of named import.
 * `null` when it cannot be, which the caller reports instead of dropping.
 */
function evaluateString(expression: ts.Expression, scope: StringScope): string | null {
  const node = unwrap(expression);
  if (ts.isStringLiteralLike(node)) return node.text;
  const chain: string[] = [];
  let current: ts.Expression = node;
  while (ts.isPropertyAccessExpression(current)) {
    chain.unshift(current.name.text);
    current = unwrap(current.expression);
  }
  if (!ts.isIdentifier(current) || chain.length === 0) return null;
  let value: ts.Expression | undefined = scope.resolveIdentifier(current.text);
  for (const key of chain) {
    if (!value) return null;
    const object = unwrap(value);
    if (!ts.isObjectLiteralExpression(object)) return null;
    value = objectProperties(object).get(key);
  }
  if (!value) return null;
  const leaf = unwrap(value);
  return ts.isStringLiteralLike(leaf) ? leaf.text : null;
}

/** What the module that writes `identifier` imports it as — `{ from: 'react', name: 'lazy' }` — or null. */
function importOf(identifier: ts.Identifier): { readonly from: string; readonly name: string } | null {
  if (isShadowed(identifier)) return null;
  for (const statement of identifier.getSourceFile().statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteralLike(statement.moduleSpecifier)) continue;
    const clause = statement.importClause;
    if (!clause || clause.isTypeOnly) continue;
    const from = statement.moduleSpecifier.text;
    if (clause.name?.text === identifier.text) return { from, name: 'default' };
    const bindings = clause.namedBindings;
    if (bindings && ts.isNamespaceImport(bindings) && bindings.name.text === identifier.text) return { from, name: '*' };
    if (bindings && ts.isNamedImports(bindings)) {
      for (const element of bindings.elements) {
        if (!element.isTypeOnly && element.name.text === identifier.text) return { from, name: (element.propertyName ?? element.name).text };
      }
    }
  }
  return null;
}

/**
 * React's `lazy` (imported from `react`, or `React.lazy` through its default or namespace import) and
 * Vue's `defineAsyncComponent` (imported from `vue`): the calls that only make a loader a page. Any
 * other wrapper — `requireAdmin(() => import('./X'))`, `withRole('ADMIN')(…)`, a `lazy` of the app's
 * own — may be a guard, and a guard read as the page it wraps would offer that page to every role.
 */
function isLazyWrapper(callee: ts.Expression): boolean {
  const node = unwrap(callee);
  if (ts.isIdentifier(node)) {
    const imported = importOf(node);
    return (imported?.from === 'react' && imported.name === 'lazy') || (imported?.from === 'vue' && imported.name === 'defineAsyncComponent');
  }
  if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression) && node.name.text === 'lazy') {
    const imported = importOf(node.expression);
    return imported?.from === 'react' && (imported.name === 'default' || imported.name === '*');
  }
  return false;
}

/** `import('./X')`, with the specifier written out. */
function isImportCall(node: ts.Node): node is ts.CallExpression {
  return ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && !!node.arguments[0] && ts.isStringLiteralLike(node.arguments[0]);
}

/**
 * A `.then` callback that only picks the page out of the module: `(m) => m.X`, `(m) => ({ default: m.X })`,
 * `({ X }) => ({ default: X })` or `({ X: Y }) => ({ default: Y })` (`Component` in place of `default`,
 * as React Router's `lazy` writes it). Anything else — `(m) => ({ default: requireAdmin(m.default) })` —
 * does something to the page, and may guard it.
 */
function picksExport(callback: ts.Expression): boolean {
  const fn = unwrap(callback);
  if ((!ts.isArrowFunction(fn) && !ts.isFunctionExpression(fn)) || fn.parameters.length !== 1) return false;
  const parameter = fn.parameters[0]!;
  if (parameter.dotDotDotToken || parameter.initializer) return false;
  let body = returnedExpression(fn);
  if (body && ts.isObjectLiteralExpression(body)) {
    const [only] = body.properties;
    if (body.properties.length !== 1 || !only || !ts.isPropertyAssignment(only) || !['default', 'Component'].includes(keyOf(only.name) ?? '')) return false;
    body = unwrap(only.initializer);
  }
  if (!body) return false;
  const name = parameter.name;
  if (ts.isIdentifier(name)) {
    return ts.isPropertyAccessExpression(body) && ts.isIdentifier(body.expression) && body.expression.text === name.text;
  }
  if (!ts.isObjectBindingPattern(name) || name.elements.length !== 1) return false;
  const [element] = name.elements;
  return !!element && !element.dotDotDotToken && !element.initializer && ts.isIdentifier(element.name) && ts.isIdentifier(body) && body.text === element.name.text;
}

/**
 * `() => import('./X')`, or `() => import('./X').then(…)` whose callback only picks the page out
 * (`picksExport`): a loader that does nothing to the page it loads. `() => import('./X').then((m) =>
 * ({ default: requireAdmin(m.default) }))` or `() => withGuard(import('./X'))` is not one — its page is
 * left unread, as a guard that cannot be read leaves a route.
 */
function isPlainLoader(loader: ts.Expression): boolean {
  const fn = unwrap(loader);
  if ((!ts.isArrowFunction(fn) && !ts.isFunctionExpression(fn)) || fn.parameters.length > 0) return false;
  const body = returnedExpression(fn);
  if (!body) return false;
  if (isImportCall(body)) return true;
  return (
    ts.isCallExpression(body) &&
    ts.isPropertyAccessExpression(body.expression) &&
    body.expression.name.text === 'then' &&
    isImportCall(unwrap(body.expression.expression)) &&
    body.arguments.length === 1 &&
    picksExport(body.arguments[0]!)
  );
}

/**
 * `component: () => import("@/views/Home")` (Vue Router) and `loadComponent: () => import(...)`
 * (Angular) are the lazy page, spelled differently, and so is `lazy(() => import("./Page"))` (see
 * `isLazyWrapper`) written into `component`, `Component` or `element` — each only when its loader is
 * plain (`isPlainLoader`). A `component` that is a plain identifier is the eager page, and is read like
 * `element`.
 */
function lazyComponentProperty(expression: ts.Expression | undefined): ts.Expression | undefined {
  if (!expression) return undefined;
  const node = unwrap(expression);
  if ((ts.isArrowFunction(node) || ts.isFunctionExpression(node)) && isPlainLoader(node)) return node;
  if (ts.isCallExpression(node) && isLazyWrapper(node.expression) && node.arguments.length === 1) {
    const [loader] = node.arguments;
    const inner = loader ? unwrap(loader) : undefined;
    if (inner && isPlainLoader(inner)) return inner;
  }
  return undefined;
}

/**
 * Is `name`, where the route is written, bound to a call that loads a page and is not a lazy page itself —
 * `requireAdmin(() => import('./X'))`, or `lazy` around a loader that wraps what it loads?
 */
function wrapsLoadedPage(name: string, context: CollectContext): boolean {
  const module = context.modules.scope(context.sourceFile);
  const binding = module ? context.modules.lookup(module, name) : null;
  if (!binding || ts.isFunctionDeclaration(binding.value)) return false;
  return ts.isCallExpression(unwrap(binding.value)) && importSpecifierOf(binding.value) !== null && !lazyComponentProperty(binding.value);
}

/** `routes/app/users.tsx` -> `Users`; an `index` file takes its folder's name. */
function lazyComponentName(file: string): string {
  const parts = file.split(/[\\/]/);
  let base = (parts.pop() ?? '').replace(/\.(?:[jt]sx?|vue|svelte)$/, '').replace(/\.component$/, '');
  if (base === 'index') base = parts.pop() ?? base;
  return base
    .split(/[-_]/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join('');
}

/**
 * `import('./wrappers').then(({ UsersRoute }) => ({ default: UsersRoute }))`, or
 * `.then((m) => ({ default: m.UsersRoute }))`: the named export a lazy loader makes the page, or null.
 */
function lazyNamedExport(loader: ts.Expression): string | null {
  let found: string | null = null;
  const visit = (node: ts.Node): void => {
    if (found !== null) return;
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'then' &&
      ts.isCallExpression(node.expression.expression) &&
      node.expression.expression.expression.kind === ts.SyntaxKind.ImportKeyword
    ) {
      const callback = node.arguments[0] ? unwrap(node.arguments[0]) : undefined;
      if (callback && (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback)) && callback.parameters.length === 1) {
        const body = returnedExpression(callback);
        const value = body && ts.isObjectLiteralExpression(body) ? objectProperties(body).get('default') : undefined;
        const parameter = callback.parameters[0]!.name;
        const named = value ? unwrap(value) : undefined;
        if (named && ts.isIdentifier(parameter) && ts.isPropertyAccessExpression(named)) {
          if (ts.isIdentifier(named.expression) && named.expression.text === parameter.text) found = named.name.text;
        } else if (named && ts.isObjectBindingPattern(parameter) && ts.isIdentifier(named)) {
          for (const element of parameter.elements) {
            if (!element.dotDotDotToken && ts.isIdentifier(element.name) && element.name.text === named.text) {
              found = keyOf(element.propertyName ?? element.name);
            }
          }
        }
      }
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(loader);
  return found;
}

/**
 * The page a module's named export stands for.
 *
 * A thin wrapper — `export function ChildMedicalRoute() { return <ChildRedirect suffix="medical" /> }`,
 * a route-shaped adapter around one component — is the component it renders: read in that component's
 * own file, as it was when the route table wrote `<ChildRedirect suffix="medical" />` itself. Any other
 * export is read where it is declared: on its own when that file declares no other component, and by
 * name when it shares the file with others.
 */
function namedExportPage(
  file: string,
  name: string,
  modules: Modules,
): { readonly component: string; readonly file: string | null; readonly declaredIn?: string } {
  const binding = modules.exported(file, name);
  if (!binding) return { component: name, file };
  const fn = ts.isFunctionDeclaration(binding.value) ? binding.value : unwrap(binding.value);
  const rendered = ts.isFunctionDeclaration(fn) || ts.isArrowFunction(fn) || ts.isFunctionExpression(fn) ? returnedExpression(fn) : null;
  const tag = rendered && ts.isJsxSelfClosingElement(rendered)
    ? rendered.tagName
    : rendered && ts.isJsxElement(rendered) && rendered.children.every((child) => ts.isJsxText(child) && child.containsOnlyTriviaWhiteSpaces)
      ? rendered.openingElement.tagName
      : null;
  const imported = tag && ts.isIdentifier(tag) ? binding.module.imports.get(tag.text) : undefined;
  if (imported && tag && ts.isIdentifier(tag)) {
    const target = imported.name === 'default' ? imported.file : (modules.exported(imported.file, imported.name)?.module.file ?? imported.file);
    return { component: tag.text, file: target };
  }
  const components = [
    ...binding.module.functions.keys(),
    ...[...binding.module.constants].filter(([, value]) => {
      const node = unwrap(value);
      return ts.isArrowFunction(node) || ts.isFunctionExpression(node);
    }).map(([key]) => key),
  ].filter((key) => /^[A-Z]/.test(key));
  const value = binding.value;
  const declared = ts.isFunctionDeclaration(value)
    ? (value.name?.text ?? name)
    : ts.isVariableDeclaration(value.parent) && ts.isIdentifier(value.parent.name)
      ? value.parent.name.text
      : name;
  return components.length > 1
    ? { component: declared, file: null, declaredIn: binding.module.file }
    : { component: declared, file: binding.module.file };
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

/**
 * A component named as a guard or a provider rather than a page: `ProtectedRoute`, `RequireAuth`,
 * `PrivateRoute`, `RoleGuard`, `Suspense`. It renders its child when allowed and something of its own
 * (a login wall, a spinner) when not — and that something is not the screen.
 */
const GUARD_NAME = /^(?:Protected|Private|Guarded|Secure|Authenticated|Auth|Require\w*|Role\w*|Permission\w*|Guard\w*|Suspense|ErrorBoundary)|(?:Guard|Gate|Protected|Route|Boundary|Provider)$/;

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
  const name = ts.isIdentifier(tag) ? tag.text : tag.getText();
  // `<ProtectedRoute><FeedbackFormPage /></ProtectedRoute>`: the page is the guard's one child. Two
  // children, or a wrapper not named as a guard (a layout shell, whose children are read through it
  // later), is not guessed at. Who may reach the page is read from the outer element's props, and
  // stays that way.
  if (ts.isJsxElement(node) && GUARD_NAME.test(name)) {
    const children = node.children.filter(
      (child) => ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child) || (ts.isJsxExpression(child) && child.expression !== undefined),
    );
    const [only] = children;
    if (children.length === 1 && only && (ts.isJsxElement(only) || ts.isJsxSelfClosingElement(only))) {
      return elementComponent(only as unknown as ts.Expression) ?? name;
    }
  }
  return name;
}

/**
 * The roles a guard *wrapper* route imposes on everything beneath it.
 *
 * `<Route element={<ProtectedRoute allowedRoles={['ADMIN']} />}>` is a route with
 * no path of its own whose element is a guard component. Its children inherit
 * the restriction, exactly as the router enforces it at run time.
 *
 * Returns `undefined` when the element imposes nothing (no guard, or a guard with
 * no role list — "any signed-in user", which narrows nothing by role), and `null`
 * when a guard names roles this generator cannot evaluate. `null` propagates and
 * drops the route, because Rule 17's kill criterion is zero mis-assignments and
 * an unreadable guard is not an absent one.
 */
const ROLE_PROPS = ['allowedRoles', 'roles', 'requiredRoles', 'anyOfRoles'] as const;

function guardRoles(properties: Map<string, ts.Expression>, env: RoleEnv): readonly RoleName[] | null | undefined {
  // Angular `data: { roles: [...] }` and Vue Router `meta: { roles: [...] }`. A `canActivate`
  // or `beforeEnter` guard is code: authentication is not a role, and a computed check is not read.
  for (const holder of ['data', 'meta']) {
    const value = properties.get(holder);
    const object = value ? unwrap(value) : undefined;
    if (!object || !ts.isObjectLiteralExpression(object)) continue;
    const roles = objectProperties(object).get('roles');
    if (!roles) continue;
    const evaluated = evaluateRoles(roles, env);
    return evaluated && evaluated.length > 0 ? evaluated : null;
  }
  const element = properties.get('element') ?? properties.get('Component');
  if (!element) return undefined;
  const node = unwrap(element);
  const opening = ts.isJsxElement(node)
    ? node.openingElement
    : ts.isJsxSelfClosingElement(node)
      ? node
      : null;
  if (!opening) return undefined;

  const attributes = jsxRouteProperties(
    ts.isJsxElement(node) ? node : (node as ts.JsxSelfClosingElement),
  );
  for (const name of ROLE_PROPS) {
    const expression = attributes.get(name);
    if (!expression) continue;
    const evaluated = evaluateRoles(expression, env);
    return evaluated && evaluated.length > 0 ? evaluated : null;
  }
  return undefined;
}

/** Two role sets, both of which must hold: a child cannot widen its parent's guard. */
function narrow(
  parent: readonly RoleName[] | null | undefined,
  child: readonly RoleName[] | null | undefined,
): readonly RoleName[] | null | undefined {
  if (parent === null || child === null) return null;
  if (parent === undefined) return child;
  if (child === undefined) return parent;
  return parent.filter((role) => child.includes(role));
}

/** `ROLES.x`, or `[...ROLES.x]`: the role-set access a route's `roles` is written as, or null. */
function roleSetAccess(expression: ts.Expression): (ts.PropertyAccessExpression & { name: ts.Identifier }) | null {
  let node = unwrap(expression);
  if (ts.isArrayLiteralExpression(node) && node.elements.length === 1 && ts.isSpreadElement(node.elements[0]!)) {
    node = unwrap(node.elements[0].expression);
  }
  return ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.name)
    ? (node as ts.PropertyAccessExpression & { name: ts.Identifier })
    : null;
}

/**
 * Does `object` name the configured role table — the `roleSetExport` of the configured permissions
 * file, followed there through imports and re-exports, under whatever name? A name that cannot be
 * followed (an import from a module the scanner cannot read), a table of the route's own module, or
 * another module's table of the same name is not that table, whatever it is called.
 */
function isConfiguredRoleSet(object: ts.Expression, context: CollectContext): boolean {
  const node = unwrap(object);
  if (!ts.isIdentifier(node) || isShadowed(node) || !context.permissionsFile) return false;
  const module = context.modules.scope(context.sourceFile);
  const binding = module ? context.modules.lookup(module, node.text) : null;
  if (!binding || resolve(binding.module.file) !== resolve(context.permissionsFile)) return false;
  return binding.module.constants.get(context.roleSetExport) === binding.value;
}

function collect(
  entries: readonly RouteObject[],
  parentPath: string,
  context: {
    source: ts.SourceFile;
    sourceFile: string;
    components: Map<string, string>;
    roles: RoleModel;
    /** The configured name of the role table, e.g. `ROUTE_ROLES`. */
    roleSetExport: string;
    /** The configured permissions file, which declares that table; null when there is none. */
    permissionsFile: string | null;
    /** Route arrays also spread under a nested route (see `followSpreads`). */
    guarded: Guarded;
    aliases: Aliases;
    scope: StringScope;
    modules: Modules;
    /** Route entries already read, so one reached twice — written out, and followed — is read once. */
    collected: Set<ts.Node>;
    /** Every route here is registered only in a development build: the spread that brought them in is. */
    devOnly?: boolean;
    unreadable: UnreadableRoute[];
    out: DiscoveredRoute[];
  },
  inherited?: readonly RoleName[] | null,
): void {
  for (const entry of entries) {
    const { node, children } = entry;
    if (context.collected.has(node)) continue;
    context.collected.add(node);
    const { properties, rolesInDoubt, guardInDoubt } = ts.isObjectLiteralExpression(node)
      ? entryProperties(node, context.sourceFile, context.modules)
      : { properties: entry.properties, rolesInDoubt: false, guardInDoubt: false };
    const env = context.modules.roleEnv(context.sourceFile);
    const pathExpression = properties.get('path');
    const segment = pathExpression ? evaluateString(pathExpression, context.scope) : '';
    if (segment === null) {
      // An unreadable path used to become '' and the route vanished with
      // no trace — under-discovery no skip report could mention, because nothing
      // knew the route existed. Now it is reported, the expression quoted.
      const nested = children ? childRoutesOf(children, node).length : 0;
      context.unreadable.push({
        path: pathExpression!.getText(context.source),
        detail: `route path is an expression this generator cannot evaluate${nested ? ` (and ${nested} nested route(s) under it)` : ''}`,
      });
      continue;
    }
    const path = joinPath(parentPath, segment);

    // What this route's own element imposes, narrowed by whatever it inherited.
    // A guard route usually has no path and no children of its own beyond the
    // ones it protects, so this is computed before the destination checks below.
    // Something spread into the entry that could not be read may have put a guard
    // there: then no route beneath it is offered on a guess (`{ ...adminLayout(), children }`).
    // The route itself is settled by a `roles` written after it (`rolesInDoubt`, below).
    const guard = narrow(inherited, guardRoles(properties, env));

    // The route's own `roles`, read where it is written: `ROLES.x` and `[...ROLES.x]` follow `ROLES`
    // through this file's import to the module that declares it, whichever module that is.
    const rolesExpression = properties.get('roles');
    const accessed = rolesExpression ? roleSetAccess(rolesExpression) : null;
    let written: readonly RoleName[] | null | undefined;
    if (rolesExpression) {
      written = evaluateRoles(rolesExpression, env);
      if (written === null && accessed && isConfiguredRoleSet(accessed.expression, context)) {
        // The configured role table, by key, as the permissions file declares it. Only for that
        // table: a pack's own `SPORT_ROLES.x`, or its own `ROUTE_ROLES.x`, is never answered with the
        // core table's `x`.
        const named = context.roles.namedSets.get(accessed.name.text);
        if (named !== undefined) written = named;
      }
    }
    // What reaches the routes beneath: every guard above and on this route, its own `roles` included —
    // where a route's roles gate its element, they gate the outlet its children render in. A `roles`
    // that cannot be read leaves them unresolved, like any guard that cannot be read.
    const here = guardInDoubt ? null : narrow(guard, written);

    if (children) {
      collect(childRoutesOf(children, node), path, context, here);
    }

    // Angular: `loadChildren: () => import('./profile/profile.routes')`. The routes are that
    // file's default export or its exported `routes`, read with that file's own imports.
    const loadChildren = properties.get('loadChildren');
    if (loadChildren) {
      const childFile = resolveSpecifierFile(importSpecifierOf(loadChildren), context.sourceFile, context.aliases);
      if (!childFile) {
        context.unreadable.push({
          path,
          detail: `lazy child routes could not be resolved: ${loadChildren.getText(context.source).slice(0, 120)}`,
        });
      } else {
        const childSource = parse(childFile);
        collect(routeObjectsIn(childSource), path, {
          ...context,
          source: childSource,
          sourceFile: childFile,
          components: componentSources(childSource, childFile, context.aliases),
          scope: stringScope(childSource, childFile, context.aliases),
        }, here);
      }
      continue;
    }

    // A catch-all is the app's own 404, not a place anyone asks to go.
    if (segment === '*' || segment.includes('*')) continue;

    // `redirect: true`: the route table itself says this entry only sends the user on. Its element
    // works out where at run time, so there is no screen here to offer — reported, like any skip.
    const redirect = properties.get('redirect');
    if (redirect && unwrap(redirect).kind === ts.SyntaxKind.TrueKeyword) {
      if (pathExpression || properties.has('index')) {
        context.unreadable.push({
          path,
          reason: 'declared-redirect',
          detail: 'the route table marks it `redirect: true` — it only sends the user on, and is not a screen of its own',
        });
      }
      continue;
    }

    // `lazy: () => import('./routes/users')` — the data-router spelling a
    // code-split app uses for every page. Its module is the page.
    // A route a helper spread into it gave its page (`...page(() => import('./X'))`) arrives here
    // as `lazy`, too (see `spreadHelper`).
    // `lazy: () => import('./routes/users')` and `loadComponent` only when the loader does nothing to
    // the page it loads (`isPlainLoader`): one that does may be guarding it, and is reported.
    const declaredLoader = properties.get('lazy') ?? properties.get('loadComponent');
    if (declaredLoader && !isPlainLoader(declaredLoader)) {
      context.unreadable.push({
        path,
        detail: `its lazy loader does more than import the page, so the page is not read: ${declaredLoader.getText(context.source).replace(/\s+/g, ' ').slice(0, 120)}`,
      });
      continue;
    }
    const lazyExpression =
      declaredLoader ??
      lazyComponentProperty(properties.get('component')) ??
      lazyComponentProperty(properties.get('Component')) ??
      lazyComponentProperty(properties.get('element'));
    const hasElement = [...COMPONENT_KEYS].some((key) => properties.has(key) && !lazyComponentProperty(properties.get(key)));

    // A redirect entry (`redirect`, Vue Router; `redirectTo`, Angular) declares no page of its own.
    if (!hasElement && !lazyExpression && (properties.has('redirect') || properties.has('redirectTo'))) continue;
    if (!hasElement && !lazyExpression) {
      // A layout wrapper with children is not a destination — correctly silent.
      // A leaf with nothing readable to render is reported, not dropped.
      if (!children && (pathExpression || properties.has('index'))) {
        context.unreadable.push({ path, detail: 'route declares no element, Component or lazy import this generator can read' });
      }
      continue;
    }
    if (!pathExpression && !properties.has('index')) continue;

    let component: string | null;
    let componentFile: string | null;
    let declaredIn: string | undefined;
    if (hasElement) {
      component = elementComponent(properties.get('element') ?? properties.get('Component') ?? properties.get('component'));
      // `const Users = requireAdmin(() => import('./Users'))`: a page loaded and wrapped in something —
      // which may be a guard — is not read as the page (as `lazyComponentProperty` does not read it inline).
      if (component && wrapsLoadedPage(component, context)) component = null;
      componentFile = component ? (context.components.get(component) ?? null) : null;
    } else {
      const loaded = resolveSpecifierFile(importSpecifierOf(lazyExpression!), context.sourceFile, context.aliases);
      if (!loaded) {
        context.unreadable.push({ path, detail: `lazy import could not be resolved: ${lazyExpression!.getText(context.source).slice(0, 120)}` });
        continue;
      }
      // `.then(({ UsersRoute }) => ({ default: UsersRoute }))`: one export of the module is the page, not the module.
      const named = lazyNamedExport(lazyExpression!);
      const page = named !== null ? namedExportPage(loaded, named, context.modules) : null;
      componentFile = page ? page.file : loaded;
      component = page ? page.component : lazyComponentName(loaded);
      declaredIn = page?.declaredIn;
    }
    const placements = navPlacements(properties.get('nav'));

    let roles: readonly RoleName[] | null;
    let roleKey: string | null = null;
    if (rolesInDoubt || guard === null) {
      // Something spread into the entry after its last `roles` could set them, or a guard above it (or
      // something that may have put one there) cannot be read: its own `roles` cannot widen what that
      // guard allows, and what it allows is not known. Not guessed.
      roles = null;
    } else if (!rolesExpression) {
      // A third shape, found on an app we do not own: the guard is a
      // PARENT route whose element carries the roles, and the guarded routes are
      // its children.
      //
      //   <Route element={<ProtectedRoute allowedRoles={['ADMIN']} />}>
      //     <Route path="/admin/users" element={<UserManagement />} />
      //
      // Before this, that app's four admin-only screens were emitted as PUBLIC —
      // one registry, every user, no skip reported. Rule 17 is a security
      // property and that was a leak, so an inherited guard is read here, and an
      // inherited guard that cannot be read is `null` like any other.
      roles = guard === undefined ? context.roles.allRoles : guard;
    } else {
      // Its own `roles`, and no more than every guard above it allows.
      roleKey = accessed?.name.text ?? null;
      roles = narrow(guard, written) ?? null;
    }

    const redirectTo = hasElement ? elementRedirect(properties.get('element')) : null;
    context.out.push({
      path,
      component,
      componentFile,
      feature: featureOf(componentFile),
      ...(hasElement && component && !componentFile ? { routedIn: context.sourceFile } : {}),
      ...(declaredIn ? { routedIn: declaredIn } : {}),
      roles: roles && roles.length > 0 ? [...new Set(roles)] : roles === null ? null : [],
      roleKey,
      ...(placements ? { navPlacements: placements } : {}),
      devOnly: context.devOnly === true || isDevGuarded(node),
      comment: leadingComment(context.source, node),
      ...(redirectTo !== null ? { redirectTo } : {}),
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
  unreadable: readonly UnreadableRoute[];
} {
  const found = discoverByRouter(config);
  return withRouteRolesInAudience({ ...found, routes: applyRouteRoles(found.routes, config.routeRoles) });
}

/**
 * A role named on a route is a role the application has.
 *
 * Found on the first Angular build: `data: { roles: ['ADMIN'] }` narrowed `/admin` to ADMIN,
 * but with no permissions module the audience was the single `PUBLIC` one, so no ADMIN
 * registry was ever built. The admin screen did not leak — it reached nobody, which is the
 * other way to be wrong. The same held for `routeRoles`, whose test only looked at discovery.
 *
 * So a role named on a route joins the audience, and a route that was open to the whole
 * audience stays open to it, the new role included: an unguarded screen is one an admin can
 * open too. A narrowed route keeps exactly its own roles, so nothing reaches a role that was
 * not already allowed it (Rule 17).
 */
function withRouteRolesInAudience<T extends { routes: readonly DiscoveredRoute[]; roles: RoleModel }>(found: T): T {
  const audience = found.roles.allRoles;
  const named = [...new Set(found.routes.flatMap((route) => route.roles ?? []))];
  const joining = named.filter((role) => !audience.includes(role));
  if (joining.length === 0) return found;
  const widened = [...audience, ...joining].sort();
  const openToAll = (roles: readonly RoleName[]): boolean =>
    roles.length === audience.length && audience.every((role) => roles.includes(role));
  return {
    ...found,
    roles: { ...found.roles, allRoles: widened },
    routes: found.routes.map((route) => (route.roles && openToAll(route.roles) ? { ...route, roles: widened } : route)),
  };
}

/**
 * `routeRoles`: roles an application enforces in code, declared by the adopter.
 *
 * A folder layout declares no roles, and many apps guard a screen in a middleware,
 * a layout or a loader that no static reading can follow. Without this, such an
 * app's restricted screens would reach every role. The longest prefix that matches
 * at a segment boundary wins — `/admin` covers `/admin/users`, never
 * `/administration` — and it replaces whatever discovery found, an unreadable
 * guard included, because the adopter has now said what the code does.
 */
function applyRouteRoles(
  routes: readonly DiscoveredRoute[],
  routeRoles: GeneratorConfig['routeRoles'],
): readonly DiscoveredRoute[] {
  if (!routeRoles) return routes;
  const prefixes = Object.keys(routeRoles).sort((a, b) => b.length - a.length);
  if (prefixes.length === 0) return routes;
  return routes.map((route) => {
    const prefix = prefixes.find((candidate) => {
      const base = candidate.replace(/\/+$/, '') || '/';
      return base === '/' || route.path === base || route.path.startsWith(`${base}/`);
    });
    return prefix ? { ...route, roles: [...new Set(routeRoles[prefix]!)], roleKey: null } : route;
  });
}

function discoverByRouter(config: GeneratorConfig): {
  routes: readonly DiscoveredRoute[];
  roles: RoleModel;
  unreadable: readonly UnreadableRoute[];
} {
  const folderLayouts = {
    next: discoverNextRoutes,
    remix: discoverRemixRoutes,
    sveltekit: discoverSvelteKitRoutes,
    nuxt: discoverNuxtRoutes,
  } as const;
  // Vue Router and Angular declare a route table in code, as React Router does: read below.
  const layout = config.router
    ? (folderLayouts as Partial<Record<string, typeof discoverNextRoutes>>)[config.router]
    : undefined;
  if (layout) {
    const roles = readRoleModel(config);
    const routesDir = resolve(config.appRoot, config.routesFile);
    const found = layout(routesDir, roles.allRoles);
    return { routes: found.routes, roles, unreadable: found.leftOut.map(({ path, reason, detail }) => ({ path, reason, detail })) };
  }

  const routesFile = resolve(config.appRoot, config.routesFile);
  const source = parse(routesFile);
  const roles = rolesFromRouteTable(source, readRoleModel(config));
  const aliases = readAliases(config.appRoot);
  const modules = createModules(aliases, new Map([[routesFile, source]]));

  const read = (guarded: Guarded): { out: DiscoveredRoute[]; unreadable: UnreadableRoute[] } => {
    const out: DiscoveredRoute[] = [];
    const unreadable: UnreadableRoute[] = [];
    const context: CollectContext = {
      source,
      sourceFile: routesFile,
      components: componentSources(source, routesFile, aliases),
      roles,
      roleSetExport: config.roleSetExport,
      permissionsFile: config.permissionsFile ? resolve(config.appRoot, config.permissionsFile) : null,
      guarded,
      aliases,
      scope: stringScope(source, routesFile, aliases),
      modules,
      collected: new Set(),
      unreadable,
      out,
    };
    collect(routeObjectsIn(source), '', context);
    followSpreads(source, source, routesFile, context, new Set());
    return { out, unreadable };
  };
  // A route array spread under a nested route may be found only in a module followed after a `.filter`
  // over the same routes was looked through. Read again, knowing every one, before any filter is trusted.
  const guarded: Guarded = { entries: new Set(), sources: new Set() };
  let found = read(guarded);
  if (guarded.entries.size > 0 || guarded.sources.size > 0) {
    found = read({ entries: new Set(guarded.entries), sources: new Set(guarded.sources) });
  }

  return { routes: found.out, roles, unreadable: found.unreadable };
}

/** Resolve a component import to a file on disk, trying the usual extensions. */
function resolveComponentFile(base: string | null): string | null {
  if (!base) return null;
  const extensions = ['.tsx', '.ts', '.jsx', '.js', '.vue', '.svelte'];
  const candidates = [
    // `@/views/Home.vue`: the import already names the file.
    base,
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
