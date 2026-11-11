/**
 * Execution package public surface (WP-03).
 * Local product ports plus the AttemptSupervisor; no core or storage import.
 */
export * from './contracts.ts'
export { AttemptSupervisor } from './supervisor.ts'
export type {
  FenceDecision,
  StartInput,
  StopResult,
  SupervisorOptions,
} from './supervisor.ts'

// --- wave-08 B2: current resource facts for recovery and upgrade ------------------------------
export {
  INVALID_INFERENCES,
  RESOURCE_VERDICTS,
  classifyResource,
  describeResourceFacts,
  resourceFactsDigest,
} from './resource-facts.ts'
