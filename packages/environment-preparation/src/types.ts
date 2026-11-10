import { existsSync } from 'node:fs'
import { join } from 'node:path'

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

export interface EnvironmentProcessResult {
  code: number | null
  signal: string | null
  stdout: string
  stderr: string
  timedOut: boolean
  cancelled: boolean
  outputLimited: boolean
  /** confirmed only when the owned process group is proven gone. */
  quiescence: 'confirmed' | 'indeterminate' | 'unknown'
  spawnError?: string
}

export interface EnvironmentProcessPort {
  run(
    command: string,
    args: readonly string[],
    options: {
      cwd: string
      env: Record<string, string>
      signal?: AbortSignal
      timeoutMs: number
      maxOutputBytes: number
    },
  ): Promise<EnvironmentProcessResult>
}

export interface EnvironmentRef {
  protocol: 'environment-ref/2'
  authorityRoot: string
  receiptId: string
  requestId: string
  fingerprint: string
  workspacePath: string
}

export interface VerifiedEnvironment {
  status: 'valid'
  ref: EnvironmentRef
  fingerprint: string
  environment: Readonly<Record<string, string>>
  excludedPaths: readonly string[]
  ownedPaths: readonly string[]
  diagnostics: readonly EnvironmentDiagnostic[]
}

export interface FailedEnvironmentVerification {
  status: 'blocked'
  code: string
  message: string
  diagnostics: readonly EnvironmentDiagnostic[]
}

export type EnvironmentVerificationResult = VerifiedEnvironment | FailedEnvironmentVerification

export interface TrustedCleanupResult {
  status: 'cleaned' | 'blocked'
  code?: string
  message?: string
  removed: readonly string[]
  leftovers: readonly string[]
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
  /** Caller-owned private directory outside project/workspace for signed receipts, liveness lock and authority key. */
  authorityRoot?: string
  /** Optional injected process runner (e.g. the coordinator's OwnedProcessHost adapter). */
  processPort?: EnvironmentProcessPort
  /** Explicit opt-in: default single package; pnpm_workspace supports one root, one lock, local workspace links. */
  mode?: 'single' | 'pnpm_workspace'
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
  /** Signed, serializable receipt reference for cross-process verification/cleanup. */
  environmentRef?: EnvironmentRef
  /** Absolute paths this environment truly owns; empty for existing_only. */
  ownedPaths?: readonly string[]
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

/**
 * Default integration proposal: only environment directories that actually exist in this workspace.
 * An absent directory is never presented as owned state, and preparation further drops
 * `.product-environment` unless this preparation created it.
 */
export const defaultEnvironmentExclusions: EnvironmentExclusionPort = {
  excludedPaths: (workspace: string): readonly string[] =>
    ['.product-environment', 'node_modules'].filter(relative => existsSync(join(workspace, relative))),
}
