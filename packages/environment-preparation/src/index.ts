/**
 * Isolated dependency preparation for a real project in an attempt worktree. The exported port is
 * package-local (no product wire schema): detect package.json/lock/manager, validate dependency
 * sources, prepare only inside the private workspace with offline/frozen/ignore-scripts, and return a
 * reproducible fingerprint, allowlisted environment, diagnostic evidence and an owned cleanup handle.
 */
export { prepareEnvironment } from './prepare.ts'
export { inspectWorkspace, nodeRangeSatisfied } from './project.ts'
export { runOwned } from './process.ts'
export {
  EnvironmentPreparationError, defaultEnvironmentExclusions,
  type BlockedEnvironment, type CleanupResult, type DiagnosticSeverity, type EnvironmentDiagnostic,
  type EnvironmentEvidence, type EnvironmentExclusionPort, type EnvironmentManager,
  type EnvironmentPreparationInput, type PreparationPolicy, type PreparationResult, type ReadyEnvironment,
} from './types.ts'
