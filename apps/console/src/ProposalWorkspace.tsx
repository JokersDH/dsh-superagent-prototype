import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { z } from 'zod'
import { ArrowLeft, ArrowUpRight, BookmarkCheck, Check, ChevronDown, FileCheck2, GitPullRequest, MessageSquare, Play, RefreshCw, X } from 'lucide-react'
import { ProposalCommandSchema, ProposalPreviewSchema } from '@personal-agent/contracts'
import type { ApplicationConfiguration, CommandReceipt, ConversationMessage, Criterion, ProposalCommand, ProposalPreview, Scope, WorkView } from '@personal-agent/contracts'
import type { ConsoleTransport } from './transport.ts'
import { blockedLabel } from './configuration-labels.ts'
import type { CandidateDraft } from './ReplyCandidates.tsx'

const storageKey = 'personal-agent:pending-proposal-command'
const StoredSchema = z.strictObject({ version: z.literal(1), command: ProposalCommandSchema, preview: ProposalPreviewSchema })
  .refine(value => value.command.token === value.preview.token && value.command.projectId === value.preview.record.projectId &&
    value.command.conversationId === value.preview.record.conversationId, 'Pending request and preview must agree')
type Stored = z.infer<typeof StoredSchema>
type Kind = 'propose_work' | 'propose_revision' | 'propose_decision'
const modes = [
  { kind: 'propose_work' as const, label: '创建工作', icon: Play },
  { kind: 'propose_revision' as const, label: '修订工作', icon: GitPullRequest },
  { kind: 'propose_decision' as const, label: '记录决定', icon: BookmarkCheck },
]
function remembered(): { value?: Stored; damaged: boolean } {
  try {
    const raw = sessionStorage.getItem(storageKey)
    return { ...(raw ? { value: StoredSchema.parse(JSON.parse(raw)) } : {}), damaged: false }
  } catch { return { damaged: true } }
}
const criteriaText = (criterion: Criterion) => `${criterion.description}${criterion.required ? '（必需）' : ''}`

export function ProposalWorkspace({ transport, configuration, sources, source, works, initialProjectId, initialCandidate, onClose, onRecorded, onOpenWork }: {
  transport: ConsoleTransport; configuration: ApplicationConfiguration; sources: readonly ConversationMessage[];
  source: ConversationMessage | undefined; works: readonly WorkView[]; initialProjectId: string;
  initialCandidate?: CandidateDraft;
  onClose(): void; onRecorded(): Promise<void>; onOpenWork(workId: string): void
}) {
  const [initial] = useState(remembered)
  const seed = initialCandidate?.preview.record, payload = seed?.payload
  const seededContent = payload?.kind === 'propose_work' ? payload.goal : payload?.kind === 'propose_revision' ? payload.rationale : payload?.kind === 'propose_decision' ? payload.content : undefined
  const [pending, setPending] = useState<Stored | undefined>(initial.value)
  const [damaged, setDamaged] = useState(initial.damaged)
  const [projectId, setProjectId] = useState(initial.value?.command.projectId ?? seed?.projectId ?? source?.projectId ?? initialProjectId)
  const candidates = sources.filter(value => value.role === 'user' && value.provenance === 'trusted_user' && value.projectId === projectId)
  const [sourceId, setSourceId] = useState(seed?.sourceMessageId ?? source?.id ?? candidates.at(-1)?.id ?? '')
  const [kind, setKind] = useState<Kind>(payload && payload.kind !== 'reply' ? payload.kind : 'propose_work')
  const [content, setContent] = useState(seededContent ?? (source ?? candidates.at(-1))?.text.slice(0, 16384) ?? '')
  const project = configuration.projects.find(value => value.id === projectId)
  const [profileId, setProfileId] = useState(project?.defaultProfileId ?? '')
  const [paths, setPaths] = useState<readonly string[]>(payload?.kind === 'propose_decision' ? payload.scope.allowedPaths : project?.scope.allowedPaths ?? [])
  const [criterionIds, setCriterionIds] = useState<readonly string[]>(project?.defaultCriteria.map(value => value.id) ?? [])
  const [workId, setWorkId] = useState(payload?.kind === 'propose_revision' ? payload.expected.workId : works.find(value => value.work.projectId === projectId && value.work.conversationId === source?.conversationId)?.work.id ?? '')
  const [candidateWork, setCandidateWork] = useState<WorkView>()
  const [revisionGoal, setRevisionGoal] = useState('')
  const [preview, setPreview] = useState<ProposalPreview>()
  const [confirmation, setConfirmation] = useState<ProposalCommand>()
  const [receipt, setReceipt] = useState<CommandReceipt>()
  const [settledLabel, setSettledLabel] = useState('操作已记录')
  const [busy, setBusy] = useState(false), [error, setError] = useState<string>(), [expired, setExpired] = useState(false)
  const dialog = useRef<HTMLDialogElement>(null)
  const selected = candidates.find(value => value.id === sourceId)
  const availableWorks = candidateWork ? [candidateWork, ...works.filter(value => value.work.id !== candidateWork.work.id)] : works
  const revisions = availableWorks.filter(value => value.work.projectId === projectId && value.work.conversationId === (seed?.conversationId ?? selected?.conversationId) &&
    !['ended', 'delivered', 'stopping', 'switching'].includes(value.phase))
  const work = revisions.find(value => value.work.id === workId)
  const profiles = configuration.profiles.filter(value => value.dispatchAllowed && project?.profileIds.includes(value.id))
  const criteria = kind === 'propose_revision' ? work?.contract.criteria ?? [] : project?.defaultCriteria ?? []
  const scope: Scope | undefined = payload?.kind === 'propose_decision' ? payload.scope : kind === 'propose_revision' ? work?.contract.scope : project ? { ...project.scope, allowedPaths: paths } : undefined
  const confirmedCriteria = criteria.filter(value => criterionIds.includes(value.id))
  const blocked = busy || !!pending || damaged
  const displayPreview = pending?.preview ?? preview
  const displaySource = sources.find(value => value.id === displayPreview?.record.sourceMessageId)
  const revisionTarget = displayPreview?.record.payload.kind === 'propose_revision' ? displayPreview.record.payload.expected : undefined
  const targetWork = works.find(value => value.work.id === revisionTarget?.workId)
  const projectBlocked = !!project && !project.dispatchAllowed && (kind !== 'propose_decision' || project.blockedReason === 'stale_contract')
  const title = receipt?.status === 'recorded' ? settledLabel
    : pending ? '核对提案请求' : preview ? '确认提案' : '创建提案'

  useEffect(() => {
    const focused = initialCandidate?.returnFocus ?? document.activeElement as HTMLElement | null
    dialog.current?.showModal()
    return () => { dialog.current?.close(); if (focused?.isConnected) focused.focus() }
  }, [])
  useEffect(() => {
    if (payload?.kind !== 'propose_revision') return
    let active = true
    void transport.snapshot({ workId: payload.expected.workId, conversationId: seed!.conversationId }).then(snapshot => {
      const current = snapshot.works.find(value => value.work.id === payload.expected.workId)
      if (!current || current.work.projectId !== seed!.projectId || current.work.conversationId !== seed!.conversationId ||
        current.contract.digest !== payload.expected.digest || current.contract.revision !== payload.expected.revision) throw new Error('Target changed')
      if (active) { setCandidateWork(current); setCriterionIds(current.contract.criteria.map(criterion => criterion.id)) }
    }).catch(() => { if (active) setError('目标工作已变化或无法读取，请返回重新审阅。') })
    return () => { active = false }
  }, [])
  useEffect(() => {
    if (!preview) { setExpired(false); return }
    const remaining = Date.parse(preview.expiresAt) - Date.now()
    setExpired(remaining <= 0)
    if (remaining <= 0) return
    const timer = setTimeout(() => setExpired(true), remaining)
    return () => clearTimeout(timer)
  }, [preview])

  const mutate = async (command: ProposalCommand, value: ProposalPreview) => {
    if (busy || damaged) return
    const stored = StoredSchema.parse({ version: 1, command, preview: value })
    try { sessionStorage.setItem(storageKey, JSON.stringify(stored)) }
    catch { setDamaged(true); setError('浏览器无法保留请求身份，提交已暂停。'); return }
    setPending(stored); setBusy(true); setError(undefined)
    try {
      const result = await transport.proposalCommand!(command)
      // A validated receipt settles this request even when the server rejected its business effect.
      setReceipt(result); setPending(undefined); setPreview(undefined); setConfirmation(undefined)
      setSettledLabel(command.kind === 'reject_proposal' ? '提案已拒绝' : value.record.payload.kind === 'propose_decision' ? '决定已记录'
        : value.record.payload.kind === 'propose_revision' ? '工作已修订' : '工作已创建')
      try { sessionStorage.removeItem(storageKey) } catch { setDamaged(true) }
      if (result.status === 'rejected') setError('提案未执行，来源、范围或当前工作已变化。请重新预览。')
      else void onRecorded().catch(() => setError('操作已记录，对话暂时无法刷新。'))
    } catch { setError('提交结果尚未确认，请核对原请求。') }
    finally { setBusy(false) }
  }
  const prepare = async () => {
    if ((!selected && !initialCandidate) || !project || !scope || !content.trim() || blocked) return
    if (projectBlocked || (kind !== 'propose_decision' && !confirmedCriteria.some(value => value.kind === 'machine' && value.required))) return
    if (kind === 'propose_work' && !profiles.some(value => value.id === profileId)) return
    if (kind === 'propose_revision' && (!work || !revisionGoal.trim())) return
    setBusy(true); setError(undefined); setReceipt(undefined)
    try {
      const value = initialCandidate ? await transport.prepareReplyCandidate!(initialCandidate.selection)
        : await transport.prepareProposal!({ projectId, conversationId: selected!.conversationId, sourceMessageId: selected!.id,
        payload: kind === 'propose_work' ? { kind, goal: content.trim(), projectId, sourceMessageId: selected!.id }
          : kind === 'propose_decision' ? { kind, content: content.trim(), scope, sourceMessageId: selected!.id }
            : { kind, expected: { workId: work!.contract.workId, revision: work!.contract.revision, digest: work!.contract.digest },
              rationale: content.trim(), sourceMessageId: selected!.id } })
      setPreview(value)
      setConfirmation(ProposalCommandSchema.parse({ kind: 'confirm_proposal', commandId: `proposal-confirm-${crypto.randomUUID()}`,
        projectId, conversationId: value.record.conversationId, token: value.token,
        ...(kind === 'propose_work' ? { work: { scope, criteria: confirmedCriteria, profileId } } : {}),
        ...(kind === 'propose_revision' ? { revision: { goal: revisionGoal.trim(), scope, criteria: confirmedCriteria } } : {}),
      }))
    } catch { setError('提案预览失败，请核对来源与当前项目后重试。') }
    finally { setBusy(false) }
  }
  const resetProject = (id: string) => {
    const value = configuration.projects.find(item => item.id === id), message = sources.filter(item => item.projectId === id && item.role === 'user' && item.provenance === 'trusted_user').at(-1)
    setProjectId(id); setSourceId(message?.id ?? ''); setContent(message?.text.slice(0, 16384) ?? '')
    setProfileId(value?.defaultProfileId ?? ''); setPaths(value?.scope.allowedPaths ?? []); setCriterionIds(value?.defaultCriteria.map(item => item.id) ?? [])
    setWorkId(''); setRevisionGoal(''); setError(undefined)
  }
  const previewScope = pending?.command.kind === 'confirm_proposal' ? pending.command.work?.scope ?? pending.command.revision?.scope ??
    (pending.preview.record.payload.kind === 'propose_decision' ? pending.preview.record.payload.scope : pending.preview.record.grantScope)
    : confirmation?.kind === 'confirm_proposal' ? confirmation.work?.scope ?? confirmation.revision?.scope ?? scope : scope
  const previewCriteria = pending?.command.kind === 'confirm_proposal' ? pending.command.work?.criteria ?? pending.command.revision?.criteria
    : confirmation?.kind === 'confirm_proposal' ? confirmation.work?.criteria ?? confirmation.revision?.criteria : undefined
  const previewProfileId = pending?.command.kind === 'confirm_proposal' ? pending.command.work?.profileId
    : confirmation?.kind === 'confirm_proposal' ? confirmation.work?.profileId : undefined
  const displayCommand = pending?.command ?? confirmation
  const previewRevision = displayCommand?.kind === 'confirm_proposal' ? displayCommand.revision : undefined

  return createPortal(<dialog ref={dialog} className="project-settings-dialog proposal-workspace" aria-label="提案"
    onCancel={event => { if (busy) event.preventDefault() }} onClose={() => { if (!dialog.current?.open) onClose() }}>
    <header><div><h2>{title}</h2><span className="context-line">{project?.displayName ?? projectId}</span></div>
      <button type="button" className="icon-button" title="关闭提案" aria-label="关闭提案" disabled={busy} onClick={onClose}><X size={18} /></button></header>
    {error && <p className="warn-text" role="alert">{error}</p>}
    {damaged && <p className="warn-text" role="alert">待核对请求记录无法读取或清除，已暂停新提交。</p>}
    {receipt?.status === 'recorded' ? <section className="proposal-result" aria-label="提案结果"><Check size={24} /><h3>{settledLabel}</h3>
      <div className="settings-actions">{receipt.workId && <button type="button" onClick={() => onOpenWork(receipt.workId!)}><ArrowUpRight size={15} />查看工作</button>}
        <button type="button" className="quiet" onClick={onClose}>返回对话</button></div></section>
      : <>
        {pending && <div className="proposal-pending" role="status"><RefreshCw size={16} /><span>原请求待核对</span>
          <button type="button" disabled={busy || damaged} onClick={() => void mutate(pending.command, pending.preview)}><RefreshCw size={15} />核对原请求</button></div>}
        {!displayPreview && !damaged && <form onSubmit={event => { event.preventDefault(); void prepare() }}>
          <div className="proposal-form-scroll"><fieldset disabled={blocked}>
            {!initialCandidate && <div className="proposal-modes" role="group" aria-label="提案类型">{modes.map(mode => <button key={mode.kind} type="button" aria-pressed={kind === mode.kind}
              onClick={() => { setKind(mode.kind); setError(undefined); setCriterionIds(project?.defaultCriteria.map(item => item.id) ?? []) }}><mode.icon size={15} />{mode.label}</button>)}</div>}
            <div className="proposal-fields"><label>项目<select aria-label="提案项目" value={projectId} disabled={!!initialCandidate} onChange={event => resetProject(event.target.value)}>
              {configuration.projects.map(value => <option key={value.id} value={value.id}>{value.displayName}{value.dispatchAllowed ? '' : '（不可调度）'}</option>)}</select></label>
              <label>来源消息<select aria-label="提案来源消息" required value={sourceId} disabled={!!initialCandidate} onChange={event => { setSourceId(event.target.value); setContent(candidates.find(value => value.id === event.target.value)?.text.slice(0, 16384) ?? ''); setWorkId('') }}>
                <option value="">选择用户消息</option>{seed && !candidates.some(value => value.id === seed.sourceMessageId) && <option value={seed.sourceMessageId}>原始用户消息</option>}{candidates.map(value => <option key={value.id} value={value.id}>{value.text.slice(0, 60)}</option>)}</select></label></div>
            {!candidates.length && !initialCandidate && <p className="proposal-empty">当前对话没有可用的用户消息</p>}
            {projectBlocked && <p className="warn-text" role="alert">{blockedLabel(project?.blockedReason)}</p>}
            <label>{kind === 'propose_work' ? '工作目标' : kind === 'propose_revision' ? '修订说明' : '决定内容'}<textarea aria-label="提案内容" rows={4} maxLength={16384} value={content} readOnly={!!initialCandidate} required onChange={event => setContent(event.target.value)} /></label>
            {kind === 'propose_revision' && <><label>当前工作<select aria-label="修订目标工作" value={workId} disabled={!!initialCandidate} required onChange={event => {
              const value = revisions.find(item => item.work.id === event.target.value); setWorkId(event.target.value); setRevisionGoal(value?.contract.goal ?? ''); setCriterionIds(value?.contract.criteria.map(item => item.id) ?? [])
            }}><option value="">选择当前工作</option>{revisions.map(value => <option key={value.work.id} value={value.work.id}>{value.work.title}</option>)}</select></label>
              <label>新工作目标<textarea aria-label="修订后目标" required rows={3} maxLength={16384} value={revisionGoal} onChange={event => setRevisionGoal(event.target.value)} /></label></>}
            {kind === 'propose_work' && <label>执行器<select aria-label="提案执行器" value={profileId} required onChange={event => setProfileId(event.target.value)}>
              <option value="">选择执行器</option>{profiles.map(value => <option key={value.id} value={value.id}>{value.displayName}</option>)}</select></label>}
            {scope && <section className="proposal-scope" aria-label="提案执行范围"><h3>执行范围</h3>
              {kind === 'propose_revision' ? <p>{scope.allowedPaths.join('、')}</p> : <div className="proposal-paths">{project?.scope.allowedPaths.map(path => <label key={path} className="settings-toggle"><input type="checkbox" checked={paths.includes(path)} disabled={!!initialCandidate && kind === 'propose_decision'}
                onChange={event => setPaths(event.target.checked ? [...paths, path] : paths.filter(value => value !== path))} /><code>{path}</code></label>)}</div>}
              {!!scope.excludedPaths.length && <p>排除：{scope.excludedPaths.join('、')}</p>}
              <p>外部动作：{scope.externalActions.join('、') || '无'}</p></section>}
            {kind !== 'propose_decision' && <section className="proposal-checks" aria-label="提案验收标准"><h3>验收标准</h3>{criteria.map(criterion => <label key={criterion.id} className="settings-toggle"><input type="checkbox" checked={criterionIds.includes(criterion.id)}
              onChange={event => setCriterionIds(event.target.checked ? [...criterionIds, criterion.id] : criterionIds.filter(value => value !== criterion.id))} /><span>{criteriaText(criterion)}<small>{criterion.kind === 'machine' ? '机器检查' : '人工验收'}</small></span></label>)}</section>}
          </fieldset></div>
          <footer><button type="submit" disabled={blocked || projectBlocked || (!selected && !initialCandidate) || !content.trim() || !scope?.allowedPaths.length ||
            (kind !== 'propose_decision' && (!project?.dispatchAllowed || !confirmedCriteria.some(value => value.kind === 'machine' && value.required))) ||
            (kind === 'propose_work' && !profileId) || (kind === 'propose_revision' && (!work || !revisionGoal.trim()))}><FileCheck2 size={15} />{busy ? '正在预览' : '预览提案'}</button></footer>
        </form>}
        {displayPreview && <section className="proposal-preview" aria-label="待确认提案"><div className="proposal-preview-title"><FileCheck2 size={18} /><h3>{displayPreview.record.payload.kind === 'propose_work' ? '创建工作' : displayPreview.record.payload.kind === 'propose_revision' ? '修订工作' : '记录决定'}</h3></div>
          <p className="proposal-content">{displayPreview.record.payload.kind === 'propose_work' ? displayPreview.record.payload.goal : displayPreview.record.payload.kind === 'propose_revision' ? displayPreview.record.payload.rationale : displayPreview.record.payload.kind === 'propose_decision' ? displayPreview.record.payload.content : ''}</p>
          <details className="proposal-source"><summary><MessageSquare size={14} /><span>{displaySource ? `来源：${displaySource.text.slice(0, 70)}` : '查看原消息身份'}</span><ChevronDown size={14} className="proposal-source-chevron" /></summary>
            {displaySource && <p>{displaySource.text}</p>}<dl><dt>原会话</dt><dd><code>{displayPreview.record.conversationId}</code></dd><dt>来源消息</dt><dd><code>{displayPreview.record.sourceMessageId}</code></dd></dl></details>
          <dl>{revisionTarget && <><dt>目标工作</dt><dd>{targetWork?.work.title ?? '原工作'}<code className="proposal-target-id">{revisionTarget.workId}</code></dd>
            <dt>合同版本</dt><dd>版本 {revisionTarget.revision}</dd></>}
            <dt>允许路径</dt><dd>{previewScope?.allowedPaths.join('、')}</dd><dt>排除路径</dt><dd>{previewScope?.excludedPaths.join('、') || '无'}</dd>
            <dt>外部动作</dt><dd>{previewScope?.externalActions.join('、') || '无'}</dd>
            {previewProfileId && <><dt>执行器</dt><dd>{configuration.profiles.find(value => value.id === previewProfileId)?.displayName ?? previewProfileId}</dd></>}
            <dt>确认期限</dt><dd><time dateTime={displayPreview.expiresAt}>{new Date(displayPreview.expiresAt).toLocaleString('zh-CN')}</time></dd></dl>
          {previewCriteria && <div className="proposal-criteria-preview"><h3>验收标准</h3><ul>{previewCriteria.map(value => <li key={value.id}><Check size={14} />{criteriaText(value)}</li>)}</ul></div>}
          {previewRevision && <section className="proposal-revision-preview"><h3>新工作目标</h3><p>{previewRevision.goal}</p></section>}
          {expired && !pending && <p className="warn-text" role="status">预览已到期，请返回编辑后重新预览。</p>}
          {!pending && <footer><button type="button" className="quiet" disabled={busy} onClick={() => { setPreview(undefined); setConfirmation(undefined) }}><ArrowLeft size={15} />返回编辑</button>
            <button type="button" className="quiet" disabled={blocked || expired} onClick={() => void mutate({ kind: 'reject_proposal', commandId: `proposal-reject-${crypto.randomUUID()}`,
              projectId: displayPreview.record.projectId, conversationId: displayPreview.record.conversationId, token: displayPreview.token }, displayPreview)}><X size={15} />拒绝提案</button>
            <button type="button" disabled={blocked || expired || !confirmation} onClick={() => void mutate(confirmation!, displayPreview)}><Check size={15} />确认{displayPreview.record.payload.kind === 'propose_decision' ? '记录' : displayPreview.record.payload.kind === 'propose_revision' ? '修订' : '创建'}</button></footer>}
        </section>}
      </>}
  </dialog>, document.body)
}
