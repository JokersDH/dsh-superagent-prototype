import { existsSync, lstatSync, readdirSync, rmSync } from 'node:fs'
import { canonical, inside } from './paths.ts'
import { inspectWorkspace } from './project.ts'
import { scanInstalledTree } from './installed.ts'
import { inspectPnpmWorkspace, scanWorkspaceInstalled } from './workspace.ts'
import {
  identityMatches, loadAuthority, ownedPath, readReceipt, removeReceipt, type OwnedPath, type ReceiptBody,
} from './authority.ts'
import { EnvironmentPreparationError } from './types.ts'
import type {
  BlockedEnvironment, EnvironmentDiagnostic, EnvironmentRef, EnvironmentVerificationResult, FailedEnvironmentVerification,
  PreparationResult, ReadyEnvironment, TrustedCleanupResult,
} from './types.ts'

const blocked = (code: string, message: string, diagnostics: EnvironmentDiagnostic[] = []): FailedEnvironmentVerification =>
  ({ status: 'blocked', code, message, diagnostics })

function load(ref: EnvironmentRef, diagnostics: EnvironmentDiagnostic[]) {
  if (!ref || ref.protocol !== 'environment-ref/2') return { error: blocked('invalid_ref', 'Environment reference protocol is unsupported.', diagnostics) }
  if (!ref.authorityRoot.startsWith('/')) return { error: blocked('invalid_ref', 'Environment authority root must be absolute.', diagnostics) }
  let authority
  try { authority = loadAuthority(ref.authorityRoot) } catch (error) {
    return { error: blocked('authority_unavailable', String((error as Error).message ?? error), diagnostics) }
  }
  const stored = readReceipt(authority, ref.receiptId)
  if (!stored.ok) return { error: blocked(stored.code, stored.message, diagnostics) }
  return { authority, receipt: stored.receipt }
}

const canonicalOwned = (body: ReceiptBody): readonly string[] => body.ownedPaths.map(entry => entry.relative)

/** The path can be recreated by another directory; a recorded dev/inode mismatch is a replacement. */
function workspaceIdentityMatches(body: ReceiptBody, workspace: string): boolean {
  if (!body.workspaceIdentity) return true
  try {
    const stat = lstatSync(workspace)
    return Number(stat.dev) === body.workspaceIdentity.dev && Number(stat.ino) === body.workspaceIdentity.ino
  } catch { return false }
}

/** Re-verifies a serialized environment reference in a new process without trusting workspace markers. */
export function verifyPreparedEnvironment(ref: EnvironmentRef): EnvironmentVerificationResult {
  const diagnostics: EnvironmentDiagnostic[] = []
  const loaded = load(ref, diagnostics)
  if ('error' in loaded) return loaded.error
  const { receipt } = loaded
  const body = receipt.body
  if (body.requestId !== ref.requestId || body.fingerprint !== ref.fingerprint)
    return blocked('receipt_mismatch', 'The reference does not match its signed receipt.', diagnostics)
  if (!existsSync(body.workspaceReal) || canonical(body.workspaceReal) !== canonical(ref.workspacePath))
    return blocked('workspace_replaced', 'The private workspace no longer exists or has been replaced.', diagnostics)
  const workspace = canonical(body.workspaceReal)
  if (!workspaceIdentityMatches(body, workspace))
    return blocked('workspace_replaced', 'The private workspace directory was replaced after preparation.', diagnostics)
  if (body.mode === 'pnpm_workspace') {
    const ws = inspectPnpmWorkspace(workspace)
    if (!ws.ok) return blocked('environment_inputs_invalid', ws.problem?.message ?? 'Workspace layout is invalid.', diagnostics)
    if (ws.workspaceDigest !== body.workspaceDigest
      || JSON.stringify(ws.manifests) !== JSON.stringify(body.manifests)
      || JSON.stringify(ws.lockFiles) !== JSON.stringify(body.lockFiles)
      || JSON.stringify(ws.dependencies) !== JSON.stringify(body.dependencies))
      return blocked('environment_inputs_changed', 'Workspace manifests, lock or dependencies changed after preparation.', diagnostics)
    for (const entry of body.ownedPaths)
      if (!inside(workspace, entry.real) || !identityMatches(entry)) return blocked('ownership_changed', `Owned environment path was replaced or removed: ${entry.relative}`, diagnostics)
    const scan = scanWorkspaceInstalled(workspace, body.modulesDirs ?? [])
    if (scan.problem) return blocked(scan.problem.code, scan.problem.message, diagnostics)
    if (scan.digest !== body.installedDigest) return blocked('environment_drift', 'The installed workspace dependency tree no longer matches the prepared fingerprint.', diagnostics)
    return {
      status: 'valid', ref, fingerprint: body.fingerprint, environment: body.environment,
      excludedPaths: body.excludedPaths, ownedPaths: canonicalOwned(body), diagnostics,
    }
  }
  const inspection = inspectWorkspace(workspace)
  if (inspection.blocked) return blocked('environment_inputs_invalid', inspection.blocked.message, diagnostics)
  if (inspection.packageJsonDigest !== body.packageJsonDigest)
    return blocked('environment_inputs_changed', 'package.json changed after preparation; the environment must be prepared again.', diagnostics)
  if (JSON.stringify(inspection.lockFiles) !== JSON.stringify(body.lockFiles))
    return blocked('environment_inputs_changed', 'The lockfile changed after preparation; the environment must be prepared again.', diagnostics)
  if (JSON.stringify(inspection.dependencies) !== JSON.stringify(body.dependencies))
    return blocked('environment_inputs_changed', 'Declared dependencies changed after preparation; the environment must be prepared again.', diagnostics)
  for (const entry of body.ownedPaths) {
    if (!inside(workspace, entry.real) || !identityMatches(entry))
      return blocked('ownership_changed', `Owned environment path was replaced or removed: ${entry.relative}`, diagnostics)
  }
  const scan = scanInstalledTree(workspace, inspection.dependencies)
  if (scan.problem) return blocked(scan.problem.code, scan.problem.message, diagnostics)
  if (scan.digest !== body.installedDigest)
    return blocked('environment_drift', 'The installed dependency tree no longer matches the prepared fingerprint.', diagnostics)
  diagnostics.push({ code: 'environment_verified', severity: 'info', message: `Verified installed layout (${scan.entries} entries).` })
  return {
    status: 'valid', ref, fingerprint: body.fingerprint, environment: body.environment,
    excludedPaths: body.excludedPaths, ownedPaths: canonicalOwned(body), diagnostics,
  }
}

/** Removes only signed, identity-matched owned paths; forged markers or replaced paths never authorize deletion. */
export async function cleanupPreparedEnvironment(ref: EnvironmentRef): Promise<TrustedCleanupResult> {
  const diagnostics: EnvironmentDiagnostic[] = []
  const loaded = load(ref, diagnostics)
  if ('error' in loaded) return { status: 'blocked', code: loaded.error.code, message: loaded.error.message, removed: [], leftovers: [] }
  const { authority, receipt } = loaded
  const body = receipt.body
  if (body.requestId !== ref.requestId || body.fingerprint !== ref.fingerprint)
    return { status: 'blocked', code: 'receipt_mismatch', message: 'The reference does not match its signed receipt.', removed: [], leftovers: [] }
  const workspace = canonical(body.workspaceReal)
  if (!existsSync(workspace) || canonical(ref.workspacePath) !== workspace)
    return { status: 'blocked', code: 'workspace_replaced', message: 'The private workspace was replaced; no cleanup is performed.', removed: [], leftovers: [] }
  if (!workspaceIdentityMatches(body, workspace))
    return { status: 'blocked', code: 'workspace_replaced', message: 'The private workspace directory was replaced; no cleanup is performed.', removed: [], leftovers: [] }
  for (const entry of body.ownedPaths)
    if (!inside(workspace, entry.real) || !identityMatches(entry))
      return { status: 'blocked', code: 'cleanup_forbidden', message: `Owned path identity no longer matches: ${entry.relative}`, removed: [], leftovers: [] }

  const removed: string[] = []
  const leftovers: string[] = []
  for (const entry of [...body.ownedPaths].sort((a, b) => b.real.length - a.real.length)) {
    try { rmSync(entry.real, { recursive: true, force: true }) } catch { /* checked below */ }
    if (existsSync(entry.real)) leftovers.push(entry.real)
    else removed.push(entry.real)
  }
  if (leftovers.length) return { status: 'blocked', code: 'cleanup_unproven', message: 'Some owned paths could not be removed.', removed, leftovers }
  removeReceipt(authority, receipt.id)
  return { status: 'cleaned', removed, leftovers }
}

/** Re-export for tests/tools that need the signed receipt shape without importing authority internals. */
export type { ReceiptBody, OwnedPath }
export { ownedPath }

/** Enumerates signed ready receipts so a restarted caller can recover after losing its ref. */
export function listPreparedEnvironments(authorityRoot: string): EnvironmentRef[] {
  const authority = loadAuthority(authorityRoot)
  const refs: EnvironmentRef[] = []
  let names: string[]
  try { names = readdirSync(authority.receiptsDir) } catch { return refs }
  for (const name of names.sort()) {
    const id = name.replace(/\.json$/, '')
    const stored = readReceipt(authority, id)
    if (!stored.ok) continue
    refs.push({
      protocol: 'environment-ref/2', authorityRoot: authority.root, receiptId: id,
      requestId: stored.receipt.body.requestId, fingerprint: stored.receipt.body.fingerprint,
      workspacePath: stored.receipt.body.workspaceReal,
    })
  }
  return refs
}


/** Runtime parser for a serialized environment reference (JSON file / persisted attempt record). */
export function parseEnvironmentRef(value: unknown): EnvironmentRef {
  if (!value || typeof value !== 'object') throw new EnvironmentPreparationError('invalid_ref', 'Environment reference must be an object.')
  const v = value as Record<string, unknown>
  if (v.protocol !== 'environment-ref/2') throw new EnvironmentPreparationError('invalid_ref', 'Environment reference protocol is unsupported.')
  if (typeof v.authorityRoot !== 'string' || !v.authorityRoot.startsWith('/'))
    throw new EnvironmentPreparationError('invalid_ref', 'Environment reference authorityRoot must be absolute.')
  if (typeof v.receiptId !== 'string' || !/^[a-f0-9]{64}$/.test(v.receiptId))
    throw new EnvironmentPreparationError('invalid_ref', 'Environment reference receiptId is malformed.')
  if (typeof v.requestId !== 'string' || typeof v.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(v.fingerprint))
    throw new EnvironmentPreparationError('invalid_ref', 'Environment reference requestId/fingerprint is malformed.')
  if (typeof v.workspacePath !== 'string' || !v.workspacePath.startsWith('/'))
    throw new EnvironmentPreparationError('invalid_ref', 'Environment reference workspacePath must be absolute.')
  return value as EnvironmentRef
}

/** Runtime parser for verifyPreparedEnvironment output. */
export function parseEnvironmentVerification(value: unknown): EnvironmentVerificationResult {
  if (!value || typeof value !== 'object') throw new EnvironmentPreparationError('invalid_result', 'Verification result must be an object.')
  const v = value as Record<string, unknown>
  if (v.status !== 'valid' && v.status !== 'blocked') throw new EnvironmentPreparationError('invalid_result', 'Verification status is invalid.')
  if (v.status === 'blocked') {
    if (typeof v.code !== 'string' || typeof v.message !== 'string')
      throw new EnvironmentPreparationError('invalid_result', 'Blocked verification result needs code/message.')
    return value as EnvironmentVerificationResult
  }
  if (typeof v.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(v.fingerprint))
    throw new EnvironmentPreparationError('invalid_result', 'Valid verification result needs a fingerprint.')
  if (!v.environment || typeof v.environment !== 'object' || !Array.isArray(v.excludedPaths) || !Array.isArray(v.ownedPaths))
    throw new EnvironmentPreparationError('invalid_result', 'Valid verification result needs environment/excludedPaths/ownedPaths.')
  return value as EnvironmentVerificationResult
}

/** Runtime parser for cleanupPreparedEnvironment output. */
export function parseTrustedCleanupResult(value: unknown): TrustedCleanupResult {
  if (!value || typeof value !== 'object') throw new EnvironmentPreparationError('invalid_result', 'Cleanup result must be an object.')
  const v = value as Record<string, unknown>
  if (v.status !== 'cleaned' && v.status !== 'blocked') throw new EnvironmentPreparationError('invalid_result', 'Cleanup status is invalid.')
  if (!Array.isArray(v.removed) || !v.removed.every(item => typeof item === 'string')
    || !Array.isArray(v.leftovers) || !v.leftovers.every(item => typeof item === 'string'))
    throw new EnvironmentPreparationError('invalid_result', 'Cleanup removed/leftovers must be string arrays.')
  if (v.status === 'blocked' && (typeof v.code !== 'string' || typeof v.message !== 'string'))
    throw new EnvironmentPreparationError('invalid_result', 'Blocked cleanup result needs code/message.')
  return value as TrustedCleanupResult
}

/** Projection expected by main's WorkspaceEnvironmentPort; an invalid/missing receipt throws, never undefined. */
export interface WorkspaceEnvironmentProjection {
  reference: string
  fingerprint: string
  excludedPaths: readonly string[]
}

/**
 * Verify a persisted ref and project it to the main workspace port. `reference` is the opaque receipt
 * id (no host path); a missing/blocked receipt throws so main cannot downgrade to "no environment".
 */
export function projectWorkspaceEnvironment(ref: EnvironmentRef): WorkspaceEnvironmentProjection {
  const parsed = parseEnvironmentRef(ref)
  const verified = parseEnvironmentVerification(verifyPreparedEnvironment(parsed))
  if (verified.status !== 'valid')
    throw new EnvironmentPreparationError(verified.code, `${verified.code}: ${verified.message}`)
  return { reference: parsed.receiptId, fingerprint: verified.fingerprint, excludedPaths: verified.excludedPaths }
}


/** Runtime parser for a direct prepare result (not a JSON persistence format because cleanup is a function). */
export function parsePreparationResult(value: unknown): PreparationResult {
  if (!value || typeof value !== 'object') throw new EnvironmentPreparationError('invalid_result', 'Preparation result must be an object.')
  const v = value as Record<string, unknown>
  if (v.status !== 'ready' && v.status !== 'blocked') throw new EnvironmentPreparationError('invalid_result', 'Preparation status is invalid.')
  if (typeof v.requestId !== 'string' || typeof v.cleanup !== 'function')
    throw new EnvironmentPreparationError('invalid_result', 'Preparation result needs requestId and cleanup.')
  if (!Array.isArray(v.diagnostics) || !Array.isArray(v.evidence))
    throw new EnvironmentPreparationError('invalid_result', 'Preparation diagnostics/evidence must be arrays.')
  if (v.status === 'blocked') {
    if (typeof v.code !== 'string' || typeof v.message !== 'string')
      throw new EnvironmentPreparationError('invalid_result', 'Blocked preparation result needs code/message.')
    return value as BlockedEnvironment
  }
  if (typeof v.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(v.fingerprint)
    || typeof v.nodeVersion !== 'string' || typeof v.policy !== 'string'
    || !v.manager || typeof v.manager !== 'object' || !v.environment || typeof v.environment !== 'object'
    || !Array.isArray(v.excludedPaths) || !Array.isArray(v.ownedPaths))
    throw new EnvironmentPreparationError('invalid_result', 'Ready preparation result is incomplete.')
  if (v.environmentRef !== undefined) parseEnvironmentRef(v.environmentRef)
  return value as ReadyEnvironment
}
