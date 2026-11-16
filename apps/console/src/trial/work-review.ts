/**
 * Read-only rules for the original Work review surfaces: deliverable history, decision references and
 * acceptance evidence. They consume public DTOs from main and never fetch, apply a decision, accept a
 * candidate or widen a Scope. "eligible" here only means displayable for explicit navigation; the
 * original form/Application guard remains the only authority.
 */
import type {
  DecisionPage, DecisionView, ExecutionOutcome, WorkEvidence, WorkEvidenceHistory, WorkVerificationStatus, WorkView,
} from '@personal-agent/contracts'

export type TrialWorkHistoryReason = 'foreign_work' | 'stale_contract' | 'invalid_continuation' | 'duplicate_entry' | 'page_limit'

export interface TrialWorkHistoryScope {
  readonly workId: string
  readonly revision?: number | undefined
  readonly digest?: string | undefined
}

export interface TrialWorkHistoryPage {
  readonly contract: WorkEvidenceHistory['contract']
  readonly observedAt: string
  readonly entries: WorkEvidenceHistory['entries']
  readonly hasMore: boolean
  readonly nextCursor?: string | undefined
  readonly window: WorkEvidenceHistory['window']
  readonly sourcesCapped: WorkEvidenceHistory['sourcesCapped']
}

const historyEntryIdentity = (entry: WorkEvidenceHistory['entries'][number]) => JSON.stringify([entry.at, entry.kind, entry.sourceRef])
const mergedLimit = 300

export function trialWorkHistoryAdmission(
  history: WorkEvidenceHistory,
  scope: TrialWorkHistoryScope,
): { readonly ok: true; readonly page: TrialWorkHistoryPage } | { readonly ok: false; readonly reason: TrialWorkHistoryReason } {
  if (history.workId !== scope.workId || history.contract.workId !== scope.workId) return { ok: false, reason: 'foreign_work' }
  if ((scope.revision !== undefined && history.contract.revision !== scope.revision) ||
    (scope.digest !== undefined && history.contract.digest !== scope.digest)) return { ok: false, reason: 'stale_contract' }
  if (history.entries.length > 100 || new Set(history.entries.map(historyEntryIdentity)).size !== history.entries.length)
    return { ok: false, reason: history.entries.length > 100 ? 'page_limit' : 'duplicate_entry' }
  if (history.hasMore !== (history.nextCursor !== undefined)) return { ok: false, reason: 'invalid_continuation' }
  return {
    ok: true,
    page: {
      contract: history.contract, observedAt: history.observedAt, entries: history.entries,
      hasMore: history.hasMore, window: history.window, sourcesCapped: history.sourcesCapped,
      ...(history.nextCursor === undefined ? {} : { nextCursor: history.nextCursor }),
    },
  }
}

export function trialWorkHistoryMerge(
  previous: TrialWorkHistoryPage,
  next: WorkEvidenceHistory,
  scope: TrialWorkHistoryScope,
): { readonly ok: true; readonly page: TrialWorkHistoryPage } | { readonly ok: false; readonly reason: TrialWorkHistoryReason } {
  const admission = trialWorkHistoryAdmission(next, scope)
  if (!admission.ok) return admission
  if (admission.page.contract.revision !== previous.contract.revision || admission.page.contract.digest !== previous.contract.digest)
    return { ok: false, reason: 'stale_contract' }
  const known = new Set(previous.entries.map(historyEntryIdentity))
  if (admission.page.entries.some(entry => known.has(historyEntryIdentity(entry)))) return { ok: false, reason: 'duplicate_entry' }
  const entries = [...previous.entries, ...admission.page.entries]
  if (entries.length > mergedLimit) return { ok: false, reason: 'page_limit' }
  return {
    ok: true,
    page: {
      ...admission.page, entries,
    },
  }
}

export type TrialDecisionReason =
  | 'foreign_project' | 'invalid_continuation' | 'revoked' | 'superseded' | 'expired' | 'source_missing' | 'source_stale' | 'source_unknown'

export interface TrialDecisionRow {
  readonly view: DecisionView
  readonly statusLabel: string
  readonly sourceLabel: string
  /** Only a current recorded, non-expired decision can be offered as an explicit reference. */
  readonly selectable: boolean
  readonly reason?: TrialDecisionReason | undefined
  readonly expiry?: string | undefined
}

export const trialDecisionStatusLabel: Record<DecisionView['status'], string> = {
  recorded: '已记录', revoked: '已撤销', superseded: '已替代', expired: '已到期',
}

export const trialDecisionSourceLabel: Record<DecisionView['sourceState'], string> = {
  current: '来源可核对', missing: '来源已缺失', stale: '来源已变化', unknown: '来源待核对',
}

export function trialDecisionRows(
  page: DecisionPage,
  projectId: string,
  now = Date.now(),
): { readonly ok: true; readonly rows: readonly TrialDecisionRow[] } | { readonly ok: false; readonly reason: 'foreign_project' | 'invalid_continuation' } {
  if (page.hasMore !== (page.nextCursor !== undefined)) return { ok: false, reason: 'invalid_continuation' }
  if (page.decisions.some(view => view.record.decision.scope.projectId !== projectId)) return { ok: false, reason: 'foreign_project' }
  const rows = page.decisions.map(view => {
    const decision = view.record.decision
    const expiry = decision.scope.expiresAt
    let reason: TrialDecisionReason | undefined
    if (view.status === 'revoked') reason = 'revoked'
    else if (view.status === 'superseded') reason = 'superseded'
    else if (view.status === 'expired' || (expiry !== undefined && Date.parse(expiry) <= now)) reason = 'expired'
    else if (view.sourceState === 'missing') reason = 'source_missing'
    else if (view.sourceState === 'stale') reason = 'source_stale'
    else if (view.sourceState === 'unknown') reason = 'source_unknown'
    return {
      view, statusLabel: trialDecisionStatusLabel[view.status], sourceLabel: trialDecisionSourceLabel[view.sourceState],
      selectable: reason === undefined, ...(reason === undefined ? {} : { reason }),
      ...(expiry === undefined ? {} : { expiry }),
    }
  })
  return { ok: true, rows }
}

export const trialDecisionReasonLabel: Record<TrialDecisionReason, string> = {
  foreign_project: '属于另一个项目', invalid_continuation: '续页信息不完整',
  revoked: '决定已撤销', superseded: '决定已替代', expired: '决定范围已过期',
  source_missing: '来源消息已缺失', source_stale: '来源已变化', source_unknown: '来源尚未核对',
}

export type TrialReviewReason = 'foreign_work' | 'stale_contract'

export interface TrialReviewSnapshot {
  readonly phase: WorkView['phase']
  readonly verificationState: WorkVerificationStatus['state'] | 'unobserved'
  readonly candidateId?: string | undefined
  readonly verificationId?: string | undefined
  readonly machineFailure?: string | undefined
  readonly retryAvailable: boolean
  readonly artifacts: number
  readonly outcome?: ExecutionOutcome | undefined
  readonly acceptance: ExecutionOutcome['acceptance'] | 'unobserved'
  readonly projection: WorkEvidence['projection'] | 'unobserved'
  readonly truncated: boolean
  readonly blockers: readonly string[]
  /** A UI hint that the original accept action is currently offered; it is not an acceptance. */
  readonly acceptOffered: boolean
}

export function trialReviewSnapshot(
  work: WorkView,
  verification: WorkVerificationStatus | undefined,
  evidence: WorkEvidence | undefined,
): { readonly ok: true; readonly snapshot: TrialReviewSnapshot } | { readonly ok: false; readonly reason: TrialReviewReason } {
  if (verification !== undefined && verification.workId !== work.work.id) return { ok: false, reason: 'foreign_work' }
  if (evidence !== undefined && (evidence.workId !== work.work.id || evidence.outcomes.some(outcome => outcome.attempt.contract.workId !== work.work.id)))
    return { ok: false, reason: 'foreign_work' }
  const sameContract = (outcome: ExecutionOutcome) => outcome.attempt.contract.revision === work.contract.revision &&
    outcome.attempt.contract.digest === work.contract.digest
  if (evidence !== undefined && !evidence.outcomes.every(sameContract)) return { ok: false, reason: 'stale_contract' }
  const candidate = work.actions.currentCandidate
  const outcome = evidence?.outcomes.find(value => sameContract(value) &&
    (candidate === undefined || (value.candidate?.ticketId === candidate.ticketId &&
      value.candidate.assignmentId === candidate.assignmentId && value.candidate.candidateGeneration === candidate.candidateGeneration)) &&
    (work.actions.currentVerificationId === undefined || value.verificationRef === work.actions.currentVerificationId))
  const blockers: string[] = []
  if (evidence?.projection === 'source_missing') blockers.push('接受记录来源缺失')
  if (evidence?.projection === 'not_in_window') blockers.push('接受记录不在当前窗口')
  if (evidence?.projection === 'not_accepted') blockers.push('尚未接受当前交付')
  if (evidence?.truncated) blockers.push('交付记录仅部分读取')
  if (verification?.state === 'blocked') blockers.push(`机器检查失败：${verification.failure?.code ?? 'verification_failed'}`)
  if (work.phase === 'needs_user') blockers.push('仍有待回答的问题')
  return {
    ok: true,
    snapshot: {
      phase: work.phase, verificationState: verification?.state ?? 'unobserved',
      ...(candidate === undefined ? {} : { candidateId: `${candidate.ticketId}/${candidate.assignmentId}/${candidate.candidateGeneration}` }),
      ...(work.actions.currentVerificationId === undefined ? {} : { verificationId: work.actions.currentVerificationId }),
      ...(verification?.failure === undefined ? {} : { machineFailure: verification.failure.code }),
      retryAvailable: verification?.retryAvailable ?? false, artifacts: work.artifactIds.length,
      ...(outcome === undefined ? {} : { outcome }), acceptance: outcome?.acceptance ?? 'unobserved',
      projection: evidence?.projection ?? 'unobserved', truncated: evidence?.truncated ?? false,
      blockers, acceptOffered: work.actions.available.includes('accept_candidate') && verification?.state === 'finished',
    },
  }
}
