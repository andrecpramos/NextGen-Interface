/**
 * The registry generator (WP-25).
 *
 * Point it at an application's source; it emits one capability registry per
 * role, a master inventory with the role annotations kept for review, and a
 * report of every route it refused to declare and why.
 *
 * It never writes inside the application it reads (Rule 16), and it never puts
 * a capability in the registry of a role that cannot reach it (Rule 17).
 */

export { generate, type GenerateOptions } from './generate.ts';
export { discoverRoutes, readRoleModel, type RoleModel } from './discover.ts';
export { readPage } from './pages.ts';
export { readManifest, readManifests, readTranslations, translate } from './labels.ts';
export { synthesiseId, featureOf, routeSegments } from './ids.ts';
export { judgeProse, type ProseVerdict } from './prose.ts';
export { synthesiseBoundaries } from './boundaries.ts';
export {
  deriveProse,
  synthesise,
  ollamaModel,
  cacheKey,
  EXAMPLES_PER_CAPABILITY,
  type Prose,
  type ProseCache,
  type ProseModel,
  type ProseRequest,
} from './synthesise.ts';
export {
  splitByRole,
  formatSkipReport,
  formatRoleSummary,
  writeOutput,
  writeIndexes,
  SCHEMA_VERSION,
  type WriteResult,
} from './emit.ts';
export type {
  AnnotatedCapability,
  DiscoveredRoute,
  GeneratorConfig,
  GeneratorOutput,
  ManifestEntry,
  PageFacts,
  RoleName,
  SkipReason,
  SkippedRoute,
} from './types.ts';
