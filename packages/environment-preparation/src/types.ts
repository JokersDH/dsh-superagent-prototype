/** The package-local port for isolated dependency preparation. No product wire schema is added here. */
export type PreparationPolicy = 'existing_only' | 'offline_install'

export type DiagnosticSeverity = 'info' | 'warning' | 'error'

export interface EnvironmentDiagnostic {
  code: string
  severity: DiagnosticSeverity
  message: string
}

export interface EnvironmentEvidence {
  /** Stable local reference (digest-based where possible), not a product database ref. */
  ref: string
  note: string
}

export interface CleanupResult {
  removed: readonly string[]
  leftovers: readonly string[]
}

/** The integration seam an owner can pass to a workspace freeze so environment paths never enter the business patch. */
export interface EnvironmentExclusionPort {
  excludedPaths(workspacePath: string): readonly string[]
}

export interface EnvironmentPreparationInput {
  /** Authorized original project; this module only reads it. */
  projectPath: string
  /** The private attempt worktree where dependencies may be prepared. */
  workspacePath: string
  /** Stable idempotency key chosen by the caller. */
  requestId: string
  policy: PreparationPolicy
  signal: AbortSignal
  /** Trusted package-manager executable; defaults to the detected manager name. */
  managerCommand?: string
  /** Authorized offline pnpm store/cache directory (required for offline_install with dependencies). */
  storeDir?: string
  timeoutMs?: number
  maxOutputBytes?: number
  maxWorkspaceBytes?: number
  /** Allows tests/integration to supply the same exclusion port the workspace would use. */
  exclusion?: EnvironmentExclusionPort
}

export interface EnvironmentManager {
  name: 'pnpm' | 'npm' | 'none'
  declaredVersion?: string
  actualVersion?: string
}

export interface ReadyEnvironment {
  status: 'ready'
  requestId: string
  fingerprint: string
  manager: EnvironmentManager
  nodeVersion: string
  policy: PreparationPolicy
  /** Allowlisted child environment; no user credentials or native profile variables. */
  environment: Readonly<Record<string, string>>
  /** Paths that must be excluded from any business patch/freeze. */
  excludedPaths: readonly string[]
  diagnostics: readonly EnvironmentDiagnostic[]
  evidence: readonly EnvironmentEvidence[]
  cleanup(): Promise<CleanupResult>
}

export interface BlockedEnvironment {
  status: 'blocked'
  requestId: string
  code: string
  message: string
  fingerprint?: string
  diagnostics: readonly EnvironmentDiagnostic[]
  evidence: readonly EnvironmentEvidence[]
  cleanup(): Promise<CleanupResult>
}

export type PreparationResult = ReadyEnvironment | BlockedEnvironment

/** Thrown only for an invalid request shape (unsafe paths, missing request id, aborted before inspection). */
export class EnvironmentPreparationError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'EnvironmentPreparationError'
    this.code = code
  }
}

/** Default integration proposal: these workspace-relative paths are owned environment state. */
export const defaultEnvironmentExclusions: EnvironmentExclusionPort = {
  excludedPaths: (): readonly string[] => ['.product-environment', 'node_modules'],
}
