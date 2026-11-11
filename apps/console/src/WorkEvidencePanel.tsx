import { useCallback, useEffect, useRef, useState } from 'react'
import { BookmarkCheck, Check, ChevronDown, Clock3, FileCheck2, History, RefreshCw } from 'lucide-react'
import type { ExecutionOutcome, WorkEvidence, WorkEvidenceHistory, WorkView } from '@personal-agent/contracts'
import type { ConsoleTransport } from './transport.ts'

const kindLabels: Record<string, string> = {
  'work.created': '工作已创建', 'contract.revision': '合同已修订', 'ticket.link': '执行任务已关联',
  'question.opened': '收到待决定问题', 'verification.recorded': '检查结果已记录',
  'acceptance.recorded': '人工接受已记录', 'execution.outcome': '交付结果已记录', 'review.recorded': '独立复核已记录',
  'runtime.attempt.started': '执行已开始', 'runtime.attempt.ended': '执行已结束', 'runtime.candidate.observed': '候选已记录',
}
const projectionLabels = { recorded: '接受记录可核对', source_missing: '接受记录来源缺失', not_in_window: '接受记录不在当前窗口', not_accepted: '尚未接受当前交付' }
const elapsed = (milliseconds: number | null | undefined): string => {
  if (milliseconds === null || milliseconds === undefined) return '未记录'
  if (milliseconds < 1000) return '不足 1 秒'
  if (milliseconds < 60000) return `${Math.floor(milliseconds / 1000)} 秒`
  if (milliseconds < 3600000) return `${Math.floor(milliseconds / 60000)} 分 ${Math.floor(milliseconds / 1000) % 60} 秒`
  return `${Math.floor(milliseconds / 3600000)} 小时 ${Math.floor(milliseconds / 60000) % 60} 分`
}
const identity = (entry: WorkEvidenceHistory['entries'][number]) => JSON.stringify([entry.at, entry.kind, entry.sourceRef])

export function WorkEvidencePanel({ work, transport }: { work: WorkView; transport: ConsoleTransport }) {
  const [open, setOpen] = useState(work.phase === 'delivered')
  const [summary, setSummary] = useState<WorkEvidence>(), [page, setPage] = useState<WorkEvidenceHistory>()
  const [entries, setEntries] = useState<WorkEvidenceHistory['entries']>([])
  const [loading, setLoading] = useState(false), [error, setError] = useState<string>(), [supported, setSupported] = useState<boolean>()
  const [loadedFor, setLoadedFor] = useState<string>()
  const request = useRef(0), workId = work.work.id
  const contextKey = JSON.stringify([workId, work.contract.revision, work.contract.digest, work.phase, work.actions.currentVerificationId])
  const load = useCallback(async (cursor?: string) => {
    const sequence = ++request.current
    setLoading(true); setError(undefined)
    if (!cursor) { setSummary(undefined); setPage(undefined); setEntries([]); setSupported(undefined) }
    try {
      const [value, history] = await Promise.all([
        !cursor && transport.workEvidence ? transport.workEvidence(workId) : Promise.resolve(undefined),
        transport.workEvidenceHistory ? transport.workEvidenceHistory(workId, { limit: 20, ...(cursor ? { cursor } : {}) }) : Promise.resolve(undefined),
      ])
      if (sequence !== request.current) return
      if (history && (history.contract.revision !== work.contract.revision || history.contract.digest !== work.contract.digest))
        throw new Error('Contract changed')
      if (!cursor) { setSummary(value); setSupported(!!value || !!history) }
      setLoadedFor(contextKey)
      setPage(history)
      setEntries(previous => {
        const existing = new Set(cursor ? previous.map(identity) : [])
        return [...(cursor ? previous : []), ...(history?.entries ?? []).filter(entry => !existing.has(identity(entry)))]
      })
    } catch {
      if (sequence === request.current) setError('交付记录暂时无法核对，请重新读取。')
    } finally { if (sequence === request.current) setLoading(false) }
  }, [workId, work.contract.revision, work.contract.digest, contextKey, transport])
  useEffect(() => {
    if (!open) return
    void load()
    return () => { request.current++ }
  }, [open, load, work.phase, work.actions.currentVerificationId])
  useEffect(() => { if (work.phase === 'delivered') setOpen(true) }, [work.phase])

  if (!transport.workEvidence && !transport.workEvidenceHistory) return null
  const currentSummary = loadedFor === contextKey ? summary : undefined, currentPage = loadedFor === contextKey ? page : undefined
  const visibleEntries = loadedFor === contextKey ? entries : []
  const current = currentSummary?.outcomes.find(outcome => outcome.acceptance === 'accepted' && outcome.attempt.contract.revision === work.contract.revision &&
    outcome.attempt.contract.digest === work.contract.digest && outcome.verificationRef === work.actions.currentVerificationId)
  return <section className="work-evidence" aria-label="交付记录">
    <header><h4><History size={15} />交付记录</h4><button type="button" className="icon-button" aria-label={open ? '收起交付记录' : '展开交付记录'}
      title={open ? '收起交付记录' : '展开交付记录'} aria-expanded={open} onClick={() => setOpen(!open)}><ChevronDown size={16} className={open ? 'evidence-chevron-open' : ''} /></button></header>
    {open && <>
      <div className="evidence-tools"><span>{currentPage ? `更新于 ${new Date(currentPage.observedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}` : `合同版本 ${work.contract.revision}`}</span>
        <button type="button" className="icon-button" title="刷新交付记录" aria-label="刷新交付记录" disabled={loading} onClick={() => void load()}><RefreshCw size={14} /></button></div>
      {error && <p className="warn-text" role="alert">{error}</p>}
      {loading && !summary && !page && <p className="evidence-empty" role="status">正在读取交付记录</p>}
      {!loading && supported === false && <p className="evidence-empty">该实例暂无可用的交付记录</p>}
      {currentSummary && <div className="evidence-summary"><span className={`evidence-projection${currentSummary.projection === 'recorded' ? ' evidence-recorded' : ''}`}><BookmarkCheck size={15} />{projectionLabels[currentSummary.projection]}</span>
        {current && <OutcomeTiming outcome={current} />}
        {currentSummary.truncated && <p className="evidence-bound">部分来源不在本次读取范围内</p>}</div>}
      {!!visibleEntries.length && <ol className="evidence-timeline">{visibleEntries.map(entry => {
        const detail = entry.detail && typeof entry.detail === 'object' && !Array.isArray(entry.detail) ? entry.detail : undefined
        const revision = typeof detail?.revision === 'number' ? detail.revision : undefined
        return <li key={identity(entry)}><span className="evidence-event-icon">{entry.kind === 'acceptance.recorded' || entry.kind === 'execution.outcome' ? <Check size={13} /> : <FileCheck2 size={13} />}</span>
          <div><div className="evidence-event-title"><span>{kindLabels[entry.kind] ?? (entry.kind.startsWith('runtime.') ? '执行状态已记录' : '记录已更新')}</span>
            <time dateTime={entry.at}>{new Date(entry.at).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</time></div>
            {revision !== undefined && <span className="evidence-revision">合同版本 {revision}</span>}
            <details className="technical-details"><summary>记录来源</summary><code>{entry.sourceRef}</code><span className="evidence-kind">{entry.kind}</span></details>
          </div></li>
      })}</ol>}
      {!loading && currentPage && !visibleEntries.length && <p className="evidence-empty">当前没有历史记录</p>}
      {currentPage?.hasMore && <button type="button" className="quiet evidence-more" disabled={loading} onClick={() => void load(currentPage.nextCursor)}>{loading ? '正在读取' : '加载较早记录'}</button>}
      {!!currentPage?.sourcesCapped.length && <p className="evidence-bound" role="status">历史来源读取范围受限</p>}
      {!loading && supported && !currentPage && <p className="evidence-empty">历史分页暂不可用</p>}
    </>}
  </section>
}

function OutcomeTiming({ outcome }: { outcome: ExecutionOutcome }) {
  return <dl className="evidence-timing"><dt><Clock3 size={13} />就绪后等待</dt><dd>{elapsed(outcome.reviewTiming?.readyToAcceptanceMs)}</dd>
    <dt>可见活动<span className="evidence-partial">部分</span></dt><dd>{elapsed(outcome.reviewTiming?.activeReviewMs)}</dd></dl>
}
