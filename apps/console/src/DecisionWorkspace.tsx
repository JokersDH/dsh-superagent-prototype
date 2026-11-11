import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { BookmarkCheck, Check, ChevronLeft, RefreshCw, Undo2, X } from 'lucide-react'
import { DecisionCommandSchema } from '@personal-agent/contracts'
import type { ApplicationConfiguration, ConversationMessage, DecisionCommand, DecisionPage, DecisionPreview } from '@personal-agent/contracts'
import type { ConsoleTransport } from './transport.ts'

const label = { recorded: '已记录', revoked: '已撤销', superseded: '已替代', expired: '已到期' }
const sourceLabel = { current: '来源可核对', missing: '来源已缺失', stale: '来源已变化', unknown: '来源待核对' }
const pendingKey = 'personal-agent:pending-decision-command'
function remembered(): DecisionCommand | undefined {
  try { const value = sessionStorage.getItem(pendingKey); return value ? DecisionCommandSchema.parse(JSON.parse(value)) : undefined } catch { return undefined }
}

export function DecisionWorkspace({ transport, configuration, sources, source, initialProjectId, onClose }: {
  transport: ConsoleTransport; configuration: ApplicationConfiguration; sources: readonly ConversationMessage[];
  source: ConversationMessage | undefined; initialProjectId: string; onClose(): void
}) {
  const pending = useRef<DecisionCommand | undefined>(remembered())
  const [projectId, setProjectId] = useState(pending.current?.projectId ?? source?.projectId ?? initialProjectId)
  const [sourceId, setSourceId] = useState(source?.id ?? ''), [content, setContent] = useState(source?.text ?? '')
  const [editing, setEditing] = useState(!!source), [preview, setPreview] = useState<DecisionPreview>()
  const [page, setPage] = useState<DecisionPage>(), [error, setError] = useState<string>(), [notice, setNotice] = useState<string>()
  const [busy, setBusy] = useState(false), [unknown, setUnknown] = useState(!!pending.current), [revokeId, setRevokeId] = useState<string>()
  const dialog = useRef<HTMLDialogElement>(null), project = configuration.projects.find(value => value.id === projectId)
  const candidates = sources.filter(value => value.role === 'user' && value.provenance === 'trusted_user' && value.projectId === projectId)
  useEffect(() => { const active = document.activeElement as HTMLElement | null; dialog.current?.showModal();
    return () => { dialog.current?.close(); active?.focus() } }, [])
  useEffect(() => {
    let active = true; setPage(undefined); setError(undefined)
    void transport.decisions!({ projectId }).then(value => { if (active) setPage(value) }).catch(() => { if (active) setError('项目决定读取失败，请刷新。') })
    return () => { active = false }
  }, [projectId, transport])
  const load = async () => setPage(await transport.decisions!({ projectId }))
  const mutate = async (command: DecisionCommand) => {
    if (busy) return
    // Preserve the exact command across a lost response and page reload; this contains no API credential.
    try { sessionStorage.setItem(pendingKey, JSON.stringify(command)) }
    catch { setError('当前浏览器无法保留请求身份，请启用会话存储后重试。'); return }
    pending.current = command; setBusy(true); setError(undefined); setNotice(undefined)
    try {
      const receipt = await transport.decisionCommand!(command)
      sessionStorage.removeItem(pendingKey); pending.current = undefined; setUnknown(false)
      if (receipt.status === 'rejected') { setError(receipt.error.message); setPreview(undefined); await load(); return }
      setPreview(undefined); setEditing(false); setRevokeId(undefined); await load()
      setNotice(command.kind === 'record_decision' ? '决定已记录' : '决定已撤销')
    } catch {
      if (pending.current) { setUnknown(true); setError('提交结果未确认，请重试原请求以核对。') }
      else setError('操作已记录，目录暂时无法刷新，请重新读取。')
    }
    finally { setBusy(false) }
  }
  return createPortal(<dialog ref={dialog} className="project-settings-dialog decision-workspace" aria-label="项目决定"
    onCancel={event => { if (busy) event.preventDefault() }} onClose={() => { if (!dialog.current?.open) onClose() }}>
    <header><div><h2>{editing ? preview ? '确认决定' : '记录决定' : '项目决定'}</h2><span className="context-line">{project?.displayName ?? projectId}</span></div>
      <button type="button" className="icon-button" aria-label="关闭项目决定" title="关闭项目决定" disabled={busy} onClick={onClose}><X size={18} /></button></header>
    {error && <p className="warn-text" role="alert">{error}</p>}
    {notice && <p className="settings-notice" role="status">{notice}</p>}
    {unknown && pending.current && <div className="decision-pending"><span>有一笔决定请求待核对</span><button type="button" disabled={busy} onClick={() => void mutate(pending.current!)}><RefreshCw size={15} />重试原请求</button></div>}
    {!editing && <>
      <div className="decision-catalog-tools"><label>项目<select aria-label="决定项目" value={projectId} disabled={busy || unknown} onChange={event => { setProjectId(event.target.value); setRevokeId(undefined) }}>{configuration.projects.map(value => <option key={value.id} value={value.id}>{value.displayName}</option>)}</select></label>
        <button type="button" className="icon-button" aria-label="刷新项目决定" title="刷新项目决定" disabled={busy} onClick={() => void load().catch(() => setError('项目决定读取失败，请重试。'))}><RefreshCw size={16} /></button></div>
      {!page && !error && <p className="empty" role="status">正在读取决定…</p>}
      {page && !page.decisions.length && <p className="decision-empty">还没有项目决定</p>}
      <ol className="decision-list">{page?.decisions.map(value => {
        const decision = value.record.decision
        return <li key={decision.id}><div className="decision-status"><BookmarkCheck size={15} /><span className="mini">{label[value.status]}</span><span>{sourceLabel[value.sourceState]}</span><span>版本 {decision.version}</span></div>
          <p>{decision.content}</p><details><summary>来源与范围</summary><dl><dt>来源消息</dt><dd><code>{value.record.sourceMessageId}</code></dd><dt>原会话</dt><dd><code>{value.record.conversationId}</code></dd><dt>允许路径</dt><dd>{decision.scope.allowedPaths.join(', ')}</dd><dt>排除路径</dt><dd>{decision.scope.excludedPaths.join(', ') || '无'}</dd><dt>外部动作</dt><dd>{decision.scope.externalActions.join(', ') || '无'}</dd></dl></details>
          {value.status === 'recorded' && !unknown && <div className="decision-revoke">{revokeId === decision.id ? <><span>撤销这条决定？</span><button type="button" className="danger" disabled={busy} onClick={() => void mutate({ kind: 'revoke_decision', commandId: `decision-revoke-${crypto.randomUUID()}`, projectId,
            conversationId: value.record.conversationId, decisionId: decision.id, expectedVersion: decision.version })}>确认撤销</button><button type="button" className="quiet" onClick={() => setRevokeId(undefined)}>取消</button></>
            : <button type="button" className="quiet" disabled={busy} onClick={() => setRevokeId(decision.id)}><Undo2 size={14} />撤销</button>}</div>}
        </li>
      })}</ol>
      {page?.nextCursor && <button type="button" className="quiet" disabled={busy} onClick={() => { setBusy(true); void transport.decisions!({ projectId, cursor: page.nextCursor! }).then(next => setPage({ ...next, decisions: [...page.decisions, ...next.decisions] })).catch(() => setError('较早决定读取失败，请重试。')).finally(() => setBusy(false)) }}>加载较早决定</button>}
    </>}
    {editing && !preview && <form onSubmit={async event => {
      event.preventDefault(); if (!project || !sourceId || !content.trim() || busy || unknown) return
      const selected = candidates.find(value => value.id === sourceId); if (!selected) return
      setBusy(true); setError(undefined)
      try { setPreview(await transport.prepareDecision!({ projectId, conversationId: selected.conversationId,
        sourceMessageId: selected.id, content: content.trim(), scope: project.scope })) }
      catch { setError('决定预览失败，请核对来源与项目范围后重试。') } finally { setBusy(false) }
    }}><fieldset disabled={busy || unknown}><label>来源消息<select aria-label="决定来源消息" value={sourceId} onChange={event => { setSourceId(event.target.value); setContent(candidates.find(value => value.id === event.target.value)?.text ?? '') }} required><option value="">选择本次对话的用户消息</option>{candidates.map(value => <option key={value.id} value={value.id}>{value.text.slice(0, 70)}</option>)}</select></label>
      <label>决定内容<textarea aria-label="决定内容" rows={5} maxLength={16384} required value={content} onChange={event => setContent(event.target.value)} /></label></fieldset>
      <div className="settings-actions"><button type="submit" disabled={busy || unknown || !sourceId || !content.trim()}><BookmarkCheck size={15} />预览决定</button><button type="button" className="quiet" disabled={busy || unknown} onClick={() => setEditing(false)}>取消</button></div></form>}
    {editing && preview && <section className="decision-preview" aria-label="待确认决定"><p>{preview.decision.content}</p><dl><dt>项目</dt><dd>{project?.displayName ?? projectId}</dd><dt>允许路径</dt><dd>{preview.decision.scope.allowedPaths.join(', ')}</dd><dt>排除路径</dt><dd>{preview.decision.scope.excludedPaths.join(', ') || '无'}</dd><dt>外部动作</dt><dd>{preview.decision.scope.externalActions.join(', ') || '无'}</dd>{preview.decision.scope.expiresAt && <><dt>范围到期</dt><dd>{new Date(preview.decision.scope.expiresAt).toLocaleString('zh-CN')}</dd></>}<dt>确认期限</dt><dd>{new Date(preview.expiresAt).toLocaleString('zh-CN')}</dd></dl>
      <div className="settings-actions"><button type="button" disabled={busy || unknown} onClick={() => void mutate({ kind: 'record_decision', commandId: `decision-record-${crypto.randomUUID()}`,
        projectId, conversationId: preview.conversationId, token: preview.token })}><Check size={15} />确认记录</button><button type="button" className="quiet" disabled={busy || unknown} onClick={() => setPreview(undefined)}><ChevronLeft size={15} />返回编辑</button></div></section>}
  </dialog>, document.body)
}
