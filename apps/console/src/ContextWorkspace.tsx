import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, Copy, FileSearch, RefreshCw, X } from 'lucide-react'
import { ContextPreviewInputSchema } from '@personal-agent/contracts'
import type { ApplicationConfiguration, ContextPreview, ContextPreviewInput, WorkView } from '@personal-agent/contracts'
import { TransportError } from './transport.ts'
import type { ConsoleTransport } from './transport.ts'

type Selection = ContextPreviewInput['selections'][number]
const options: { id: Selection; label: string; needsWork?: boolean }[] = [
  { id: 'work', label: '当前工作', needsWork: true }, { id: 'decisions', label: '项目决定' },
  { id: 'project', label: '项目信息' }, { id: 'conversation', label: '当前会话' },
  { id: 'artifacts', label: '交付元数据', needsWork: true },
]
const kindLabel: Record<ContextPreview['sources'][number]['kind'], string> = {
  work: '工作', contract: '当前合同', verification: '验证', delivery: '接受记录', decision: '项目决定',
  project_metadata: '项目信息', conversation_message: '会话消息', artifact: '交付元数据',
}
const groupLabel: Record<ContextPreview['groups'][number]['name'], string> = {
  contract: '当前工作', decisions: '项目决定', project_facts: '项目与验证', conversation: '当前会话', artifacts: '交付元数据',
}
const stateLabel = { included: '已纳入', empty: '无可用记录', unavailable: '暂不可读', truncated: '部分纳入' }
const reasonLabel: Record<string, string> = {
  budget_files: '条目上限', budget_bytes: '字节上限', budget_tokens: '估算 token 上限', budget_time: '读取超时',
  budget_slices: '条目上限', budget_group: '分组预算上限', missing: '来源缺失', stale: '来源已变化',
  contract_stale: '合同已变化', source_unavailable: '来源暂不可读', oversized: '单条内容超限', unreadable: '来源不可读',
}
const size = (bytes: number) => `${(bytes / 1024).toFixed(1)} KB`
const budgetFields = [['maxFiles', '条目', 64], ['maxBytes', '字节', 4194304], ['maxTokens', '估算 token', 500000]] as const

export function ContextWorkspace({ transport, configuration, conversationId, works, initialProjectId, initialWorkId, onClose }: {
  transport: ConsoleTransport; configuration: ApplicationConfiguration; conversationId: string; works: readonly WorkView[];
  initialProjectId: string; initialWorkId?: string; onClose(): void
}) {
  const [projectId, setProjectId] = useState(initialProjectId), [workId, setWorkId] = useState(initialWorkId ?? '')
  const [selections, setSelections] = useState<Selection[]>(initialWorkId ? ['work', 'decisions', 'project', 'conversation'] : ['decisions', 'project', 'conversation'])
  const [query, setQuery] = useState(''), [budget, setBudget] = useState({ maxFiles: 24, maxBytes: 65536, maxTokens: 16384 })
  const [preview, setPreview] = useState<ContextPreview>(), [busy, setBusy] = useState(false), [error, setError] = useState<string>()
  const [expired, setExpired] = useState(false), [copied, setCopied] = useState(false)
  const dialog = useRef<HTMLDialogElement>(null), sequence = useRef(0)
  const candidates = works.filter(work => work.work.projectId === projectId && work.work.conversationId === conversationId)
  const selectedWork = candidates.find(work => work.work.id === workId)
  const project = configuration.projects.find(value => value.id === projectId)
  const grantExpired = !!project?.scope.expiresAt && Date.parse(project.scope.expiresAt) <= Date.now()
  const input = { projectId, conversationId, ...(selectedWork ? { workId: selectedWork.work.id } : {}), selections, query, budget }
  const valid = ContextPreviewInputSchema.safeParse(input).success
  useEffect(() => {
    const focused = document.activeElement as HTMLElement | null
    dialog.current?.showModal()
    return () => { sequence.current++; dialog.current?.close(); focused?.focus() }
  }, [])
  useEffect(() => {
    if (!preview) { setExpired(false); return }
    const remaining = Date.parse(preview.expiresAt) - Date.now()
    setExpired(remaining <= 0)
    if (remaining <= 0) return
    const timer = setTimeout(() => setExpired(true), remaining)
    return () => clearTimeout(timer)
  }, [preview])
  const clear = () => { sequence.current++; setPreview(undefined); setError(undefined); setCopied(false) }
  const prepare = async () => {
    if (busy || !valid || grantExpired) return
    const request = ++sequence.current
    setBusy(true); setError(undefined); setPreview(undefined); setCopied(false)
    try { const result = await transport.contextPreview!(input); if (sequence.current === request) setPreview(result) }
    catch (problem) { if (sequence.current === request) setError(problem instanceof TransportError && problem.code === 'conflict'
      ? '来源或工作已变化，请重新预览。' : problem instanceof TransportError && problem.code === 'forbidden'
        ? '所选项目与当前会话不匹配，请核对项目。' : '上下文读取失败，请核对项目授权和数据来源后重试。') }
    finally { if (sequence.current === request) setBusy(false) }
  }
  const copy = async () => {
    if (!preview || expired) return
    try { await navigator.clipboard.writeText(JSON.stringify(preview, null, 2)); setCopied(true) }
    catch { setError('浏览器未允许复制，请在来源详情中选择内容。') }
  }
  return createPortal(<dialog ref={dialog} className="project-settings-dialog context-workspace" aria-label="上下文预览"
    onClose={() => { if (!dialog.current?.open) onClose() }}>
    <header><div><h2>上下文预览</h2><p className="context-line">{project?.displayName ?? projectId}{selectedWork ? ` · ${selectedWork.work.title}` : ' · 当前会话'}</p></div>
      <button type="button" className="icon-button" aria-label="关闭上下文预览" title="关闭上下文预览" onClick={onClose}><X size={18} /></button></header>
    <fieldset className="context-controls" disabled={busy}>
      <div className="context-selectors"><label>项目<select aria-label="上下文项目" value={projectId} onChange={event => {
        clear(); setProjectId(event.target.value); setWorkId(''); setSelections(previous => previous.filter(id => id !== 'work' && id !== 'artifacts'))
      }}>{configuration.projects.map(value => <option key={value.id} value={value.id}>{value.displayName}</option>)}</select></label>
        <label>工作<select aria-label="上下文工作" value={selectedWork?.work.id ?? ''} onChange={event => {
          clear(); setWorkId(event.target.value); if (!event.target.value) setSelections(previous => previous.filter(id => id !== 'work' && id !== 'artifacts'))
          else setSelections(previous => previous.includes('work') ? previous : ['work', ...previous])
        }}><option value="">会话级预览</option>{candidates.map(value => <option key={value.work.id} value={value.work.id}>{value.work.title}</option>)}</select></label></div>
      <div className="context-selections" role="group" aria-label="上下文来源">{options.map(option => <label key={option.id} className="settings-toggle"><input type="checkbox"
        checked={selections.includes(option.id)} disabled={!!option.needsWork && !selectedWork} onChange={event => {
          clear(); setSelections(previous => event.target.checked ? [...previous, option.id] : previous.filter(id => id !== option.id))
        }} />{option.label}</label>)}</div>
      <label className="context-query">相关问题<input aria-label="上下文相关问题" value={query} maxLength={8192} onChange={event => { clear(); setQuery(event.target.value) }} /></label>
      <details className="context-budget"><summary>读取预算<ChevronDown size={14} /></summary><div>{budgetFields.map(([key, label, max]) => <label key={key}>最多{label}<input type="number" aria-label={`最多${label}`} min={1} max={max}
        value={Number.isFinite(budget[key]) ? budget[key] : ''} onChange={event => {
          clear(); setBudget(previous => ({ ...previous, [key]: event.target.value === '' ? NaN : Number(event.target.value) }))
        }} /></label>)}</div></details>
    </fieldset>
    {grantExpired && <p className="local-error" role="alert">项目授权已过期，请更新授权后重新预览。</p>}
    {error && <p className="local-error" role="alert">{error}</p>}
    <div className="context-actions"><button type="button" className="primary" disabled={busy || !valid || grantExpired} onClick={() => void prepare()}>
      {busy ? <RefreshCw size={15} /> : <FileSearch size={15} />}{busy ? '读取中' : '生成预览'}</button>
      {preview && <button type="button" className="quiet" disabled={expired} onClick={() => void copy()}><Copy size={15} />{copied ? '已复制' : '复制预览'}</button>}</div>
    {busy && <div className="context-loading" role="status" aria-label="正在读取上下文"><span /><span /><span /></div>}
    {preview && <section className="context-result" aria-label="上下文读取结果">
      <div className="context-result-heading"><h3>{expired ? '预览已过期' : { sufficient: '来源已就绪', partial: '部分来源已纳入', insufficient: '没有可用来源' }[preview.status]}</h3>
        <span>{preview.totals.files} 条 · {size(preview.totals.bytes)} · 约 {Math.ceil(preview.totals.tokens)} tokens</span></div>
      <p className="context-validity">{preview.contract ? `合同版本 ${preview.contract.revision} · ` : ''}有效至 {new Date(preview.expiresAt).toLocaleTimeString('zh-CN')}{preview.budgetClamped.length ? ' · 已按实例上限收紧预算' : ''}</p>
      <ul className="context-group-list">{preview.groups.map(group => <li key={group.name}><span>{groupLabel[group.name]}</span><span>{stateLabel[group.status]} · {group.used.files} 条</span></li>)}</ul>
      {preview.issues.length > 0 && <p className="context-warning" role="status">{preview.issues.includes('conversation_scan_incomplete') ? '会话较长，仅检查了最近 600 条消息。' : ''}{preview.issues.includes('artifact_source_missing') ? '部分交付来源缺失。' : ''}</p>}
      {preview.injectionFlags.length > 0 && <p className="context-warning" role="status">{preview.injectionFlags.length} 条来源含指令式文本，已标记为非授权内容。</p>}
      <div className="context-source-list">{preview.sources.map(source => <details className="context-source" key={source.sourceId}>
        <summary><FileSearch size={15} /><span>{kindLabel[source.kind]}<small>{size(source.bytes)} · 约 {Math.ceil(source.estimatedTokens)} tokens{source.truncated ? ' · 已截断' : ''}</small></span><ChevronDown size={14} /></summary>
        <pre>{source.content}</pre><dl><dt>来源摘要</dt><dd><code>{source.sourceDigest}</code></dd><dt>预览摘要</dt><dd><code>{source.previewDigest}</code></dd></dl>
      </details>)}</div>
      {preview.omitted.length > 0 && <details className="context-omissions"><summary>未纳入 {preview.omitted.length} 项</summary><ul>{preview.omitted.map((item, index) => <li key={index}>{reasonLabel[item.reason] ?? '来源不符合读取条件'}{item.path && <code>{item.path}</code>}</li>)}</ul></details>}
    </section>}
  </dialog>, document.body)
}
