import type { Scope } from '@personal-agent/contracts'
import { DecisionError } from './errors.ts'
import type { DecisionGovernance } from './governance.ts'
import { captureDecisionSnapshot, revalidateDecisionSnapshot } from './decision-snapshot.ts'
import type { CurrentDecisionSnapshot } from './decision-snapshot.ts'

export const DECISION_SELECTION_PREPARATION_PROTOCOL = 'decision-selection-preparation/1' as const

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
