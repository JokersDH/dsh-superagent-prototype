import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, ArrowUpRight, ChevronDown, Clock3, History, RefreshCw } from 'lucide-react'
import type { ApplicationConfiguration, ContextHistory, ContextHistoryEntry, WorkView } from '@personal-agent/contracts'
import type { ConsoleTransport } from './transport.ts'
import { TransportError } from './transport.ts'
import { ContextSourceRecord } from './ContextSources.tsx'

export function ContextHistoryPanel({ transport, configuration, conversationId, projectId, initialWorkId, works, onProjectChange, onOpenConversation }: {
  transport: ConsoleTransport; configuration: ApplicationConfiguration; conversationId: string; projectId: string;
  initialWorkId?: string; works: readonly WorkView[]; onProjectChange(id: string): void; onOpenConversation?(id: string, projectId: string): void
}) {
  const [onlyConversation, setOnlyConversation] = useState(true), [workSelection, setWorkSelection] = useState(initialWorkId ?? '')
  const [page, setPage] = useState<ContextHistory>(), [selected, setSelected] = useState<ContextHistoryEntry>()
  const [loading, setLoading] = useState(false), [error, setError] = useState<'failed' | 'stale'>(), [refresh, setRefresh] = useState(0)
  const [catalog, setCatalog] = useState<readonly WorkView[]>(), [catalogLoading, setCatalogLoading] = useState(false), [catalogFailed, setCatalogFailed] = useState(false)
  const sequence = useRef(0)
  const catalogSequence = useRef(0), detailHeading = useRef<HTMLHeadingElement>(null), rows = useRef(new Map<string, HTMLButtonElement>())
  const availableWorks = (onlyConversation ? works : catalog ?? works).filter(work => work.work.projectId === projectId && (!onlyConversation || work.work.conversationId === conversationId))
  const workId = workSelection
  const projectKey = configuration.projects.map(project => project.id).sort().join(',')
  const validProject = configuration.projects.some(project => project.id === projectId)
  const query = { projectId, ...(onlyConversation ? { conversationId } : {}), ...(workId ? { workId } : {}), limit: 20 }
  useEffect(() => {
    const request = ++catalogSequence.current
    if (onlyConversation) { setCatalogLoading(false); setCatalogFailed(false); return }
    setCatalogLoading(true); setCatalogFailed(false)
    void transport.snapshot({ limit: 200 }).then(snapshot => {
      if (request === catalogSequence.current) setCatalog(snapshot.works)
    }).catch(() => { if (request === catalogSequence.current) setCatalogFailed(true) })
      .finally(() => { if (request === catalogSequence.current) setCatalogLoading(false) })
    return () => { catalogSequence.current++ }
  }, [transport, onlyConversation, projectKey, configuration.revision, refresh])
  useEffect(() => {
    if (!selected) return
    const viewport = window.matchMedia('(max-width: 720px)')
    const focus = () => { if (viewport.matches) detailHeading.current?.focus({ preventScroll: true }) }
    focus(); viewport.addEventListener('change', focus)
    return () => viewport.removeEventListener('change', focus)
  }, [selected])
  const back = () => {
    const id = selected?.messageId
    setSelected(undefined)
    requestAnimationFrame(() => { if (id) rows.current.get(id)?.focus({ preventScroll: true }) })
  }
  useEffect(() => {
    const request = ++sequence.current
    setPage(undefined); setSelected(undefined); setError(undefined); setLoading(true)
    void (async () => {
      try {
        if (!validProject || !transport.contextHistory) throw new Error('History scope unavailable')
        const result = await transport.contextHistory(query)
        if (sequence.current === request) setPage(result)
      } catch { if (sequence.current === request) setError('failed') }
      finally { if (sequence.current === request) setLoading(false) }
    })()
    return () => { sequence.current++ }
  }, [transport, projectId, projectKey, configuration.revision, conversationId, onlyConversation, workId, refresh, validProject])
  const more = async () => {
    if (loading || error || !page?.nextCursor || page.entries.length >= 200 || !transport.contextHistory) return
    const request = ++sequence.current
    setLoading(true)
    try {
      const result = await transport.contextHistory({ ...query, cursor: page.nextCursor })
      if (request !== sequence.current) return
      const known = new Set(page.entries.map(entry => entry.messageId))
      if (result.entries.some(entry => known.has(entry.messageId))) throw new Error('History continuation overlaps')
      setPage({ ...result, entries: [...page.entries, ...result.entries].slice(0, 200) })
    } catch (problem) { if (request === sequence.current) setError(problem instanceof TransportError && problem.code === 'conflict' ? 'stale' : 'failed') }
    finally { if (request === sequence.current) setLoading(false) }
  }
  return <section className="context-history" aria-label="上下文使用记录">
    <div className="context-history-filters">
      <label>项目<select aria-label="记录项目" value={projectId} onChange={event => { setWorkSelection(''); onProjectChange(event.target.value) }}>
        {configuration.projects.map(project => <option key={project.id} value={project.id}>{project.displayName}</option>)}
      </select></label>
      <label>工作<select aria-label="记录工作" value={workId} disabled={catalogLoading || catalogFailed} onChange={event => setWorkSelection(event.target.value)}><option value="">{catalogLoading ? '正在读取工作' : '全部工作'}</option>
        {workId && !availableWorks.some(work => work.work.id === workId) && <option value={workId}>原工作已不可用</option>}
        {availableWorks.map(work => <option key={work.work.id} value={work.work.id}>{work.work.title}</option>)}
      </select></label>
      <div className="context-history-options"><label className="settings-toggle"><input type="checkbox" checked={onlyConversation} onChange={event => {
        if (event.target.checked && workSelection && !works.some(work => work.work.id === workSelection && work.work.conversationId === conversationId)) setWorkSelection('')
        setOnlyConversation(event.target.checked)
      }} />仅当前会话</label>
        <button type="button" className="icon-button" disabled={loading} title="刷新使用记录" aria-label="刷新使用记录" onClick={() => setRefresh(value => value + 1)}><RefreshCw size={15} /></button></div>
    </div>
    {catalogFailed && <p className="local-error context-record-status" role="alert">工作列表暂时无法读取<button type="button" className="quiet" onClick={() => setRefresh(value => value + 1)}><RefreshCw size={14} />重新读取工作</button></p>}
    {!onlyConversation && catalog && catalog.length >= 200 && <p className="context-record-status">工作列表已达 200 项上限</p>}
    {error && <p className="local-error context-record-status" role="alert">{error === 'stale' ? '记录续页已过期或范围已变化' : '使用记录暂时无法读取'}
      <button type="button" className="quiet" disabled={loading} onClick={() => setRefresh(value => value + 1)}><RefreshCw size={14} />重新读取</button></p>}
    {!page && loading && <div className="context-loading" role="status" aria-label="正在读取使用记录"><span /><span /><span /></div>}
    {page && !page.entries.length && !loading && <div className="context-history-empty" role="status"><History size={24} /><p>暂无使用记录</p></div>}
    {page && page.entries.length > 0 && <div className={`context-history-body${selected ? ' has-selection' : ''}`}>
      <div className="context-history-index"><ol aria-label="上下文使用记录列表">{page.entries.map(entry => {
        const work = works.find(work => work.work.id === entry.contract?.workId)
        return <li key={entry.messageId}><button type="button" className="context-history-row" aria-current={selected?.messageId === entry.messageId ? 'true' : undefined}
          ref={element => { if (element) rows.current.set(entry.messageId, element); else rows.current.delete(entry.messageId) }}
          aria-label={`查看使用记录：${entry.message.state === 'available' ? entry.message.text : '原消息已缺失'}`} onClick={() => setSelected(entry)}>
          <span className="context-history-row-time"><Clock3 size={12} /><time dateTime={entry.confirmedAt}>{new Date(entry.confirmedAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</time><span>{entry.sourceCount} 条来源</span></span>
          <span className="context-history-row-text">{entry.message.state === 'available' ? entry.message.text : '原消息已缺失'}</span>
          {entry.contract && <span className="context-history-row-work">{work?.work.title ?? `合同版本 ${entry.contract.revision}`}</span>}
          {!onlyConversation && <span className="context-history-row-session">{entry.conversationId === conversationId ? '当前会话' : '其他会话'}</span>}
        </button></li>
      })}</ol>
        {page.hasMore && page.entries.length < 200 && <button type="button" className="quiet context-history-more" disabled={loading || !!error} onClick={() => void more()}><ChevronDown size={14} />{loading ? '读取中' : '更多记录'}</button>}
        {page.entries.length >= 200 && <p className="context-history-end">已显示最近 200 条记录</p>}
        {!page.hasMore && <p className="context-history-end">已显示 {page.entries.length} 条记录</p>}
      </div>
      <div className="context-history-detail">{selected ? <>
        <header className="context-history-detail-heading"><button type="button" className="icon-button context-history-back" title="返回使用记录" aria-label="返回使用记录" onClick={back}><ArrowLeft size={16} /></button>
          <div><h3 ref={detailHeading} tabIndex={-1}>原始上下文</h3><p>{new Date(selected.confirmedAt).toLocaleString('zh-CN')}{selected.contract ? ` · 合同版本 ${selected.contract.revision}` : ''}</p></div>
          {onOpenConversation && <button type="button" className="icon-button" title="返回原会话" aria-label="返回原会话" onClick={() => onOpenConversation(selected.conversationId, selected.projectId)}><ArrowUpRight size={16} /></button>}
        </header>
        <p className="context-history-message">{selected.message.state === 'available' ? selected.message.text : '原消息已缺失'}{selected.message.truncated ? '...' : ''}</p>
        <ContextSourceRecord key={selected.messageId} transport={transport} messageId={selected.messageId} projectId={selected.projectId} conversationId={selected.conversationId} />
      </> : <div className="context-history-detail-empty"><History size={24} aria-hidden="true" /><p>原始来源</p></div>}</div>
    </div>}
  </section>
}
