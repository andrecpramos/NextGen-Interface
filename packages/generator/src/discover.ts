import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import ts from 'typescript';

import { discoverNextRoutes, discoverNuxtRoutes, discoverRemixRoutes, discoverSvelteKitRoutes } from './filesystem.ts';
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

interface RoleEnv {
  readonly constants: Map<string, ts.Expression>;
  /** Helpers proven to be `(...xs) => [...xs]`, and therefore safe to inline. */
  readonly identityHelpers: ReadonlySet<string>;
}

/**
 * Is this arrow function exactly `(...xs) => [...xs]`?
 *
 * `readRoles` in the fixture app is such a helper. Treating *any* call as
 * "its string arguments are the roles" would misread something like
 * `except(APP_ROLES, 'STUDENT')` as granting the one role it removes — a role
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
const SINGLE_AUDIENCE = 'PUBLIC';

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
function componentSources(source: ts.SourceFile, sourceFile: string, aliases: Aliases): Map<string, string> {
  const out = new Map<string, string>();
  const record = (name: string, specifier: string | null | undefined): void => {
    const file = resolveSpecifierFile(specifier, sourceFile, aliases);
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
  readonly spread: ts.SpreadElement;
  /** Inside a route's own `children`: there a parent's path and guard apply, and are not carried in. */
  readonly nested: boolean;
}

/** `...x` inside an array that holds route objects — `[{ path: '/a', … }, ...extraRoutes]`. */
function routeSpreads(root: ts.Node): RouteSpread[] {
  const out: RouteSpread[] = [];
  const isRoute = (element: ts.Node): boolean => {
    if (!ts.isObjectLiteralExpression(element)) return false;
    const properties = objectProperties(element);
    return properties.has('path') || properties.has('children') || properties.has('index');
  };
  const visit = (node: ts.Node, nested: boolean): void => {
    if (ts.isArrayLiteralExpression(node) && node.elements.some(isRoute)) {
      for (const element of node.elements) if (ts.isSpreadElement(element)) out.push({ spread: element, nested });
    }
    const inChildren = ts.isPropertyAssignment(node) && node.name.getText() === 'children';
    ts.forEachChild(node, (child) => visit(child, nested || inChildren));
  };
  visit(root, false);
  return out;
}

type CollectContext = Parameters<typeof collect>[2];

/**
 * A spread of routes from another module: followed, or reported — never silently dropped.
 *
 * A real app's route table ended `...workspaces`, and before this the routes it named were simply not
 * there, with nothing in `SKIPPED.md` to say so: under-discovery no skip report can mention.
 * An imported array of routes is read in the module that declares it, with *that* module's imports. A
 * computed one (`...workspaces.flatMap(…)`), one that is not an array literal, and any inside a nested
 * route — where a parent's path and guard would have to be carried in, and a guess there is a role leak
 * (Rule 17) — are reported with the expression quoted.
 */
function followSpreads(root: ts.Node, source: ts.SourceFile, sourceFile: string, context: CollectContext, seen: Set<string>): void {
  const local = moduleConstants(source);
  const imported = new Map<string, { file: string; name: string }>();
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteralLike(statement.moduleSpecifier)) continue;
    const file = resolveSpecifierFile(statement.moduleSpecifier.text, sourceFile, context.aliases);
    const clause = statement.importClause;
    if (!file || !clause) continue;
    if (clause.name) imported.set(clause.name.text, { file, name: 'default' });
    if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
      for (const element of clause.namedBindings.elements) imported.set(element.name.text, { file, name: (element.propertyName ?? element.name).text });
    }
  }

  for (const { spread, nested } of routeSpreads(root)) {
    const quoted = spread.getText(source).replace(/\s+/g, ' ').slice(0, 90);
    const report = (why: string): void => {
      context.unreadable.push({ path: quoted, detail: `routes spread into the route table (${why}) — none of them are declared` });
    };
    const expression = unwrap(spread.expression);
    if (!ts.isIdentifier(expression)) {
      // `...(import.meta.env.DEV ? [{ path: '/dev', … }] : [])`: the routes are written out right here and
      // the whole file is already read for them. Only an expression with none in it is opaque.
      if (routeObjectsIn(expression).length === 0) report('a computed expression cannot be read');
      continue;
    }
    if (nested) {
      report('inside a nested route, whose path and guard would apply');
      continue;
    }
    const own = local.get(expression.text);
    if (own) {
      // Declared in this file: the whole file is read for route objects already.
      if (!ts.isArrayLiteralExpression(unwrap(own))) report(`${expression.text} is not an array of routes written out`);
      continue;
    }
    const target = imported.get(expression.text);
    if (!target) {
      report(`${expression.text} is not imported from a file the scanner can read`);
      continue;
    }
    const key = `${target.file}#${target.name}`;
    if (seen.has(key)) continue; // already followed: a cycle proves nothing
    seen.add(key);
    let child: ts.SourceFile | null = null;
    try {
      child = parse(target.file);
    } catch {
      child = null;
    }
    const declared = child ? moduleConstants(child).get(target.name) : undefined;
    const array = declared ? unwrap(declared) : undefined;
    if (!child || !array || !ts.isArrayLiteralExpression(array)) {
      report(`${expression.text} is not an array of routes written out`);
      continue;
    }
    const childContext: CollectContext = {
      ...context,
      source: child,
      sourceFile: target.file,
      components: componentSources(child, target.file, context.aliases),
      scope: stringScope(child, target.file, context.aliases),
    };
    collect(routeObjectsIn(array), '', childContext);
    followSpreads(array, child, target.file, childContext, seen);
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
        ? evaluateRoles(expression, { constants: new Map(), identityHelpers: new Set() })
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
  // The application, and the packages of the workspace it sits in: the generator reads the adopter's
  // code and nothing else.
  const roots = [resolve(appRoot), ...(WORKSPACES.get(aliases)?.roots ?? [])];
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

/** `routes/app/users.tsx` -> `Users`; an `index` file takes its folder's name. */
/**
 * `component: () => import("@/views/Home")` (Vue Router) and `loadComponent: () => import(...)`
 * (Angular) are the lazy page, spelled differently. A `component` that is a plain identifier is
 * the eager page, and is read like `element`.
 */
function lazyComponentProperty(expression: ts.Expression | undefined): ts.Expression | undefined {
  if (!expression) return undefined;
  const node = unwrap(expression);
  return (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) && importSpecifierOf(node) !== null ? node : undefined;
}

function lazyComponentName(file: string): string {
  const parts = file.split(/[\\/]/);
  let base = (parts.pop() ?? '').replace(/\.(?:[jt]sx?|vue|svelte)$/, '').replace(/\.component$/, '');
  if (base === 'index') base = parts.pop() ?? base;
  return base
    .split(/[-_]/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join('');
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
  // `<ProtectedRoute><WellnessFormPage /></ProtectedRoute>`: the page is the guard's one child. Two
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

function guardRoles(properties: Map<string, ts.Expression>): readonly RoleName[] | null | undefined {
  // Angular `data: { roles: [...] }` and Vue Router `meta: { roles: [...] }`. A `canActivate`
  // or `beforeEnter` guard is code: authentication is not a role, and a computed check is not read.
  for (const holder of ['data', 'meta']) {
    const value = properties.get(holder);
    const object = value ? unwrap(value) : undefined;
    if (!object || !ts.isObjectLiteralExpression(object)) continue;
    const roles = objectProperties(object).get('roles');
    if (!roles) continue;
    const evaluated = evaluateRoles(roles, { constants: new Map(), identityHelpers: new Set() });
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
    const evaluated = evaluateRoles(expression, { constants: new Map(), identityHelpers: new Set() });
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

function collect(
  entries: readonly RouteObject[],
  parentPath: string,
  context: {
    source: ts.SourceFile;
    sourceFile: string;
    components: Map<string, string>;
    roles: RoleModel;
    aliases: Aliases;
    scope: StringScope;
    unreadable: UnreadableRoute[];
    out: DiscoveredRoute[];
  },
  inherited?: readonly RoleName[] | null,
): void {
  for (const { node, properties, children } of entries) {
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
    const here = narrow(inherited, guardRoles(properties));

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

    // `lazy: () => import('./routes/users')` — the data-router spelling a
    // code-split app uses for every page. Its module is the page.
    const lazyExpression = properties.get('lazy') ?? properties.get('loadComponent') ?? lazyComponentProperty(properties.get('component'));
    const hasElement =
      properties.has('element') || properties.has('Component') || (properties.has('component') && !lazyComponentProperty(properties.get('component')));

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
    if (hasElement) {
      component = elementComponent(properties.get('element') ?? properties.get('Component') ?? properties.get('component'));
      componentFile = component ? (context.components.get(component) ?? null) : null;
    } else {
      componentFile = resolveSpecifierFile(importSpecifierOf(lazyExpression!), context.sourceFile, context.aliases);
      if (!componentFile) {
        context.unreadable.push({ path, detail: `lazy import could not be resolved: ${lazyExpression!.getText(context.source).slice(0, 120)}` });
        continue;
      }
      component = lazyComponentName(componentFile);
    }

    const rolesExpression = properties.get('roles');
    let roles: readonly RoleName[] | null;
    let roleKey: string | null = null;
    if (!rolesExpression) {
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
      roles = here === undefined ? context.roles.allRoles : here;
    } else {
      const accessed = unwrap(rolesExpression);
      roleKey = ts.isPropertyAccessExpression(accessed) ? accessed.name.text : null;
      const named = roleKey !== null ? context.roles.namedSets.get(roleKey) : undefined;
      roles = named !== undefined ? named : evaluateRoles(rolesExpression, {
        constants: new Map(),
        identityHelpers: new Set(),
      });
    }

    const redirectTo = hasElement ? elementRedirect(properties.get('element')) : null;
    context.out.push({
      path,
      component,
      componentFile,
      feature: featureOf(componentFile),
      ...(hasElement && component && !componentFile ? { routedIn: context.sourceFile } : {}),
      roles: roles && roles.length > 0 ? [...new Set(roles)] : roles === null ? null : [],
      roleKey,
      devOnly: isDevGuarded(node),
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
  const out: DiscoveredRoute[] = [];
  const unreadable: UnreadableRoute[] = [];

  const context: CollectContext = {
    source,
    sourceFile: routesFile,
    components: componentSources(source, routesFile, aliases),
    roles,
    aliases,
    scope: stringScope(source, routesFile, aliases),
    unreadable,
    out,
  };
  collect(routeObjectsIn(source), '', context);
  followSpreads(source, source, routesFile, context, new Set());

  return { routes: out, roles, unreadable };
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
