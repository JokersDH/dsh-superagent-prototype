import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Archive, ArchiveRestore, Check, RefreshCw, Settings2, X } from 'lucide-react'
import type { ProjectSettingsCommand, ProjectSettingsPage } from '@personal-agent/contracts'
import type { ConsoleTransport } from './transport.ts'

export function ProjectSettings({ projectId, transport, onOpen, onCommitted }: {
  projectId: string
  transport: ConsoleTransport
  onOpen: () => void
  onCommitted: () => Promise<void>
}) {
  const dialog = useRef<HTMLDialogElement | null>(null)
  const trigger = useRef<HTMLButtonElement | null>(null)
  const [open, setOpen] = useState(false)
  const [page, setPage] = useState<ProjectSettingsPage>()
  const [name, setName] = useState('')
  const [check, setCheck] = useState<'node_test' | 'pnpm_test' | 'npm_test'>('node_test')
  const [offline, setOffline] = useState(false)
  const [cache, setCache] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [notice, setNotice] = useState<string>()
  const load = async () => {
    const value = await transport.projectSettings!(projectId)
    setPage(value); setName(value.current.displayName); setCheck(value.current.check)
    setOffline(value.current.environment.policy === 'offline_install')
    setCache(value.current.environment.policy === 'offline_install' ? value.current.environment.storeDir : '')
  }
  useEffect(() => {
    if (!open) return
    dialog.current?.showModal()
    setPage(undefined); setError(undefined); setNotice(undefined)
    let active = true
    void transport.projectSettings!(projectId).then(value => {
      if (!active) return
      setPage(value); setName(value.current.displayName); setCheck(value.current.check)
      setOffline(value.current.environment.policy === 'offline_install')
      setCache(value.current.environment.policy === 'offline_install' ? value.current.environment.storeDir : '')
    }).catch(() => { if (active) setError('项目设置读取失败，请重试。') })
    return () => { active = false; dialog.current?.close() }
  }, [open, projectId, transport])
  const mutate = async (command: ProjectSettingsCommand) => {
    if (busy) return
    setBusy(true); setError(undefined); setNotice(undefined)
    try {
      const receipt = await transport.projectSettingsCommand!(command)
      if (receipt.status === 'rejected') { setError(receipt.error.code === 'conflict' ? '设置已变化，请刷新后再提交。' : receipt.error.message); return }
      await load(); await onCommitted(); setNotice(command.kind === 'update_project_settings' ? '设置已保存' : command.archived ? '项目已归档' : '项目已恢复')
    } catch { setError('提交结果未确认，请刷新核对后继续。') }
    finally { setBusy(false) }
  }
  return <>
    <button ref={trigger} type="button" className="icon-button" title="项目设置" aria-label="项目设置" onClick={() => { onOpen(); setOpen(true) }}><Settings2 size={16} /></button>
    {createPortal(<dialog ref={dialog} className="project-settings-dialog" aria-label="项目设置" onClose={() => {
      setOpen(false)
      if (trigger.current?.getBoundingClientRect().width) trigger.current.focus()
      else document.querySelector<HTMLButtonElement>('button[aria-label="工作空间"]')?.focus()
    }} onCancel={event => { if (busy) event.preventDefault() }}>
      <header><div><h2>项目设置</h2><span className="context-line">{page ? `版本 ${page.current.revision}${page.current.archived ? ' · 已归档' : ''}` : '正在读取'}</span></div>
        <button type="button" className="icon-button" title="关闭项目设置" aria-label="关闭项目设置" disabled={busy} onClick={() => setOpen(false)}><X size={18} /></button></header>
      {error && <p className="warn-text" role="alert">{error}</p>}
      {notice && <p className="settings-notice" role="status">{notice}</p>}
      {!page && !error && <p className="empty" role="status">正在读取项目设置…</p>}
      <form onSubmit={event => { event.preventDefault(); if (page) void mutate({ kind: 'update_project_settings', commandId: `settings-${crypto.randomUUID()}`, projectId,
        expectedRevision: page.current.revision, displayName: name.trim(), check, environment: offline ? { policy: 'offline_install', storeDir: cache.trim() } : { policy: 'existing_only' } }) }}>
        <fieldset disabled={busy || !page || page.current.archived}><label>项目名称<input aria-label="项目名称" value={name} onChange={event => setName(event.target.value)} maxLength={160} required /></label>
          <label>验收检查<select aria-label="验收检查" value={check} onChange={event => setCheck(event.target.value as typeof check)}><option value="node_test">Node 测试</option><option value="pnpm_test">pnpm test</option><option value="npm_test">npm test</option></select></label>
          <label className="settings-toggle"><input type="checkbox" checked={offline} onChange={event => setOffline(event.target.checked)} />授权使用本地缓存离线准备依赖</label>
          {offline && <label>缓存目录<input aria-label="缓存目录" value={cache} onChange={event => setCache(event.target.value)} placeholder="/absolute/path/to/pnpm-store" required /></label>}
        </fieldset>
        {page && page.current.revision >= 100 && <p className="warn-text" role="status">已达到设置版本上限（100）。</p>}
        <div className="settings-actions"><button type="submit" disabled={busy || !page || page.current.archived || page.current.revision >= 100 || !name.trim() || (offline && !cache.trim())}><Check size={15} />{busy ? '正在提交' : '保存设置'}</button>
          <button type="button" className="quiet" disabled={busy} onClick={() => { setError(undefined); void load().catch(() => setError('项目设置读取失败，请重试。')) }}><RefreshCw size={14} />刷新</button></div>
      </form>
      {page && <><details className="settings-history"><summary>版本记录 · {page.history.length}</summary><ol>{page.history.map(version => <li key={version.revision}><span>版本 {version.revision} · {version.displayName}</span><span className="context-line">{{ node_test: 'Node 测试', pnpm_test: 'pnpm test', npm_test: 'npm test' }[version.check]} · {new Date(version.createdAt).toLocaleString('zh-CN')}</span></li>)}</ol></details>
        <footer><button type="button" className="quiet" disabled={busy} onClick={() => void mutate({ kind: 'archive_project', commandId: `archive-project-${crypto.randomUUID()}`, projectId, expectedArchiveRevision: page.current.archiveRevision, archived: !page.current.archived })}>
          {page.current.archived ? <ArchiveRestore size={15} /> : <Archive size={15} />}{page.current.archived ? '恢复项目' : '归档项目'}</button></footer></>}
    </dialog>, document.body)}
  </>
}
