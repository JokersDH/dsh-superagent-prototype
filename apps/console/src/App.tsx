/**
 * The console app shell: main conversation, conversation-scoped works, concentrated questions,
 * dispatch controls, verification and current-candidate acceptance. Everything displayed comes from
 * the backend snapshot and `actions.available`; the UI never infers a phase or invents an action.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ConversationMessageSchema } from '@personal-agent/contracts'
import type {
  AssignmentRef, CandidateRef, CommandReceipt, ContractRef, ConversationMessage, Criterion, QuestionAnswer,
  Snapshot, UserCommand, UserQuestion, WorkView,
} from '@personal-agent/contracts'
import type { ConsoleTransport, ExecutorSnapshot, TargetDelivery, VerificationDetail } from './transport.ts'
import { TransportError } from './transport.ts'
import type { FixtureAdapter } from './fixture.ts'
import { checkCriterionId, checkDefinitionRef, conversationId, defaultProfileId, profileIds } from './config.ts'
const phaseLabel: Record<WorkView['phase'], string> = {
  evaluating: '评估中', queued: '已排队', working: '执行中', needs_user: '待你决定', verifying: '验证中',
  switching: '切换中', stopping: '停止中', delivered: '已交付', ended: '已结束', uncertain: '状态不确定',
}
const resourceLabel: Record<WorkView['resourceStatus'], string> = {
  quiescent: '写者已静止', active: '写者活动', indeterminate: '写者状态未知',
}
const deliveryLabel: Record<TargetDelivery['status'], string> = {
  local_recorded: '本地已记录（尚未写到原生）', response_written: '已写入原生响应', native_applied: '原生已应用',
  indeterminate: '投递结果未知', expired: '已过期',
}
const outcomeLabel: Record<VerificationDetail['results'][number]['outcome'], string> = {
  PASS: '通过', FAIL: '未通过', SKIPPED: '跳过', NOT_TESTED: '未测试', NOT_APPLICABLE: '不适用',
}
const questionKindLabel: Record<UserQuestion['kind'], string> = {
  clarification: '澄清', permission: '权限', authentication: '认证', review: '验收',
}
const newId = (prefix: string): string => `${prefix}-${crypto.randomUUID()}`
const contractRef = (contract: WorkView['contract']): ContractRef => ({ workId: contract.workId, revision: contract.revision, digest: contract.digest })

interface Problem { code: string; message: string; retry: 'safe' | 'reconcile' | 'user_action' | 'none' }

const problemOf = (error: unknown): Problem => {
  if (error instanceof TransportError) return { code: error.code, message: error.message, retry: error.retry }
  return { code: 'storage_unavailable', message: String(error), retry: 'safe' }
}

export function App({ transport }: { transport: ConsoleTransport }) {
  const fixture = typeof (transport as FixtureAdapter).setModelOffline === 'function' ? transport as FixtureAdapter : undefined
  const [snapshot, setSnapshot] = useState<Snapshot | undefined>(undefined)
  const [loading, setLoading] = useState(true)
  const [connection, setConnection] = useState<'connecting' | 'live' | 'reconnecting' | 'offline' | 'expired'>('connecting')
  const [problem, setProblem] = useState<Problem | undefined>(undefined)
  const [notice, setNotice] = useState<string | undefined>(undefined)
  const [pending, setPending] = useState<string | undefined>(undefined)
  const [selectedWorkId, setSelectedWorkId] = useState<string | undefined>(undefined)
  const [projectFilter, setProjectFilter] = useState<string | undefined>(undefined)
  const [offline, setOffline] = useState<boolean>(() => fixture?.modelOffline() ?? false)
  const [createOpen, setCreateOpen] = useState(false)
  const [auth, setAuth] = useState<'checking' | 'required' | 'ready'>(transport.session ? 'checking' : 'ready')
  const [verification, setVerification] = useState<VerificationDetail | undefined>(undefined)
  const [deliveries, setDeliveries] = useState<Record<string, readonly TargetDelivery[]>>({})
  const lastSeq = useRef(0)
  const detailRef = useRef<HTMLElement | null>(null)
  const seen = useRef(new Set<number>())
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const refresh = useCallback(async (query: { workId?: string } = {}): Promise<void> => {
    try {
      const next = await transport.snapshot({
        conversationId,
        limit: 100,
        ...(query.workId ? { workId: query.workId } : {}),
      })
      setSnapshot(next)
      lastSeq.current = Math.max(lastSeq.current, next.cursor)
      setConnection('live')
      setProblem(undefined)
      setLoading(false)
      if (transport.deliveries) {
        const entries = await Promise.all(next.questions.map(async question => [question.id, await transport.deliveries!(question.id)] as const))
        setDeliveries(Object.fromEntries(entries))
      }
    } catch (error) {
      const failure = problemOf(error)
      if (failure.code === 'auth_required') setAuth('required')
      setProblem(failure)
      setLoading(false)
    }
  }, [transport])

  useEffect(() => {
    if (!transport.session) return
    let cancelled = false
    void transport.session().then(authenticated => { if (!cancelled) setAuth(authenticated ? 'ready' : 'required') })
      .catch(() => { if (!cancelled) setAuth('required') })
    return () => { cancelled = true }
  }, [transport])

  const scheduleRefresh = useCallback((): void => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current)
    refreshTimer.current = setTimeout(() => { void refresh() }, 40)
  }, [refresh])

  useEffect(() => {
    if (auth !== 'ready') return
    let closed = false
    const controller = new AbortController()
    let failures = 0
    const run = async (): Promise<void> => {
      void refresh()
      while (!closed) {
        try {
          // The subscription attempt starts here; a refusal below flips the status to offline/expired.
          setConnection('live')
          for await (const change of transport.changes(lastSeq.current, controller.signal)) {
            if (closed) return
            if (seen.current.has(change.seq) || change.seq <= lastSeq.current - 200) continue
            seen.current.add(change.seq)
            lastSeq.current = Math.max(lastSeq.current, change.seq)
            failures = 0
            setConnection('live')
            if (change.topic === 'conversation.message') {
              const message = ConversationMessageSchema.safeParse((change.payload as { message?: unknown }).message)
              if (message.success && message.data.conversationId === conversationId) appendMessage(message.data)
              else scheduleRefresh()
            } else {
              scheduleRefresh()
            }
          }
        } catch (error) {
          if (closed) return
          const failure = problemOf(error)
          if (failure.code === 'cursor_expired') {
            setConnection('expired')
            setNotice('事件游标已过期，已重新获取快照；较早的实时事件可能缺失。')
            seen.current.clear()
            await refresh()
            failures = 0
            continue
          }
          failures += 1
          setConnection('offline')
          setNotice(`事件流断开，正在重连（第 ${failures} 次）…`)
          await new Promise(resolve => setTimeout(resolve, Math.min(2000, 300 * failures)))
        }
      }
    }
    void run()
    return () => {
      closed = true
      controller.abort()
      if (refreshTimer.current) clearTimeout(refreshTimer.current)
    }
  }, [transport, refresh, scheduleRefresh, auth])

  // Refresh when the tab becomes visible again; a hidden page can miss SSE frames.
  useEffect(() => {
    const onVisible = (): void => { if (document.visibilityState === 'visible') void refresh() }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [refresh])

  const appendMessage = (message: ConversationMessage): void => {
    setSnapshot(previous => {
      if (!previous?.conversation) return previous
      if (previous.conversation.messages.some(item => item.id === message.id)) return previous
      const messages = [...previous.conversation.messages, message].sort((a, b) => a.sequence - b.sequence)
      return { ...previous, conversation: { ...previous.conversation, messages } }
    })
  }

  const send = useCallback(async (command: UserCommand, label: string): Promise<CommandReceipt | undefined> => {
    setPending(label)
    setProblem(undefined)
    try {
      const receipt = await transport.dispatch(command)
      if (receipt.status === 'rejected') {
        setProblem({ code: receipt.error.code, message: receipt.error.message, retry: receipt.error.retry })
      } else {
        const reference = command.kind === 'answer_question' ? command.questionId : undefined
        if (reference && transport.deliveries) {
          const targets = await transport.deliveries(reference)
          setDeliveries(previous => ({ ...previous, [reference]: targets }))
        }
        scheduleRefresh()
      }
      return receipt
    } catch (error) {
      setProblem(problemOf(error))
      return undefined
    } finally {
      setPending(undefined)
    }
  }, [transport, scheduleRefresh])

  // Load verification detail for the selected work whenever selection or snapshot changes.
  useEffect(() => {
    let cancelled = false
    const id = snapshot?.works.find(work => work.work.id === selectedWorkId)?.actions.currentVerificationId
    if (!id || !transport.verification) { setVerification(undefined); return }
    void transport.verification(id).then(detail => { if (!cancelled) setVerification(detail) }).catch(() => { if (!cancelled) setVerification(undefined) })
    return () => { cancelled = true }
  }, [selectedWorkId, snapshot, transport])

  useEffect(() => { detailRef.current?.scrollTo({ top: 0 }) }, [selectedWorkId])

  const works = useMemo(() => (snapshot?.works ?? []).filter(work => !projectFilter || work.work.projectId === projectFilter), [snapshot, projectFilter])
  const projects = useMemo(() => [...new Set((snapshot?.works ?? []).map(work => work.work.projectId))], [snapshot])
  const selectedWork = works.find(work => work.work.id === selectedWorkId) ?? (snapshot?.works ?? []).find(work => work.work.id === selectedWorkId)
  const openQuestions = snapshot?.questions ?? []

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <h1>个人 Agent 工作台</h1>
          <span className="subtitle">主对话 · 委托 · 待决定</span>
        </div>
        <div className="status-cluster" aria-live="polite">
          <span className={`badge status-${connection}`}>{connection === 'live' ? '实时连接' : connection === 'expired' ? '游标已过期' : connection === 'offline' ? '连接中断' : '连接中'}</span>
          {offline && <span className="badge warn">模型离线</span>}
          <button type="button" className="quiet" onClick={() => void refresh()}>刷新快照</button>
          {fixture && (
            <span className="fixture-controls" role="group" aria-label="fixture 控制">
              <button type="button" className="quiet" onClick={() => { fixture.disconnect(); }}>模拟断线</button>
              <button type="button" className="quiet" onClick={() => { fixture.expireCursor(); fixture.disconnect(); }}>使游标过期</button>
              <button type="button" className="quiet" aria-pressed={offline} onClick={() => { fixture.setModelOffline(!offline); setOffline(!offline) }}>
                {offline ? '恢复模型' : '模拟模型离线'}
              </button>
            </span>
          )}
        </div>
      </header>

      {notice && (
        <div className="notice" role="status">
          <span>{notice}</span>
          <button type="button" className="quiet" onClick={() => setNotice(undefined)}>关闭</button>
        </div>
      )}
      {problem && auth === 'ready' && <ErrorPanel problem={problem} onRefresh={() => void refresh()} onDismiss={() => setProblem(undefined)} />}
      {auth !== 'ready' && (
        <SessionGate
          checking={auth === 'checking'}
          bootstrap={transport.bootstrap ? token => transport.bootstrap!(token) : undefined}
          onAuthenticated={() => { setAuth('ready'); setProblem(undefined) }}
        />
      )}

      {auth === 'ready' && <main className="layout">
        <aside className="sidebar" aria-label="工作列表">
          <div className="section-head">
            <h2>工作</h2>
            <span className="count">{works.length}</span>
            <button type="button" className="quiet" onClick={() => setCreateOpen(!createOpen)}>新建委托</button>
          </div>
          <div className="project-filter" role="group" aria-label="按项目筛选">
            <button type="button" className={!projectFilter ? 'chip active' : 'chip'} aria-pressed={!projectFilter} onClick={() => setProjectFilter(undefined)}>全部</button>
            {projects.map(project => (
              <button key={project} type="button" className={projectFilter === project ? 'chip active' : 'chip'} aria-pressed={projectFilter === project} onClick={() => setProjectFilter(project)}>{project}</button>
            ))}
          </div>
          {createOpen && (
            <NewWorkForm
              projects={projects}
              profiles={profileIds}
              initialProfile={defaultProfileId}
              pending={pending === 'create_work'}
              onCancel={() => setCreateOpen(false)}
              onCreate={async (goal, projectId, allowedPath, profileId) => {
                const receipt = await send({
                  commandId: newId('cmd-work'), conversationId, kind: 'create_work', projectId, goal,
                  scope: { projectId, allowedPaths: [allowedPath], excludedPaths: [], externalActions: [] },
                  criteria: [
                    { id: checkCriterionId, kind: 'machine', description: '已注册输出检查通过', required: true, checkDefinitionRef },
                    { id: 'review', kind: 'human', description: '用户验收结果', required: true },
                  ],
                  profileId,
                }, 'create_work')
                if (receipt?.status === 'recorded' && receipt.workId) {
                  setCreateOpen(false)
                  setSelectedWorkId(receipt.workId)
                }
              }}
            />
          )}
          <ul className="work-list">
            {works.map(work => (
              <li key={work.work.id}>
                <button
                  type="button"
                  className={`work-card${selectedWorkId === work.work.id ? ' selected' : ''}`}
                  aria-current={selectedWorkId === work.work.id ? 'true' : undefined}
                  onClick={() => { setSelectedWorkId(work.work.id); setProjectFilter(undefined) }}
                >
                  <span className="work-title">{work.work.title}</span>
                  <span className="work-meta">
                    <span className={`phase phase-${work.phase}`}>{phaseLabel[work.phase]}</span>
                    {work.actions.dispatchHold.paused && <span className="mini warn">派工暂停</span>}
                    {work.openQuestionIds.length > 0 && <span className="mini">{work.openQuestionIds.length} 个待决定</span>}
                    {work.resourceStatus === 'indeterminate' && <span className="mini warn">写者未知</span>}
                  </span>
                  <span className={`resource resource-${work.resourceStatus}`}>{resourceLabel[work.resourceStatus]}</span>
                </button>
              </li>
            ))}
            {!loading && works.length === 0 && <li className="empty">该项目还没有工作。</li>}
          </ul>
          {loading && <p className="empty">正在载入…</p>}
        </aside>

        <section className="conversation" aria-label="主对话">
          <Conversation
            snapshot={snapshot}
            projectFilter={projectFilter}
            selectedWork={selectedWork}
            pending={pending === 'chat'}
            offline={offline}
            onSend={async text => {
              const command: UserCommand = {
                commandId: newId('cmd-chat'), conversationId, kind: 'chat', text,
                projectId: selectedWork?.work.projectId ?? projectFilter ?? 'project-atlas',
                ...(selectedWork ? { anchor: { workId: selectedWork.work.id } } : {}),
              }
              await send(command, 'chat')
            }}
            onLoadOlder={async before => {
              const page = await transport.messages(conversationId, { before, limit: 100 })
              setSnapshot(previous => previous?.conversation
                ? { ...previous, conversation: { ...previous.conversation, messages: [...page.messages, ...previous.conversation.messages].filter((item, index, all) => all.findIndex(other => other.id === item.id) === index).sort((a, b) => a.sequence - b.sequence), hasMore: page.hasMore } }
                : previous)
            }}
          />
        </section>

        <aside className="detail" aria-label="决定与工作详情" ref={detailRef}>
          <WorkDetail
            work={selectedWork}
            verification={verification}
            artifactReader={transport.artifact ? id => transport.artifact!(id) : undefined}
            pending={pending}
            onPause={async work => {
              const command: UserCommand = {
                commandId: newId('cmd-pause'), conversationId, kind: work.actions.dispatchHold.paused ? 'resume_dispatch' : 'pause_dispatch',
                expected: contractRef(work.contract), expectedHoldRevision: work.actions.dispatchHold.revision,
              }
              await send(command, 'dispatch')
            }}
            onStop={async work => {
              await send({ commandId: newId('cmd-stop'), conversationId, kind: 'stop_work', workId: work.work.id }, 'stop')
            }}
            onRetry={async (assignment: AssignmentRef, token: string) => {
              await send({ commandId: newId('cmd-retry'), conversationId, kind: 'retry_assignment', expected: assignment, actionToken: token }, 'retry')
            }}
            onContinue={async (contract: ContractRef) => {
              await send({ commandId: newId('cmd-continue'), conversationId, kind: 'continue_work', expected: contract }, 'continue')
            }}
            onAccept={async (candidate: CandidateRef) => {
              await send({ commandId: newId('cmd-accept'), conversationId, kind: 'accept_candidate', candidate }, 'accept')
            }}
          />
          <ExecutorPanel transport={transport} />
          <Questions
            questions={openQuestions}
            deliveries={deliveries}
            pending={pending}
            onAnswer={async (question, answer) => {
              const command: UserCommand = {
                commandId: newId('cmd-answer'), conversationId, kind: 'answer_question',
                questionId: question.id, expectedVersion: question.version, answer,
              }
              await send(command, `answer:${question.id}`)
            }}
          />
        </aside>
      </main>}
    </div>
  )
}

function SessionGate({ checking, bootstrap, onAuthenticated }: {
  checking: boolean
  bootstrap: ((token: string) => Promise<void>) | undefined
  onAuthenticated: () => void
}) {
  const [token, setToken] = useState('')
  const [pending, setPending] = useState(false)
  const [failure, setFailure] = useState<string | undefined>(undefined)
  return (
    <section className="session-gate" aria-label="本地 API 登录">
      <div className="session-card">
        <h2>连接本地 API</h2>
        {checking && <p className="empty">正在检查本地会话…</p>}
        {!checking && !bootstrap && <p className="empty">该 transport 不支持会话登录。</p>}
        {!checking && bootstrap && (
          <form onSubmit={async event => {
            event.preventDefault()
            setPending(true)
            try {
              setFailure(undefined)
              await bootstrap(token.trim())
              onAuthenticated()
            } catch (error) {
              setFailure(problemOf(error).message)
            } finally { setPending(false) }
          }}>
            <label htmlFor="bootstrap-token">Bootstrap token（本地私钥文件，不会写入浏览器存储）</label>
            <input
              id="bootstrap-token" type="password" autoComplete="off" required value={token}
              onChange={event => setToken(event.target.value)}
            />
            {failure && <p className="warn-text" role="alert">{failure}</p>}
            <div className="actions">
              <button type="submit" disabled={pending || !token.trim()}>{pending ? '连接中…' : '建立本地会话'}</button>
            </div>
            <p className="note">令牌来自本地 demo 的 <code>bootstrap.key</code>；后端生成 TrustedActor，浏览器不发送角色或 actor 字段。</p>
          </form>
        )}
      </div>
    </section>
  )
}

function Artifacts({ ids, reader }: {
  ids: readonly string[]
  reader: ((id: string) => Promise<{ contentType: string; text: string } | undefined>) | undefined
}) {
  const [preview, setPreview] = useState<{ id: string; text: string; contentType: string } | undefined>(undefined)
  const [failure, setFailure] = useState<string | undefined>(undefined)
  if (!ids.length) return <p className="empty">当前候选还没有已发布的产物。</p>
  return (
    <div className="artifacts">
      <ul>
        {ids.map((id, index) => (
          <li key={id}>
            <code>{id.slice(0, 18)}…</code>
            <span className="mini">产物 {index + 1}</span>
            <span className="artifact-actions">
              {reader && <button type="button" className="quiet" onClick={async () => {
                setFailure(undefined)
                try {
                  const value = await reader(id)
                  if (!value) setFailure('该产物没有已接线的读取入口。')
                  else setPreview({ id, text: value.text, contentType: value.contentType })
                } catch (error) { setFailure(String((error as Error).message ?? error)) }
              }}>查看</button>}
              <a href={`/v1/artifacts/${encodeURIComponent(id)}`} target="_blank" rel="noreferrer">下载</a>
            </span>
          </li>
        ))}
      </ul>
      {failure && <p className="warn-text" role="alert">{failure}</p>}
      {preview && (
        <div className="artifact-preview">
          <p className="context-line">产物 <code>{preview.id}</code> · {preview.contentType}</p>
          <pre className="artifact-text">{preview.text.length > 8000 ? `${preview.text.slice(0, 8000)}\n…` : preview.text}</pre>
          <button type="button" className="quiet" onClick={() => setPreview(undefined)}>关闭预览</button>
        </div>
      )}
    </div>
  )
}

function NewWorkForm({ projects, profiles, initialProfile, pending, onCreate, onCancel }: {
  projects: readonly string[]
  profiles: readonly string[]
  initialProfile: string
  pending: boolean
  onCreate: (goal: string, projectId: string, allowedPath: string, profileId: string) => Promise<unknown>
  onCancel: () => void
}) {
  const [goal, setGoal] = useState('')
  const [project, setProject] = useState(projects[0] ?? 'project-atlas')
  const [allowedPath, setAllowedPath] = useState('src/')
  const [profile, setProfile] = useState(initialProfile)
  return (
    <form className="new-work" onSubmit={async event => {
      event.preventDefault()
      if (!goal.trim()) return
      await onCreate(goal.trim(), project, allowedPath.trim() || 'src/', profile)
    }}>
      <label><span>目标</span><textarea rows={3} required value={goal} onChange={event => setGoal(event.target.value)} /></label>
      <label><span>项目</span>
        {projects.length
          ? <select value={project} onChange={event => setProject(event.target.value)}>
              {projects.map(item => <option key={item} value={item}>{item}</option>)}
            </select>
          : <input type="text" required value={project} onChange={event => setProject(event.target.value)} placeholder="project-atlas" />}
      </label>
      <label><span>允许路径</span><input type="text" required value={allowedPath} onChange={event => setAllowedPath(event.target.value)} /></label>
      <label><span>执行器 Profile</span>
        <select value={profile} onChange={event => setProfile(event.target.value)}>
          {profiles.map(item => <option key={item} value={item}>{item}</option>)}
        </select>
      </label>
      <div className="actions">
        <button type="submit" disabled={pending || !goal.trim()}>{pending ? '创建中…' : '创建委托'}</button>
        <button type="button" className="quiet" onClick={onCancel}>取消</button>
      </div>
    </form>
  )
}

function ExecutorPanel({ transport }: { transport: ConsoleTransport }) {
  const [items, setItems] = useState<readonly ExecutorSnapshot[] | undefined>(undefined)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    if (!transport.executors) { setItems(undefined); return }
    let cancelled = false
    void transport.executors().then(value => { if (!cancelled) setItems(value) }).catch(() => { if (!cancelled) setFailed(true) })
    return () => { cancelled = true }
  }, [transport])
  const readiness: Record<string, string> = {
    missing: '未找到', needs_setup: '需要配置', needs_auth: '需要认证', incompatible: '不兼容',
    inspection_passed: '只读检查通过', native_test_passed: '原生测试通过',
  }
  return (
    <section className="panel" aria-label="执行器连接">
      <div className="section-head"><h2>执行器连接</h2>{transport.executors && <span className="mini">fixture</span>}</div>
      {!transport.executors && <p className="empty">执行器 Catalog 尚未接线（等待主 Agent 发布生产读取入口）。</p>}
      {failed && <p className="empty">执行器探针读取失败。</p>}
      {items?.map(({ profile, report }) => (
        <div key={profile.id} className="executor">
          <p><strong>{profile.id}@{profile.revision}</strong> · {profile.driverId} {profile.driverRelease}</p>
          <p className="context-line">期望 {profile.expectedVersion} · {readiness[report.readiness] ?? report.readiness}</p>
          <ul className="results">
            {report.capabilities.map(capability => (
              <li key={capability.feature}>
                <span>{capability.feature}</span>
                <span className={`outcome outcome-${capability.test}`}>{capability.test}</span>
                <span className="mini">{capability.policy}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
      {transport.executors && <p className="note">fixture 场景；生产 Catalog 由主线统一接线。未测能力不显示为通过。</p>}
    </section>
  )
}

function ErrorPanel({ problem, onRefresh, onDismiss }: { problem: Problem; onRefresh: () => void; onDismiss: () => void }) {
  return (
    <div className="error-panel" role="alert">
      <div>
        <strong>{problem.code === 'stale_candidate' ? '候选已过期' : problem.code === 'question_expired' ? '问题已过期' : '操作未完成'}</strong>
        <p>{problem.message}</p>
        <span className="retry-note">可恢复方式：{problem.retry === 'safe' ? '刷新后重试' : problem.retry === 'reconcile' ? '先核对原生状态' : problem.retry === 'user_action' ? '请调整输入或操作' : '不可重试'}</span>
      </div>
      <div className="error-actions">
        <button type="button" onClick={onRefresh}>刷新快照</button>
        <button type="button" className="quiet" onClick={onDismiss}>关闭</button>
      </div>
    </div>
  )
}

function Conversation({ snapshot, projectFilter, selectedWork, pending, offline, onSend, onLoadOlder }: {
  snapshot: Snapshot | undefined
  projectFilter: string | undefined
  selectedWork: WorkView | undefined
  pending: boolean
  offline: boolean
  onSend: (text: string) => Promise<unknown>
  onLoadOlder: (before: number) => Promise<void>
}) {
  const [draft, setDraft] = useState('')
  const page = snapshot?.conversation
  const messages = page?.messages ?? []
  const anchorId = selectedWork ? `work:${selectedWork.work.id}` : undefined
  return (
    <div className="conversation-inner">
      <div className="conversation-head">
        <div>
          <h2>主对话</h2>
          <p className="context-line">
            项目 <code>{selectedWork?.work.projectId ?? projectFilter ?? 'project-atlas'}</code>
            {selectedWork ? <> · 锚点 <code>{anchorId}</code>（{selectedWork.work.title}）</> : <> · 锚点：最新消息</>}
          </p>
        </div>
        {offline && <span className="badge warn">模型离线：查询、回答与停止仍可用</span>}
      </div>
      <div className="messages" role="log" aria-live="polite" aria-label="对话消息">
        {page?.hasMore && (
          <button type="button" className="load-older" onClick={() => void onLoadOlder(page.beforeCursor!)}>加载更早消息</button>
        )}
        {messages.map(message => (
          <article key={message.id} className={`message role-${message.role}`}>
            <header>
              <span className="role">{message.role === 'user' ? '你' : message.role === 'assistant' ? 'Agent' : '系统'}</span>
              <span className="provenance">{message.provenance === 'trusted_user' ? '用户输入' : message.provenance === 'reasoner_reply' ? '模型回复' : message.provenance === 'question_answer_display' ? '问题结果' : '应用通知'}</span>
              <time dateTime={message.createdAt}>{new Date(message.createdAt).toLocaleString('zh-CN', { hour12: false })}</time>
            </header>
            <p className="text">{message.text}</p>
          </article>
        ))}
        {!messages.length && <p className="empty">还没有消息。写下目标，或从左侧选择一个工作继续。</p>}
      </div>
      <form className="composer" onSubmit={async event => {
        event.preventDefault()
        const text = draft.trim()
        if (!text || pending) return
        setDraft('')
        await onSend(text)
      }}>
        <label htmlFor="composer-input">发送消息</label>
        <textarea
          id="composer-input"
          rows={3}
          value={draft}
          placeholder={offline ? '模型离线：消息会显示为未发送，你仍可回答问题或停止工作。' : '说明目标、补充约束，或引用当前工作继续…'}
          onChange={event => setDraft(event.target.value)}
          onKeyDown={event => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) event.currentTarget.form?.requestSubmit() }}
        />
        <div className="composer-actions">
          <span className="hint">Ctrl/⌘ + Enter 发送{selectedWork ? ` · 引用 ${selectedWork.work.id}` : ''}</span>
          <button type="submit" disabled={pending || !draft.trim()}>{pending ? '发送中…' : '发送'}</button>
        </div>
      </form>
    </div>
  )
}

function Questions({ questions, deliveries, pending, onAnswer }: {
  questions: readonly UserQuestion[]
  deliveries: Record<string, readonly TargetDelivery[]>
  pending: string | undefined
  onAnswer: (question: UserQuestion, answer: QuestionAnswer) => Promise<unknown>
}) {
  return (
    <section className="panel">
      <div className="section-head"><h2>待决定</h2><span className="count">{questions.length}</span></div>
      {questions.length === 0 && <p className="empty">没有待决定问题。</p>}
      <div className="question-list">
        {questions.map(question => (
          <QuestionCard key={question.id} question={question} deliveries={deliveries[question.id] ?? []} pending={pending === `answer:${question.id}`} onAnswer={answer => onAnswer(question, answer)} />
        ))}
      </div>
    </section>
  )
}

function QuestionCard({ question, deliveries, pending, onAnswer }: {
  question: UserQuestion
  deliveries: readonly TargetDelivery[]
  pending: boolean
  onAnswer: (answer: QuestionAnswer) => Promise<unknown>
}) {
  const [selected, setSelected] = useState<string[]>([])
  const [text, setText] = useState('')
  const [form, setForm] = useState<Record<string, string | boolean>>({})
  const presentation = question.presentation
  const submitChoices = (ids: string[]): void => { if (ids.length) void onAnswer({ kind: 'choices', optionIds: ids }) }

  return (
    <article className="question-card" aria-labelledby={`q-${question.id}`}>
      <header>
        <span className={`kind kind-${question.kind}`}>{questionKindLabel[question.kind]}</span>
        <h3 id={`q-${question.id}`}>{question.prompt}</h3>
      </header>
      <p className="targets">
        原生目标：{question.targets.map(target => `${target.nativeMethod} · ${target.id}`).join('；')}
        {question.expiresAt ? ` · 截止 ${new Date(question.expiresAt).toLocaleString('zh-CN', { hour12: false })}` : ''}
      </p>
      {presentation.kind === 'choices' && (
        <div className="options" role="group" aria-label="选项">
          {presentation.options.map(option => (
            <button
              key={option.id}
              type="button"
              className={selected.includes(option.id) ? 'option selected' : 'option'}
              aria-pressed={selected.includes(option.id)}
              disabled={pending}
              onClick={() => {
                const next = presentation.multiple
                  ? (selected.includes(option.id) ? selected.filter(id => id !== option.id) : [...selected, option.id])
                  : [option.id]
                setSelected(next)
                if (!presentation.multiple) submitChoices(next)
              }}
            >
              {option.label}
            </button>
          ))}
          {presentation.multiple && <button type="button" disabled={pending || !selected.length} onClick={() => submitChoices(selected)}>提交选择</button>}
        </div>
      )}
      {presentation.kind === 'review' && (
        <div className="options">
          {presentation.options.map(option => (
            <button key={option.id} type="button" className="option" disabled={pending} onClick={() => submitChoices([option.id])}>{option.label}</button>
          ))}
        </div>
      )}
      {presentation.kind === 'form' && (
        <form className="answer-form" onSubmit={event => {
          event.preventDefault()
          const values: Record<string, string | boolean | string[]> = {}
          for (const field of presentation.fields) {
            const value = form[field.id]
            if (value !== undefined) values[field.id] = value
          }
          void onAnswer({ kind: 'form', values })
        }}>
          {presentation.fields.map(field => (
            <label key={field.id}>
              <span>{field.label}{field.required ? '（必填）' : ''}</span>
              {field.kind === 'boolean'
                ? <input type="checkbox" checked={Boolean(form[field.id])} onChange={event => setForm(previous => ({ ...previous, [field.id]: event.target.checked }))} />
                : <input type="text" required={field.required} value={String(form[field.id] ?? '')} onChange={event => setForm(previous => ({ ...previous, [field.id]: event.target.value }))} />}
            </label>
          ))}
          <button type="submit" disabled={pending}>提交表单</button>
        </form>
      )}
      {presentation.kind === 'free_text' && (
        <form className="answer-form" onSubmit={event => {
          event.preventDefault()
          if (!text.trim()) return
          void onAnswer({ kind: 'free_text', text })
        }}>
          <label>
            <span>回答</span>
            <textarea rows={3} value={text} onChange={event => setText(event.target.value)} />
          </label>
          <button type="submit" disabled={pending || !text.trim()}>提交回答</button>
        </form>
      )}
      {presentation.kind === 'url_flow' && (
        <div className="url-flow">
          <p>{presentation.purpose}</p>
          <div className="options">
            <button type="button" disabled={pending} onClick={() => void onAnswer({ kind: 'url_action', action: 'open' })}>在原生中打开授权</button>
            <button type="button" className="quiet" disabled={pending} onClick={() => void onAnswer({ kind: 'url_action', action: 'cancel' })}>取消授权</button>
          </div>
        </div>
      )}
      {deliveries.length > 0 && (
        <ul className="deliveries" aria-label="逐 target 投递状态">
          {deliveries.map(delivery => (
            <li key={delivery.targetBindingId}>
              <code>{delivery.targetBindingId}</code>
              <span className={`delivery delivery-${delivery.status}`}>{deliveryLabel[delivery.status]}</span>
            </li>
          ))}
        </ul>
      )}
      {pending && <p className="pending-note">正在提交答案…</p>}
    </article>
  )
}

function WorkDetail({ work, verification, artifactReader, pending, onPause, onStop, onRetry, onContinue, onAccept }: {
  work: WorkView | undefined
  verification: VerificationDetail | undefined
  artifactReader: ((id: string) => Promise<{ contentType: string; text: string } | undefined>) | undefined
  pending: string | undefined
  onPause: (work: WorkView) => Promise<unknown>
  onStop: (work: WorkView) => Promise<unknown>
  onRetry: (assignment: AssignmentRef, token: string) => Promise<unknown>
  onContinue: (contract: ContractRef) => Promise<unknown>
  onAccept: (candidate: CandidateRef) => Promise<unknown>
}) {
  if (!work) {
    return (
      <section className="panel">
        <div className="section-head"><h2>工作详情</h2></div>
        <p className="empty">从左侧选择一个工作查看合同、验证与可用动作。</p>
      </section>
    )
  }
  const available = work.actions.available
  const stale = verification?.stale ?? false
  const failed = verification?.results.some(result => result.outcome === 'FAIL' || result.outcome === 'SKIPPED' || result.outcome === 'NOT_TESTED') ?? false
  return (
    <section className="panel" aria-label="工作详情">
      <div className="section-head"><h2>工作详情</h2><span className={`phase phase-${work.phase}`}>{phaseLabel[work.phase]}</span></div>
      <h3 className="detail-title">{work.work.title}</h3>
      <p className="context-line">
        合同 <code>{work.contract.workId}@{work.contract.revision}</code> · <code className="mono">{work.contract.digest.slice(0, 12)}…</code>
      </p>
      <p className={`resource resource-${work.resourceStatus}`}>{resourceLabel[work.resourceStatus]}{work.resourceStatus === 'indeterminate' ? '（不能视为已停止）' : ''}</p>
      <p className="goal">{work.contract.goal}</p>
      <h4>完成标准</h4>
      <ul className="criteria">
        {work.contract.criteria.map((criterion: Criterion) => (
          <li key={criterion.id}>
            <span>{criterion.description}</span>
            <span className="mini">{criterion.kind === 'machine' ? '机器检查' : '人工验收'}{criterion.required ? ' · 必需' : ''}</span>
          </li>
        ))}
      </ul>
      <h4>验证结果</h4>
      {!work.actions.currentVerificationId && <p className="empty">还没有当前候选的验证。</p>}
      {work.actions.currentVerificationId && (
        <div className={`verification${stale ? ' stale' : ''}`}>
          <p className="context-line">验证 <code>{work.actions.currentVerificationId}</code>{stale ? ' · 已过期' : ''}</p>
          {verification ? (
            <ul className="results">
              {verification.results.map(result => (
                <li key={result.criterionId}>
                  <span>{result.criterionId}</span>
                  <span className={`outcome outcome-${result.outcome}`}>{outcomeLabel[result.outcome]}</span>
                  <span className="mini">{result.evidenceRefs.join(', ') || '无证据引用'}</span>
                </li>
              ))}
            </ul>
          ) : <p className="empty">验证详情尚未从产品路由读取（fixture 场景可见）。</p>}
          {verification?.note && <p className="note">{verification.note}</p>}
          {stale && <p className="warn-text" role="alert">该候选已过期，不能接受为完成结果。</p>}
        </div>
      )}
      <h4>当前候选产物</h4>
      <Artifacts ids={work.artifactIds} reader={artifactReader} />
      <h4>可用动作</h4>
      <div className="actions">
        {available.includes('accept_candidate') && work.actions.currentCandidate && (
          <button
            type="button"
            disabled={pending === 'accept' || stale || failed}
            title={stale ? '候选已过期，不能接受' : failed ? '存在未通过的必需检查，人工接受不能覆盖' : undefined}
            onClick={() => void onAccept(work.actions.currentCandidate!)}
          >接受当前候选</button>
        )}
        {(available.includes('pause_dispatch') || available.includes('resume_dispatch')) && (
          <button type="button" className="quiet" disabled={pending === 'dispatch'} onClick={() => void onPause(work)}>
            {work.actions.dispatchHold.paused ? '恢复派工' : '暂停派工'}
          </button>
        )}
        {available.includes('retry_assignment') && work.actions.currentAssignment && work.actions.retryActionToken && (
          <button type="button" className="quiet" disabled={pending === 'retry'} onClick={() => void onRetry(work.actions.currentAssignment!, work.actions.retryActionToken!)}>重试当前执行</button>
        )}
        {available.includes('continue_work') && (
          <button type="button" className="quiet" disabled={pending === 'continue'} onClick={() => void onContinue(work.contract)}>继续工作</button>
        )}
        {available.includes('stop_work') && (
          <button type="button" className="danger" disabled={pending === 'stop'} onClick={() => void onStop(work)}>停止工作</button>
        )}
        {available.length === 0 && <p className="empty">后端当前没有为这个工作提供可用动作。</p>}
      </div>
      <p className="context-line hold">派工控制 revision {work.actions.dispatchHold.revision} · {work.actions.dispatchHold.paused ? '已暂停' : '未暂停'}</p>
    </section>
  )
}
