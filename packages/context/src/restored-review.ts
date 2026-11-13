import type { Scope } from '@personal-agent/contracts'
import { pathWithin } from './paths.ts'

/**
 * Explanation of how an explicit restored-review selection relates to the scope a frozen
 * historical binding was created under. It is presentation data only and never authorizes,
 * refreshes or widens execution: `authorization` is always `none`.
 */
export type RestoredScopeReason =
  | 'project_changed'
  | 'selection_narrowed'
  | 'selection_broadened'
  | 'selection_replaced'
  | 'exclusion_added'
  | 'exclusion_removed'

export interface RestoredScopeReviewInput {
  readonly bindingScope: Scope
  readonly selection: Scope
  readonly sourcesState: 'verified' | 'scope_changed' | 'missing' | 'unverified'
  readonly frozenSourceIds: readonly string[]
  readonly readableCandidates?: number
  readonly readableHistory?: number
  readonly readableWorks?: number
  readonly readableDeliveries?: number
}

export interface RestoredScopeReview {
  readonly protocol: 'restored-review-scope/1'
  readonly state: RestoredScopeReviewInput['sourcesState']
  readonly scopeChanged: boolean
  readonly partial: boolean
  readonly reasons: readonly RestoredScopeReason[]
  readonly withheldSourceIds: readonly string[]
  readonly readable: {
    readonly candidates: number | null
    readonly history: number | null
    readonly works: number | null
    readonly deliveries: number | null
  }
  readonly authorization: 'none'
}

const same = (left: readonly string[], right: readonly string[]): boolean => {
  const a = [...left].sort(), b = [...right].sort()
  return a.length === b.length && a.every((value, index) => value === b[index])
}

const within = (inner: readonly string[], outer: readonly string[]): boolean =>
  inner.every((value) => outer.some((root) => pathWithin(value, root)))

/** Pure projection over the actual HTTP data; a changed selection only explains what is withheld. */
export function explainRestoredReviewScope(input: RestoredScopeReviewInput): RestoredScopeReview {
  const { bindingScope, selection } = input
  const reasons: RestoredScopeReason[] = []
  if (bindingScope.projectId !== selection.projectId) reasons.push('project_changed')
  const selectionWithinBinding = within(selection.allowedPaths, bindingScope.allowedPaths)
  const bindingWithinSelection = within(bindingScope.allowedPaths, selection.allowedPaths)
  if (!same(selection.allowedPaths, bindingScope.allowedPaths)) {
    if (selectionWithinBinding && !bindingWithinSelection) reasons.push('selection_narrowed')
    else if (bindingWithinSelection && !selectionWithinBinding) reasons.push('selection_broadened')
    else reasons.push('selection_replaced')
  }
  const addedExclusions = selection.excludedPaths.filter((path) => !bindingScope.excludedPaths.some((root) => pathWithin(path, root)))
  const removedExclusions = bindingScope.excludedPaths.filter((path) => !selection.excludedPaths.some((root) => pathWithin(path, root)))
  if (addedExclusions.length > 0) reasons.push('exclusion_added')
  if (removedExclusions.length > 0) reasons.push('exclusion_removed')
  if (!same(selection.externalActions, bindingScope.externalActions)) reasons.push('selection_replaced')
  const scopeChanged = reasons.length > 0
  const withheldSourceIds = input.sourcesState === 'scope_changed' ? [...input.frozenSourceIds] : []
  return {
    protocol: 'restored-review-scope/1',
    state: input.sourcesState,
    scopeChanged,
    partial: input.sourcesState !== 'verified' || withheldSourceIds.length > 0,
    reasons: [...new Set(reasons)],
    withheldSourceIds,
    readable: {
      candidates: input.readableCandidates ?? null,
      history: input.readableHistory ?? null,
      works: input.readableWorks ?? null,
      deliveries: input.readableDeliveries ?? null,
    },
    authorization: 'none',
  }
}
