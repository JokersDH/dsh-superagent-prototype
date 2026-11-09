/**
 * Isolated dependency preparation for a real project in an attempt worktree. The exported port is
 * package-local (no product wire schema): detect package.json/lock/manager, validate dependency
 * sources, prepare only inside the private workspace with offline/frozen/ignore-scripts, and return a
 * reproducible fingerprint, allowlisted environment, diagnostic evidence and an owned cleanup handle.
 */
export { prepareEnvironment } from './prepare.ts'
export { verifyPreparedEnvironment, cleanupPreparedEnvironment } from './verify.ts'
export { standaloneProcessPort } from './process.ts'
export { inspectWorkspace, nodeRangeSatisfied, versionsEqual } from './project.ts'
export { runOwned } from './process.ts'
export {
  EnvironmentPreparationError, defaultEnvironmentExclusions,
  type BlockedEnvironment, type CleanupResult, type DiagnosticSeverity, type EnvironmentDiagnostic,
  type EnvironmentEvidence, type EnvironmentExclusionPort, type EnvironmentManager, type EnvironmentProcessPort,
  type EnvironmentProcessResult, type EnvironmentPreparationInput, type EnvironmentRef,
  type EnvironmentVerificationResult, type FailedEnvironmentVerification, type PreparationPolicy,
  type PreparationResult, type ReadyEnvironment, type TrustedCleanupResult, type VerifiedEnvironment,
} from './types.ts'
