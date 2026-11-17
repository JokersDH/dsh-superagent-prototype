import { useEffect, useRef, useState } from 'react'
import { ChevronDown, History, RefreshCw } from 'lucide-react'
import type { WorkCompletionHistory, WorkCompletionHistoryQuery, WorkView } from '@personal-agent/contracts'
import type { ConsoleTransport } from './transport.ts'

const kinds = { verifications: '检查记录', acceptances: '接受记录', contracts: '合同版本' } as const
export function CompletionHistoryPanel({ work, transport, identity }: { work: WorkView; transport: ConsoleTransport; identity: string }) {
  const [open, setOpen] = useState(false), [kind, setKind] = useState<WorkCompletionHistoryQuery['kind']>('verifications')
  const [loaded, setLoaded] = useState<{ key: string; page?: WorkCompletionHistory }>(), [error, setError] = useState<string>()
  const [pending, setPending] = useState(false), [revision, setRevision] = useState(0)
  const [rows, setRows] = useState<WorkCompletionHistory['entries']>([])
  const key = JSON.stringify([identity, work.work.id, work.contract.revision, work.contract.digest, kind])
  const currentKey = useRef(key); currentKey.current = key
  const sequence = useRef(0), controller = useRef<AbortController>()
  const load = async (cursor?: string) => {
    if (!transport.workCompletionHistory) return
    controller.current?.abort()
    const request = new AbortController(), generation = ++sequence.current
    controller.current = request; setPending(true); setError(undefined)
    if (!cursor) { setLoaded(undefined); setRows([]) }
    try {
      const page = await transport.workCompletionHistory(work.work.id, { kind, limit: 10, ...(cursor ? { cursor } : {}) }, request.signal)
      if (request.signal.aborted || generation !== sequence.current || currentKey.current !== key) return
      if (page && (page.currentContract.revision !== work.contract.revision || page.currentContract.digest !== work.contract.digest || page.projectId !== work.work.projectId))
        throw new Error('History context changed')
      if (cursor && page && (page.nextCursor === cursor || page.entries.some(row => rows.some(previous => previous.id === row.id))))
        throw new Error('History continuation cannot progress')
      setRows(previous => [...(cursor ? previous : []), ...(page?.entries ?? [])].slice(0, 200))
      setLoaded({ key, ...(page ? { page } : {}) })
    } catch {
      if (!request.signal.aborted && generation === sequence.current && currentKey.current === key)
        setError(key)
    } finally { if (generation === sequence.current) setPending(false) }
  }
  useEffect(() => {
    setError(undefined)
    if (open) void load()
    return () => { sequence.current++; controller.current?.abort() }
  }, [key, open, revision, transport])
  if (!transport.workCompletionHistory) return null
  const page = loaded?.key === key ? loaded.page : undefined, visible = loaded?.key === key ? rows : []
  return <section className="work-evidence" aria-label="工作历史">
    <header><h4><History size={15} />工作历史</h4><button type="button" className="icon-button" title={open ? '收起工作历史' : '展开工作历史'}
      aria-label={open ? '收起工作历史' : '展开工作历史'} aria-expanded={open} onClick={() => setOpen(!open)}><ChevronDown size={16} /></button></header>
    {open && <>
      <div className="evidence-tools"><select aria-label="工作历史类别" value={kind} onChange={event => setKind(event.target.value as typeof kind)}>
        {Object.entries(kinds).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
        <button type="button" className="icon-button" title="重新读取工作历史" aria-label="重新读取工作历史" disabled={pending} onClick={() => setRevision(value => value + 1)}><RefreshCw size={14} /></button></div>
      {error === key && <p className="warn-text" role="alert">历史暂时无法读取，请重新读取。</p>}
      {pending && !page && <p className="evidence-empty" role="status">正在读取工作历史</p>}
      {!pending && loaded?.key === key && !page && <p className="evidence-empty">此版本未提供分类历史</p>}
      {page && <>
        <p className="evidence-bound">本类来源 {page.available} 条 · 已显示 {visible.length} 条{page.hasMore ? ' · 部分记录' : ''}</p>
        {page.status === 'blocked' && <p className="warn-text" role="status">单条历史超过读取上限，较早记录暂不可达。</p>}
        <ol className="evidence-timeline">{visible.map(row => <li key={row.id}><span className="evidence-event-icon"><History size={13} /></span><div>
          <div className="evidence-event-title"><span>{row.kind === 'contracts' ? `合同版本 ${row.revision}` : `第 ${row.generation} 代${kinds[row.kind]}`}</span>
            {'at' in row && <time dateTime={row.at}>{new Date(row.at).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</time>}</div>
          <details className="technical-details"><summary>记录标识</summary><code>{row.id}</code><code>{row.kind === 'contracts' ? row.digest : row.artifactDigest}</code></details>
        </div></li>)}</ol>
        {!visible.length && page.status === 'ok' && <p className="evidence-empty">本类暂无记录</p>}
        {page.nextCursor && visible.length < 200 && <button type="button" className="quiet evidence-more" disabled={pending || error === key} onClick={() => void load(page.nextCursor)}>{pending ? '正在读取' : '加载较早记录'}</button>}
        {visible.length >= 200 && page.hasMore && <p className="evidence-bound">已达 200 条显示上限</p>}
      </>}
    </>}
  </section>
}
