import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown, Copy, FileSearch, RefreshCw, Send, X } from 'lucide-react'
import { z } from 'zod'
import { AssistantContextPreparedSchema, AssistantContextSendSchema, ContextPreviewInputSchema } from '@personal-agent/contracts'
import type { ApplicationConfiguration, AssistantContextPrepared, AssistantContextSend, ContextPreview, ContextPreviewInput, WorkView } from '@personal-agent/contracts'
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
const pendingKey = 'personal-agent:pending-context-message'
const PendingSchema = z.strictObject({ version: z.literal(1), command: AssistantContextSendSchema, prepared: AssistantContextPreparedSchema })
  .refine(value => value.command.commandId === value.prepared.commandId && value.command.token === value.prepared.token)
type Pending = z.infer<typeof PendingSchema>
function remembered(): { value?: Pending; damaged: boolean } {
  try { const raw = sessionStorage.getItem(pendingKey); return { ...(raw ? { value: PendingSchema.parse(JSON.parse(raw)) } : {}), damaged: false } }
  catch { return { damaged: true } }
}

export function ContextWorkspace({ transport, configuration, conversationId, works, initialProjectId, initialWorkId, initialDraft = '', onClose, onSent }: {
  transport: ConsoleTransport; configuration: ApplicationConfiguration; conversationId: string; works: readonly WorkView[];
  initialProjectId: string; initialWorkId?: string; initialDraft?: string; onClose(): void
  onSent?(value: { text: string; conversationId: string; commandId: string }): Promise<void>
}) {
  const [initial] = useState(remembered)
  const [pending, setPending] = useState<Pending | undefined>(initial.value), [damaged, setDamaged] = useState(initial.damaged)
  const [projectId, setProjectId] = useState(initialProjectId), [workId, setWorkId] = useState(initialWorkId ?? '')
  const [selections, setSelections] = useState<Selection[]>(initialWorkId ? ['work', 'decisions', 'project', 'conversation'] : ['decisions', 'project', 'conversation'])
  const [query, setQuery] = useState(''), [budget, setBudget] = useState({ maxFiles: 24, maxBytes: 65536, maxTokens: 16384 })
  const [preview, setPreview] = useState<ContextPreview>(), [busy, setBusy] = useState(false), [error, setError] = useState<string>()
  const [prepared, setPrepared] = useState<AssistantContextPrepared>(), [text, setText] = useState(initialDraft)
  const [expired, setExpired] = useState(false), [copied, setCopied] = useState(false)
  const dialog = useRef<HTMLDialogElement>(null), sequence = useRef(0)
  const candidates = works.filter(work => work.work.projectId === projectId && work.work.conversationId === conversationId)
  const selectedWork = candidates.find(work => work.work.id === workId)
  const project = configuration.projects.find(value => value.id === projectId)
  const displayPrepared = pending?.prepared ?? prepared
  const displayPreview = displayPrepared?.preview ?? preview
  const displayProject = configuration.projects.find(value => value.id === (displayPreview?.projectId ?? projectId))
  const canSend = !!configuration.assistantContextAvailable && !!transport.prepareAssistantContext && !!transport.sendAssistantContext && !!onSent
  const canReconcile = !!transport.sendAssistantContext && !!onSent
  const sending = busy && !!pending
  const grantExpired = !!project?.scope.expiresAt && Date.parse(project.scope.expiresAt) <= Date.now()
  const input = { projectId, conversationId, ...(selectedWork ? { workId: selectedWork.work.id } : {}), selections, query, budget }
  const valid = ContextPreviewInputSchema.safeParse(input).success
  useEffect(() => {
    const focused = document.activeElement as HTMLElement | null
    dialog.current?.showModal()
    return () => { sequence.current++; dialog.current?.close(); focused?.focus() }
  }, [])
  useEffect(() => {
    if (!displayPreview) { setExpired(false); return }
    const remaining = Date.parse(displayPreview.expiresAt) - Date.now()
    setExpired(remaining <= 0)
    if (remaining <= 0) return
    const timer = setTimeout(() => setExpired(true), remaining)
    return () => clearTimeout(timer)
  }, [displayPreview])
  const clear = () => { sequence.current++; setPreview(undefined); setPrepared(undefined); setError(undefined); setCopied(false) }
  const prepare = async (message = false) => {
    if (busy || pending || !valid || grantExpired || (message && (!canSend || damaged || !text.trim() || text.length > 16384))) return
    const request = ++sequence.current
    setBusy(true); setError(undefined); setPreview(undefined); setPrepared(undefined); setCopied(false)
    try {
      if (message) {
        const value = await transport.prepareAssistantContext!({ commandId: `context-chat-${crypto.randomUUID()}`, text, context: input })
        if (sequence.current === request) setPrepared(value)
      } else { const result = await transport.contextPreview!(input); if (sequence.current === request) setPreview(result) }
    }
    catch (problem) { if (sequence.current === request) setError(problem instanceof TransportError && problem.code === 'conflict'
      ? '来源或工作已变化，请重新预览。' : problem instanceof TransportError && problem.code === 'forbidden'
        ? '所选项目与当前会话不匹配，请核对项目。' : '上下文读取失败，请核对项目授权和数据来源后重试。') }
    finally { if (sequence.current === request) setBusy(false) }
  }
  const send = async (value: AssistantContextPrepared, original?: AssistantContextSend) => {
    if (busy || damaged || (original ? !canReconcile : !canSend || expired)) return
    const stored = PendingSchema.parse({ version: 1, command: original ?? { commandId: value.commandId, token: value.token }, prepared: value })
    try { sessionStorage.setItem(pendingKey, JSON.stringify(stored)) }
    catch { setDamaged(true); setError('浏览器无法保留原请求，发送已暂停。'); return }
    setPending(stored); setBusy(true); setError(undefined)
    try {
      const receipt = await transport.sendAssistantContext!(stored.command)
      try { sessionStorage.removeItem(pendingKey) } catch { setDamaged(true) }
      setPending(undefined); setPrepared(undefined); setPreview(undefined)
      if (receipt.status === 'rejected') { setError('消息未发送，请核对来源后重新预览。'); return }
      void onSent!({ text: value.text, conversationId: value.preview.conversationId, commandId: value.commandId }).catch(() => {})
      onClose()
    } catch { setError('发送结果尚未确认，请核对原请求。') }
    finally { setBusy(false) }
  }
  const copy = async () => {
    if (!displayPreview || expired) return
    try { await navigator.clipboard.writeText(JSON.stringify(displayPreview, null, 2)); setCopied(true) }
    catch { setError('浏览器未允许复制，请在来源详情中选择内容。') }
  }
  return createPortal(<dialog ref={dialog} className="project-settings-dialog context-workspace" aria-label="上下文预览"
    onCancel={event => { if (sending) event.preventDefault() }}
    onClose={() => { if (!dialog.current?.open) onClose() }}>
    <header><div><h2>{pending ? '核对消息请求' : prepared ? '确认上下文消息' : '上下文预览'}</h2><p className="context-line">{displayProject?.displayName ?? projectId}{pending ? ' · 原请求' : selectedWork ? ` · ${selectedWork.work.title}` : ' · 当前会话'}</p></div>
      <button type="button" className="icon-button" aria-label="关闭上下文预览" title="关闭上下文预览" disabled={sending} onClick={onClose}><X size={18} /></button></header>
    {!displayPrepared && <fieldset className="context-controls" disabled={busy}>
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
      {canSend && <label className="context-message-field">本条消息<textarea aria-label="上下文消息" value={text} maxLength={16384} rows={3}
        onChange={event => { clear(); setText(event.target.value) }} /></label>}
      <details className="context-budget"><summary>读取预算<ChevronDown size={14} /></summary><div>{budgetFields.map(([key, label, max]) => <label key={key}>最多{label}<input type="number" aria-label={`最多${label}`} min={1} max={max}
        value={Number.isFinite(budget[key]) ? budget[key] : ''} onChange={event => {
          clear(); setBudget(previous => ({ ...previous, [key]: event.target.value === '' ? NaN : Number(event.target.value) }))
        }} /></label>)}</div></details>
    </fieldset>}
    {grantExpired && <p className="local-error" role="alert">项目授权已过期，请更新授权后重新预览。</p>}
    {error && <p className="local-error" role="alert">{error}</p>}
    {damaged && <p className="local-error" role="alert">原请求记录无法读取或清除，新的上下文发送已暂停。</p>}
    {displayPrepared && <section className="context-message-confirmation" aria-label="待发送上下文消息"><h3>{pending ? '原请求消息' : '本条消息'}</h3><p>{displayPrepared.text}</p>
      <dl><dt>原会话</dt><dd><code>{displayPrepared.preview.conversationId}</code></dd>{displayPrepared.preview.contract && <><dt>工作版本</dt><dd><span>版本 {displayPrepared.preview.contract.revision}</span><code>{displayPrepared.preview.contract.workId}</code></dd></>}</dl></section>}
    {pending && <p className="context-pending" role="status"><RefreshCw size={15} />原请求待核对</p>}
    <div className="context-actions">
      {pending ? <button type="button" className="primary" disabled={busy || damaged || !canReconcile} onClick={() => void send(pending.prepared, pending.command)}><RefreshCw size={15} />{busy ? '核对中' : '核对原请求'}</button>
        : prepared ? <><button type="button" className="primary" disabled={busy || damaged || expired || !canSend} onClick={() => void send(prepared)}><Send size={15} />确认发送</button><button type="button" className="quiet" disabled={busy} onClick={clear}>修改消息</button></>
          : <><button type="button" className={canSend ? 'quiet' : 'primary'} disabled={busy || !valid || grantExpired} onClick={() => void prepare()}><FileSearch size={15} />{busy ? '读取中' : '生成预览'}</button>
            {canSend && <button type="button" className="primary" disabled={busy || damaged || !valid || grantExpired || !text.trim() || text.length > 16384} onClick={() => void prepare(true)}><Send size={15} />预览消息</button>}</>}
      {displayPreview && <button type="button" className="quiet" disabled={expired || busy} onClick={() => void copy()}>{copied ? <Check size={15} /> : <Copy size={15} />}{copied ? '已复制' : '复制预览'}</button>}</div>
    {busy && <div className="context-loading" role="status" aria-label="正在读取上下文"><span /><span /><span /></div>}
    {displayPreview && <section className="context-result" aria-label="上下文读取结果">
      <div className="context-result-heading"><h3>{expired ? '预览已过期' : { sufficient: '来源已就绪', partial: '部分来源已纳入', insufficient: '没有可用来源' }[displayPreview.status]}</h3>
        <span>{displayPreview.totals.files} 条 · {size(displayPreview.totals.bytes)} · 约 {Math.ceil(displayPreview.totals.tokens)} tokens</span></div>
      <p className="context-validity">{displayPreview.contract ? `合同版本 ${displayPreview.contract.revision} · ` : ''}有效至 {new Date(displayPreview.expiresAt).toLocaleTimeString('zh-CN')}{displayPreview.budgetClamped.length ? ' · 已按实例上限收紧预算' : ''}</p>
      <ul className="context-group-list">{displayPreview.groups.map(group => <li key={group.name}><span>{groupLabel[group.name]}</span><span>{stateLabel[group.status]} · {group.used.files} 条</span></li>)}</ul>
      {displayPreview.issues.length > 0 && <p className="context-warning" role="status">{displayPreview.issues.includes('conversation_scan_incomplete') ? '会话较长，仅检查了最近 600 条消息。' : ''}{displayPreview.issues.includes('artifact_source_missing') ? '部分交付来源缺失。' : ''}</p>}
      {displayPreview.injectionFlags.length > 0 && <p className="context-warning" role="status">{displayPreview.injectionFlags.length} 条来源含指令式文本，已标记为非授权内容。</p>}
      <div className="context-source-list">{displayPreview.sources.map(source => <details className="context-source" key={source.sourceId}>
        <summary><FileSearch size={15} /><span>{kindLabel[source.kind]}<small>{size(source.bytes)} · 约 {Math.ceil(source.estimatedTokens)} tokens{source.truncated ? ' · 已截断' : ''}</small></span><ChevronDown size={14} /></summary>
        <pre>{source.content}</pre><dl><dt>来源摘要</dt><dd><code>{source.sourceDigest}</code></dd><dt>预览摘要</dt><dd><code>{source.previewDigest}</code></dd></dl>
      </details>)}</div>
      {displayPreview.omitted.length > 0 && <details className="context-omissions"><summary>未纳入 {displayPreview.omitted.length} 项</summary><ul>{displayPreview.omitted.map((item, index) => <li key={index}>{reasonLabel[item.reason] ?? '来源不符合读取条件'}{item.path && <code>{item.path}</code>}</li>)}</ul></details>}
    </section>}
  </dialog>, document.body)
}
