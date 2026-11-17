import { BookmarkCheck, CheckCircle2, ChevronDown, Clock3, FileCheck2, History, RefreshCw, ShieldCheck, TriangleAlert } from 'lucide-react'
import type {
  DecisionPage, DecisionPreview, WorkCompletionHistory, WorkEvidence, WorkVerificationStatus, WorkView,
} from '@personal-agent/contracts'
import type { TrialCompletionHistoryScope } from './work-review.ts'
import {
  trialCompletionHistoryAdmission, trialCompletionKindLabel, trialCompletionReasonLabel, trialDecisionReasonLabel, trialDecisionRows, trialReviewSnapshot,
} from './work-review.ts'
import './trial.css'

const phaseLabel: Record<WorkView['phase'], string> = {
  evaluating: '评估中', queued: '排队中', working: '执行中', needs_user: '待回答', verifying: '检查中',
  switching: '切换中', stopping: '停止中', delivered: '已交付', ended: '已结束', uncertain: '结果未知',
}
const verificationLabel: Record<WorkVerificationStatus['state'], string> = {
  not_ready: '尚未就绪', queued: '排队检查', running: '检查中', retry_wait: '等待重试', blocked: '机器检查失败', finished: '检查完成',
}
const acceptanceLabel: Record<string, string> = { not_requested: '未请求接受', accepted: '已人工接受', rejected: '已拒绝', unknown: '接受结果未知', unobserved: '未观察' }
const projectionLabel: Record<WorkEvidence['projection'] | 'unobserved', string> = {
  recorded: '接受记录可核对', source_missing: '接受记录来源缺失', not_in_window: '接受记录不在当前窗口',
  not_accepted: '尚未接受当前交付', unobserved: '交付记录未观察',
}
const format = (value: string) => {
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '时间未读取'
}

export interface WorkCompletionHistoryPanelProps {
  readonly page?: WorkCompletionHistory | undefined
  readonly scope: TrialCompletionHistoryScope
  readonly loading?: boolean | undefined
  readonly loadingMore?: boolean | undefined
  readonly error?: string | undefined
  readonly onSelectKind?: ((kind: WorkCompletionHistory['kind']) => void) | undefined
  readonly onLoadMore?: (() => void) | undefined
  readonly onRetry?: (() => void) | undefined
  readonly onOpenWork?: (() => void) | undefined
  readonly headingLevel?: 2 | 3 | undefined
}

/** A's classified completion metadata (contracts/verifications/acceptances). Not a frozen snapshot. */
export function WorkCompletionHistoryPanel({
  page: raw, scope, loading = false, loadingMore = false, error, onSelectKind, onLoadMore, onRetry, onOpenWork, headingLevel = 3,
}: WorkCompletionHistoryPanelProps) {
  const Heading = headingLevel === 3 ? 'h3' : 'h2'
  const admission = raw === undefined ? undefined : trialCompletionHistoryAdmission(raw, scope)
  const page = admission?.ok === true ? admission.page : undefined
  const kind = scope.kind
  return (
    <section className="trial-work-history" aria-label="原工作分类历史" aria-busy={loading || loadingMore}>
      <header className="trial-work-history-head">
        <div><Heading className="trial-history-title"><History size={15} aria-hidden="true" />原工作分类历史</Heading>
          <p className="trial-note">合同版本、检查记录与人工标准验收的只读 metadata；原时间线保留整体交付接受。</p></div>
        {onRetry !== undefined && <button type="button" className="icon-button" aria-label="重新读取分类历史" title="重新读取分类历史" disabled={loading} onClick={onRetry}><RefreshCw size={15} /></button>}
      </header>
      {onSelectKind !== undefined && <div className="trial-work-history-kinds" role="group" aria-label="分类历史类别">
        {(['contracts', 'verifications', 'acceptances'] as const).map(value => <button key={value} type="button" className="quiet"
          aria-pressed={kind === value} disabled={loading} onClick={() => onSelectKind(value)}>{trialCompletionKindLabel[value]}</button>)}
      </div>}
      {admission !== undefined && admission.ok === false && <p className="trial-history-status" role="alert">
        {admission.reason === 'blocked' ? '单条历史超过读取上限，较早记录暂不可达；这不是完整的零条记录。'
          : `${trialCompletionReasonLabel[admission.reason]}，已拒绝显示。`}
      </p>}
      {error !== undefined && <p className="trial-history-status" role="alert">{error}{onRetry !== undefined && <button type="button" className="quiet" onClick={onRetry}>重试</button>}</p>}
      {loading && page === undefined && <p className="trial-history-status" role="status">正在读取分类历史…</p>}
      {page !== undefined && <>
        <div className="trial-work-history-meta"><span>当前合同版本 {page.currentContract.revision}</span><span>{trialCompletionKindLabel[page.kind]}</span>
          <span>来源 {page.available} 条 · 已显示 {page.returned} 条</span><span>{page.coverage === 'complete' ? '窗口完整' : '部分记录'}</span>
          <span>live keyset</span><span>更新于 {format(page.observedAt)}</span></div>
        {page.entries.length === 0 ? <p className="trial-history-status" role="status">本类暂无记录。</p> : <ol className="trial-work-history-list">
          {page.entries.map(row => <li key={row.id}>
            <span className="trial-work-event"><FileCheck2 size={13} aria-hidden="true" />
              {row.kind === 'contracts' ? `合同版本 ${row.revision}` : row.kind === 'verifications' ? `第 ${row.generation} 代检查记录` : `第 ${row.generation} 代人工标准验收`}</span>
            {'at' in row && <time dateTime={row.at}>{format(row.at)}</time>}
            <span className="trial-note">{row.kind === 'contracts' ? `摘要 ${row.digest.slice(0, 12)}…` : row.kind === 'verifications' ? `标准摘要 ${row.criteriaDigest.slice(0, 12)}…` : `${row.criterionCount} 项人工标准`}</span>
            <span className="trial-note trial-mono">记录 {row.id}</span>
          </li>)}
        </ol>}
        <div className="trial-work-history-foot">
          {page.hasMore && page.entries.length < 200
            ? <button type="button" className="quiet" disabled={loadingMore || error !== undefined || onLoadMore === undefined} onClick={onLoadMore}><ChevronDown size={14} />{loadingMore ? '读取中…' : '较早记录'}</button>
            : <span className="trial-note">已显示 {page.entries.length} 条{page.hasMore ? '，达到 200 条上限' : '，没有更早记录'}。</span>}
          {onOpenWork !== undefined && <button type="button" className="quiet" onClick={onOpenWork}>回到原工作</button>}
        </div>
        <p className="trial-note">人工标准验收是逐条 criteria 记录，不等于整体交付接受；整体接受仍看原时间线/候选。</p>
      </>}
    </section>
  )
}

export interface DecisionReferencePanelProps {
  readonly page?: DecisionPage | undefined
  readonly projectId: string
  readonly selectedId?: string | undefined
  readonly preview?: DecisionPreview | undefined
  readonly now?: number | undefined
  readonly loading?: boolean | undefined
  readonly error?: string | undefined
  readonly onSelect?: ((decisionId: string) => void) | undefined
  readonly onRetry?: (() => void) | undefined
  readonly headingLevel?: 2 | 3 | undefined
}

/** Current decision reference picker. Selection is a reference only; the original form records it. */
export function DecisionReferencePanel({
  page, projectId, selectedId, preview, now = Date.now(), loading = false, error, onSelect, onRetry, headingLevel = 3,
}: DecisionReferencePanelProps) {
  const Heading = headingLevel === 3 ? 'h3' : 'h2'
  const view = page === undefined ? undefined : trialDecisionRows(page, projectId, now)
  return (
    <section className="trial-decision-reference" aria-label="项目决定引用">
      <header className="trial-work-history-head">
        <div><Heading className="trial-history-title"><BookmarkCheck size={15} aria-hidden="true" />项目决定引用</Heading>
          <p className="trial-note">只选择当前有效版本作为参考；记录/应用仍走原表单与原命令。</p></div>
        {onRetry !== undefined && <button type="button" className="icon-button" aria-label="重新读取项目决定" title="重新读取项目决定" disabled={loading} onClick={onRetry}><RefreshCw size={15} /></button>}
      </header>
      {loading && page === undefined && <p className="trial-history-status" role="status">正在读取项目决定…</p>}
      {error !== undefined && <p className="trial-history-status" role="alert">{error}</p>}
      {view !== undefined && view.ok === false && <p className="trial-history-status" role="alert">{view.reason === 'foreign_project' ? '决定属于另一个项目，已拒绝显示。' : '决定续页信息不完整，已拒绝显示。'}</p>}
      {view?.ok === true && view.rows.length === 0 && !loading && <p className="trial-history-status" role="status">当前项目还没有决定。</p>}
      {view?.ok === true && view.rows.length > 0 && <ul className="trial-decision-list">
        {view.rows.map(row => {
          const decision = row.view.record.decision
          return <li key={decision.id}>
            <button type="button" className="trial-decision-row" aria-current={selectedId === decision.id ? 'true' : undefined}
              disabled={!row.selectable || onSelect === undefined} onClick={() => { if (row.selectable) onSelect?.(decision.id) }}>
              <span className="trial-decision-meta"><span>版本 {decision.version}</span><span>{row.statusLabel}</span><span>{row.sourceLabel}</span>
                {row.expiry !== undefined && <span>范围至 {format(row.expiry)}</span>}</span>
              <span className="trial-decision-content">{decision.content}</span>
              {row.reason !== undefined && <span className="trial-decision-reason"><TriangleAlert size={12} aria-hidden="true" />{trialDecisionReasonLabel[row.reason]}，不可作为当前参考。</span>}
            </button>
          </li>
        })}
      </ul>}
      {preview !== undefined && <section className="trial-decision-preview" aria-label="待确认决定">
        <strong>待确认决定</strong><p>{preview.decision.content}</p>
        <dl><div><dt>项目</dt><dd>{preview.decision.scope.projectId}</dd></div>
          <div><dt>允许路径</dt><dd>{preview.decision.scope.allowedPaths.join('、') || '—'}</dd></div>
          <div><dt>排除路径</dt><dd>{preview.decision.scope.excludedPaths.join('、') || '无'}</dd></div>
          <div><dt>确认期限</dt><dd>{format(preview.expiresAt)}</dd></div></dl>
        <p className="trial-note">预览不授予执行权限；只有你在原确认表单明确记录后才成为项目决定。</p>
      </section>}
      <p className="trial-note"><ShieldCheck size={13} aria-hidden="true" /> data-only 有效、来源可核对或历史版本都不构成执行 grant。</p>
    </section>
  )
}

export interface ReviewEvidencePanelProps {
  readonly work?: WorkView | undefined
  readonly verification?: WorkVerificationStatus | undefined
  readonly evidence?: WorkEvidence | undefined
  readonly onOpenWork?: (() => void) | undefined
  readonly headingLevel?: 2 | 3 | undefined
}

/** Candidate/verification/acceptance summary. It never offers or performs the accept command. */
export function ReviewEvidencePanel({ work, verification, evidence, onOpenWork, headingLevel = 3 }: ReviewEvidencePanelProps) {
  const Heading = headingLevel === 3 ? 'h3' : 'h2'
  const result = work === undefined ? undefined : trialReviewSnapshot(work, verification, evidence)
  if (work === undefined) return null
  return (
    <section className="trial-review-evidence" aria-label="交付与人工审阅">
      <header className="trial-work-history-head">
        <div><Heading className="trial-history-title"><CheckCircle2 size={15} aria-hidden="true" />交付与人工审阅</Heading>
          <p className="trial-note">当前候选、机器检查和接受摘要；接受仍是原确认命令。</p></div>
        {onOpenWork !== undefined && <button type="button" className="quiet" onClick={onOpenWork}>打开原工作</button>}
      </header>
      {result !== undefined && result.ok === false && <p className="trial-history-status" role="alert">
        {result.reason === 'foreign_work' ? '检查或证据属于另一个原工作，已拒绝显示。' : '证据合同与当前合同不一致，已拒绝显示。'}
      </p>}
      {result?.ok === true && <div className="trial-review-body">
        <dl className="trial-review-facts">
          <div><dt>工作状态</dt><dd>{phaseLabel[result.snapshot.phase]}</dd></div>
          <div><dt>机器检查</dt><dd>{result.snapshot.verificationState === 'unobserved' ? '未观察' : verificationLabel[result.snapshot.verificationState]}</dd></div>
          <div><dt>当前候选</dt><dd className="trial-mono">{result.snapshot.candidateId ?? '未提供'}</dd></div>
          <div><dt>检查结果</dt><dd className="trial-mono">{result.snapshot.verificationId ?? '未提供'}</dd></div>
          <div><dt>交付产物</dt><dd>{result.snapshot.artifacts} 项</dd></div>
          <div><dt>人工接受</dt><dd>{acceptanceLabel[result.snapshot.acceptance] ?? result.snapshot.acceptance}</dd></div>
          <div><dt>交付记录</dt><dd>{projectionLabel[result.snapshot.projection]}</dd></div>
          <div><dt>检查重试</dt><dd>{result.snapshot.retryAvailable ? '原界面提供重试' : '未提供'}</dd></div>
        </dl>
        {result.snapshot.blockers.length > 0 && <ul className="trial-review-blockers">{result.snapshot.blockers.map(blocker => <li key={blocker}><TriangleAlert size={13} aria-hidden="true" />{blocker}</li>)}</ul>}
        {result.snapshot.outcome !== undefined && <p className="trial-note"><Clock3 size={13} aria-hidden="true" /> 最近结果观测于 {format(result.snapshot.outcome.observedAt)} · {result.snapshot.outcome.layer} · {acceptanceLabel[result.snapshot.outcome.acceptance]}</p>}
        <p className="trial-note">{result.snapshot.acceptOffered ? '原界面当前提供接受动作；点击后仍需原确认与主程序 guard。' : '当前不可接受；缺候选、检查未完成或机器检查失败时不会出现隐式接受。'}</p>
      </div>}
    </section>
  )
}
