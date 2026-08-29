import type {
  Capability,
  CapabilityExample,
  EnumDefinition,
  ExecutableKind,
  ParamSpec,
  RegistryFile,
} from './types.ts';

/**
 * The typed builder. This is what a domain writes; everything else in the
 * pipeline is generated from it.
 *
 * It replaces the Dart `@Capability` annotation from the original blueprint
 * (ADR-006 moved the stack to TypeScript). The job is the same: one definition,
 * from which the route table, the intent registry, and the golden-set fixtures
 * are all derived, so they cannot drift apart.
 */

export interface CapabilityDefinition {
  readonly id: string;
  readonly kind: ExecutableKind;
  readonly route: string;
  readonly title: string;
  readonly description: string;
  readonly triggers?: readonly string[];
  readonly params?: Readonly<Record<string, ParamSpec>>;
  /** At least three (coding-standards.md). The validator enforces it. */
  readonly examples: readonly (string | CapabilityExample)[];
}

/**
 * A declared limit of the application.
 *
 * ADR-009. An `unsupported` entry is matched by exactly the same retrieval as
 * every other capability, which is the whole point: out-of-scope detection stops
 * being a judgement the model makes and becomes ordinary routing. It therefore
 * behaves identically on a 1B model and an 8B one — measured, because there is
 * no model involved in it at all.
 */
export interface BoundaryDefinition {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly triggers?: readonly string[];
  readonly examples: readonly (string | CapabilityExample)[];
  /** What the user is told. Say what the app *can* do, not only what it cannot. */
  readonly refusal: string;
}

/**
 * Define one capability.
 *
 * `kind` is `ExecutableKind` here, so a domain cannot accidentally declare an
 * executable capability as `unsupported` — the boundary has its own builder, and
 * conflating the two is how you end up with a refusal that has a route.
 */
export function defineCapability(def: CapabilityDefinition): Capability {
  return {
    id: def.id,
    kind: def.kind,
    route: def.route,
    title: def.title,
    description: def.description,
    ...(def.triggers ? { triggers: def.triggers } : {}),
    ...(def.params ? { params: def.params } : {}),
    examples: def.examples,
  };
}

/** Define a declared limit — something this application deliberately does not do. */
export function defineBoundary(def: BoundaryDefinition): Capability {
  return {
    id: def.id,
    kind: 'unsupported',
    route: null,
    title: def.title,
    description: def.description,
    ...(def.triggers ? { triggers: def.triggers } : {}),
    params: {},
    examples: def.examples,
    refusal: def.refusal,
  };
}

export interface RegistryDefinition {
  readonly schemaVersion?: number;
  readonly capabilities: readonly Capability[];
  readonly enums?: Readonly<Record<string, EnumDefinition>>;
}

export function defineRegistry(def: RegistryDefinition): RegistryFile {
  return {
    schemaVersion: def.schemaVersion ?? 1,
    capabilities: def.capabilities,
    ...(def.enums ? { enums: def.enums } : {}),
  };
}
