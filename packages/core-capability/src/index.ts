// @nextgen/core-capability
//
// The capability registry: schema, typed builders, validation and codegen.
//
// This package owns the contract that routing, navigation and the intent engine
// all read, so they cannot drift. It depends on nothing else in the workspace —
// a contract that imports its consumers is not a contract.

export {
  isCapabilityKind,
  isExecutableKind,
  exampleText,
  type Capability,
  type CapabilityExample,
  type CapabilityKind,
  type EnumDefinition,
  type ExecutableKind,
  type ParamSpec,
  type ParamType,
  type RegistryFile,
} from './types.ts';

export {
  defineCapability,
  defineBoundary,
  defineRegistry,
  type BoundaryDefinition,
  type CapabilityDefinition,
  type RegistryDefinition,
} from './define.ts';

export {
  validateRegistry,
  assertValidRegistry,
  formatValidation,
  type Severity,
  type ValidationIssue,
  type ValidationResult,
} from './validate.ts';

export {
  capabilityDocument,
  generateRouteTable,
  generateCapabilitiesJson,
  generateEmbeddingIndex,
  generateGoldenEntries,
  type EmbeddingIndex,
  type GoldenEntry,
  type RouteEntry,
} from './codegen.ts';

export {
  similarityAudit,
  boundaryAudit,
  type BoundaryAudit,
  type SimilarPair,
} from './audit.ts';
