import {
  exampleText,
  isCapabilityKind,
  type Capability,
  type RegistryFile,
} from './types.ts';

/**
 * Registry validation.
 *
 * A registry that is merely *parsed* is not validated. Every rule here exists
 * because breaking it produces a failure somewhere far away and much later: a
 * capability with no examples routes badly and nobody knows why; a duplicate
 * trigger silently shadows another capability; a param that names an enum the
 * registry does not declare can never be filled, so the turn escalates forever.
 *
 * This runs in CI. Failing loudly at build time is the entire point.
 */

export type Severity = 'error' | 'warning';

export interface ValidationIssue {
  readonly severity: Severity;
  readonly capabilityId: string | null;
  readonly rule: string;
  readonly message: string;
}

export interface ValidationResult {
  readonly ok: boolean;
  readonly issues: readonly ValidationIssue[];
  readonly errors: readonly ValidationIssue[];
  readonly warnings: readonly ValidationIssue[];
}

const ID_PATTERN = /^[a-z][a-z0-9]*(\.[a-z][a-z0-9_]*)+$/;
const MIN_EXAMPLES = 3;

export function validateRegistry(registry: RegistryFile): ValidationResult {
  const issues: ValidationIssue[] = [];
  const err = (capabilityId: string | null, rule: string, message: string) =>
    issues.push({ severity: 'error', capabilityId, rule, message });
  const warn = (capabilityId: string | null, rule: string, message: string) =>
    issues.push({ severity: 'warning', capabilityId, rule, message });

  if (typeof registry.schemaVersion !== 'number') {
    err(null, 'schema-version', 'registry has no numeric schemaVersion');
  }
  if (!Array.isArray(registry.capabilities) || registry.capabilities.length === 0) {
    err(null, 'non-empty', 'registry declares no capabilities');
    return summarise(issues);
  }

  const seenIds = new Set<string>();
  const triggerOwners = new Map<string, string>();
  const routeOwners = new Map<string, string>();
  const enumNames = new Set(Object.keys(registry.enums ?? {}));

  for (const cap of registry.capabilities) {
    validateOne(cap, { err, warn, seenIds, triggerOwners, routeOwners, enumNames });
  }

  return summarise(issues);
}

interface Ctx {
  err: (id: string | null, rule: string, message: string) => void;
  warn: (id: string | null, rule: string, message: string) => void;
  seenIds: Set<string>;
  triggerOwners: Map<string, string>;
  routeOwners: Map<string, string>;
  enumNames: Set<string>;
}

function validateOne(cap: Capability, ctx: Ctx): void {
  const { err, warn, seenIds, triggerOwners, routeOwners, enumNames } = ctx;
  const id = cap.id;

  // --- identity ---------------------------------------------------------------
  if (!id) {
    err(null, 'id-required', 'a capability has no id');
    return;
  }
  if (!ID_PATTERN.test(id)) {
    err(id, 'id-format', `id "${id}" must be dotted lowercase, e.g. "transactions.list"`);
  }
  if (seenIds.has(id)) {
    err(id, 'id-unique', `duplicate capability id "${id}"`);
  }
  seenIds.add(id);

  // --- kind: the ADR-004 fail-closed rule -------------------------------------
  // This is the check the whole policy table rests on. An unclassified kind is
  // not a style problem; it is a capability nobody decided the safety of.
  if (!cap.kind) {
    err(id, 'kind-required', `"${id}" declares no kind — unclassified capabilities are refused (ADR-004)`);
  } else if (!isCapabilityKind(cap.kind)) {
    err(id, 'kind-known', `"${id}" has unknown kind "${cap.kind}" — refused (ADR-004)`);
  }

  const isBoundary = cap.kind === 'unsupported';

  // --- route ------------------------------------------------------------------
  if (isBoundary) {
    if (cap.route !== null && cap.route !== undefined) {
      err(id, 'boundary-no-route', `"${id}" is unsupported but declares route "${cap.route}" — a refusal has nowhere to navigate`);
    }
    if (!cap.refusal || !cap.refusal.trim()) {
      err(id, 'boundary-refusal', `"${id}" is unsupported but has no refusal message — the user must be told what the app does instead`);
    }
  } else {
    if (!cap.route) {
      err(id, 'route-required', `"${id}" has no route`);
    } else {
      if (!cap.route.startsWith('/')) {
        err(id, 'route-format', `"${id}" route "${cap.route}" must start with "/"`);
      }
      const owner = routeOwners.get(cap.route);
      // Two capabilities may legitimately share a screen (list and its filtered
      // view), so this is a warning — but it is worth seeing, because it is also
      // what an accidental copy-paste looks like.
      if (owner && owner !== id) {
        warn(id, 'route-shared', `"${id}" shares route "${cap.route}" with "${owner}"`);
      }
      routeOwners.set(cap.route, id);
    }
    if (cap.refusal) {
      err(id, 'refusal-misplaced', `"${id}" is ${cap.kind} but declares a refusal message — only unsupported capabilities refuse`);
    }
  }

  // --- prose ------------------------------------------------------------------
  if (!cap.title?.trim()) err(id, 'title-required', `"${id}" has no title`);
  if (!cap.description?.trim()) {
    err(id, 'description-required', `"${id}" has no description — stage-2 retrieval is built from it`);
  } else if (cap.description.trim().length < 20) {
    warn(id, 'description-thin', `"${id}" has a very short description; stage-2 margin depends on it being distinctive`);
  }

  // --- examples: the ≥3 rule from coding-standards.md -------------------------
  // Not documentation. They are the retrieval document, the few-shot pool and
  // the golden-set fixtures, so a capability with two of them is under-specified
  // in three places at once.
  const examples = cap.examples ?? [];
  if (examples.length < MIN_EXAMPLES) {
    err(id, 'examples-min', `"${id}" has ${examples.length} example(s); at least ${MIN_EXAMPLES} are required`);
  }
  const seenExamples = new Set<string>();
  for (const ex of examples) {
    const text = exampleText(ex);
    if (!text?.trim()) {
      err(id, 'example-empty', `"${id}" has an empty example`);
      continue;
    }
    const key = text.trim().toLowerCase();
    if (seenExamples.has(key)) warn(id, 'example-duplicate', `"${id}" repeats the example "${text}"`);
    seenExamples.add(key);
  }

  // --- triggers ---------------------------------------------------------------
  for (const trigger of cap.triggers ?? []) {
    const key = trigger.trim().toLowerCase();
    if (!key) {
      err(id, 'trigger-empty', `"${id}" has an empty trigger`);
      continue;
    }
    const owner = triggerOwners.get(key);
    // A duplicate trigger is a silent shadow: stage 1 takes the first
    // registration and the second capability becomes unreachable by phrase.
    if (owner && owner !== id) {
      err(id, 'trigger-unique', `trigger "${trigger}" is claimed by both "${owner}" and "${id}" — stage 1 would silently shadow one`);
    }
    triggerOwners.set(key, id);
  }

  // --- params -----------------------------------------------------------------
  for (const [name, spec] of Object.entries(cap.params ?? {})) {
    if (!spec?.type) {
      err(id, 'param-type', `"${id}" param "${name}" has no type`);
      continue;
    }
    if (spec.type.startsWith('enum:')) {
      const enumName = spec.type.slice(5);
      if (!enumNames.has(enumName)) {
        err(id, 'param-enum-declared', `"${id}" param "${name}" references enum "${enumName}", which the registry does not declare`);
      }
    } else if (!['date', 'money', 'number', 'string'].includes(spec.type)) {
      err(id, 'param-type-known', `"${id}" param "${name}" has unknown type "${spec.type}"`);
    }
    if (isBoundary) {
      err(id, 'boundary-no-params', `"${id}" is unsupported but declares param "${name}" — a refusal takes no arguments`);
    }
  }

  // --- route/param coherence --------------------------------------------------
  // A path segment like /budget/:id is a promise that `id` is fillable. If the
  // capability does not declare it, the route can never be built.
  for (const segment of (cap.route ?? '').split('/')) {
    if (!segment.startsWith(':')) continue;
    const paramName = segment.slice(1);
    if (!cap.params?.[paramName]) {
      err(id, 'route-param-declared', `"${id}" route "${cap.route}" needs "${paramName}", which is not a declared param`);
    } else if (!cap.params[paramName]?.required) {
      err(id, 'route-param-required', `"${id}" route "${cap.route}" needs "${paramName}", so it must be required`);
    }
  }
}

function summarise(issues: ValidationIssue[]): ValidationResult {
  const errors = issues.filter((i) => i.severity === 'error');
  const warnings = issues.filter((i) => i.severity === 'warning');
  return { ok: errors.length === 0, issues, errors, warnings };
}

/** Render a result for a terminal or a CI log. */
export function formatValidation(result: ValidationResult): string {
  if (result.issues.length === 0) return '  registry valid — no issues\n';
  const lines: string[] = [];
  for (const i of result.issues) {
    const tag = i.severity === 'error' ? 'ERROR  ' : 'warning';
    lines.push(`  ${tag} [${i.rule}] ${i.capabilityId ?? '(registry)'}: ${i.message}`);
  }
  lines.push('');
  lines.push(`  ${result.errors.length} error(s), ${result.warnings.length} warning(s)`);
  return lines.join('\n') + '\n';
}

/** Throwing form, for build scripts that should stop. */
export function assertValidRegistry(registry: RegistryFile): void {
  const result = validateRegistry(registry);
  if (!result.ok) {
    throw new Error(`registry validation failed:\n${formatValidation(result)}`);
  }
}
