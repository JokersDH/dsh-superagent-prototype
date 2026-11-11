import { AttentionItemSchema, AttentionRankSchema } from '@personal-agent/contracts'
import type { AttentionItem, AttentionRank, AttentionRanker } from '@personal-agent/contracts'

/** A "near" business deadline reason is only emitted inside this explicit window. */
export const DEADLINE_NEAR_WINDOW_MS = 24 * 3_600_000

export class AttentionRankError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AttentionRankError'
  }
}

const KIND_WEIGHT: Record<AttentionItem['kind'], number> = {
  blocked: 6000,
  candidate: 4000,
  question: 2000,
}

function questionWeight(item: Extract<AttentionItem, { kind: 'question' }>): number {
  return item.questionKind === 'permission' || item.questionKind === 'authentication' ? 3000 : 2000
}

function waitOf(item: AttentionItem, now: number): { score: number; reasons: AttentionRank['reasons'][number][] } {
  if (item.sinceAt === null) return { score: 0, reasons: ['unknown_wait'] }
  const since = Date.parse(item.sinceAt)
  if (!Number.isFinite(since)) return { score: 0, reasons: ['unknown_wait'] }
  const hours = Math.max(0, now - since) / 3_600_000
  // Known wait gets a small base so it outranks an unknown wait at equal other factors.
  return { score: 1 + Math.min(hours, 720), reasons: ['waiting_age'] }
}

function deadlineOf(item: AttentionItem, now: number): { score: number; reasons: AttentionRank['reasons'][number][] } {
  if (item.deadlineAt === null) return { score: 0, reasons: [] }
  const at = Date.parse(item.deadlineAt)
  if (!Number.isFinite(at)) return { score: 0, reasons: [] }
  const delta = at - now
  if (delta <= 0) return { score: 1200, reasons: ['deadline_overdue'] }
  if (delta <= DEADLINE_NEAR_WINDOW_MS) return { score: 600, reasons: ['deadline_near'] }
  return { score: 0, reasons: [] }
}

function kindReasons(item: AttentionItem): AttentionRank['reasons'][number][] {
  if (item.kind === 'blocked') return [item.code]
  if (item.kind === 'candidate') return ['candidate_ready']
  if (item.questionKind === 'permission') return ['permission_pending']
  if (item.questionKind === 'authentication') return ['authentication_pending']
  return []
}

/**
 * Shared AttentionRanker implementation (`packages/contracts/src/attention.ts`).
 *
 * - `sinceAt: null` is unknown waiting: reason `unknown_wait`, never a fabricated age.
 * - `deadlineAt` is the only business deadline; `expiresAt` is answer validity and is not converted
 *   into a deadline reason. Ranking never grants/removes permission to answer a still-valid item.
 * - `blockedWorkIds` is outgoing (works this item blocks). The old incoming `blockedBy` model is not
 *   reused or renamed; only the shared outgoing set produces `blocks_other_work`.
 * - The result is a complete, duplicate-free permutation of the input ids. Same items and `now`
 *   produce the same order and reasons.
 */
export function rankSharedAttention(input: {
  readonly items: readonly AttentionItem[]
  readonly now: string
}): readonly AttentionRank[] {
  const now = Date.parse(input.now)
  if (!Number.isFinite(now)) throw new AttentionRankError('now must be a valid timestamp')
  const items = input.items.map((item) => AttentionItemSchema.parse(item))
  const seen = new Set<string>()
  for (const item of items) {
    if (seen.has(item.id)) throw new AttentionRankError(`Duplicate attention id: ${item.id}`)
    seen.add(item.id)
  }

  const scored = items.map((item) => {
    const wait = waitOf(item, now)
    const deadline = deadlineOf(item, now)
    const blocks = new Set(item.blockedWorkIds)
    const reasons = new Set<AttentionRank['reasons'][number]>([
      ...kindReasons(item),
      ...deadline.reasons,
      ...wait.reasons,
    ])
    if (blocks.size > 0) reasons.add('blocks_other_work')
    const score =
      (item.kind === 'question' ? questionWeight(item) : KIND_WEIGHT[item.kind]) +
      deadline.score +
      wait.score +
      (blocks.size > 0 ? 800 + Math.min(blocks.size, 8) * 50 : 0)
    return {
      item,
      score,
      reasons: [...reasons],
      deadlineAt: item.deadlineAt === null ? Number.POSITIVE_INFINITY : Date.parse(item.deadlineAt),
      sinceAt: item.sinceAt === null ? Number.POSITIVE_INFINITY : Date.parse(item.sinceAt),
    }
  })

  scored.sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score
    if (left.deadlineAt !== right.deadlineAt) return left.deadlineAt - right.deadlineAt
    if (left.sinceAt !== right.sinceAt) return left.sinceAt - right.sinceAt
    return left.item.id.localeCompare(right.item.id)
  })

  return scored.map(({ item, reasons }) =>
    AttentionRankSchema.parse({ id: item.id, reasons: [...new Set(reasons)] }),
  ) as readonly AttentionRank[]
}

/** Directly assignable to contracts' `AttentionRanker`. */
export const sharedAttentionRanker: AttentionRanker = rankSharedAttention
