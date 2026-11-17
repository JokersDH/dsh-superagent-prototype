import type { Scope } from '@personal-agent/contracts'
import { DecisionError } from './errors.ts'
import type { DecisionGovernance } from './governance.ts'
import { createHash } from 'node:crypto'
import type { Scope as ScopeType } from '@personal-agent/contracts'
import { captureDecisionSnapshot, revalidateDecisionSnapshot } from './decision-snapshot.ts'
import type { DecisionRecord } from './types.ts'
import type { CurrentDecisionSnapshot } from './decision-snapshot.ts'

export const DECISION_SELECTION_PREPARATION_PROTOCOL = 'decision-selection-preparation/1' as const
export const DECISION_SELECTION_BINDING_PROTOCOL = 'decision-selection-binding/1' as const
const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex')
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
const DIGEST = /^[a-f0-9]{64}$/
const isTime = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value))
const bindingDigest = (decisions: DecisionSelectionBinding['decisions']): string => sha256(JSON.stringify(decisions.map((decision) => ({
  decisionId: decision.decisionId, version: decision.version, contentDigest: decision.contentDigest,
  scope: decision.scope, sourceMessageId: decision.sourceMessageId, sourceTextDigest: decision.sourceTextDigest,
  recordedAt: decision.recordedAt }))))
const scopeKey = (scope: ScopeType): string => JSON.stringify({ projectId: scope.projectId,
  allowedPaths: [...scope.allowedPaths].sort(), excludedPaths: [...scope.excludedPaths].sort(),
  externalActions: [...scope.externalActions].sort(), expiresAt: scope.expiresAt ?? null })

/**
 * Typed preparation for a user's explicit decision selection at the original form/create boundary.
 * It is data for main's existing Work/contract/criteria guard, not a second confirmation authority:
 * main owns the form, shared schema and final write. A preparation may be re-asserted immediately
 * before the original command; a decision change requires an explicit re-preview.
 */
export interface DecisionSelectionPreparation {
  readonly protocol: typeof DECISION_SELECTION_PREPARATION_PROTOCOL
  readonly preparedAt: string
  readonly projectId: string
  readonly authorization: 'none'
  readonly snapshot: CurrentDecisionSnapshot
  readonly scopeChecked: boolean
  readonly scopeMatch: boolean | null
  readonly mismatches: readonly { readonly decisionId: string; readonly reason: 'scope' | 'expired' }[]
}

export interface DecisionSelectionBinding {
  readonly protocol: typeof DECISION_SELECTION_BINDING_PROTOCOL
  readonly projectId: string
  readonly boundAt: string
  readonly authorization: 'none'
  readonly snapshotDigest: string
  readonly decisions: readonly {
    readonly decisionId: string
    readonly version: number
    readonly contentDigest: string
    readonly scope: ScopeType
    readonly sourceMessageId: string
    readonly sourceTextDigest: string
    readonly recordedAt: string
  }[]
}

/** Synchronous current-record reader for main's commit guard inside its existing transaction. */
export interface SyncDecisionBindingReader {
  getDecision(decisionId: string): DecisionRecord | undefined
  sourceTextDigest(messageId: string): string | undefined
}

export interface DecisionSelectionBindingAssertion {
  readonly current: boolean
  readonly code?: 'invalid_binding' | 'project_mismatch' | 'version_changed' | 'content_changed' | 'source_stale' | 'expired' | 'inactive'
  readonly decisions: readonly { readonly decisionId: string; readonly valid: boolean; readonly code?: string }[]
}

export interface DecisionSelectionAssertion {
  readonly current: boolean
  readonly code?: 'invalid_scope' | 'scope_changed' | 'expired' | 'project_mismatch' | 'invalid_snapshot' | 'duplicate_decision' | 'invalid_time' | 'version_changed' | 'content_changed' | 'inactive' | 'source_stale'
  readonly decisions: readonly { readonly decisionId: string; readonly valid: boolean; readonly code?: string }[]
}

function scopeWithin(scope: Scope, grant: Scope, now: Date): boolean {
  if (scope.projectId !== grant.projectId) return false
  if (!scope.allowedPaths.every((path) => grant.allowedPaths.includes(path))) return false
  if (!grant.excludedPaths.every((path) => scope.excludedPaths.includes(path))) return false
  if (!scope.externalActions.every((action) => grant.externalActions.includes(action))) return false
  if (grant.expiresAt && Date.parse(grant.expiresAt) <= now.getTime()) return false
  if (scope.expiresAt && Date.parse(scope.expiresAt) <= now.getTime()) return false
  return true
}

export async function prepareDecisionSelection(
  governance: DecisionGovernance,
  input: {
    readonly projectId: string
    readonly selectedDecisionIds?: readonly string[]
    readonly projectScope?: Scope
    readonly max?: number
    readonly now?: Date
  },
): Promise<DecisionSelectionPreparation> {
  const now = input.now ?? new Date()
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new DecisionError('invalid_scope', 'Preparation time is invalid')
  if (input.projectScope && input.projectScope.projectId !== input.projectId)
    throw new DecisionError('invalid_scope', 'Preparation project scope belongs to another project')
  const snapshot = await captureDecisionSnapshot(governance, {
    projectId: input.projectId,
    ...(input.selectedDecisionIds === undefined ? {} : { selectedDecisionIds: input.selectedDecisionIds }),
    ...(input.max === undefined ? {} : { max: input.max }),
    now,
  })
  const mismatches: { decisionId: string; reason: 'scope' | 'expired' }[] = []
  if (input.projectScope) {
    for (const decision of snapshot.decisions) {
      if (decision.expiresAt && Date.parse(decision.expiresAt) <= now.getTime()) mismatches.push({ decisionId: decision.decisionId, reason: 'expired' })
      else if (!scopeWithin(decision.scope, input.projectScope, now)) mismatches.push({ decisionId: decision.decisionId, reason: 'scope' })
    }
  }
  return Object.freeze({
    protocol: DECISION_SELECTION_PREPARATION_PROTOCOL,
    preparedAt: now.toISOString(),
    projectId: input.projectId,
    authorization: 'none',
    snapshot,
    scopeChecked: input.projectScope !== undefined,
    scopeMatch: input.projectScope === undefined ? null : mismatches.length === 0,
    mismatches: Object.freeze(mismatches.map((mismatch) => Object.freeze(mismatch))),
  })
}

/** Re-checks the preparation's complete scope/version/source/time against the current trusted records. */
export async function assertDecisionSelectionCurrent(
  governance: DecisionGovernance,
  preparation: DecisionSelectionPreparation,
  input: { readonly projectId?: string; readonly projectScope?: Scope; readonly now?: Date } = {},
): Promise<DecisionSelectionAssertion> {
  if (!preparation || preparation.protocol !== DECISION_SELECTION_PREPARATION_PROTOCOL || preparation.authorization !== 'none')
    return { current: false, code: 'invalid_snapshot', decisions: [] }
  const now = input.now ?? new Date()
  if (input.projectScope && input.projectScope.projectId !== preparation.projectId)
    return { current: false, code: 'project_mismatch', decisions: [] }
  const revalidation = await revalidateDecisionSnapshot(governance, preparation.snapshot, {
    projectId: input.projectId ?? preparation.projectId, now })
  if (!revalidation.valid) return { current: false, ...(revalidation.code ? { code: revalidation.code } : {}), decisions: revalidation.decisions }
  if (input.projectScope) {
    for (const decision of preparation.snapshot.decisions) {
      if (!scopeWithin(decision.scope, input.projectScope, now))
        return { current: false, code: 'scope_changed', decisions: revalidation.decisions }
    }
  }
  return { current: true, decisions: revalidation.decisions }
}


/**
 * Canonical binding of the user-confirmed selection. Main must persist these refs in the new
 * Work/contract context and call the synchronous guard inside the same transaction that commits
 * the original create command. A raw create without this binding is not a bound confirmation.
 */
export async function bindDecisionSelection(
  governance: DecisionGovernance,
  preparation: DecisionSelectionPreparation,
  input: { readonly projectId?: string; readonly projectScope?: ScopeType; readonly now?: Date } = {},
): Promise<DecisionSelectionBinding> {
  const asserted = await assertDecisionSelectionCurrent(governance, preparation, input)
  if (!asserted.current) throw new DecisionError('inactive', `Decision selection is not current: ${asserted.code ?? 'unknown'}`,
    { code: asserted.code ?? null })
  const decisions = preparation.snapshot.decisions.map((decision) => ({
    decisionId: decision.decisionId, version: decision.version, contentDigest: decision.contentDigest,
    scope: structuredClone(decision.scope), sourceMessageId: decision.sourceMessageId,
    sourceTextDigest: decision.sourceTextDigest, recordedAt: decision.recordedAt,
  }))
  return Object.freeze({
    protocol: DECISION_SELECTION_BINDING_PROTOCOL,
    projectId: preparation.projectId,
    boundAt: (input.now ?? new Date()).toISOString(),
    authorization: 'none' as const,
    snapshotDigest: sha256(JSON.stringify(decisions)),
    decisions: Object.freeze(decisions.map((decision) => Object.freeze(decision))),
  })
}

/** Guard for main's existing UnitOfWork: no await, reads current records synchronously. */
export function assertDecisionSelectionBindingCurrentSync(
  binding: DecisionSelectionBinding,
  reader: SyncDecisionBindingReader,
  input: { readonly projectId?: string; readonly projectScope?: ScopeType; readonly now?: Date } = {},
): DecisionSelectionBindingAssertion {
  if (!binding || binding.protocol !== DECISION_SELECTION_BINDING_PROTOCOL || binding.authorization !== 'none' ||
    typeof binding.projectId !== 'string' || !ID_PATTERN.test(binding.projectId) || !isTime(binding.boundAt) ||
    typeof binding.snapshotDigest !== 'string' || !DIGEST.test(binding.snapshotDigest) ||
    !Array.isArray(binding.decisions) || binding.decisions.length === 0 || binding.decisions.length > 200 ||
    new Set(binding.decisions.map((decision) => decision?.decisionId)).size !== binding.decisions.length)
    return { current: false, code: 'invalid_binding', decisions: [] }
  for (const decision of binding.decisions) {
    if (!decision || typeof decision.decisionId !== 'string' || !ID_PATTERN.test(decision.decisionId) ||
      !Number.isInteger(decision.version) || decision.version < 1 ||
      typeof decision.contentDigest !== 'string' || !DIGEST.test(decision.contentDigest) ||
      typeof decision.sourceMessageId !== 'string' || !ID_PATTERN.test(decision.sourceMessageId) ||
      typeof decision.sourceTextDigest !== 'string' || !DIGEST.test(decision.sourceTextDigest) ||
      !isTime(decision.recordedAt) || !decision.scope || decision.scope.projectId !== binding.projectId)
      return { current: false, code: 'invalid_binding', decisions: [] }
  }
  // Canonical identity must match the refs it claims to protect; a swapped digest is not stored trust.
  if (bindingDigest(binding.decisions) !== binding.snapshotDigest)
    return { current: false, code: 'invalid_binding', decisions: [] }
  if (input.projectId && input.projectId !== binding.projectId)
    return { current: false, code: 'project_mismatch', decisions: [] }
  const now = input.now ?? new Date()
  if (!Number.isFinite(now.getTime())) return { current: false, code: 'invalid_binding', decisions: [] }
  const results: { decisionId: string; valid: boolean; code?: string }[] = []
  for (const decision of binding.decisions) {
    const record = reader.getDecision(decision.decisionId)
    if (!record) { results.push({ decisionId: decision.decisionId, valid: false, code: 'source_stale' }); continue }
    if (record.decision.scope.projectId !== binding.projectId) { results.push({ decisionId: decision.decisionId, valid: false, code: 'project_mismatch' }); continue }
    if (record.status !== 'active') { results.push({ decisionId: decision.decisionId, valid: false, code: 'inactive' }); continue }
    if (record.decision.version !== decision.version) { results.push({ decisionId: decision.decisionId, valid: false, code: 'version_changed' }); continue }
    if (record.decision.revokedAt) { results.push({ decisionId: decision.decisionId, valid: false, code: 'source_stale' }); continue }
    const expired = (decision.scope.expiresAt && Date.parse(decision.scope.expiresAt) <= now.getTime()) ||
      (record.decision.scope.expiresAt && Date.parse(record.decision.scope.expiresAt) <= now.getTime())
    if (expired) { results.push({ decisionId: decision.decisionId, valid: false, code: 'expired' }); continue }
    if (sha256(JSON.stringify(record.decision.content)) !== decision.contentDigest ||
      record.sourceMessageId !== decision.sourceMessageId ||
      record.sourceTextDigest !== decision.sourceTextDigest ||
      record.recordedAt !== decision.recordedAt ||
      scopeKey(record.decision.scope) !== scopeKey(decision.scope) ||
      reader.sourceTextDigest(decision.sourceMessageId) !== decision.sourceTextDigest) {
      results.push({ decisionId: decision.decisionId, valid: false, code: 'content_changed' }); continue
    }
    if (input.projectScope && !scopeWithin(decision.scope, input.projectScope, now)) {
      results.push({ decisionId: decision.decisionId, valid: false, code: 'content_changed' }); continue
    }
    results.push({ decisionId: decision.decisionId, valid: true })
  }
  const invalid = results.find((result) => !result.valid)
  return invalid ? { current: false, code: (invalid.code ?? 'content_changed') as Exclude<DecisionSelectionBindingAssertion['code'], undefined>, decisions: results }
    : { current: true, decisions: results }
}
