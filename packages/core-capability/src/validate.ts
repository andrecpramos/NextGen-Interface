import {
  exampleText,
  isCapabilityKind,
  isLocaleParam,
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
/** BCP 47, loosely: "en", "pt-PT", "zh-Hant". Also a key in `translations`, so nothing else gets in. */
const LANGUAGE_TAG = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;
const TRANSLATED = new Set(['title', 'explanation', 'refusal']);

/** Text that goes into a model's prompt is bounded here, so no registry can make every turn enormous. */
const CONTEXT_MAX_TEXT = 600;
const CONTEXT_MAX_RULES = 60;
const CONTEXT_MAX_GLOSSARY = 200;
const CONTEXT_MAX_LIMITS = 50;
const CONTEXT_KEYS = new Set(['glossary', 'rules', 'limits']);

/**
 * The owner's `context` (ADR-023): checked for shape and size, never for meaning. It is text a
 * model is handed, so a malformed or oversized one is refused when the registry is written, not
 * discovered in a prompt.
 */
function validateContext(
  context: unknown,
  err: (capabilityId: string | null, rule: string, message: string) => void,
  warn: (capabilityId: string | null, rule: string, message: string) => void,
): void {
  if (typeof context !== 'object' || context === null || Array.isArray(context)) {
    err(null, 'context-shape', 'context must be an object with glossary, rules and limits');
    return;
  }
  const c = context as Record<string, unknown>;
  for (const key of Object.keys(c)) {
    if (!CONTEXT_KEYS.has(key)) warn(null, 'context-unknown-key', `context has an unknown key "${key}" — known: glossary, rules, limits`);
  }
  const text = (value: unknown, where: string, required = true): boolean => {
    if (value === undefined && !required) return true;
    if (typeof value !== 'string' || value.trim() === '') {
      err(null, 'context-shape', `${where} must be non-empty text`);
      return false;
    }
    if (value.length > CONTEXT_MAX_TEXT) err(null, 'context-size', `${where} is ${value.length} characters; the most a prompt is given is ${CONTEXT_MAX_TEXT}`);
    return true;
  };
  const listOf = (value: unknown, where: string, max: number): unknown[] => {
    if (value === undefined) return [];
    if (!Array.isArray(value)) {
      err(null, 'context-shape', `${where} must be a list`);
      return [];
    }
    if (value.length > max) err(null, 'context-size', `${where} has ${value.length} entries; the most a prompt is given is ${max}`);
    return value;
  };

  listOf(c.rules, 'context.rules', CONTEXT_MAX_RULES).forEach((rule, i) => text(rule, `context.rules[${i}]`));
  listOf(c.glossary, 'context.glossary', CONTEXT_MAX_GLOSSARY).forEach((entry, i) => {
    const where = `context.glossary[${i}]`;
    if (typeof entry !== 'object' || entry === null) return void err(null, 'context-shape', `${where} must be an object`);
    const e = entry as Record<string, unknown>;
    text(e.term, `${where}.term`);
    text(e.means, `${where}.means`, false);
    listOf(e.aliases, `${where}.aliases`, 20).forEach((alias, j) => text(alias, `${where}.aliases[${j}]`));
  });
  listOf(c.limits, 'context.limits', CONTEXT_MAX_LIMITS).forEach((entry, i) => {
    const where = `context.limits[${i}]`;
    if (typeof entry !== 'object' || entry === null) return void err(null, 'context-shape', `${where} must be an object`);
    const e = entry as Record<string, unknown>;
    text(e.about, `${where}.about`);
    text(e.say, `${where}.say`);
  });
}

export function validateRegistry(registry: RegistryFile): ValidationResult {
  const issues: ValidationIssue[] = [];
  const err = (capabilityId: string | null, rule: string, message: string) =>
    issues.push({ severity: 'error', capabilityId, rule, message });
  const warn = (capabilityId: string | null, rule: string, message: string) =>
    issues.push({ severity: 'warning', capabilityId, rule, message });

  if (typeof registry.schemaVersion !== 'number') {
    err(null, 'schema-version', 'registry has no numeric schemaVersion');
  }
  if (!registry.domainDescription?.trim()) {
    err(null, 'domain-description-required', 'registry has no domainDescription — stage 3 needs to know what application it serves (Rule 1)');
  }
  if (registry.context !== undefined) validateContext(registry.context, err, warn);
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

  // Where a limit sends the visitor to help themselves must be a screen of *this* registry: a limit is
  // given to every role, and a route this role cannot open named in its file is a Rule 17 leak — and a
  // link to nowhere.
  const screens = new Set(registry.capabilities.filter((c) => c.kind !== 'unsupported' && c.route).map((c) => c.route!));
  for (const cap of registry.capabilities) {
    const helpAt = (cap as { helpAt?: unknown }).helpAt;
    if (helpAt === undefined) continue;
    if (cap.kind !== 'unsupported') {
      err(cap.id, 'help-at-misplaced', `"${cap.id}" is ${cap.kind} but declares "helpAt" — only a limit points elsewhere`);
    } else if (!Array.isArray(helpAt) || helpAt.some((route) => typeof route !== 'string' || !screens.has(route))) {
      err(cap.id, 'help-at-reachable', `"${cap.id}" helpAt names a route that is not a screen of this registry: ${JSON.stringify(helpAt)}`);
    }
  }

  // A translation is shown to a visitor as text (ADR-030): a language tag, and short strings, or nothing.
  const language = (registry as { language?: unknown }).language;
  if (language !== undefined && !(typeof language === 'string' && LANGUAGE_TAG.test(language))) {
    err(null, 'language-tag', `"language" must be a language tag such as "pt-PT", not ${JSON.stringify(language)}`);
  }
  for (const cap of registry.capabilities) {
    const translations = (cap as { translations?: unknown }).translations;
    if (translations === undefined) continue;
    const fine =
      typeof translations === 'object' && translations !== null && !Array.isArray(translations) &&
      Object.entries(translations).every(([tag, text]) =>
        LANGUAGE_TAG.test(tag) && typeof text === 'object' && text !== null && !Array.isArray(text) &&
        Object.entries(text).every(([field, value]) => TRANSLATED.has(field) && typeof value === 'string' && value.length <= 2000));
    if (!fine) err(cap.id, 'translations-shape', `"${cap.id}" translations must map language tags to { title, explanation, refusal } strings`);
  }

  // What the widget may press for a visitor (ADR-031): short names of controls on a screen, nothing else.
  for (const cap of registry.capabilities) {
    const opens = (cap as { opens?: unknown }).opens;
    if (opens === undefined) continue;
    if (cap.kind === 'unsupported' || !cap.route) {
      err(cap.id, 'opens-misplaced', `"${cap.id}" declares "opens" but is not a screen — only a screen has controls to open`);
    } else if (!Array.isArray(opens) || opens.length > 20 || opens.some((name) => typeof name !== 'string' || name.trim() === '' || name.length > 80)) {
      err(cap.id, 'opens-shape', `"${cap.id}" opens must be at most 20 control names of at most 80 characters`);
    }
  }

  // What a screen lets a visitor do (ADR-042): the same shape as `opens`, and only on a screen.
  for (const cap of registry.capabilities) {
    const actions = (cap as { actions?: unknown }).actions;
    if (actions === undefined) continue;
    if (cap.kind === 'unsupported' || !cap.route) {
      err(cap.id, 'actions-misplaced', `"${cap.id}" declares "actions" but is not a screen — only a screen has controls`);
    } else if (!Array.isArray(actions) || actions.length > 20 || actions.some((name) => typeof name !== 'string' || name.trim() === '' || name.length > 80)) {
      err(cap.id, 'actions-shape', `"${cap.id}" actions must be at most 20 control names of at most 80 characters`);
    }
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
  // ADR-025: a limit may be one that refuses only a request to act. Any other value is a typo that would
  // silently leave it refusing on topic, and on anything but a limit it means nothing.
  const refuses = (cap as { refuses?: unknown }).refuses;
  if (refuses !== undefined) {
    if (!isBoundary) err(id, 'refuses-misplaced', `"${id}" is ${cap.kind} but declares "refuses" — only unsupported capabilities refuse`);
    else if (refuses !== 'action') err(id, 'refuses-known', `"${id}" declares refuses "${String(refuses)}" — the only value is "action"`);
  }

  // --- prose ------------------------------------------------------------------
  if (!cap.title?.trim()) err(id, 'title-required', `"${id}" has no title`);
  if (!cap.description?.trim()) {
    err(id, 'description-required', `"${id}" has no description — stage-2 retrieval is built from it`);
  } else if (cap.description.trim().length < 20) {
    warn(id, 'description-thin', `"${id}" has a very short description; stage-2 margin depends on it being distinctive`);
  }

  // --- the declared explanation ---------------------------------------
  // "What is this / what does this page do" is answered from a string written
  // once, not from a model called per turn. A capability with no explanation is
  // a question the assistant has to escalate or guess at, which is exactly the
  // chat-widget failure Ladder A1 exists to avoid. A declared limit is exempt:
  // its `refusal` already answers the same question.
  if (!isBoundary) {
    if (!cap.explanation?.trim()) {
      err(id, 'explanation-required', `"${id}" has no explanation — "what is this?" would have to be generated per turn`);
    } else if (cap.explanation.trim().length < 30) {
      warn(id, 'explanation-thin', `"${id}" has a very short explanation; it is served to the user verbatim`);
    }
    if (cap.explanation?.trim() && !cap.explanationSource?.trim()) {
      warn(id, 'explanation-untraceable', `"${id}" has an explanation with no source — a wrong answer cannot be traced back to fix it`);
    }
  }

  // --- guided steps -----------------------------------------------
  // A step's text is what a user gets when its anchor cannot be found, so a step
  // without text is a highlight with no instruction. And a selector-only anchor
  // breaks silently on the next redesign.
  if (isBoundary && (cap.steps?.length ?? 0) > 0) {
    err(id, 'steps-on-boundary', `"${id}" is a declared limit and cannot have steps — there is no page to guide anyone through`);
  }
  for (const [index, step] of (cap.steps ?? []).entries()) {
    const where = `"${id}" step ${index + 1}`;
    if (!step.text?.trim()) {
      err(id, 'step-text-required', `${where} has no text — it is what the user sees when the anchor cannot be found`);
    }
    const anchor = step.anchor;
    if (anchor && !anchor.label && !anchor.role && anchor.selector) {
      warn(id, 'step-anchor-selector-only', `${where} anchors by CSS selector alone — it will break silently on the next redesign (a selector is the fallback, never the only signal)`);
    }
    if (anchor && !anchor.label && !anchor.selector) {
      warn(id, 'step-anchor-empty', `${where} declares an anchor with nothing to match`);
    }
  }

  // --- extracted rules (ADR-020) ---------------------------------------
  // Rule 13 gains a sibling: a limit is declared, never judged by the model, and
  // now an application rule is *extracted*, never judged by the model either.
  // What makes an extracted rule trustworthy is exactly what makes an
  // explanation trustworthy — a source a human can check.
  if (isBoundary && (cap.rules?.length ?? 0) > 0) {
    err(id, 'rules-on-boundary', `"${id}" is a declared limit and cannot have rules — there is no form to constrain`);
  }
  for (const [index, rule] of (cap.rules ?? []).entries()) {
    const where = `"${id}" rule ${index + 1}`;
    if (!rule.field?.trim()) err(id, 'rule-field-required', `${where} names no field`);
    if (!rule.statement?.trim()) err(id, 'rule-statement-required', `${where} has no statement`);
    if (!rule.source?.trim()) {
      err(id, 'rule-untraceable', `${where} has no source — an extracted rule with no provenance cannot be checked (ADR-020)`);
    }
    if (rule.tier !== 'read' && rule.tier !== 'inferred') {
      err(id, 'rule-tier-invalid', `${where} has an unrecognised tier "${String(rule.tier)}"`);
    }
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
  // capability does not declare it, the route can never be built. A locale prefix
  // is the exception: the page fills it, so it is never declared (`isLocaleParam`).
  for (const segment of (cap.route ?? '').split('/')) {
    if (!segment.startsWith(':')) continue;
    if (isLocaleParam(segment) && !cap.params?.[segment.slice(1).replace(/\?$/, '')]) continue;
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
