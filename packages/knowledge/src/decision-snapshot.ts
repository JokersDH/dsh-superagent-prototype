import { createHash } from 'node:crypto'
import type { Scope } from '@personal-agent/contracts'
import { DecisionError } from './errors.ts'
import type { DecisionGovernance } from './governance.ts'
import { snapshot as immutable } from './snapshot.ts'
import type { DecisionRecord } from './types.ts'

export const DECISION_CONTEXT_SNAPSHOT_PROTOCOL = 'decision-context-snapshot/1' as const
const MAX_SNAPSHOT_DECISIONS = 200
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
const DIGEST = /^[a-f0-9]{64}$/
const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex')
const isTime = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value))

export interface DecisionSnapshotDecision {
  readonly decisionId: string
  readonly version: number
  readonly contentDigest: string
  readonly scope: Scope
  readonly sourceMessageId: string
  readonly sourceTextDigest: string
  readonly recordedAt: string
  readonly expiresAt?: string
}

/**
 * Bounded, data-only projection of the decisions that are currently effective for one project.
 * Nested scope/arrays are deep-frozen and revalidation binds the complete scope, source identity,
 * version and time to the current trusted record. `valid` only means the data still matches; it is
 * not a grant, approval token or completeness proof, and main's Work/contract/criteria guard stays
 * authoritative.
 */
export interface CurrentDecisionSnapshot {
  readonly protocol: typeof DECISION_CONTEXT_SNAPSHOT_PROTOCOL
  readonly capturedAt: string
  readonly projectId: string
  readonly authorization: 'none'
  readonly decisions: readonly DecisionSnapshotDecision[]
  readonly coverage: { readonly scan: 'complete'; readonly callerTruncated: boolean; readonly max: number }
}

export interface DecisionSnapshotRevalidation {
  readonly valid: boolean
  readonly code?: 'invalid_snapshot' | 'project_mismatch' | 'duplicate_decision' | 'invalid_scope' | 'invalid_time' | 'version_changed' | 'content_changed' | 'inactive' | 'source_stale' | 'expired'
  readonly decisions: readonly { readonly decisionId: string; readonly valid: boolean; readonly code?: string }[]
}

function validScope(value: unknown, projectId: string): value is Scope {
  if (!value || typeof value !== 'object') return false
  const scope = value as Record<string, unknown>
  if (scope.projectId !== projectId) return false
  if (!Array.isArray(scope.allowedPaths) || scope.allowedPaths.length < 1 || scope.allowedPaths.length > 64 ||
    !scope.allowedPaths.every((path) => typeof path === 'string' && path.length > 0 && path.length <= 1024) ||
    new Set(scope.allowedPaths).size !== scope.allowedPaths.length) return false
  if (!Array.isArray(scope.excludedPaths) || scope.excludedPaths.length > 64 ||
    !scope.excludedPaths.every((path) => typeof path === 'string' && path.length > 0 && path.length <= 1024) ||
    new Set(scope.excludedPaths).size !== scope.excludedPaths.length) return false
  if (!Array.isArray(scope.externalActions) || scope.externalActions.length > 32 ||
    !scope.externalActions.every((action) => typeof action === 'string' && action.length > 0 && action.length <= 128)) return false
  if (scope.expiresAt !== undefined && !isTime(scope.expiresAt)) return false
  return true
}

function validDecision(value: unknown, projectId: string): value is DecisionSnapshotDecision {
  if (!value || typeof value !== 'object') return false
  const decision = value as Record<string, unknown>
  if (typeof decision.decisionId !== 'string' || !ID_PATTERN.test(decision.decisionId)) return false
  if (!Number.isInteger(decision.version) || (decision.version as number) < 1) return false
  if (typeof decision.contentDigest !== 'string' || !DIGEST.test(decision.contentDigest)) return false
  if (!validScope(decision.scope, projectId)) return false
  if (typeof decision.sourceMessageId !== 'string' || !ID_PATTERN.test(decision.sourceMessageId)) return false
  if (typeof decision.sourceTextDigest !== 'string' || !DIGEST.test(decision.sourceTextDigest)) return false
  if (!isTime(decision.recordedAt)) return false
  if (decision.expiresAt !== undefined && !isTime(decision.expiresAt)) return false
  const keys = Object.keys(decision).sort().join(',')
  return keys === 'contentDigest,decisionId,recordedAt,scope,sourceMessageId,sourceTextDigest,version' ||
    keys === 'contentDigest,decisionId,expiresAt,recordedAt,scope,sourceMessageId,sourceTextDigest,version'
}

function parseSnapshot(value: unknown): CurrentDecisionSnapshot | undefined {
  if (!value || typeof value !== 'object') return undefined
  const snapshot = value as Record<string, unknown>
  const keys = Object.keys(snapshot).sort().join(',')
  if (keys !== 'authorization,capturedAt,coverage,decisions,projectId,protocol') return undefined
  if (snapshot.protocol !== DECISION_CONTEXT_SNAPSHOT_PROTOCOL || snapshot.authorization !== 'none') return undefined
  if (typeof snapshot.projectId !== 'string' || !ID_PATTERN.test(snapshot.projectId)) return undefined
  if (!isTime(snapshot.capturedAt)) return undefined
  const coverage = snapshot.coverage as Record<string, unknown> | undefined
  if (!coverage || Object.keys(coverage).sort().join(',') !== 'callerTruncated,max,scan' || coverage.scan !== 'complete' ||
    typeof coverage.callerTruncated !== 'boolean' || !Number.isInteger(coverage.max) || (coverage.max as number) < 1 ||
    (coverage.max as number) > MAX_SNAPSHOT_DECISIONS) return undefined
  if (!Array.isArray(snapshot.decisions) || snapshot.decisions.length > MAX_SNAPSHOT_DECISIONS) return undefined
  if (!snapshot.decisions.every((decision) => validDecision(decision, snapshot.projectId as string))) return undefined
  if (new Set(snapshot.decisions.map((decision) => (decision as DecisionSnapshotDecision).decisionId)).size !== snapshot.decisions.length) return undefined
  return snapshot as unknown as CurrentDecisionSnapshot
}

const scopeKey = (scope: Scope): string => JSON.stringify({
  projectId: scope.projectId,
  allowedPaths: [...scope.allowedPaths].sort(),
  excludedPaths: [...scope.excludedPaths].sort(),
  externalActions: [...scope.externalActions].sort(),
  expiresAt: scope.expiresAt ?? null,
})

function project(record: DecisionRecord): DecisionSnapshotDecision {
  const expiresAt = record.decision.scope.expiresAt
  return {
    decisionId: record.decision.id,
    version: record.decision.version,
    contentDigest: sha256(JSON.stringify(record.decision.content)),
    scope: structuredClone(record.decision.scope) as Scope,
    sourceMessageId: record.sourceMessageId,
    sourceTextDigest: record.sourceTextDigest,
    recordedAt: record.recordedAt,
    ...(expiresAt ? { expiresAt } : {}),
  }
}

/**
 * Captures the current effective decisions of one project. An incomplete store/source scan throws
 * `scan_incomplete` instead of returning a smaller set that looks complete; a caller selection may
 * only narrow that current set and never resurrect an inactive record or widen scope.
 */
export async function captureDecisionSnapshot(
  governance: DecisionGovernance,
  input: { readonly projectId: string; readonly selectedDecisionIds?: readonly string[]; readonly max?: number; readonly now?: Date },
): Promise<CurrentDecisionSnapshot> {
  if (typeof input.projectId !== 'string' || !ID_PATTERN.test(input.projectId))
    throw new DecisionError('invalid_scope', 'Snapshot projectId is invalid')
  const max = input.max ?? 32
  if (!Number.isInteger(max) || max < 1 || max > MAX_SNAPSHOT_DECISIONS)
    throw new DecisionError('invalid_scope', `Snapshot max must be an integer 1..${MAX_SNAPSHOT_DECISIONS}`, { max })
  const now = input.now ?? new Date()
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new DecisionError('invalid_scope', 'Snapshot time is invalid')
  const window = await governance.listEffectiveWindow(input.projectId, max, now)
  let records = window.decisions
  if (input.selectedDecisionIds) {
    const selected = new Set(input.selectedDecisionIds)
    if (!input.selectedDecisionIds.every((id) => typeof id === 'string' && ID_PATTERN.test(id)) ||
      selected.size !== input.selectedDecisionIds.length)
      throw new DecisionError('conflict', 'Decision snapshot selection is invalid or duplicated', { projectId: input.projectId })
    const missing = [...selected].filter((id) => !records.some((record) => record.decision.id === id))
    if (missing.length)
      throw new DecisionError('not_found', 'A selected decision is not currently effective', { projectId: input.projectId, missing })
    records = records.filter((record) => selected.has(record.decision.id))
  }
  return immutable({
    protocol: DECISION_CONTEXT_SNAPSHOT_PROTOCOL,
    capturedAt: now.toISOString(),
    projectId: input.projectId,
    authorization: 'none' as const,
    decisions: records.map(project),
    coverage: { scan: 'complete' as const, callerTruncated: window.truncatedByLimit, max },
  })
}

export async function revalidateDecisionSnapshot(
  governance: DecisionGovernance,
  snapshotValue: CurrentDecisionSnapshot,
  input: { readonly projectId?: string; readonly now?: Date } = {},
): Promise<DecisionSnapshotRevalidation> {
  const snapshot = parseSnapshot(snapshotValue)
  if (!snapshot) return { valid: false, code: 'invalid_snapshot', decisions: [] }
  if (input.projectId && input.projectId !== snapshot.projectId)
    return { valid: false, code: 'project_mismatch', decisions: snapshot.decisions.map((decision) => ({ decisionId: decision.decisionId, valid: false, code: 'project_mismatch' })) }
  const now = input.now ?? new Date()
  if (!(now instanceof Date) || !Number.isFinite(now.getTime()))
    return { valid: false, code: 'invalid_time', decisions: snapshot.decisions.map((decision) => ({ decisionId: decision.decisionId, valid: false, code: 'invalid_time' })) }
  const results: { decisionId: string; valid: boolean; code?: string }[] = []
  for (const decision of snapshot.decisions) {
    if (decision.expiresAt && Date.parse(decision.expiresAt) <= now.getTime()) { results.push({ decisionId: decision.decisionId, valid: false, code: 'expired' }); continue }
    if (decision.scope.expiresAt && Date.parse(decision.scope.expiresAt) <= now.getTime()) { results.push({ decisionId: decision.decisionId, valid: false, code: 'expired' }); continue }
    const current = await governance.getEffective(decision.decisionId, now)
    if (!current) {
      const state = await governance.decisionSourceState(decision.decisionId)
      results.push({ decisionId: decision.decisionId, valid: false, code: state === 'current' ? 'inactive' : 'source_stale' })
      continue
    }
    if (current.decision.version !== decision.version) { results.push({ decisionId: decision.decisionId, valid: false, code: 'version_changed' }); continue }
    const currentRecord = { contentDigest: sha256(JSON.stringify(current.decision.content)), scope: current.decision.scope,
      sourceMessageId: current.sourceMessageId, sourceTextDigest: current.sourceTextDigest, recordedAt: current.recordedAt }
    if (currentRecord.contentDigest !== decision.contentDigest ||
      currentRecord.sourceMessageId !== decision.sourceMessageId ||
      currentRecord.sourceTextDigest !== decision.sourceTextDigest ||
      currentRecord.recordedAt !== decision.recordedAt ||
      scopeKey(currentRecord.scope) !== scopeKey(decision.scope) ||
      current.decision.scope.projectId !== snapshot.projectId ||
      !validScope(decision.scope, snapshot.projectId)) {
      results.push({ decisionId: decision.decisionId, valid: false, code: 'content_changed' }); continue
    }
    results.push({ decisionId: decision.decisionId, valid: true })
  }
  const invalid = results.find((result) => !result.valid)
  return invalid ? { valid: false, code: (invalid.code ?? 'inactive') as Exclude<DecisionSnapshotRevalidation['code'], undefined>, decisions: results }
    : { valid: true, decisions: results }
}
