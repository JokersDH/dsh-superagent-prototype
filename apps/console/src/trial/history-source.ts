/**
 * Read-only presentation rules for original context history and frozen sources. The component receives
 * already-validated public DTOs from main; these functions only enforce the exact public scope, reject
 * overlapping continuations and keep unknown/partial states explicit. They never read local files,
 * never fetch and never grant a send/execute capability.
 */
import type { ContextHistory, ContextHistoryEntry, ContextPreview, ContextSources } from '@personal-agent/contracts'

export type TrialHistoryReason =
  | 'foreign_project' | 'foreign_conversation' | 'duplicate_entry' | 'invalid_continuation' | 'page_limit'

export interface TrialHistoryScope {
  readonly projectId?: string | undefined
  readonly conversationId?: string | undefined
}

export interface TrialHistoryPage {
  readonly entries: readonly ContextHistoryEntry[]
  readonly hasMore: boolean
  readonly nextCursor?: string | undefined
  readonly observedAt: string
}

export type TrialHistoryAdmission =
  | { readonly ok: true; readonly page: TrialHistoryPage }
  | { readonly ok: false; readonly reason: TrialHistoryReason }

const pageLimit = 50
const mergedLimit = 200

function continuationValid(entries: readonly ContextHistoryEntry[], hasMore: boolean, nextCursor: string | undefined): boolean {
  return hasMore === (nextCursor !== undefined) && new Set(entries.map(entry => entry.messageId)).size === entries.length
}

export function trialHistoryAdmission(history: ContextHistory, scope: TrialHistoryScope = {}): TrialHistoryAdmission {
  if (scope.projectId !== undefined && history.projectId !== scope.projectId) return { ok: false, reason: 'foreign_project' }
  if (scope.conversationId !== undefined && history.conversationId !== undefined && history.conversationId !== scope.conversationId)
    return { ok: false, reason: 'foreign_conversation' }
  if (history.entries.length > pageLimit) return { ok: false, reason: 'page_limit' }
  if (!continuationValid(history.entries, history.hasMore, history.nextCursor)) return { ok: false, reason: 'invalid_continuation' }
  if (history.entries.some(entry => entry.projectId !== history.projectId ||
    (scope.conversationId !== undefined && entry.conversationId !== scope.conversationId))) return { ok: false, reason: 'foreign_project' }
  return {
    ok: true,
    page: {
      entries: history.entries, hasMore: history.hasMore, observedAt: history.observedAt,
      ...(history.nextCursor === undefined ? {} : { nextCursor: history.nextCursor }),
    },
  }
}

/**
 * Merge one live keyset continuation into the pages already shown. Overlap, a missing cursor or a page
 * for another project refuses the merge instead of silently replacing current rows.
 */
export function trialHistoryMerge(
  previous: TrialHistoryPage,
  next: ContextHistory,
  scope: TrialHistoryScope = {},
): { readonly ok: true; readonly page: TrialHistoryPage } | { readonly ok: false; readonly reason: TrialHistoryReason } {
  const admission = trialHistoryAdmission(next, scope)
  if (!admission.ok) return admission
  const known = new Set(previous.entries.map(entry => entry.messageId))
  if (admission.page.entries.some(entry => known.has(entry.messageId))) return { ok: false, reason: 'duplicate_entry' }
  const entries = [...previous.entries, ...admission.page.entries]
  if (entries.length > mergedLimit) return { ok: false, reason: 'page_limit' }
  return {
    ok: true,
    page: {
      entries, hasMore: admission.page.hasMore, observedAt: admission.page.observedAt,
      ...(admission.page.nextCursor === undefined ? {} : { nextCursor: admission.page.nextCursor }),
    },
  }
}

export type TrialSourceReason = 'foreign_message' | 'foreign_project' | 'foreign_conversation' | 'unbound_source'

export function trialSourcesAdmission(
  sources: ContextSources,
  scope: { readonly messageId: string; readonly projectId: string; readonly conversationId: string },
): { readonly ok: true } | { readonly ok: false; readonly reason: TrialSourceReason } {
  if (sources.binding.messageId !== scope.messageId) return { ok: false, reason: 'foreign_message' }
  if (sources.binding.projectId !== scope.projectId) return { ok: false, reason: 'foreign_project' }
  if (sources.binding.conversationId !== scope.conversationId) return { ok: false, reason: 'foreign_conversation' }
  if (sources.state === 'verified' && sources.sources.some((source, index) => source.sourceId !== sources.binding.sources[index]?.sourceId))
    return { ok: false, reason: 'unbound_source' }
  return { ok: true }
}

export const trialHistoryMessage = {
  available: '原文可用', missing: '原消息已缺失', truncated: '原文已截断',
} as const

export const trialSourceStateLabel: Record<ContextSources['state'], string> = {
  verified: '已核对冻结原文',
  missing: '冻结原文文件缺失',
  unverified: '无法核对冻结原文',
  scope_changed: '当前只读选择与冻结时不同',
}

export const trialSourceKindLabel: Record<ContextPreview['sources'][number]['kind'], string> = {
  work: '工作', contract: '工作合同', verification: '验证', delivery: '接受记录', decision: '项目决定',
  project_metadata: '项目信息', conversation_message: '会话消息', artifact: '交付元数据',
}

export const trialScopeReasonLabel: Record<NonNullable<ContextSources['scopeReview']>['reasons'][number], string> = {
  project_changed: '所属项目与冻结时不同', selection_narrowed: '当前允许路径比冻结时更窄',
  selection_broadened: '当前允许路径比冻结时更宽', selection_replaced: '允许路径已变化',
  exclusion_added: '新增了排除路径', exclusion_removed: '移除了排除路径',
  selection_validity_changed: '选择有效期与冻结时不同',
}

/** Bounded body preview; the full original stays in main's existing source viewer. */
export function trialSourceExcerpt(content: string, max = 1200): { readonly text: string; readonly truncated: boolean } {
  return content.length <= max ? { text: content, truncated: false } : { text: `${content.slice(0, max)}…`, truncated: true }
}
