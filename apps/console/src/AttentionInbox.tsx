import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { ArrowDown, ArrowLeft, ArrowRight, ChevronRight, CircleHelp, Clock3, FileCheck2, Inbox, ListChecks, RefreshCw, Search, TriangleAlert } from 'lucide-react'
import type { ApplicationConfiguration, AttentionItem, AttentionPage, AttentionQuery } from '@personal-agent/contracts'
import type { ConsoleTransport } from './transport.ts'

const category = (item: AttentionItem) => item.kind === 'candidate' ? '待审阅' : item.kind === 'blocked' ? '待处理'
  : { clarification: '待回答', permission: '权限确认', authentication: '认证', review: '复核确认' }[item.questionKind]
const waiting = (at: string | null, now: number) => {
  if (!at || now < Date.parse(at)) return '等待时间未知'
  const minutes = Math.floor((now - Date.parse(at)) / 60000)
  return minutes < 1 ? '刚刚' : minutes < 60 ? `${minutes} 分钟` : minutes < 1440 ? `${Math.floor(minutes / 60)} 小时` : `${Math.floor(minutes / 1440)} 天`
}
const clock = (at: string) => new Date(at).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })
const reasonLabel: Record<AttentionPage['ranks'][number]['reasons'][number], string> = {
  waiting_age: '等待时间', unknown_wait: '时间未知', deadline_overdue: '已过截止', deadline_near: '临近截止', blocks_other_work: '阻塞其他工作',
  permission_pending: '待权限确认', authentication_pending: '待认证', candidate_ready: '交付待审阅', verification_blocked: '验证受阻',
  machine_failed: '检查未通过', writer_indeterminate: '执行资源待核对', dispatch_paused: '派工暂停',
}

export function AttentionInbox({ transport, configuration, active, revision, fallback, onOpen, onCount }: {
  transport: ConsoleTransport; configuration: ApplicationConfiguration | undefined; active: boolean; revision: number | undefined; fallback: ReactNode
  onOpen(item: AttentionItem, queue?: readonly AttentionItem[]): Promise<void>
  onCount(value: { count: number; partial: boolean }): void
}) {
  const [query, setQuery] = useState<AttentionQuery>({}), [history, setHistory] = useState<(string | undefined)[]>([])
  const [page, setPage] = useState<AttentionPage>(), [kind, setKind] = useState('all'), [search, setSearch] = useState('')
  const [loading, setLoading] = useState(false), [unavailable, setUnavailable] = useState(false), [failure, setFailure] = useState<string>()
  const [reload, setReload] = useState(0), [opening, setOpening] = useState<string>(), [visible, setVisible] = useState(50)
  const countCallback = useRef(onCount); countCallback.current = onCount
  useEffect(() => {
    if (!active || !transport.attention) return
    let cancelled = false
    const timer = setTimeout(() => {
      setLoading(true); setFailure(undefined)
      void transport.attention!(query).then(value => {
        if (cancelled) return
        setUnavailable(!value); setPage(value)
        if (value) countCallback.current({ count: value.items.length, partial: value.hasMore || value.questionCoverage === 'bounded' })
      }).catch(() => { if (!cancelled) setFailure('待办暂时无法读取，请重试。') })
        .finally(() => { if (!cancelled) setLoading(false) })
    }, 150)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [active, transport, query, revision, reload])
  useEffect(() => { setVisible(50) }, [kind, search, query])
  if (unavailable || !transport.attention) return active ? <div className="workspace-view"><div className="view-header"><h2 className="view-title">待我决定</h2></div><div className="view-content"><p className="attention-scope">当前对话</p>{fallback}</div></div> : null
  const byId = new Map(page?.items.map(item => [item.id, item]) ?? [])
  const ordered = page?.ranks.map(rank => byId.get(rank.id)!).filter(Boolean) ?? []
  const titleFor = (id: string) => configuration?.projects.find(project => project.id === id)?.displayName ?? id
  const filtered = ordered.filter(item => (kind === 'all' || item.kind === kind) &&
    `${item.workTitle} ${item.summary} ${titleFor(item.projectId)}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))
  const candidates = filtered.filter(item => item.kind === 'candidate')
  const open = async (item: AttentionItem, queue?: readonly AttentionItem[]) => {
    setOpening(item.id); setFailure(undefined)
    try { await onOpen(item, queue) } catch { setFailure('待办已变化或暂时不可用，请刷新后重试。') }
    finally { setOpening(undefined) }
  }
  const now = Date.now()
  return <div className="workspace-view attention-view" aria-busy={loading}>
    <div className="view-header attention-header"><div><h2 className="view-title">待你处理</h2><p className="view-description">全部会话{page ? ` · 已读取 ${page.scannedWorks} 个工作 · 本页 ${page.items.length} 项` : ''}</p></div>
      <div className="attention-tools"><button type="button" className="quiet" disabled={!candidates.length || !!opening || loading}
        onClick={() => void open(candidates[0]!, candidates)}><ListChecks size={15} />逐项审阅</button>
        <button type="button" className="icon-button" title="刷新待办" aria-label="刷新待办" disabled={loading} onClick={() => setReload(value => value + 1)}><RefreshCw size={16} /></button></div></div>
    <div className="attention-filters">
      <label className="attention-search"><Search size={15} /><input aria-label="搜索待办" value={search} onChange={event => setSearch(event.target.value)} placeholder="搜索工作或问题" /></label>
      <label className="attention-project"><span>项目</span><select aria-label="待办项目" value={query.projectId ?? ''} onChange={event => { setQuery(event.target.value ? { projectId: event.target.value } : {}); setHistory([]); setPage(undefined) }}><option value="">全部项目</option>
        {configuration?.projects.map(project => <option key={project.id} value={project.id}>{project.displayName}</option>)}</select></label>
    </div>
    <div className="attention-tabs" role="group" aria-label="待办类型">
      {([['all', '全部'], ['question', '待回答'], ['candidate', '待审阅'], ['blocked', '待处理']] as const).map(([value, label]) =>
        <button key={value} type="button" aria-pressed={kind === value} onClick={() => setKind(value)}>{label}<span>{page?.items.filter(item => value === 'all' || item.kind === value).length ?? 0}</span></button>)}
      <span className="attention-order"><Clock3 size={13} />{page?.ranking === 'deterministic_priority' ? '优先级' : '等待时间'}<ArrowDown size={12} /></span>
    </div>
    <div className="attention-content">
      {failure && <div className="attention-error" role="alert"><TriangleAlert size={16} /><span>{failure}</span><button type="button" className="icon-button" title="重试读取待办" aria-label="重试读取待办" onClick={() => setReload(value => value + 1)}><RefreshCw size={16} /></button></div>}
      {page?.questionCoverage === 'bounded' && <p className="attention-coverage" role="status">部分工作的问题数量达到读取上限，当前列表可能不完整。</p>}
      {!page && !failure ? <p className="attention-empty" role="status">正在读取待办…</p> : page && !filtered.length ? <div className="attention-empty"><Inbox size={27} /><h3>{search || kind !== 'all' ? '没有匹配的待办' : '这批工作暂无待办'}</h3>{page.hasMore && <p>仍有较早工作未读取</p>}</div> : null}
      <ul className="attention-list" aria-label="跨会话待办">
        {filtered.slice(0, visible).map(item => {
          const Icon = item.kind === 'question' ? CircleHelp : item.kind === 'candidate' ? FileCheck2 : TriangleAlert
          const expired = item.expiresAt !== null && Date.parse(item.expiresAt) <= now
          return <li key={item.id}><button type="button" className={`attention-row attention-${item.kind}`} data-attention-id={item.id}
            aria-label={`打开待办：${item.workTitle}`} disabled={!!opening || loading} onClick={() => void open(item)}>
            <span className="attention-icon"><Icon size={18} /></span><span className="attention-body">
              <span className="attention-row-title"><strong>{item.workTitle}</strong><span className={`mini ${item.kind === 'question' ? 'warn' : ''}`}>{category(item)}</span></span>
              <span className="attention-summary">{item.summary}</span>
              <span className="attention-meta"><span className="attention-project-name">{titleFor(item.projectId)}</span><span>{waiting(item.sinceAt, now)}</span>
                {item.deadlineAt ? <span className={Date.parse(item.deadlineAt) < now ? 'attention-overdue' : ''}>截止 {clock(item.deadlineAt)}</span> : <span>截止未知</span>}
                {item.expiresAt && <span className={expired ? 'attention-overdue' : ''}>{expired ? '问题已过期' : `有效至 ${clock(item.expiresAt)}`}</span>}
              </span>
              {page?.ranking === 'deterministic_priority' && <span className="attention-rationale">{page.ranks.find(rank => rank.id === item.id)?.reasons.map(reason => reasonLabel[reason]).join(' · ')}</span>}
            </span><ChevronRight className="attention-chevron" size={16} /></button></li>
        })}
      </ul>
      {filtered.length > visible && <button type="button" className="quiet attention-more" onClick={() => setVisible(value => value + 50)}>显示更多待办（{visible}/{filtered.length}）</button>}
    </div>
    <div className="attention-pagination"><span>{history.length + 1} / {page?.hasMore ? '后续还有工作' : '已读取到末页'}</span><div>
      <button type="button" className="quiet" disabled={!history.length || loading} onClick={() => { const previous = history.at(-1); setHistory(history.slice(0, -1)); setQuery({ ...(query.projectId ? { projectId: query.projectId } : {}), ...(previous ? { cursor: previous } : {}) }) }}><ArrowLeft size={14} />较新工作</button>
      <button type="button" className="quiet" disabled={!page?.nextCursor || loading} onClick={() => { setHistory([...history, query.cursor]); setQuery({ ...query, cursor: page!.nextCursor! }) }}>较早工作<ArrowRight size={14} /></button>
    </div></div>
  </div>
}
