// @nextgen/domain-modules
//
// The registered domain: the user tells the AI what to remember, and the AI
// organizes it into modules — arbitrary topic, arbitrary category, entirely
// built at runtime. Structurally the same shape as @nextgen/domain-finance
// (entities, ports, use cases, capabilities), which stays in the repo as the
// reference domain but is no longer what the composition root registers by
// default.

export { capabilities, boundary, enums, registry } from './capabilities.ts';

export type {
  Module, ModuleCategory, ModuleCategoryRepository,
  ModuleEntry, ModuleEntryKind, ModuleEntryRepository,
  ModuleRepository, ModuleSourceType,
  Repositories,
} from './entities.ts';

export { EventBus, type DomainEvent, type EventHandler } from './events.ts';

export {
  commitCapture, deleteModule, proposeCapture, relatedModules, revertModule, searchModules,
  type CaptureCandidate, type CaptureDecision, type CaptureInput, type CaptureProposal,
  type CommitCaptureInput, type CommitOutcome,
  type ModuleMatch, type RelatedModulesOptions, type Result, type UseCaseDeps,
} from './use-cases.ts';
