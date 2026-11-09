/**
 * The console app shell: main conversation, conversation-scoped works, concentrated questions,
 * dispatch controls, verification and current-candidate acceptance. Everything displayed comes from
 * the backend snapshot and `actions.available`; the UI never infers a phase or invents an action.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ConversationMessageSchema, IdSchema } from '@personal-agent/contracts'
import {
  ArrowUp,
  Bot,
  Check,
  ChevronRight,
  CircleHelp,
  Copy,
  Download,
  Folder,
  ListTodo,
  MessageSquare,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  RefreshCw,
  Settings2,
  Sparkles,
  X,
} from 'lucide-react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type {
  ApplicationConfiguration,
  AssistantProviderStatus,
  AssistantStreamUpdate,
  AssignmentRef,
  CandidateRef,
  CommandReceipt,
  ConfiguredProjectView,
  ContractRef,
  ConversationMessage,
  Criterion,
  QuestionAnswer,
  Snapshot,
  UserCommand,
  UserQuestion,
  WorkView,
} from '@personal-agent/contracts'
import type { ConsoleTransport, ExecutorSnapshot, TargetDelivery, VerificationDetail } from './transport.ts'
import { TransportError } from './transport.ts'
import type { FixtureAdapter } from './fixture.ts'
import { conversationId as defaultConversationId } from './config.ts'
const phaseLabel: Record<WorkView['phase'], string> = {
  evaluating: '评估中',
  queued: '已排队',
  working: '执行中',
  needs_user: '待你决定',
  verifying: '验证中',
  switching: '切换中',
  stopping: '停止中',
  delivered: '已交付',
  ended: '已结束',
  uncertain: '状态不确定',
}
const resourceLabel: Record<WorkView['resourceStatus'], string> = {
  quiescent: '写者已静止',
  active: '写者活动',
  indeterminate: '写者状态未知',
}
const deliveryLabel: Record<TargetDelivery['status'], string> = {
  local_recorded: '本地已记录（尚未写到原生）',
  response_written: '已写入原生响应',
  native_applied: '原生已应用',
  indeterminate: '投递结果未知',
  expired: '已过期',
}
const outcomeLabel: Record<VerificationDetail['results'][number]['outcome'], string> = {
  PASS: '通过',
  FAIL: '未通过',
  SKIPPED: '跳过',
  NOT_TESTED: '未测试',
  NOT_APPLICABLE: '不适用',
}
const questionKindLabel: Record<UserQuestion['kind'], string> = {
  clarification: '澄清',
  permission: '权限',
  authentication: '认证',
  review: '验收',
}
const newId = (prefix: string): string => `${prefix}-${crypto.randomUUID()}`
const taskTemplates = [
  {
    title: '拆解开发需求',
    text: '我要开发：\n目标用户：\n必须具备的功能：\n技术约束：\n\n请给出第一版范围、可独立验收的任务、依赖顺序和主要风险。',
  },
  {
    title: '分析代码或报错',
    text: '我遇到的问题：\n预期行为：\n实际行为：\n相关代码或报错：\n\n请先定位可能原因，再给出最小修改和验证步骤。不确定的地方请明确说明。',
  },
  {
    title: '生成 Agent 任务单',
    text: '需要实现的需求或已有计划：\n代码仓库与技术栈：\n可用的 Agent 数量：\n\n请生成可直接交给编码 Agent 的任务单，每份包含目标、输入、负责路径、实施步骤、接口约束、验收命令及交付内容，并明确任务依赖。',
  },
]
const contractRef = (contract: WorkView['contract']): ContractRef => ({
  workId: contract.workId,
  revision: contract.revision,
  digest: contract.digest,
})

interface Problem {
  code: string
  message: string
  retry: 'safe' | 'reconcile' | 'user_action' | 'none'
  context?: 'question' | 'candidate' | 'work'
}

const problemOf = (error: unknown): Problem => {
  if (error instanceof TransportError) return { code: error.code, message: error.message, retry: error.retry }
  return { code: 'storage_unavailable', message: String(error), retry: 'safe' }
}

export function App({ transport }: { transport: ConsoleTransport }) {
  const [conversationId, setConversationId] = useState(() => {
    const query = new URLSearchParams(window.location.search).get('conversation')
    return query && IdSchema.safeParse(query).success ? query : defaultConversationId
  })
  const [inspectorOpen, setInspectorOpen] = useState(false)
  const [modelPanelOpen, setModelPanelOpen] = useState(false)
  const [workspaceOpen, setWorkspaceOpen] = useState(false)
  const [assistant, setAssistant] = useState<AssistantProviderStatus | undefined>()
  const [waitingAfter, setWaitingAfter] = useState<number | undefined>()
  const [streamReplies, setStreamReplies] = useState<readonly AssistantStreamUpdate[]>([])
  const fixture =
    typeof (transport as FixtureAdapter).setModelOffline === 'function' ? (transport as FixtureAdapter) : undefined
  const [snapshot, setSnapshot] = useState<Snapshot | undefined>(undefined)
  const [loading, setLoading] = useState(true)
  const [connection, setConnection] = useState<'connecting' | 'live' | 'reconnecting' | 'offline' | 'expired'>(
    'connecting',
  )
  const [problem, setProblem] = useState<Problem | undefined>(undefined)
  const [notice, setNotice] = useState<string | undefined>(undefined)
  const [pending, setPending] = useState<string | undefined>(undefined)
  const [selectedWorkId, setSelectedWorkId] = useState<string | undefined>(undefined)
  const [projectFilter, setProjectFilter] = useState<string | undefined>(undefined)
  const [offline, setOffline] = useState<boolean>(() => fixture?.modelOffline() ?? false)
  const [createOpen, setCreateOpen] = useState(false)
  const [auth, setAuth] = useState<'checking' | 'required' | 'ready'>(transport.session ? 'checking' : 'ready')
  const [configuration, setConfiguration] = useState<ApplicationConfiguration | undefined>(undefined)
  const [configState, setConfigState] = useState<'loading' | 'ready' | 'unavailable' | 'failed'>(
    transport.configuration ? 'loading' : 'unavailable',
  )
  const [configProblem, setConfigProblem] = useState<Problem | undefined>(undefined)
  const [verification, setVerification] = useState<VerificationDetail | undefined>(undefined)
  const [deliveries, setDeliveries] = useState<Record<string, readonly TargetDelivery[]>>({})
  const lastSeq = useRef(0)
  const conversationRef = useRef(conversationId)
  conversationRef.current = conversationId
  const detailRef = useRef<HTMLElement | null>(null)
  const seen = useRef(new Set<number>())
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const refreshConfiguration = useCallback(async (): Promise<void> => {
    if (!transport.configuration) {
      setConfigState('unavailable')
      setConfigProblem({
        code: 'unsupported_capability',
        message: '该入口未提供应用配置读取，不能新建委托；已有工作仍可继续查询、回答和停止。',
        retry: 'user_action',
      })
      return
    }
    setConfigState((previous) => (previous === 'ready' ? 'ready' : 'loading'))
    try {
      const next = await transport.configuration()
      if (!next) {
        setConfigState('unavailable')
        setConfigProblem({
          code: 'unsupported_capability',
          message: '该入口未提供应用配置读取，不能新建委托；已有工作仍可继续查询、回答和停止。',
          retry: 'user_action',
        })
        return
      }
      setConfiguration(next)
      setConfigState('ready')
      setConfigProblem(undefined)
    } catch (error) {
      setConfigState('failed')
      setConfigProblem(problemOf(error))
    }
  }, [transport])

  useEffect(() => {
    if (auth === 'ready') void refreshConfiguration()
  }, [auth, refreshConfiguration])

  const refresh = useCallback(
    async (query: { workId?: string } = {}): Promise<void> => {
      try {
        const next = await transport.snapshot({
          conversationId,
          limit: 100,
          ...(query.workId ? { workId: query.workId } : {}),
        })
        if (conversationRef.current !== conversationId) return
        setSnapshot(next)
        lastSeq.current = Math.max(lastSeq.current, next.cursor)
        setConnection('live')
        setProblem(undefined)
        setLoading(false)
        if (transport.deliveries) {
          const entries = await Promise.all(
            next.questions.map(async (question) => [question.id, await transport.deliveries!(question.id)] as const),
          )
          setDeliveries(Object.fromEntries(entries))
        }
      } catch (error) {
        const failure = problemOf(error)
        if (failure.code === 'auth_required') setAuth('required')
        setProblem(failure)
        setLoading(false)
      }
    },
    [transport, conversationId],
  )

  const refreshAssistant = useCallback(async () => {
    if (transport.assistant) {
      try {
        setAssistant(await transport.assistant())
      } catch {
        /* Main transport errors remain visible. */
      }
    }
  }, [transport])
  useEffect(() => {
    setStreamReplies([])
    if (auth !== 'ready' || !assistant?.configured || !transport.assistantChanges) return
    const controller = new AbortController()
    void (async () => {
      try {
        for await (const update of transport.assistantChanges!(conversationId, controller.signal)) {
          if (controller.signal.aborted || conversationRef.current !== conversationId) break
          setStreamReplies((previous) => [
            ...previous.filter((reply) => reply.messageId !== update.messageId).slice(-63),
            update,
          ])
          if (update.phase !== 'streaming') {
            if (refreshTimer.current) clearTimeout(refreshTimer.current)
            refreshTimer.current = setTimeout(() => {
              void refresh()
            }, 40)
          }
        }
      } catch {
        /* Reopen/refresh still reads the durable conversation through the main transport. */
      }
    })()
    return () => controller.abort()
  }, [auth, assistant?.configured, conversationId, transport, refresh])
  useEffect(() => {
    if (auth === 'ready') void refreshAssistant()
  }, [auth, snapshot?.cursor, refreshAssistant])
  useEffect(() => {
    if (
      waitingAfter !== undefined &&
      snapshot?.conversation?.messages.some(
        (message) =>
          message.sequence > waitingAfter && ['reasoner_reply', 'application_notice'].includes(message.provenance),
      )
    )
      setWaitingAfter(undefined)
  }, [snapshot, waitingAfter])
  const newConversation = () => {
    const id = `conversation-${crypto.randomUUID()}`
    const url = new URL(window.location.href)
    url.searchParams.set('conversation', id)
    window.history.pushState(null, '', url)
    setConversationId(id)
    setSelectedWorkId(undefined)
    setSnapshot(undefined)
    setWaitingAfter(undefined)
    setInspectorOpen(false)
    setModelPanelOpen(false)
    setWorkspaceOpen(false)
    setLoading(true)
  }
  useEffect(() => {
    const restore = () => {
      const id = new URLSearchParams(window.location.search).get('conversation')
      setConversationId(id && IdSchema.safeParse(id).success ? id : defaultConversationId)
      setSelectedWorkId(undefined)
      setSnapshot(undefined)
      setWaitingAfter(undefined)
      setLoading(true)
    }
    window.addEventListener('popstate', restore)
    return () => window.removeEventListener('popstate', restore)
  }, [])

  useEffect(() => {
    if (!transport.session) return
    let cancelled = false
    void transport
      .session()
      .then((authenticated) => {
        if (!cancelled) setAuth(authenticated ? 'ready' : 'required')
      })
      .catch(() => {
        if (!cancelled) setAuth('required')
      })
    return () => {
      cancelled = true
    }
  }, [transport])

  const scheduleRefresh = useCallback((): void => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current)
    refreshTimer.current = setTimeout(() => {
      void refresh()
    }, 40)
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
          await new Promise((resolve) => setTimeout(resolve, Math.min(2000, 300 * failures)))
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
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') void refresh()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [refresh])

  const appendMessage = (message: ConversationMessage): void => {
    setSnapshot((previous) => {
      if (!previous?.conversation) return previous
      if (previous.conversation.messages.some((item) => item.id === message.id)) return previous
      const messages = [...previous.conversation.messages, message].sort((a, b) => a.sequence - b.sequence)
      return {
        ...previous,
        conversation: { ...previous.conversation, messages },
      }
    })
  }

  const send = useCallback(
    async (command: UserCommand, label: string): Promise<CommandReceipt | undefined> => {
      setPending(label)
      setProblem(undefined)
      try {
        const receipt = await transport.dispatch(command)
        if (receipt.status === 'rejected') {
          setProblem({
            code: receipt.error.code,
            message: receipt.error.message,
            retry: receipt.error.retry,
            ...(command.kind === 'answer_question' ? { context: 'question' as const } : {}),
            ...(command.kind === 'accept_candidate' ? { context: 'candidate' as const } : {}),
          })
        } else {
          const reference = command.kind === 'answer_question' ? command.questionId : undefined
          if (reference && transport.deliveries) {
            const targets = await transport.deliveries(reference)
            setDeliveries((previous) => ({
              ...previous,
              [reference]: targets,
            }))
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
    },
    [transport, scheduleRefresh],
  )

  // Load verification detail for the selected work whenever selection or snapshot changes.
  useEffect(() => {
    let cancelled = false
    const id = snapshot?.works.find((work) => work.work.id === selectedWorkId)?.actions.currentVerificationId
    if (!id || !transport.verification) {
      setVerification(undefined)
      return
    }
    void transport
      .verification(id)
      .then((detail) => {
        if (!cancelled) setVerification(detail)
      })
      .catch(() => {
        if (!cancelled) setVerification(undefined)
      })
    return () => {
      cancelled = true
    }
  }, [selectedWorkId, snapshot, transport])

  useEffect(() => {
    detailRef.current?.scrollTo({ top: 0 })
  }, [selectedWorkId])

  const works = useMemo(
    () => (snapshot?.works ?? []).filter((work) => !projectFilter || work.work.projectId === projectFilter),
    [snapshot, projectFilter],
  )
  const projects = useMemo(() => [...new Set((snapshot?.works ?? []).map((work) => work.work.projectId))], [snapshot])
  const selectedWork =
    works.find((work) => work.work.id === selectedWorkId) ??
    (snapshot?.works ?? []).find((work) => work.work.id === selectedWorkId)
  const openQuestions = snapshot?.questions ?? []

  return (
    <div
      className={`app${inspectorOpen || modelPanelOpen ? ' inspector-open' : ''}${workspaceOpen ? ' workspace-open' : ''}`}
    >
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            <Bot size={22} />
          </span>
          <h1>个人 Agent 工作台</h1>
        </div>
        <div className="status-cluster" aria-live="polite">
          {assistant?.configured && (
            <button
              type="button"
              className="model-switch"
              onClick={() => setModelPanelOpen(!modelPanelOpen)}
              title="模型设置"
            >
              <Sparkles size={15} />
              <span>{assistant.model}</span>
              <ChevronRight size={13} />
            </button>
          )}
          <span className={`badge status-${connection}`}>
            {connection === 'live'
              ? '实时连接'
              : connection === 'expired'
                ? '游标已过期'
                : connection === 'offline'
                  ? '连接中断'
                  : '连接中'}
          </span>
          {offline && <span className="badge warn">模型离线</span>}
          <button
            type="button"
            className="icon-button mobile-only"
            onClick={newConversation}
            title="新对话"
            aria-label="新对话"
          >
            <Plus size={18} />
          </button>
          <button
            type="button"
            className="icon-button mobile-only"
            onClick={() => setWorkspaceOpen(!workspaceOpen)}
            title="工作空间"
            aria-label="工作空间"
          >
            <Folder size={18} />
          </button>
          <a className="icon-button" href="/v1/guide" title="使用指南" aria-label="使用指南">
            <CircleHelp size={18} />
          </a>
          <button
            type="button"
            className="icon-button secondary-tool"
            onClick={() => {
              void refresh()
              void refreshAssistant()
            }}
            title="刷新快照"
            aria-label="刷新快照"
          >
            <RefreshCw size={17} />
          </button>
          <button
            type="button"
            className="icon-button"
            onClick={() => setModelPanelOpen(!modelPanelOpen)}
            title="模型设置"
            aria-label="模型设置"
          >
            <Settings2 size={18} />
          </button>
          <button
            type="button"
            className="icon-button"
            onClick={() => {
              const open = inspectorOpen || modelPanelOpen
              setInspectorOpen(!open)
              setModelPanelOpen(false)
            }}
            title="工作详情"
            aria-label="工作详情"
          >
            {inspectorOpen || modelPanelOpen ? <PanelRightClose size={18} /> : <PanelRightOpen size={18} />}
          </button>
          {fixture && (
            <span className="fixture-controls" role="group" aria-label="fixture 控制">
              <button
                type="button"
                className="quiet"
                onClick={() => {
                  fixture.disconnect()
                }}
              >
                模拟断线
              </button>
              <button
                type="button"
                className="quiet"
                onClick={() => {
                  fixture.expireCursor()
                  fixture.disconnect()
                }}
              >
                使游标过期
              </button>
              <button
                type="button"
                className="quiet"
                aria-pressed={offline}
                onClick={() => {
                  fixture.setModelOffline(!offline)
                  setOffline(!offline)
                }}
              >
                {offline ? '恢复模型' : '模拟模型离线'}
              </button>
            </span>
          )}
        </div>
      </header>

      {notice && (
        <div className="notice" role="status">
          <span>{notice}</span>
          <button type="button" className="quiet" onClick={() => setNotice(undefined)}>
            关闭
          </button>
        </div>
      )}
      {problem && auth === 'ready' && (
        <ErrorPanel problem={problem} onRefresh={() => void refresh()} onDismiss={() => setProblem(undefined)} />
      )}
      {auth !== 'ready' && (
        <SessionGate
          checking={auth === 'checking'}
          bootstrap={transport.bootstrap ? (token) => transport.bootstrap!(token) : undefined}
          onAuthenticated={() => {
            setAuth('ready')
            setProblem(undefined)
          }}
        />
      )}

      {auth === 'ready' && (
        <main className="layout">
          <aside className="sidebar" aria-label="工作列表">
            <button type="button" className="new-conversation" onClick={newConversation}>
              <Plus size={17} />
              <span>新对话</span>
            </button>
            <div className="sidebar-current">
              <MessageSquare size={16} />
              <span>主对话</span>
            </div>
            <div className="section-head">
              <h2>工作空间</h2>
              <span className="count">{works.length}</span>
              <button
                type="button"
                className="icon-button"
                onClick={() => setCreateOpen(!createOpen)}
                title="新建委托"
                aria-label="新建委托"
              >
                <Plus size={17} />
              </button>
            </div>
            <div className="project-filter" role="group" aria-label="按项目筛选">
              <button
                type="button"
                className={!projectFilter ? 'chip active' : 'chip'}
                aria-pressed={!projectFilter}
                onClick={() => setProjectFilter(undefined)}
              >
                全部
              </button>
              {projects.map((project) => (
                <button
                  key={project}
                  type="button"
                  className={projectFilter === project ? 'chip active' : 'chip'}
                  aria-pressed={projectFilter === project}
                  onClick={() => setProjectFilter(project)}
                >
                  {configuration?.projects.find((item) => item.id === project)?.displayName ?? project}
                </button>
              ))}
            </div>
            {createOpen && (
              <NewWorkForm
                configuration={configuration}
                state={configState}
                problem={configProblem}
                pending={pending === 'create_work'}
                onReload={() => void refreshConfiguration()}
                onCancel={() => setCreateOpen(false)}
                onCreate={async (goal, project: ConfiguredProjectView, profileId) => {
                  if (!project.dispatchAllowed) return
                  const receipt = await send(
                    {
                      commandId: newId('cmd-work'),
                      conversationId,
                      kind: 'create_work',
                      projectId: project.id,
                      goal,
                      scope: project.scope,
                      criteria: project.defaultCriteria,
                      profileId,
                    },
                    'create_work',
                  )
                  if (receipt?.status === 'recorded' && receipt.workId) {
                    setCreateOpen(false)
                    setSelectedWorkId(receipt.workId)
                    setInspectorOpen(true)
                    setModelPanelOpen(false)
                    setWorkspaceOpen(false)
                  }
                }}
              />
            )}
            <ul className="work-list">
              {works.map((work) => (
                <li key={work.work.id}>
                  <button
                    type="button"
                    className={`work-card${selectedWorkId === work.work.id ? ' selected' : ''}`}
                    aria-current={selectedWorkId === work.work.id ? 'true' : undefined}
                    onClick={() => {
                      setSelectedWorkId(work.work.id)
                      setProjectFilter(undefined)
                      setInspectorOpen(true)
                      setModelPanelOpen(false)
                      setWorkspaceOpen(false)
                    }}
                  >
                    <span className={`work-icon phase-icon-${work.phase}`} aria-hidden="true">
                      {work.phase === 'delivered' ? <Check size={16} /> : <Folder size={16} />}
                    </span>
                    <span className="work-title">{work.work.title}</span>
                    <span className="work-meta">
                      <span className={`phase phase-${work.phase}`}>{phaseLabel[work.phase]}</span>
                      {work.actions.dispatchHold.paused && <span className="mini warn">派工暂停</span>}
                      {work.openQuestionIds.length > 0 && (
                        <span className="mini">{work.openQuestionIds.length} 个待决定</span>
                      )}
                      {work.resourceStatus === 'indeterminate' && <span className="mini warn">写者未知</span>}
                    </span>
                  </button>
                </li>
              ))}
              {!loading && works.length === 0 && <li className="empty">该项目还没有工作。</li>}
            </ul>
            {loading && <p className="empty">正在载入…</p>}
            <div className="sidebar-footer">
              <span className="avatar-mark">本</span>
              <span>
                <strong>本地工作区</strong>
                <small>{assistant?.configured ? '模型对话已配置' : '模型未配置'}</small>
              </span>
              <span className="local-dot" />
            </div>
          </aside>

          <section className="conversation" aria-label="主对话">
            <Conversation
              key={conversationId}
              snapshot={snapshot}
              projectFilter={projectFilter}
              selectedWork={selectedWork}
              pending={pending === 'chat'}
              offline={offline}
              assistant={assistant}
              waiting={waitingAfter !== undefined}
              streamReplies={streamReplies}
              onSend={async (text, useWorkContext) => {
                const command: UserCommand = {
                  commandId: newId('cmd-chat'),
                  conversationId,
                  kind: 'chat',
                  text,
                  projectId:
                    useWorkContext && selectedWork
                      ? selectedWork.work.projectId
                      : (projectFilter ?? configuration?.projects[0]?.id ?? 'project-atlas'),
                  ...(useWorkContext && selectedWork ? { anchor: { workId: selectedWork.work.id } } : {}),
                }
                const receipt = await send(command, 'chat')
                if (
                  conversationRef.current === conversationId &&
                  receipt?.status === 'recorded' &&
                  assistant?.configured &&
                  !useWorkContext
                )
                  setWaitingAfter(snapshot?.conversation?.messages.at(-1)?.sequence ?? 0)
                return receipt?.status === 'recorded'
              }}
              onLoadOlder={async (before) => {
                const page = await transport.messages(conversationId, {
                  before,
                  limit: 100,
                })
                if (conversationRef.current !== conversationId) return
                setSnapshot((previous) =>
                  previous?.conversation
                    ? {
                        ...previous,
                        conversation: {
                          ...previous.conversation,
                          messages: [...page.messages, ...previous.conversation.messages]
                            .filter((item, index, all) => all.findIndex((other) => other.id === item.id) === index)
                            .sort((a, b) => a.sequence - b.sequence),
                          hasMore: page.hasMore,
                        },
                      }
                    : previous,
                )
              }}
            />
          </section>

          <aside className="detail" aria-label="决定与工作详情" ref={detailRef}>
            {modelPanelOpen && (
              <ModelPanel
                status={assistant}
                onClose={() => setModelPanelOpen(false)}
                onSelect={async (model) => {
                  if (transport.selectModel) setAssistant(await transport.selectModel(model))
                }}
              />
            )}
            <div className="work-panels" hidden={modelPanelOpen}>
              <WorkDetail
                work={selectedWork}
                verification={verification}
                artifactReader={transport.artifact ? (id) => transport.artifact!(id) : undefined}
                pending={pending}
                onPause={async (work) => {
                  const command: UserCommand = {
                    commandId: newId('cmd-pause'),
                    conversationId,
                    kind: work.actions.dispatchHold.paused ? 'resume_dispatch' : 'pause_dispatch',
                    expected: contractRef(work.contract),
                    expectedHoldRevision: work.actions.dispatchHold.revision,
                  }
                  await send(command, 'dispatch')
                }}
                onStop={async (work) => {
                  await send(
                    {
                      commandId: newId('cmd-stop'),
                      conversationId,
                      kind: 'stop_work',
                      workId: work.work.id,
                    },
                    'stop',
                  )
                }}
                onRetry={async (assignment: AssignmentRef, token: string) => {
                  await send(
                    {
                      commandId: newId('cmd-retry'),
                      conversationId,
                      kind: 'retry_assignment',
                      expected: assignment,
                      actionToken: token,
                    },
                    'retry',
                  )
                }}
                onContinue={async (contract: ContractRef) => {
                  await send(
                    {
                      commandId: newId('cmd-continue'),
                      conversationId,
                      kind: 'continue_work',
                      expected: contract,
                    },
                    'continue',
                  )
                }}
                onAccept={async (candidate: CandidateRef) => {
                  await send(
                    {
                      commandId: newId('cmd-accept'),
                      conversationId,
                      kind: 'accept_candidate',
                      candidate,
                    },
                    'accept',
                  )
                }}
                onRevise={async (work, goal) => {
                  const receipt = await send(
                    {
                      commandId: newId('cmd-revise'),
                      conversationId,
                      kind: 'revise_work',
                      expected: contractRef(work.contract),
                      goal,
                      scope: work.contract.scope,
                      criteria: work.contract.criteria,
                    },
                    'revise',
                  )
                  return receipt?.status === 'recorded'
                }}
              />
              {fixture && <ExecutorPanel transport={transport} />}
              <Questions
                questions={openQuestions}
                deliveries={deliveries}
                pending={pending}
                onAnswer={async (question, answer) => {
                  const command: UserCommand = {
                    commandId: newId('cmd-answer'),
                    conversationId,
                    kind: 'answer_question',
                    questionId: question.id,
                    expectedVersion: question.version,
                    answer,
                  }
                  await send(command, `answer:${question.id}`)
                }}
              />
            </div>
          </aside>
        </main>
      )}
    </div>
  )
}

function ModelPanel({
  status,
  onClose,
  onSelect,
}: {
  status: AssistantProviderStatus | undefined
  onClose: () => void
  onSelect: (model: string) => Promise<void>
}) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | undefined>()
  return (
    <section className="model-panel" aria-label="模型设置">
      <div className="section-head">
        <h2>
          <Sparkles size={17} />
          模型连接
        </h2>
        <button className="icon-button" type="button" onClick={onClose} aria-label="关闭模型设置" title="关闭">
          <X size={16} />
        </button>
      </div>
      <div className="provider-state">
        <span className={`state-dot ${status?.state ?? ''}`} />
        <span>
          {!status?.configured
            ? '未配置'
            : status.state === 'responding'
              ? '正在回复'
              : status.state === 'error'
                ? '连接异常'
                : status.state === 'available'
                  ? '连接正常'
                  : '已配置'}
        </span>
      </div>
      <label className="field-label" htmlFor="model-choice">
        当前模型
      </label>
      <select
        id="model-choice"
        value={status?.model ?? ''}
        disabled={!status?.configured || pending || status.state === 'responding'}
        onChange={async (event) => {
          setPending(true)
          setError(undefined)
          try {
            await onSelect(event.target.value)
          } catch {
            setError('切换失败，请稍后重试。')
          } finally {
            setPending(false)
          }
        }}
      >
        {status?.models.map((model) => (
          <option key={model} value={model}>
            {model}
          </option>
        ))}
      </select>
      <dl className="provider-facts">
        <dt>服务地址</dt>
        <dd>{status?.baseURL ?? '未配置'}</dd>
        <dt>API Key</dt>
        <dd>{status?.configured ? '已在本机配置' : '未配置'}</dd>
        <dt>传输</dt>
        <dd>{status?.secureTransport ? 'HTTPS' : 'HTTP'}</dd>
      </dl>
      {error && (
        <p role="alert" className="warn-text">
          {error}
        </p>
      )}
    </section>
  )
}

function SessionGate({
  checking,
  bootstrap,
  onAuthenticated,
}: {
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
          <form
            onSubmit={async (event) => {
              event.preventDefault()
              setPending(true)
              try {
                setFailure(undefined)
                await bootstrap(token.trim())
                onAuthenticated()
              } catch (error) {
                setFailure(problemOf(error).message)
              } finally {
                setPending(false)
              }
            }}
          >
            <label htmlFor="bootstrap-token">Bootstrap token（本地私钥文件，不会写入浏览器存储）</label>
            <input
              id="bootstrap-token"
              type="password"
              autoComplete="off"
              required
              value={token}
              onChange={(event) => setToken(event.target.value)}
            />
            {failure && (
              <p className="warn-text" role="alert">
                {failure}
              </p>
            )}
            <div className="actions">
              <button type="submit" disabled={pending || !token.trim()}>
                {pending ? '连接中…' : '建立本地会话'}
              </button>
            </div>
            <p className="note">
              令牌来自本地 demo 的 <code>bootstrap.key</code>；后端生成 TrustedActor，浏览器不发送角色或 actor 字段。
            </p>
          </form>
        )}
      </div>
    </section>
  )
}

function Artifacts({
  ids,
  reader,
}: {
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
              {reader && (
                <button
                  type="button"
                  className="quiet"
                  onClick={async () => {
                    setFailure(undefined)
                    try {
                      const value = await reader(id)
                      if (!value) setFailure('该产物没有已接线的读取入口。')
                      else
                        setPreview({
                          id,
                          text: value.text,
                          contentType: value.contentType,
                        })
                    } catch (error) {
                      setFailure(String((error as Error).message ?? error))
                    }
                  }}
                >
                  查看
                </button>
              )}
              <a href={`/v1/artifacts/${encodeURIComponent(id)}`} target="_blank" rel="noreferrer">
                下载
              </a>
            </span>
          </li>
        ))}
      </ul>
      {failure && (
        <p className="warn-text" role="alert">
          {failure}
        </p>
      )}
      {preview && (
        <div className="artifact-preview">
          <p className="context-line">
            产物 <code>{preview.id}</code> · {preview.contentType}
          </p>
          <pre className="artifact-text">
            {preview.text.length > 8000 ? `${preview.text.slice(0, 8000)}\n…` : preview.text}
          </pre>
          <button type="button" className="quiet" onClick={() => setPreview(undefined)}>
            关闭预览
          </button>
        </div>
      )}
    </div>
  )
}

const blockedLabel = (reason?: string): string => {
  if (reason === 'stale_contract') return '项目授权已过期'
  if (reason === 'unsupported_capability') return '执行器不可调度'
  if (reason === 'auth_required') return '需要重新认证'
  if (reason === 'budget_exceeded') return '预算或会话受限'
  return reason ? `暂不可调度（${reason}）` : '暂不可调度'
}

function NewWorkForm({
  configuration,
  state,
  problem,
  pending,
  onReload,
  onCreate,
  onCancel,
}: {
  configuration: ApplicationConfiguration | undefined
  state: 'loading' | 'ready' | 'unavailable' | 'failed'
  problem: Problem | undefined
  pending: boolean
  onReload: () => void
  onCreate: (goal: string, project: ConfiguredProjectView, profileId: string) => Promise<unknown>
  onCancel: () => void
}) {
  const [goal, setGoal] = useState('')
  const [projectChoice, setProjectChoice] = useState('')
  const [profileChoice, setProfileChoice] = useState('')
  const projects = configuration?.projects ?? []
  const project =
    projects.find((item) => item.id === projectChoice) ?? projects.find((item) => item.dispatchAllowed) ?? projects[0]
  const profiles = (configuration?.profiles ?? []).filter(
    (profile) => profile.dispatchAllowed && project?.profileIds.includes(profile.id),
  )
  const profile =
    profiles.find((item) => item.id === profileChoice) ??
    profiles.find((item) => item.id === project?.defaultProfileId) ??
    profiles[0]
  const usable = state === 'ready' && project?.dispatchAllowed === true && profile !== undefined && !pending
  return (
    <form
      className="new-work"
      onSubmit={async (event) => {
        event.preventDefault()
        if (!usable || !project || !profile || !goal.trim()) return
        await onCreate(goal.trim(), project, profile.id)
      }}
    >
      <div className="config-line">
        <span>应用配置</span>
        {state === 'ready' && configuration ? (
          <span className="mini">revision {configuration.revision.slice(0, 10)}…</span>
        ) : (
          <span className="mini warn">{state === 'loading' ? '读取中' : '不可用'}</span>
        )}
        <button type="button" className="quiet" onClick={onReload}>
          刷新配置
        </button>
      </div>
      {state === 'loading' && <p className="empty">正在读取项目、Profile 与检查配置…</p>}
      {state !== 'loading' && state !== 'ready' && problem && (
        <p className="warn-text" role="alert">
          {problem.message}
          <button type="button" className="quiet" onClick={onReload}>
            重试
          </button>
        </p>
      )}
      {state === 'ready' && project && !project.dispatchAllowed && (
        <p className="warn-text" role="alert">
          新委托已禁用：{blockedLabel(project.blockedReason)}
          。查询、回答和停止仍可用。
        </p>
      )}
      <label>
        <span>目标</span>
        <textarea rows={3} required value={goal} onChange={(event) => setGoal(event.target.value)} />
      </label>
      <label>
        <span>项目</span>
        <select
          value={project?.id ?? ''}
          disabled={!configuration || !projects.length}
          onChange={(event) => {
            setProjectChoice(event.target.value)
            setProfileChoice('')
          }}
        >
          {projects.map((item) => (
            <option key={item.id} value={item.id}>
              {item.displayName}
              {item.dispatchAllowed ? '' : '（不可调度）'}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>执行器 Profile</span>
        <select
          value={profile?.id ?? ''}
          disabled={!profiles.length}
          onChange={(event) => setProfileChoice(event.target.value)}
        >
          {profiles.map((item) => (
            <option key={item.id} value={item.id} title={`${item.displayName} (${item.id})`}>
              {item.displayName}
            </option>
          ))}
        </select>
      </label>
      {project && (
        <div className="config-summary">
          <p>
            <span>允许路径</span>
            <code>{project.scope.allowedPaths.join(', ') || '—'}</code>
          </p>
          <p>
            <span>初始标准</span>
            {project.defaultCriteria
              .map(
                (criterion) =>
                  `${criterion.description}（${criterion.kind === 'machine' ? '机器' : '人工'}${criterion.required ? ' · 必需' : ''}）`,
              )
              .join('；')}
          </p>
        </div>
      )}
      <div className="actions">
        <button type="submit" disabled={!usable || !goal.trim()}>
          {pending ? '创建中…' : '创建委托'}
        </button>
        <button type="button" className="quiet" onClick={onCancel}>
          取消
        </button>
      </div>
    </form>
  )
}

function ExecutorPanel({ transport }: { transport: ConsoleTransport }) {
  const [items, setItems] = useState<readonly ExecutorSnapshot[] | undefined>(undefined)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    if (!transport.executors) {
      setItems(undefined)
      return
    }
    let cancelled = false
    void transport
      .executors()
      .then((value) => {
        if (!cancelled) setItems(value)
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [transport])
  const readiness: Record<string, string> = {
    missing: '未找到',
    needs_setup: '需要配置',
    needs_auth: '需要认证',
    incompatible: '不兼容',
    inspection_passed: '只读检查通过',
    native_test_passed: '原生测试通过',
  }
  return (
    <section className="panel" aria-label="执行器连接">
      <div className="section-head">
        <h2>执行器连接</h2>
        {transport.executors && <span className="mini">fixture</span>}
      </div>
      {!transport.executors && <p className="empty">执行器 Catalog 尚未接线（等待主 Agent 发布生产读取入口）。</p>}
      {failed && <p className="empty">执行器探针读取失败。</p>}
      {items?.map(({ profile, report }) => (
        <div key={profile.id} className="executor">
          <p>
            <strong>
              {profile.id}@{profile.revision}
            </strong>{' '}
            · {profile.driverId} {profile.driverRelease}
          </p>
          <p className="context-line">
            期望 {profile.expectedVersion} · {readiness[report.readiness] ?? report.readiness}
          </p>
          <ul className="results">
            {report.capabilities.map((capability) => (
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

function ErrorPanel({
  problem,
  onRefresh,
  onDismiss,
}: {
  problem: Problem
  onRefresh: () => void
  onDismiss: () => void
}) {
  const title =
    problem.code === 'stale_candidate' || problem.context === 'candidate'
      ? '候选已过期'
      : problem.context === 'question' || problem.code === 'question_expired'
        ? '问题已过期或已变化，请刷新后重试'
        : '操作未完成'
  return (
    <div className="error-panel" role="alert">
      <div>
        <strong>{title}</strong>
        <p>{problem.message}</p>
        <span className="retry-note">
          可恢复方式：
          {problem.retry === 'safe'
            ? '刷新后重试'
            : problem.retry === 'reconcile'
              ? '先核对原生状态'
              : problem.retry === 'user_action'
                ? '请调整输入或操作'
                : '不可重试'}
        </span>
      </div>
      <div className="error-actions">
        <button type="button" onClick={onRefresh}>
          刷新快照
        </button>
        <button type="button" className="quiet" onClick={onDismiss}>
          关闭
        </button>
      </div>
    </div>
  )
}

function Conversation({
  snapshot,
  projectFilter,
  selectedWork,
  pending,
  offline,
  assistant,
  waiting,
  streamReplies,
  onSend,
  onLoadOlder,
}: {
  snapshot: Snapshot | undefined
  projectFilter: string | undefined
  selectedWork: WorkView | undefined
  pending: boolean
  offline: boolean
  assistant: AssistantProviderStatus | undefined
  waiting: boolean
  streamReplies: readonly AssistantStreamUpdate[]
  onSend: (text: string, useWorkContext: boolean) => Promise<boolean>
  onLoadOlder: (before: number) => Promise<void>
}) {
  const [draft, setDraft] = useState('')
  const [useWorkContext, setUseWorkContext] = useState(false)
  const templateRef = useRef<HTMLDetailsElement | null>(null)
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  const applyTemplate = (text: string) => {
    setDraft(text)
    setUseWorkContext(false)
    if (templateRef.current) templateRef.current.open = false
    inputRef.current?.focus()
  }
  const endRef = useRef<HTMLDivElement | null>(null)
  const page = snapshot?.conversation
  const messages = (page?.messages ?? []).filter((message) =>
    useWorkContext && selectedWork ? message.anchor?.workId === selectedWork.work.id : !message.anchor,
  )
  const drafts = useWorkContext
    ? []
    : streamReplies.filter(
        (reply) =>
          page?.messages.some((message) => message.id === reply.messageId) &&
          !page?.messages.some(
            (message) =>
              message.id === reply.replyId ||
              (message.provenance === 'application_notice' && message.sourceRefs.includes(reply.messageId)),
          ),
      )
  const streaming = drafts.some((reply) => reply.phase === 'streaming')
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const followReply = useRef(true)
  useEffect(() => {
    if (followReply.current) endRef.current?.scrollIntoView({ block: 'nearest' })
  }, [messages.length, waiting, streamReplies])
  return (
    <div className="conversation-inner">
      <div className="conversation-head">
        <div>
          <h2>主对话</h2>
          <p className="context-line">
            {useWorkContext && selectedWork ? selectedWork.work.title : (assistant?.model ?? '个人工作区')}
          </p>
        </div>
        {offline && <span className="badge warn">模型离线：查询、回答与停止仍可用</span>}
      </div>
      <div
        className="messages"
        ref={scrollRef}
        role="log"
        aria-live="polite"
        aria-label="对话消息"
        onScroll={() => {
          const element = scrollRef.current
          if (element) followReply.current = element.scrollHeight - element.clientHeight - element.scrollTop < 120
        }}
      >
        {page?.hasMore && (
          <button type="button" className="load-older" onClick={() => void onLoadOlder(page.beforeCursor!)}>
            加载更早消息
          </button>
        )}
        {messages.map((message) => (
          <article key={message.id} className={`message role-${message.role}`}>
            <header>
              <span className="role">
                {message.role === 'user' ? (
                  '你'
                ) : message.role === 'assistant' ? (
                  <>
                    <Bot size={16} />
                    个人助理
                  </>
                ) : (
                  '系统'
                )}
              </span>
              <time dateTime={message.createdAt}>
                {new Date(message.createdAt).toLocaleTimeString('zh-CN', {
                  hour: '2-digit',
                  minute: '2-digit',
                  hour12: false,
                })}
              </time>
              {message.provenance === 'reasoner_reply' && <ReplyActions text={message.text} />}
            </header>
            <MessageText text={message.text} />
          </article>
        ))}
        {drafts.map((reply) => (
          <article
            key={reply.messageId}
            className="message role-assistant streaming-reply"
            data-phase={reply.phase}
            aria-busy={reply.phase === 'streaming'}
          >
            <header>
              <span className="role">
                <Bot size={16} />
                个人助理
              </span>
              <span className="stream-status">
                {reply.phase === 'streaming'
                  ? reply.text
                    ? '正在生成'
                    : '正在思考'
                  : reply.phase === 'complete'
                    ? '正在保存'
                    : '回复中断'}
              </span>
            </header>
            <MessageText text={reply.text} />
          </article>
        ))}
        {!messages.length && (
          <div className="conversation-empty">
            <span className="empty-bot">
              <Bot size={34} />
            </span>
            <h3>今天想一起处理什么？</h3>
            <div className="quick-prompts">
              {taskTemplates.map((template) => (
                <button type="button" key={template.title} onClick={() => applyTemplate(template.text)}>
                  {template.title}
                  <ChevronRight size={14} />
                </button>
              ))}
            </div>
          </div>
        )}
        {waiting && !drafts.length && (
          <div className="assistant-pending" role="status">
            <Bot size={17} />
            <span>正在思考</span>
            <span className="typing-dots">...</span>
          </div>
        )}
        <div ref={endRef} />
      </div>
      <form
        className="composer"
        onSubmit={async (event) => {
          event.preventDefault()
          const text = draft.trim()
          if (!text || pending || waiting || streaming) return
          followReply.current = true
          if (await onSend(text, useWorkContext && !!selectedWork)) setDraft('')
        }}
      >
        <label className="sr-only" htmlFor="composer-input">
          发送消息
        </label>
        <textarea
          id="composer-input"
          ref={inputRef}
          rows={3}
          value={draft}
          placeholder={useWorkContext ? '补充当前工作的要求…' : '发消息给个人助理…'}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) event.currentTarget.form?.requestSubmit()
          }}
        />
        <div className="composer-actions">
          <div className="composer-context" role="group" aria-label="消息上下文">
            <details
              className="task-templates"
              ref={templateRef}
              onKeyDown={(event) => {
                if (event.key === 'Escape' && templateRef.current) templateRef.current.open = false
              }}
            >
              <summary className="icon-button" aria-label="任务模板" title="任务模板">
                <ListTodo size={17} />
              </summary>
              <div className="template-menu" role="menu" aria-label="任务模板">
                {taskTemplates.map((template) => (
                  <button
                    key={template.title}
                    role="menuitem"
                    type="button"
                    onClick={() => applyTemplate(template.text)}
                  >
                    {template.title}
                    <ChevronRight size={14} />
                  </button>
                ))}
              </div>
            </details>
            <button
              type="button"
              className={!useWorkContext ? 'context-mode active' : 'context-mode'}
              aria-pressed={!useWorkContext}
              onClick={() => setUseWorkContext(false)}
            >
              <MessageSquare size={14} />
              主对话
            </button>
            {selectedWork && (
              <button
                type="button"
                className={useWorkContext ? 'context-mode active' : 'context-mode'}
                aria-pressed={useWorkContext}
                onClick={() => setUseWorkContext(true)}
              >
                <Folder size={14} />
                当前工作
              </button>
            )}
          </div>
          <button
            className="send-button"
            type="submit"
            disabled={pending || waiting || streaming || !draft.trim()}
            aria-label="发送消息"
            title="发送"
          >
            <ArrowUp size={20} />
          </button>
        </div>
      </form>
    </div>
  )
}

function MessageText({ text }: { text: string }) {
  return (
    <div className="text markdown">
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={{
          img: ({ src, alt }) => (
            <a href={src} target="_blank" rel="noreferrer">
              {alt || '图片链接'}
            </a>
          ),
          a: ({ children, ...props }) => (
            <a {...props} target="_blank" rel="noreferrer">
              {children}
            </a>
          ),
        }}
      >
        {text}
      </Markdown>
    </div>
  )
}

function ReplyActions({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  const [failed, setFailed] = useState(false)
  return (
    <span className="reply-actions">
      <button
        type="button"
        className="icon-button"
        title={failed ? '复制失败，请导出回复' : copied ? '已复制' : '复制回复'}
        aria-label="复制回复"
        onClick={() => {
          void navigator.clipboard
            .writeText(text)
            .then(() => {
              setCopied(true)
              setFailed(false)
            })
            .catch(() => setFailed(true))
        }}
      >
        {copied ? <Check size={14} /> : <Copy size={14} />}
      </button>
      <button
        type="button"
        className="icon-button"
        title="导出 Markdown"
        aria-label="导出 Markdown"
        onClick={() => {
          const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' }))
          const link = document.createElement('a')
          link.href = url
          link.download = `assistant-${new Date().toISOString().slice(0, 10)}.md`
          link.click()
          setTimeout(() => URL.revokeObjectURL(url), 1000)
        }}
      >
        <Download size={14} />
      </button>
    </span>
  )
}

function Questions({
  questions,
  deliveries,
  pending,
  onAnswer,
}: {
  questions: readonly UserQuestion[]
  deliveries: Record<string, readonly TargetDelivery[]>
  pending: string | undefined
  onAnswer: (question: UserQuestion, answer: QuestionAnswer) => Promise<unknown>
}) {
  return (
    <section className="panel">
      <div className="section-head">
        <h2>待决定</h2>
        <span className="count">{questions.length}</span>
      </div>
      {questions.length === 0 && <p className="empty">没有待决定问题。</p>}
      <div className="question-list">
        {questions.map((question) => (
          <QuestionCard
            key={question.id}
            question={question}
            deliveries={deliveries[question.id] ?? []}
            pending={pending === `answer:${question.id}`}
            onAnswer={(answer) => onAnswer(question, answer)}
          />
        ))}
      </div>
    </section>
  )
}

function QuestionCard({
  question,
  deliveries,
  pending,
  onAnswer,
}: {
  question: UserQuestion
  deliveries: readonly TargetDelivery[]
  pending: boolean
  onAnswer: (answer: QuestionAnswer) => Promise<unknown>
}) {
  const [selected, setSelected] = useState<string[]>([])
  const [text, setText] = useState('')
  const [form, setForm] = useState<Record<string, string | boolean>>({})
  const presentation = question.presentation
  const submitChoices = (ids: string[]): void => {
    if (ids.length) void onAnswer({ kind: 'choices', optionIds: ids })
  }

  return (
    <article className="question-card" aria-labelledby={`q-${question.id}`}>
      <header>
        <span className={`kind kind-${question.kind}`}>{questionKindLabel[question.kind]}</span>
        <h3 id={`q-${question.id}`}>{question.prompt}</h3>
      </header>
      <details className="technical-details">
        <summary>原生请求</summary>
        <p className="targets">
          原生目标：
          {question.targets.map((target) => `${target.nativeMethod} · ${target.id}`).join('；')}
          {question.expiresAt
            ? ` · 截止 ${new Date(question.expiresAt).toLocaleString('zh-CN', { hour12: false })}`
            : ''}
        </p>
      </details>
      {presentation.kind === 'choices' && (
        <div className="options" role="group" aria-label="选项">
          {presentation.options.map((option) => (
            <button
              key={option.id}
              type="button"
              className={selected.includes(option.id) ? 'option selected' : 'option'}
              aria-pressed={selected.includes(option.id)}
              disabled={pending}
              onClick={() => {
                const next = presentation.multiple
                  ? selected.includes(option.id)
                    ? selected.filter((id) => id !== option.id)
                    : [...selected, option.id]
                  : [option.id]
                setSelected(next)
                if (!presentation.multiple) submitChoices(next)
              }}
            >
              {option.label}
            </button>
          ))}
          {presentation.multiple && (
            <button type="button" disabled={pending || !selected.length} onClick={() => submitChoices(selected)}>
              提交选择
            </button>
          )}
        </div>
      )}
      {presentation.kind === 'review' && (
        <div className="options">
          {presentation.options.map((option) => (
            <button
              key={option.id}
              type="button"
              className="option"
              disabled={pending}
              onClick={() => submitChoices([option.id])}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
      {presentation.kind === 'form' && (
        <form
          className="answer-form"
          onSubmit={(event) => {
            event.preventDefault()
            const values: Record<string, string | boolean | string[]> = {}
            for (const field of presentation.fields) {
              const value = form[field.id]
              if (value !== undefined) values[field.id] = value
            }
            void onAnswer({ kind: 'form', values })
          }}
        >
          {presentation.fields.map((field) => (
            <label key={field.id}>
              <span>
                {field.label}
                {field.required ? '（必填）' : ''}
              </span>
              {field.kind === 'boolean' ? (
                <input
                  type="checkbox"
                  checked={Boolean(form[field.id])}
                  onChange={(event) =>
                    setForm((previous) => ({
                      ...previous,
                      [field.id]: event.target.checked,
                    }))
                  }
                />
              ) : (
                <input
                  type="text"
                  required={field.required}
                  value={String(form[field.id] ?? '')}
                  onChange={(event) =>
                    setForm((previous) => ({
                      ...previous,
                      [field.id]: event.target.value,
                    }))
                  }
                />
              )}
            </label>
          ))}
          <button type="submit" disabled={pending}>
            提交表单
          </button>
        </form>
      )}
      {presentation.kind === 'free_text' && (
        <form
          className="answer-form"
          onSubmit={(event) => {
            event.preventDefault()
            if (!text.trim()) return
            void onAnswer({ kind: 'free_text', text })
          }}
        >
          <label>
            <span>回答</span>
            <textarea rows={3} value={text} onChange={(event) => setText(event.target.value)} />
          </label>
          <button type="submit" disabled={pending || !text.trim()}>
            提交回答
          </button>
        </form>
      )}
      {presentation.kind === 'url_flow' && (
        <div className="url-flow">
          <p>{presentation.purpose}</p>
          <div className="options">
            <button
              type="button"
              disabled={pending}
              onClick={() => void onAnswer({ kind: 'url_action', action: 'open' })}
            >
              在原生中打开授权
            </button>
            <button
              type="button"
              className="quiet"
              disabled={pending}
              onClick={() => void onAnswer({ kind: 'url_action', action: 'cancel' })}
            >
              取消授权
            </button>
          </div>
        </div>
      )}
      {deliveries.length > 0 && (
        <ul className="deliveries" aria-label="逐 target 投递状态">
          {deliveries.map((delivery) => (
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

function WorkDetail({
  work,
  verification,
  artifactReader,
  pending,
  onPause,
  onStop,
  onRetry,
  onContinue,
  onAccept,
  onRevise,
}: {
  work: WorkView | undefined
  verification: VerificationDetail | undefined
  artifactReader: ((id: string) => Promise<{ contentType: string; text: string } | undefined>) | undefined
  pending: string | undefined
  onPause: (work: WorkView) => Promise<unknown>
  onStop: (work: WorkView) => Promise<unknown>
  onRetry: (assignment: AssignmentRef, token: string) => Promise<unknown>
  onContinue: (contract: ContractRef) => Promise<unknown>
  onAccept: (candidate: CandidateRef) => Promise<unknown>
  onRevise: (work: WorkView, goal: string) => Promise<boolean>
}) {
  const [reviseOpen, setReviseOpen] = useState(false)
  const [revisionGoal, setRevisionGoal] = useState('')
  if (!work) {
    return (
      <section className="panel">
        <div className="section-head">
          <h2>工作详情</h2>
        </div>
        <p className="empty">从左侧选择一个工作查看合同、验证与可用动作。</p>
      </section>
    )
  }
  const available = work.actions.available
  const stale = verification?.stale ?? false
  const failed =
    verification?.results.some(
      (result) => result.outcome === 'FAIL' || result.outcome === 'SKIPPED' || result.outcome === 'NOT_TESTED',
    ) ?? false
  return (
    <section className="panel" aria-label="工作详情">
      <div className="section-head">
        <h2>工作详情</h2>
        <span className={`phase phase-${work.phase}`}>{phaseLabel[work.phase]}</span>
      </div>
      <h3 className="detail-title">{work.work.title}</h3>
      <details className="technical-details">
        <summary>合同详情</summary>
        <p className="context-line">
          合同{' '}
          <code>
            {work.contract.workId}@{work.contract.revision}
          </code>{' '}
          · <code className="mono">{work.contract.digest.slice(0, 12)}…</code>
        </p>
      </details>
      <p className={`resource resource-${work.resourceStatus}`}>
        {resourceLabel[work.resourceStatus]}
        {work.resourceStatus === 'indeterminate' ? '（不能视为已停止）' : ''}
      </p>
      <p className="goal">{work.contract.goal}</p>
      <h4>完成标准</h4>
      <ul className="criteria">
        {work.contract.criteria.map((criterion: Criterion) => (
          <li key={criterion.id}>
            <span>{criterion.description}</span>
            <span className="mini">
              {criterion.kind === 'machine' ? '机器检查' : '人工验收'}
              {criterion.required ? ' · 必需' : ''}
            </span>
          </li>
        ))}
      </ul>
      <h4>验证结果</h4>
      {!work.actions.currentVerificationId && <p className="empty">还没有当前候选的验证。</p>}
      {work.actions.currentVerificationId && (
        <div className={`verification${stale ? ' stale' : ''}`}>
          <details className="technical-details">
            <summary>验证详情{stale ? ' · 已过期' : ''}</summary>
            <code>{work.actions.currentVerificationId}</code>
          </details>
          {verification ? (
            <ul className="results">
              {verification.results.map((result) => (
                <li key={result.criterionId}>
                  <span>
                    {work.contract.criteria.find((criterion) => criterion.id === result.criterionId)?.description ??
                      result.criterionId}
                  </span>
                  <span className={`outcome outcome-${result.outcome}`}>{outcomeLabel[result.outcome]}</span>
                  <details className="technical-details evidence-disclosure">
                    <summary>证据引用</summary>
                    {result.evidenceRefs.join(', ') || '无证据引用'}
                  </details>
                </li>
              ))}
            </ul>
          ) : (
            <p className="empty">验证详情尚未从产品路由读取（fixture 场景可见）。</p>
          )}
          {stale && (
            <p className="warn-text" role="alert">
              该候选已过期，不能接受为完成结果。
            </p>
          )}
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
          >
            接受当前候选
          </button>
        )}
        {(available.includes('pause_dispatch') || available.includes('resume_dispatch')) && (
          <button type="button" className="quiet" disabled={pending === 'dispatch'} onClick={() => void onPause(work)}>
            {work.actions.dispatchHold.paused ? '恢复派工' : '暂停派工'}
          </button>
        )}
        {available.includes('retry_assignment') && work.actions.currentAssignment && work.actions.retryActionToken && (
          <button
            type="button"
            className="quiet"
            disabled={pending === 'retry'}
            onClick={() => void onRetry(work.actions.currentAssignment!, work.actions.retryActionToken!)}
          >
            重试当前执行
          </button>
        )}
        {available.includes('continue_work') && (
          <button
            type="button"
            className="quiet"
            disabled={pending === 'continue'}
            onClick={() => void onContinue(work.contract)}
          >
            继续工作
          </button>
        )}
        {available.includes('stop_work') && (
          <button type="button" className="danger" disabled={pending === 'stop'} onClick={() => void onStop(work)}>
            停止工作
          </button>
        )}
        {!['ended', 'delivered', 'stopping', 'switching'].includes(work.phase) && (
          <button
            type="button"
            className="quiet"
            disabled={pending === 'revise'}
            onClick={() => {
              setReviseOpen(!reviseOpen)
              setRevisionGoal(work.contract.goal)
            }}
          >
            修订合同
          </button>
        )}
        {available.length === 0 && <p className="empty">后端当前没有为这个工作提供可用动作。</p>}
      </div>
      {reviseOpen && (
        <form
          className="revise-form"
          onSubmit={async (event) => {
            event.preventDefault()
            if (!revisionGoal.trim()) return
            if (await onRevise(work, revisionGoal.trim())) setReviseOpen(false)
          }}
        >
          <label>
            <span>修订目标</span>
            <textarea rows={2} value={revisionGoal} onChange={(event) => setRevisionGoal(event.target.value)} />
          </label>
          <p className="context-line">
            沿用当前范围 {work.contract.scope.allowedPaths.join(', ')} 与完成标准；修订会生成新的合同
            revision，旧候选随之失效。
          </p>
          <div className="actions">
            <button type="submit" disabled={pending === 'revise' || !revisionGoal.trim()}>
              {pending === 'revise' ? '提交中…' : '提交修订'}
            </button>
            <button type="button" className="quiet" onClick={() => setReviseOpen(false)}>
              取消
            </button>
          </div>
        </form>
      )}
      <p className="context-line hold">
        派工控制 revision {work.actions.dispatchHold.revision} ·{' '}
        {work.actions.dispatchHold.paused ? '已暂停' : '未暂停'}
      </p>
    </section>
  )
}
