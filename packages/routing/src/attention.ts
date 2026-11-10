export type AttentionKind = 'question' | 'candidate_acceptance' | 'blocked'
export type AttentionCategory = 'permission' | 'authentication' | 'clarification' | 'review' | 'candidate' | 'blocked'

/** An explicit business deadline only. A question's `expiresAt` is validity, not a business deadline. */
export interface AttentionBusinessDeadline {
  readonly at: string
  readonly sourceRef: string
}

export interface AttentionItem {
  readonly id: string
  readonly kind: AttentionKind
  readonly category: AttentionCategory
  readonly projectId: string
  readonly conversationId?: string
  readonly workId?: string
  readonly questionId?: string
  readonly questionVersion?: number
  readonly candidateGeneration?: number
  readonly verificationId?: string
  /** Stable navigation target back to the original work/question/candidate. */
  readonly sourceRef: string
  readonly actorRef?: string
  readonly createdAt: string
  readonly waitingSince: string
  readonly businessDeadline?: AttentionBusinessDeadline
  /** Question validity expiry. It is never treated as a business deadline. */
  readonly expiresAt?: string
  readonly expired?: boolean
  readonly actionable: boolean
  /** Ids of items/work that this item is blocked by. */
  readonly blockedBy?: readonly string[]
  readonly version: number
  readonly evidenceRefs?: readonly string[]
}

export type AttentionBucket = 'blocking' | 'deadline' | 'actionable' | 'waiting' | 'expired'

export type AttentionReasonCode =
  | 'blocking_dependency'
  | 'business_deadline_overdue'
  | 'business_deadline_due'
  | 'business_deadline_unknown'
  | 'question_expired_no_action'
  | 'item_not_actionable'
  | 'waiting_on_dependency'
  | 'per_target_approval'
  | 'candidate_needs_review'

export interface AttentionReason {
  readonly code: AttentionReasonCode
  readonly detail?: string
}

export interface RankedAttentionItem extends AttentionItem {
  readonly rank: number
  readonly bucket: AttentionBucket
  readonly reasons: readonly AttentionReason[]
  readonly deadlineState: 'known' | 'unknown'
  readonly expired: boolean
  readonly actionable: boolean
  readonly waitingMs: number
  readonly score: number
}

export interface AttentionGroup {
  readonly projectId: string
  readonly kind: AttentionKind
  readonly items: readonly RankedAttentionItem[]
  /** Permission/authentication/candidate items stay individually confirmable; no bulk approval. */
  readonly requiresPerTargetApproval: boolean
}

const CATEGORY_WEIGHT: Record<AttentionCategory, number> = {
  permission: 400,
  authentication: 400,
  review: 300,
  candidate: 300,
  clarification: 200,
  blocked: 100,
}

function waitingMs(item: AttentionItem, now: number): number {
  const since = Date.parse(item.waitingSince)
  if (!Number.isFinite(since)) return 0
  return Math.max(0, now - since)
}

function deadlineScore(item: AttentionItem, now: number): number {
  if (!item.businessDeadline) return 0
  const at = Date.parse(item.businessDeadline.at)
  if (!Number.isFinite(at)) return 0
  const delta = at - now
  if (delta <= 0) return 900 + Math.min(-delta / 3_600_000, 720) // overdue hours, capped
  if (delta <= 24 * 3_600_000) return 800 + (24 - delta / 3_600_000)
  if (delta <= 7 * 24 * 3_600_000) return 500 + (168 - delta / 3_600_000)
  return 100
}

function deadlineReasons(item: AttentionItem, now: number): AttentionReason[] {
  if (!item.businessDeadline) return [{ code: 'business_deadline_unknown' }]
  const at = Date.parse(item.businessDeadline.at)
  if (!Number.isFinite(at)) return [{ code: 'business_deadline_unknown' }]
  return at <= now
    ? [{ code: 'business_deadline_overdue', detail: item.businessDeadline.at }]
    : [{ code: 'business_deadline_due', detail: item.businessDeadline.at }]
}

/**
 * Deterministic cross-project attention order: real business deadlines, blocking relations, waiting
 * age and category. There is no ROI probability. A question expiry is separated from a business
 * deadline, and expired items carry `actionable: false` because their answer can no longer be sent.
 */
export function rankAttention(
  items: readonly AttentionItem[],
  options: { readonly now?: Date } = {},
): readonly RankedAttentionItem[] {
  const now = (options.now ?? new Date()).getTime()
  const unblocks = new Map<string, string[]>()
  for (const item of items) {
    for (const blocked of item.blockedBy ?? []) {
      const list = unblocks.get(blocked) ?? []
      list.push(item.id)
      unblocks.set(blocked, list)
    }
  }

  const scored = items.map((item) => {
    const expired =
      item.expired === true ||
      (item.expiresAt !== undefined && Date.parse(item.expiresAt) <= now)
    const actionable = item.actionable && !expired
    const blockers = unblocks.get(item.id) ?? []
    const waiting = waitingMs(item, now)
    const score =
      blockers.length * 1000 +
      deadlineScore(item, now) +
      CATEGORY_WEIGHT[item.category] +
      Math.min(waiting / 3_600_000, 720) * 0.5 -
      (expired ? 500 : 0)
    const reasons: AttentionReason[] = []
    if (blockers.length > 0) reasons.push({ code: 'blocking_dependency', detail: blockers.join(',') })
    reasons.push(...deadlineReasons(item, now))
    if (expired) reasons.push({ code: 'question_expired_no_action' })
    if (!item.actionable && !expired) reasons.push({ code: 'item_not_actionable' })
    if (item.blockedBy && item.blockedBy.length > 0) {
      reasons.push({ code: 'waiting_on_dependency', detail: item.blockedBy.join(',') })
    }
    if (item.category === 'permission' || item.category === 'authentication') {
      reasons.push({ code: 'per_target_approval' })
    }
    if (item.category === 'candidate') reasons.push({ code: 'candidate_needs_review' })

    const bucket: AttentionBucket = expired
      ? 'expired'
      : !item.actionable || (item.blockedBy?.length ?? 0) > 0
        ? 'waiting'
        : blockers.length > 0
          ? 'blocking'
          : item.businessDeadline
            ? 'deadline'
            : 'actionable'
    return {
      item,
      score,
      bucket,
      reasons,
      deadlineState: item.businessDeadline ? 'known' : 'unknown',
      expired,
      actionable,
      waitingMs: waiting,
    } as const
  })

  scored.sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score
    const leftDeadline = left.item.businessDeadline ? Date.parse(left.item.businessDeadline.at) : Number.POSITIVE_INFINITY
    const rightDeadline = right.item.businessDeadline ? Date.parse(right.item.businessDeadline.at) : Number.POSITIVE_INFINITY
    if (leftDeadline !== rightDeadline) return leftDeadline - rightDeadline
    const since = left.item.waitingSince.localeCompare(right.item.waitingSince)
    if (since !== 0) return since
    const project = left.item.projectId.localeCompare(right.item.projectId)
    if (project !== 0) return project
    return left.item.id.localeCompare(right.item.id)
  })

  return scored.map((entry, index) => ({
    ...entry.item,
    rank: index + 1,
    bucket: entry.bucket,
    reasons: entry.reasons,
    deadlineState: entry.deadlineState,
    expired: entry.expired,
    actionable: entry.actionable,
    waitingMs: entry.waitingMs,
    score: entry.score,
  }))
}

/**
 * Groups for navigation/batch review. Every original item remains separately actionable; permissions
 * and authentication are never merged into one approval.
 */
export function groupAttention(items: readonly RankedAttentionItem[]): readonly AttentionGroup[] {
  const groups = new Map<string, RankedAttentionItem[]>()
  for (const item of items) {
    const key = `${item.projectId}\u0000${item.kind}`
    const list = groups.get(key) ?? []
    list.push(item)
    groups.set(key, list)
  }
  return [...groups.entries()]
    .map(([key, groupItems]) => {
      const [projectId, kind] = key.split('\u0000') as [string, AttentionKind]
      return {
        projectId,
        kind,
        items: groupItems,
        requiresPerTargetApproval: groupItems.some(
          (item) => item.category === 'permission' || item.category === 'authentication' || item.category === 'candidate',
        ),
      }
    })
    .sort((left, right) => left.projectId.localeCompare(right.projectId) || left.kind.localeCompare(right.kind))
}
