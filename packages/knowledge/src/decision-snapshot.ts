import { createHash } from 'node:crypto'
import type { Scope } from '@personal-agent/contracts'
import { DecisionError } from './errors.ts'
import type { DecisionGovernance } from './governance.ts'
import type { DecisionRecord } from './types.ts'

export const DECISION_CONTEXT_SNAPSHOT_PROTOCOL = 'decision-context-snapshot/1' as const
const MAX_SNAPSHOT_DECISIONS = 200
const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex')

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
 * It is not a grant or an approval: callers must revalidate it before creating new work and the
 * original server-side Work/contract/criteria guard remains authoritative.
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
  readonly code?: 'invalid_snapshot' | 'project_mismatch' | 'version_changed' | 'content_changed' | 'inactive' | 'source_stale' | 'expired'
  readonly decisions: readonly { readonly decisionId: string; readonly valid: boolean; readonly code?: string }[]
}

function project(record: DecisionRecord): DecisionSnapshotDecision {
  const expiresAt = record.decision.scope.expiresAt
  return Object.freeze({
    decisionId: record.decision.id,
    version: record.decision.version,
    contentDigest: sha256(JSON.stringify(record.decision.content)),
    scope: structuredClone(record.decision.scope) as Scope,
    sourceMessageId: record.sourceMessageId,
    sourceTextDigest: record.sourceTextDigest,
    recordedAt: record.recordedAt,
    ...(expiresAt ? { expiresAt } : {}),
  })
}

/**
 * Captures the current effective decisions of one project. An incomplete store/source scan throws
 * `scan_incomplete` instead of returning a smaller set that looks complete; a caller id filter may
 * only narrow that effective set and never resurrect an inactive record.
 */
export async function captureDecisionSnapshot(
  governance: DecisionGovernance,
  input: { readonly projectId: string; readonly selectedDecisionIds?: readonly string[]; readonly max?: number; readonly now?: Date },
): Promise<CurrentDecisionSnapshot> {
  const max = Math.min(Math.max(input.max ?? 32, 1), MAX_SNAPSHOT_DECISIONS)
  const now = input.now ?? new Date()
  const window = await governance.listEffectiveWindow(input.projectId, max, now)
  let records = window.decisions
  if (input.selectedDecisionIds) {
    const selected = new Set(input.selectedDecisionIds)
    if (selected.size !== input.selectedDecisionIds.length)
      throw new DecisionError('conflict', 'Decision snapshot selection contains duplicates', { projectId: input.projectId })
    const missing = [...selected].filter((id) => !records.some((record) => record.decision.id === id))
    if (missing.length)
      throw new DecisionError('not_found', 'A selected decision is not currently effective', { projectId: input.projectId, missing })
    records = records.filter((record) => selected.has(record.decision.id))
  }
  return Object.freeze({
    protocol: DECISION_CONTEXT_SNAPSHOT_PROTOCOL,
    capturedAt: now.toISOString(),
    projectId: input.projectId,
    authorization: 'none',
    decisions: Object.freeze(records.map(project)),
    coverage: { scan: 'complete' as const, callerTruncated: window.truncatedByLimit, max },
  })
}

export async function revalidateDecisionSnapshot(
  governance: DecisionGovernance,
  snapshot: CurrentDecisionSnapshot,
  input: { readonly projectId?: string; readonly now?: Date } = {},
): Promise<DecisionSnapshotRevalidation> {
  if (snapshot?.protocol !== DECISION_CONTEXT_SNAPSHOT_PROTOCOL || !Array.isArray(snapshot.decisions))
    return { valid: false, code: 'invalid_snapshot', decisions: [] }
  if (input.projectId && input.projectId !== snapshot.projectId)
    return { valid: false, code: 'project_mismatch', decisions: snapshot.decisions.map((decision) => ({ decisionId: decision.decisionId, valid: false, code: 'project_mismatch' })) }
  const now = input.now ?? new Date()
  const results: { decisionId: string; valid: boolean; code?: string }[] = []
  for (const decision of snapshot.decisions) {
    if (decision.expiresAt && Date.parse(decision.expiresAt) <= now.getTime()) { results.push({ decisionId: decision.decisionId, valid: false, code: 'expired' }); continue }
    const current = await governance.getEffective(decision.decisionId, now)
    if (!current) {
      const state = await governance.decisionSourceState(decision.decisionId)
      results.push({ decisionId: decision.decisionId, valid: false, code: state === 'current' ? 'inactive' : 'source_stale' })
      continue
    }
    if (current.decision.version !== decision.version) { results.push({ decisionId: decision.decisionId, valid: false, code: 'version_changed' }); continue }
    if (sha256(JSON.stringify(current.decision.content)) !== decision.contentDigest ||
      current.sourceTextDigest !== decision.sourceTextDigest ||
      current.decision.scope.projectId !== snapshot.projectId) {
      results.push({ decisionId: decision.decisionId, valid: false, code: 'content_changed' }); continue
    }
    results.push({ decisionId: decision.decisionId, valid: true })
  }
  const invalid = results.find((result) => !result.valid)
  return invalid ? { valid: false, code: (invalid.code ?? 'inactive') as Exclude<DecisionSnapshotRevalidation['code'], undefined>, decisions: results }
    : { valid: true, decisions: results }
}
