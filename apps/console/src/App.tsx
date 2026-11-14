/**
 * The console app shell: main conversation, conversation-scoped works, concentrated questions,
 * dispatch controls, verification and current-candidate acceptance. Everything displayed comes from
 * the backend snapshot and `actions.available`; the UI never infers a phase or invents an action.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ConversationMessageSchema, IdSchema } from '@personal-agent/contracts'
import {
  ArrowUp,
  ArrowUpRight,
  ArrowLeft,
  ArrowRight,
  Archive,
  ArchiveRestore,
  Bot,
  Bookmark,
  Check,
  CheckCheck,
  ClipboardCheck,
  ChevronRight,
  CircleHelp,
  Copy,
  Download,
  Eye,
  FileCheck2,
  Folder,
  FolderPlus,
  Inbox,
  Layers3,
  ListTodo,
  MessageSquare,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  Play,
  RefreshCw,
  Search,
  Settings2,
  Sparkles,
  SquarePen,
  X,
} from 'lucide-react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type {
  ApplicationConfiguration,
  AssistantProviderStatus,
  AssistantStreamUpdate,
  AssistantContextBinding,
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
  WorkLocation,
  WorkEnvironment,
  ProjectRegistrationInput,
  WorkVerificationStatus,
  VerificationRetryCommand,
  ConversationCommand,
  ConversationSummary,
  AttentionItem,
} from '@personal-agent/contracts'
import type { ConsoleTransport, ExecutorSnapshot, TargetDelivery, VerificationDetail } from './transport.ts'
import { TransportError } from './transport.ts'
import { ProjectSettings } from './ProjectSettings.tsx'
import { useReviewActivity } from './useReviewActivity.ts'
import { AttentionInbox } from './AttentionInbox.tsx'
import { DecisionWorkspace } from './DecisionWorkspace.tsx'
import { ProposalWorkspace } from './ProposalWorkspace.tsx'
import { ReplyCandidates } from './ReplyCandidates.tsx'
import type { CandidateDraft } from './ReplyCandidates.tsx'
import { ContextWorkspace } from './ContextWorkspace.tsx'
import { TrialWorkspace, useTrialReadiness } from './trial/index.ts'
import { ContextSourceRecord } from './ContextSources.tsx'
import { WorkEvidencePanel } from './WorkEvidencePanel.tsx'
import { blockedLabel, executionUnavailableLabel } from './configuration-labels.ts'
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
  const initialWork = new URLSearchParams(window.location.search).get('work')
  const validInitialWork = initialWork && IdSchema.safeParse(initialWork).success ? initialWork : undefined
  const [inspectorOpen, setInspectorOpen] = useState(!!validInitialWork)
  const [modelPanelOpen, setModelPanelOpen] = useState(false)
  const [workspaceOpen, setWorkspaceOpen] = useState(false)
  const [workspaceView, setWorkspaceView] = useState<'conversation' | 'works' | 'decisions' | 'executors' | 'trial'>('conversation')
  const [conversationTitle, setConversationTitle] = useState('主对话')
  const [catalogAvailable, setCatalogAvailable] = useState(false)
  const [decisionSource, setDecisionSource] = useState<ConversationMessage | null>()
  const [proposalSource, setProposalSource] = useState<ConversationMessage | null>()
  const [candidateDraft, setCandidateDraft] = useState<CandidateDraft>()
  const conversationDrafts = useRef(new Map<string, string>())
  const [settledContextDraft, setSettledContextDraft] = useState<{ conversationId: string; text: string; commandId: string }>()
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
  const [selectedWorkId, setSelectedWorkId] = useState<string | undefined>(validInitialWork)
  const focusedWork = useRef<{ workId: string; conversationId: string } | undefined>(validInitialWork ? { workId: validInitialWork, conversationId } : undefined)
  const attentionNavigation = useRef(0)
  const attentionQuestion = useRef<string>()
  const [reviewQueue, setReviewQueue] = useState<readonly AttentionItem[]>([])
  const [reviewOpening, setReviewOpening] = useState(false)
  const [attentionCount, setAttentionCount] = useState<{ count: number; partial: boolean }>()
  const [projectFilter, setProjectFilter] = useState<string | undefined>(undefined)
  const [offline, setOffline] = useState<boolean>(() => fixture?.modelOffline() ?? false)
  const [createOpen, setCreateOpen] = useState(false)
  const [createDraft, setCreateDraft] = useState({ id: '', goal: '', projectId: '' })
  const [projectImportOpen, setProjectImportOpen] = useState(false)
  const [contextOpen, setContextOpen] = useState(false)
  const [activateWorkId, setActivateWorkId] = useState<string | undefined>()
  const [workLocation, setWorkLocation] = useState<WorkLocation | undefined>()
  const [workEnvironment, setWorkEnvironment] = useState<WorkEnvironment | undefined>()
  const [workVerification, setWorkVerification] = useState<WorkVerificationStatus | undefined>()
  const [verificationFailure, setVerificationFailure] = useState<string | undefined>()
  const [locationFailure, setLocationFailure] = useState<string | undefined>()
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
  useEffect(() => {
    const closeDrawers = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || (!workspaceOpen && !inspectorOpen && !modelPanelOpen)) return
      setWorkspaceOpen(false)
      setInspectorOpen(false)
      setModelPanelOpen(false)
      document.querySelector<HTMLButtonElement>('button[aria-label="工作详情"]')?.focus()
    }
    window.addEventListener('keydown', closeDrawers)
    return () => window.removeEventListener('keydown', closeDrawers)
  }, [workspaceOpen, inspectorOpen, modelPanelOpen])

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
        let next = await transport.snapshot({
          conversationId,
          limit: 100,
          ...(query.workId ? { workId: query.workId } : {}),
        })
        if (conversationRef.current !== conversationId) return
        const focused = focusedWork.current
        if (!query.workId && focused?.conversationId === conversationId) {
          const exact = await transport.snapshot({ conversationId, workId: focused.workId, limit: 100 })
          if (conversationRef.current !== conversationId || focusedWork.current !== focused) return
          const target = exact.works[0]
          if (!target || target.work.conversationId !== conversationId)
            throw new TransportError('schema_mismatch', '工作与原会话身份不匹配')
          next = { ...next, cursor: Math.max(next.cursor, exact.cursor),
            works: [...next.works.filter(work => work.work.id !== focused.workId), target],
            questions: [...exact.questions, ...next.questions.filter(question => question.contract.workId !== focused.workId)].slice(0, 200) }
        }
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
  const selectConversation = (id: string, title: string) => {
    setCandidateDraft(undefined)
    attentionNavigation.current += 1
    focusedWork.current = undefined
    attentionQuestion.current = undefined
    setReviewQueue([])
    conversationRef.current = id
    setWorkspaceView('conversation')
    const url = new URL(window.location.href)
    url.searchParams.set('conversation', id)
    url.searchParams.delete('work')
    window.history.pushState(null, '', url)
    setConversationId(id)
    setConversationTitle(title)
    setSelectedWorkId(undefined)
    setSnapshot(undefined)
    setWaitingAfter(undefined)
    setInspectorOpen(false)
    setModelPanelOpen(false)
    setWorkspaceOpen(false)
    setCreateOpen(false)
    setProjectImportOpen(false)
    setActivateWorkId(undefined)
    setLoading(true)
  }
  const newConversation = async () => {
    if (pending === 'conversation') return
    const id = `conversation-${crypto.randomUUID()}`
    const projectId = projectFilter ?? configuration?.projects[0]?.id
    if (catalogAvailable && projectId && transport.conversationCommand) {
      const receipt = await send({ kind: 'create_conversation', commandId: newId('cmd-conversation'),
        conversationId: id, projectId, title: '新对话' }, 'conversation')
      if (receipt?.status !== 'recorded') return
    }
    selectConversation(id, '新对话')
  }
  useEffect(() => {
    const restore = () => {
      attentionNavigation.current += 1
      const id = new URLSearchParams(window.location.search).get('conversation')
      const nextId = id && IdSchema.safeParse(id).success ? id : defaultConversationId
      const work = new URLSearchParams(window.location.search).get('work')
      const nextWork = work && IdSchema.safeParse(work).success ? work : undefined
      focusedWork.current = nextWork ? { conversationId: nextId, workId: nextWork } : undefined
      conversationRef.current = nextId
      setConversationId(nextId)
      setConversationTitle('主对话')
      setSelectedWorkId(nextWork)
      setInspectorOpen(!!nextWork)
      setReviewQueue([])
      setSnapshot(undefined)
      setWaitingAfter(undefined)
      setLoading(true)
      void transport.snapshot({ conversationId: nextId, ...(nextWork ? { workId: nextWork } : {}), limit: 100 }).then(next => {
        if (conversationRef.current !== nextId || focusedWork.current?.workId !== nextWork) return
        setSnapshot(next); setLoading(false)
      }).catch(error => { if (conversationRef.current === nextId) { setProblem(problemOf(error)); setLoading(false) } })
    }
    window.addEventListener('popstate', restore)
    return () => window.removeEventListener('popstate', restore)
  }, [transport])

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
    async (command: UserCommand | VerificationRetryCommand | ConversationCommand, label: string): Promise<CommandReceipt | undefined> => {
      setPending(label)
      setProblem(undefined)
      try {
        const receipt = command.kind === 'retry_verification'
          ? await (transport.retryVerification?.(command) ?? Promise.reject(new TransportError('unsupported_capability', '验证恢复尚未接通')))
          : command.kind === 'create_conversation' || command.kind === 'rename_conversation' || command.kind === 'archive_conversation'
          ? await (transport.conversationCommand?.(command) ?? Promise.reject(new TransportError('unsupported_capability', '会话管理尚未接通')))
          : await transport.dispatch(command)
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
  useEffect(() => {
    if (!inspectorOpen || !attentionQuestion.current) return
    const heading = document.getElementById(`q-${attentionQuestion.current}`)
    if (!heading) return
    const frame = requestAnimationFrame(() => {
      const card = heading.closest<HTMLElement>('.question-card')
      card?.scrollIntoView({ block: 'nearest' }); card?.focus({ preventScroll: true })
      attentionQuestion.current = undefined
    })
    return () => cancelAnimationFrame(frame)
  }, [selectedWorkId, snapshot?.cursor, inspectorOpen])

  useEffect(() => {
    setWorkVerification(undefined)
    setVerificationFailure(undefined)
    if (!selectedWorkId || !transport.workVerification || !inspectorOpen || modelPanelOpen) return
    let cancelled = false
    void transport.workVerification(selectedWorkId)
      .then(value => { if (!cancelled) setWorkVerification(value) })
      .catch(() => { if (!cancelled) setVerificationFailure('验证运行状态暂时无法读取。') })
    return () => { cancelled = true }
  }, [selectedWorkId, snapshot?.cursor, inspectorOpen, modelPanelOpen, transport])

  useEffect(() => {
    setWorkLocation(undefined)
    setWorkEnvironment(undefined)
    setLocationFailure(undefined)
    if (!selectedWorkId || !transport.workLocation || !inspectorOpen || modelPanelOpen) return
    let cancelled = false
    if (transport.workEnvironment) void transport.workEnvironment(selectedWorkId)
      .then(value => { if (!cancelled) setWorkEnvironment(value) })
      .catch(() => { if (!cancelled) setLocationFailure('工作环境暂时无法读取。') })
    void transport
      .workLocation(selectedWorkId)
      .then((value) => {
        if (!cancelled) setWorkLocation(value)
      })
      .catch(() => {
        if (!cancelled) setLocationFailure('工作目录暂时无法读取。')
      })
    return () => {
      cancelled = true
    }
  }, [selectedWorkId, snapshot?.cursor, inspectorOpen, modelPanelOpen, transport])

  const openWorkDraft = (goal = '', projectId = projectFilter ?? '') => {
    setWorkspaceOpen(true)
    setInspectorOpen(false)
    setModelPanelOpen(false)
    setCreateDraft({ id: newId('draft'), goal, projectId })
    setCreateOpen(true)
    setProjectImportOpen(false)
    setWorkspaceOpen(true)
    setInspectorOpen(false)
    setModelPanelOpen(false)
  }

  const works = useMemo(
    () => (snapshot?.works ?? []).filter((work) => !projectFilter || work.work.projectId === projectFilter),
    [snapshot, projectFilter],
  )
  const projects = useMemo(
    () => [
      ...new Set([
        ...(configuration?.projects.map((project) => project.id) ?? []),
        ...(snapshot?.works ?? []).map((work) => work.work.projectId),
      ]),
    ],
    [snapshot, configuration],
  )
  const selectedWork =
    works.find((work) => work.work.id === selectedWorkId) ??
    (snapshot?.works ?? []).find((work) => work.work.id === selectedWorkId)
  const openQuestions = (snapshot?.questions ?? []).filter(question => !projectFilter ||
    snapshot?.works.some(work => work.work.id === question.contract.workId && work.work.projectId === projectFilter))
  const selectedQuestions = selectedWork ? openQuestions.filter(question => question.contract.workId === selectedWork.work.id) : openQuestions
  const executionUnavailable = configuration?.executionAvailability?.state === 'unavailable' ? configuration.executionAvailability.reason : undefined
  const flushReviewActivity = useReviewActivity(transport, selectedWork?.actions.currentCandidate,
    !!configuration?.reviewActivityAvailable && inspectorOpen && !modelPanelOpen && !contextOpen && !!selectedWork?.actions.currentVerificationId)
  const activeWorks = works.filter(work => ['evaluating', 'queued', 'working', 'verifying', 'switching'].includes(work.phase))
  const projectName = projectFilter
    ? configuration?.projects.find(project => project.id === projectFilter)?.displayName ?? projectFilter
    : '个人工作区'
  const trial = useTrialReadiness(transport, auth === 'ready' && workspaceView === 'trial')
  const openView = (view: typeof workspaceView) => {
    attentionNavigation.current += 1
    setWorkspaceView(view)
    setWorkspaceOpen(false)
    setModelPanelOpen(false)
    setInspectorOpen(false)
  }
  const selectWork = (work: WorkView) => {
    attentionNavigation.current += 1
    focusedWork.current = undefined
    setReviewQueue([])
    setSelectedWorkId(work.work.id)
    setProjectFilter(undefined)
    setInspectorOpen(true)
    setModelPanelOpen(false)
    setWorkspaceOpen(false)
  }
  const openAttention = async (item: AttentionItem, queue?: readonly AttentionItem[]) => {
    const request = ++attentionNavigation.current
    setReviewOpening(true)
    try {
      const next = await transport.snapshot({ workId: item.contract.workId, conversationId: item.conversationId, limit: 100 })
      if (attentionNavigation.current !== request) return
      const work = next.works[0]
      if (!work || work.work.id !== item.contract.workId || work.work.conversationId !== item.conversationId || work.work.projectId !== item.projectId)
        throw new TransportError('schema_mismatch', '待办来源已变化')
      selectConversation(item.conversationId, '工作会话')
      focusedWork.current = { workId: work.work.id, conversationId: item.conversationId }
      attentionQuestion.current = item.kind === 'question' ? item.questionId : undefined
      const url = new URL(window.location.href)
      url.searchParams.set('work', work.work.id); window.history.replaceState(null, '', url)
      setSnapshot(next); setLoading(false); setProjectFilter(undefined); setSelectedWorkId(work.work.id)
      setInspectorOpen(true); setReviewQueue(queue ?? []); setProblem(undefined)
      lastSeq.current = Math.max(lastSeq.current, next.cursor)
    } finally { setReviewOpening(false) }
  }
  const reviewIndex = reviewQueue.findIndex(item => item.contract.workId === selectedWorkId)
  const answerQuestion = async (question: UserQuestion, answer: QuestionAnswer) => {
    const command: UserCommand = {
      commandId: newId('cmd-answer'), conversationId, kind: 'answer_question',
      questionId: question.id, expectedVersion: question.version, answer,
    }
    await send(command, `answer:${question.id}`)
  }

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
        <div className="topbar-context"><span>工作区</span><ChevronRight size={12} /><strong>{projectName}</strong></div>
        <div className="status-cluster" aria-live="polite">
          {assistant?.configured && (
            <button
              type="button"
              className="model-switch"
              onClick={() => { setWorkspaceOpen(false); setModelPanelOpen(!modelPanelOpen) }}
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
            onClick={() => {
              setWorkspaceOpen(!workspaceOpen)
              setInspectorOpen(false)
              setModelPanelOpen(false)
            }}
            title="工作空间"
            aria-label="工作空间"
            aria-expanded={workspaceOpen}
            aria-controls="work-navigation"
          >
            <Folder size={18} />
          </button>
          <a className="icon-button" href="/v1/guide" title="使用指南" aria-label="使用指南">
            <CircleHelp size={18} />
          </a>
          {configuration?.decisionsAvailable && transport.decisions && transport.prepareDecision && transport.decisionCommand && <button type="button" className="icon-button" title="项目决定" aria-label="项目决定" onClick={() => setDecisionSource(null)}><Bookmark size={18} /></button>}
          {configuration?.proposalsAvailable && transport.prepareProposal && transport.proposalCommand && <button type="button" className="icon-button" title="创建提案" aria-label="创建提案" onClick={() => { setCandidateDraft(undefined); setProposalSource(null) }}><FileCheck2 size={18} /></button>}
          {((configuration?.contextPreviewAvailable && transport.contextPreview) || (configuration?.contextHistoryAvailable && transport.contextHistory)) && <button type="button" className="icon-button" title="上下文预览" aria-label="上下文预览" onClick={() => setContextOpen(true)}><Layers3 size={18} /></button>}
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
            onClick={() => { setWorkspaceOpen(false); setModelPanelOpen(!modelPanelOpen) }}
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
              setWorkspaceOpen(false)
              setInspectorOpen(!open)
              setModelPanelOpen(false)
            }}
            title="工作详情"
            aria-label="工作详情"
            aria-expanded={inspectorOpen || modelPanelOpen}
            aria-controls="work-inspector"
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
          <nav className="workspace-rail" aria-label="工作台导航">
            <div className="rail-top">
              <button type="button" className={`rail-button${workspaceView === 'conversation' ? ' active' : ''}`}
                aria-current={workspaceView === 'conversation' ? 'page' : undefined} title="主对话" aria-label="主对话视图" onClick={() => openView('conversation')}><MessageSquare size={19} /></button>
              <button type="button" className={`rail-button${workspaceView === 'works' ? ' active' : ''}`}
                aria-current={workspaceView === 'works' ? 'page' : undefined} title="工作与交付" aria-label="工作与交付" onClick={() => openView('works')}><Layers3 size={19} /></button>
              <button type="button" className={`rail-button${workspaceView === 'decisions' ? ' active' : ''}`}
                aria-current={workspaceView === 'decisions' ? 'page' : undefined} title="待我决定" aria-label="待我决定" onClick={() => openView('decisions')}>
                <Inbox size={19} />{(attentionCount?.count ?? openQuestions.length) > 0 && <span className="rail-badge">{attentionCount?.count ?? openQuestions.length}{attentionCount?.partial ? '+' : ''}</span>}
              </button>
              <button type="button" className={`rail-button${workspaceView === 'executors' ? ' active' : ''}`}
                aria-current={workspaceView === 'executors' ? 'page' : undefined} title="执行器连接" aria-label="执行器目录" onClick={() => openView('executors')}><Bot size={19} /></button>
              <button type="button" className={`rail-button${workspaceView === 'trial' ? ' active' : ''}`}
                aria-current={workspaceView === 'trial' ? 'page' : undefined} title="试用准备" aria-label="试用准备" onClick={() => openView('trial')}><ClipboardCheck size={19} /></button>
            </div>
            <div className="rail-bottom">
              <button type="button" className="rail-button" title="偏好设置" aria-label="偏好设置" onClick={() => { setModelPanelOpen(true); setWorkspaceOpen(false) }}><Settings2 size={19} /></button>
            </div>
          </nav>
          <aside id="work-navigation" className="sidebar" aria-label="工作列表">
            <div className="sidebar-heading"><span><Layers3 size={15} />工作区</span><button type="button" className="icon-button drawer-close" title="关闭工作列表" aria-label="关闭工作列表" onClick={() => setWorkspaceOpen(false)}><X size={17} /></button></div>
            <button type="button" className="new-conversation" disabled={pending === 'conversation'} onClick={() => void newConversation()}>
              <SquarePen size={16} />
              <span>新对话</span>
            </button>
            {transport.conversations && <ConversationDirectory transport={transport} currentId={conversationId}
              projectId={projectFilter} cursor={snapshot?.cursor} onAvailable={setCatalogAvailable} onTitle={setConversationTitle}
              onSelect={entry => selectConversation(entry.id, entry.title)}
              onCommand={command => send(command, 'conversation')} />}
            <button type="button" className="sidebar-current" onClick={() => openView('conversation')}>
              <MessageSquare size={16} />
              <span>主对话</span>
              <span className="mini">当前</span>
            </button>
            <div className="section-head">
              <h2>项目与工作</h2>
              <span className="count">{works.length}</span>
              <span className="section-tools">
                {projectFilter && configuration?.projects.find(project => project.id === projectFilter)?.settingsAvailable && transport.projectSettings && transport.projectSettingsCommand &&
                  <ProjectSettings key={projectFilter} projectId={projectFilter} transport={transport} onOpen={() => setWorkspaceOpen(false)} onCommitted={async () => { await refreshConfiguration(); scheduleRefresh() }} />}
                <button
                  type="button"
                  className="icon-button"
                  onClick={() => (createOpen ? setCreateOpen(false) : openWorkDraft())}
                  title="新建委托"
                  aria-label="新建委托"
                >
                  <Plus size={17} />
                </button>
                {transport.registerProject && (
                  <button
                    type="button"
                    className="icon-button"
                    title="导入项目"
                    aria-label="导入项目"
                    onClick={() => {
                      setProjectImportOpen(!projectImportOpen)
                      setCreateOpen(false)
                    }}
                  >
                    <FolderPlus size={17} />
                  </button>
                )}
              </span>
            </div>
            <div className="project-filter" role="group" aria-label="按项目筛选">
              <button
                type="button"
                className={!projectFilter ? 'chip active' : 'chip'}
                aria-pressed={!projectFilter}
                onClick={() => setProjectFilter(undefined)}
              >
                <Layers3 size={14} /><span>全部项目</span>
              </button>
              {projects.map((project) => (
                <button
                  key={project}
                  type="button"
                  className={projectFilter === project ? 'chip active' : 'chip'}
                  aria-pressed={projectFilter === project}
                  onClick={() => setProjectFilter(project)}
                  title={configuration?.projects.find((item) => item.id === project)?.displayName ?? project}
                >
                  <Folder size={14} /><span>{configuration?.projects.find((item) => item.id === project)?.displayName ?? project}</span>
                </button>
              ))}
            </div>
            {projectImportOpen && transport.registerProject && (
              <ProjectImportForm
                onCancel={() => setProjectImportOpen(false)}
                onImport={async (input) => {
                  const previousIds = new Set(configuration?.projects.map((project) => project.id) ?? [])
                  const next = await transport.registerProject!(input)
                  setConfiguration(next)
                  setConfigState('ready')
                  setConfigProblem(undefined)
                  const imported = next.projects.find((project) => !previousIds.has(project.id))
                  if (imported) setProjectFilter(imported.id)
                  openWorkDraft('', imported?.id)
                }}
              />
            )}
            {createOpen && (
              <NewWorkForm
                key={createDraft.id}
                initialGoal={createDraft.goal}
                initialProjectId={createDraft.projectId}
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
                    setProjectFilter(project.id)
                    setInspectorOpen(true)
                    setModelPanelOpen(false)
                    setWorkspaceOpen(false)
                    if (configuration?.profiles.find((profile) => profile.id === profileId)?.kind === 'native')
                      setActivateWorkId(receipt.workId)
                  }
                }}
              />
            )}
            <div className="sidebar-section-label"><span>当前对话的工作</span><span>{works.length}</span></div>
            <ul className="work-list">
              {works.map((work) => (
                <li key={work.work.id}>
                  <button
                    type="button"
                    className={`work-card${selectedWorkId === work.work.id ? ' selected' : ''}`}
                    aria-current={selectedWorkId === work.work.id ? 'true' : undefined}
                    onClick={() => selectWork(work)}
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
                <strong>个人工作区</strong>
                <small>{assistant?.configured ? assistant.model : '对话模型未配置'}</small>
              </span>
              <span className="local-dot" />
            </div>
          </aside>

          <section className="conversation" aria-label="主对话">
            {executionUnavailable && <div className="execution-state" role="status" aria-label="开发执行状态">
              <Bot size={18} aria-hidden="true" /><p><strong>{executionUnavailable === 'recovery_readonly' ? '恢复只读' : '开发执行未就绪'}</strong><span>{executionUnavailableLabel[executionUnavailable]}</span></p>
              <button type="button" className="icon-button" title="查看执行器" aria-label="查看执行器" onClick={() => openView('executors')}><ArrowUpRight size={17} /></button>
            </div>}
            {workspaceView === 'works' && <WorkDirectory works={works} loading={loading} configuration={configuration} onSelect={selectWork} onCreate={() => { openWorkDraft(); setWorkspaceOpen(true) }} />}
            <div className="attention-surface" hidden={workspaceView !== 'decisions'}><AttentionInbox transport={transport} configuration={configuration}
              active={workspaceView === 'decisions'} revision={snapshot?.cursor} onOpen={openAttention} onCount={setAttentionCount}
              fallback={loading ? <p className="empty" role="status">正在读取问题…</p> : <Questions questions={openQuestions} deliveries={deliveries} pending={pending} onAnswer={answerQuestion} />} /></div>
            {workspaceView === 'executors' && <ExecutorDirectory configuration={configuration} state={configState} onReload={() => void refreshConfiguration()} />}
            {workspaceView === 'trial' && <TrialWorkspace readiness={trial.readiness} loading={trial.loading} error={trial.error}
              unavailable={trial.unavailable} configuration={configuration} activeProjectId={projectFilter} activeConversationTitle={conversationTitle}
              onReload={() => { trial.reload(); void refreshConfiguration() }}
              onAction={action => {
                switch (action) {
                  case 'configure_model':
                    setWorkspaceOpen(false); setInspectorOpen(false); setModelPanelOpen(true); break
                  case 'import_project':
                    if (!transport.registerProject || executionUnavailable === 'recovery_readonly') {
                      setProblem({ code: 'unsupported_capability', message: executionUnavailable === 'recovery_readonly' ? '恢复数据只读，暂不支持导入项目' : '当前服务未提供项目导入', retry: 'none' }); break
                    }
                    openView('conversation'); setCreateOpen(false); setProjectImportOpen(true); setWorkspaceOpen(true); break
                  case 'inspect_executor': openView('executors'); break
                  case 'open_conversation': openView('conversation'); break
                }
              }} />}
            <div className="conversation-surface" hidden={workspaceView !== 'conversation'}>
            <div className="workspace-summary" aria-label="当前对话工作概况"><span><span className="summary-count">{activeWorks.length}</span>进行中</span><button type="button" onClick={() => openView('decisions')}><span className="summary-count">{openQuestions.length}</span>待决定</button><span><CheckCheck size={13} /><span className="summary-count">{works.filter(work => work.phase === 'delivered').length}</span>已交付</span></div>
            <Conversation
              key={conversationId}
              title={conversationTitle}
              initialDraft={conversationDrafts.current.get(conversationId) ?? ''}
              onDraftChange={text => conversationDrafts.current.set(conversationId, text)}
              settledContextDraft={settledContextDraft?.conversationId === conversationId ? settledContextDraft : undefined}
              contextTransport={configuration?.contextSourcesAvailable || configuration?.assistantContextAvailable ? transport : undefined}
              candidateTransport={configuration?.replyCandidatesAvailable ? transport : undefined}
              configuration={configuration}
              onCandidatePrepared={value => { if (conversationRef.current === value.preview.record.conversationId) { setProposalSource(undefined); setCandidateDraft(value) } }}
              snapshot={snapshot}
              projectFilter={projectFilter}
              selectedWork={selectedWork}
              pending={pending === 'chat'}
              offline={offline}
              assistant={assistant}
              waiting={waitingAfter !== undefined}
              streamReplies={streamReplies}
              activateWorkId={activateWorkId}
              canDelegate={configuration?.projects.some((project) => project.dispatchAllowed) === true}
              executionBlocked={!!executionUnavailable}
              onDelegate={(text) => openWorkDraft(text)}
              selectedProjectName={projectName}
              selectedQuestionCount={selectedQuestions.length}
              onInspectWork={() => { setWorkspaceOpen(false); setInspectorOpen(true); setModelPanelOpen(false) }}
              onDecisions={() => openView('decisions')}
              onRecordDecision={configuration?.decisionsAvailable && transport.prepareDecision && transport.decisionCommand && transport.decisions
                ? message => setDecisionSource(message) : undefined}
              onPropose={configuration?.proposalsAvailable && transport.prepareProposal && transport.proposalCommand
                ? message => { setCandidateDraft(undefined); setProposalSource(message) } : undefined}
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
            </div>
          </section>

          <aside id="work-inspector" className="detail" aria-label="决定与工作详情" ref={detailRef}>
            <div className="detail-heading"><span>工作上下文</span><button className="icon-button" type="button" aria-label="关闭工作详情" title="关闭工作详情" onClick={() => { setInspectorOpen(false); setModelPanelOpen(false) }}><X size={17} /></button></div>
            {modelPanelOpen && (
              <ModelPanel
                status={assistant}
                onClose={() => setModelPanelOpen(false)}
                onSelect={async (model) => {
                  if (transport.selectModel) setAssistant(await transport.selectModel(model))
                }}
                onReload={refreshAssistant}
                onSuggestions={transport.setAssistantSuggestions ? async enabled => { setAssistant(await transport.setAssistantSuggestions!(enabled)) } : undefined}
              />
            )}
            <div className="work-panels" hidden={modelPanelOpen}>
              {reviewQueue.length > 0 && <div className="review-navigation" role="group" aria-label="逐项审阅队列">
                <button type="button" className="icon-button" aria-label="返回待办" title="返回待办" onClick={() => openView('decisions')}><Inbox size={16} /></button>
                <span>审阅队列 {reviewIndex + 1} / {reviewQueue.length}</span>
                <button type="button" className="icon-button" aria-label="上一项交付" title="上一项交付" disabled={reviewIndex < 1 || reviewOpening || !!pending}
                  onClick={() => void openAttention(reviewQueue[reviewIndex - 1]!, reviewQueue).catch(() => setNotice('交付暂时无法打开，请返回待办刷新。'))}><ArrowLeft size={16} /></button>
                <button type="button" className="icon-button" aria-label="下一项交付" title="下一项交付" disabled={reviewIndex < 0 || reviewIndex >= reviewQueue.length - 1 || reviewOpening || !!pending}
                  onClick={() => void openAttention(reviewQueue[reviewIndex + 1]!, reviewQueue).catch(() => setNotice('交付暂时无法打开，请返回待办刷新。'))}><ArrowRight size={16} /></button>
              </div>}
              <WorkDetail
                transport={transport}
                work={selectedWork}
                location={workLocation}
                environment={workEnvironment}
                locationFailure={locationFailure}
                verification={verification}
                operationStatus={workVerification}
                operationFailure={verificationFailure}
                artifactReader={transport.artifact ? (id) => transport.artifact!(id) : undefined}
                pending={pending}
                onRecheck={async (status) => {
                  if (!status.candidate || !status.failure || !status.retryAvailable) return
                  await send({ kind: 'retry_verification', commandId: newId('cmd-recheck'), conversationId,
                    candidate: status.candidate, blockedId: status.failure.id }, 'recheck')
                }}
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
                  await flushReviewActivity.current()
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
              {workspaceView !== 'decisions' && <Questions
                questions={selectedQuestions}
                deliveries={deliveries}
                pending={pending}
                onAnswer={answerQuestion}
              />}
            </div>
          </aside>
          {(workspaceOpen || inspectorOpen || modelPanelOpen) && <button type="button" className="drawer-backdrop" aria-label="关闭侧栏" onClick={() => { setWorkspaceOpen(false); setInspectorOpen(false); setModelPanelOpen(false) }} />}
        </main>
      )}
      {auth === 'ready' && contextOpen && configuration && (configuration.contextPreviewAvailable || configuration.contextHistoryAvailable) && configuration.projects.length > 0 &&
        <ContextWorkspace key={conversationId} transport={transport} configuration={configuration} conversationId={conversationId}
          works={snapshot?.works ?? []} initialProjectId={selectedWork?.work.projectId ?? projectFilter ?? configuration.projects[0]!.id}
          initialDraft={conversationDrafts.current.get(conversationId) ?? ''}
          {...(selectedWork?.work.conversationId === conversationId ? { initialWorkId: selectedWork.work.id } : {})}
          onSent={async value => {
            if (conversationRef.current !== value.conversationId) return
            if (conversationDrafts.current.get(value.conversationId) === value.text) {
              conversationDrafts.current.set(value.conversationId, '')
              setSettledContextDraft(value)
            }
            if (assistant?.configured) setWaitingAfter(snapshot?.conversation?.messages.at(-1)?.sequence ?? 0)
            await refresh()
          }}
          onOpenConversation={(id, projectId) => { setContextOpen(false); setProjectFilter(projectId); selectConversation(id, '历史会话') }}
          onClose={() => setContextOpen(false)} />}
      {auth === 'ready' && decisionSource !== undefined && configuration && configuration.projects.length > 0 &&
        <DecisionWorkspace transport={transport} configuration={configuration} source={decisionSource ?? undefined}
          sources={snapshot?.conversation?.messages ?? []} initialProjectId={decisionSource?.projectId ?? projectFilter ?? configuration.projects[0]!.id}
          onClose={() => setDecisionSource(undefined)} />}
      {auth === 'ready' && (proposalSource !== undefined || candidateDraft) && configuration?.proposalsAvailable && configuration.projects.length > 0 &&
        <ProposalWorkspace key={candidateDraft?.preview.token ?? 'manual-proposal'} transport={transport} configuration={configuration} source={proposalSource ?? undefined}
          {...(candidateDraft ? { initialCandidate: candidateDraft } : {})}
          sources={snapshot?.conversation?.messages ?? []} works={snapshot?.works ?? []}
          initialProjectId={proposalSource?.projectId ?? projectFilter ?? configuration.projects[0]!.id}
          onClose={() => { setProposalSource(undefined); setCandidateDraft(undefined) }} onRecorded={async () => { await refresh() }}
          onOpenWork={id => { setProposalSource(undefined); setCandidateDraft(undefined); setSelectedWorkId(id); setInspectorOpen(true); setWorkspaceOpen(false); setModelPanelOpen(false) }} />}
    </div>
  )
}

function ConversationDirectory({ transport, currentId, projectId, cursor, onAvailable, onTitle, onSelect, onCommand }: {
  transport: ConsoleTransport
  currentId: string
  projectId: string | undefined
  cursor: number | undefined
  onAvailable: (value: boolean) => void
  onTitle: (value: string) => void
  onSelect: (entry: ConversationSummary) => void
  onCommand: (command: ConversationCommand) => Promise<CommandReceipt | undefined>
}) {
  const [items, setItems] = useState<readonly ConversationSummary[]>([])
  const [query, setQuery] = useState('')
  const [includeArchived, setIncludeArchived] = useState(false)
  const [nextCursor, setNextCursor] = useState<string | undefined>()
  const [supported, setSupported] = useState<boolean | undefined>()
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)
  const [editing, setEditing] = useState<string | undefined>()
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)
  const request = useRef(0)
  const load = useCallback(async (next?: string) => {
    const sequence = ++request.current
    setLoading(true)
    setFailed(false)
    try {
      const page = await transport.conversations?.({ limit: 30, includeArchived,
        ...(projectId ? { projectId } : {}), ...(query.trim() ? { query: query.trim() } : {}), ...(next ? { cursor: next } : {}) })
      if (request.current !== sequence) return
      setSupported(!!page)
      onAvailable(!!page)
      if (page) {
        setItems(previous => next ? [...new Map([...previous, ...page.conversations].map(entry => [entry.id, entry])).values()] : page.conversations)
        setNextCursor(page.nextCursor)
      }
    } catch { if (request.current === sequence) setFailed(true) }
    finally { if (request.current === sequence) setLoading(false) }
  }, [transport, includeArchived, projectId, query, onAvailable])
  useEffect(() => {
    const timer = setTimeout(() => { void load() }, 150)
    return () => { clearTimeout(timer); request.current++ }
  }, [load, cursor])
  useEffect(() => {
    const current = items.find(entry => entry.id === currentId)
    if (current) onTitle(current.title)
  }, [items, currentId, onTitle])
  const mutate = async (command: ConversationCommand): Promise<boolean> => {
    if (busy) return false
    setBusy(true)
    try {
      const receipt = await onCommand(command)
      if (receipt?.status !== 'recorded') return false
      await load()
      return true
    } finally { setBusy(false) }
  }
  if (supported === false) return null
  return <section className="conversation-directory" aria-label="历史对话">
    <div className="sidebar-section-label"><span>对话</span><button type="button" className="icon-button" aria-label="刷新对话目录" title="刷新对话目录" disabled={loading} onClick={() => void load()}><RefreshCw size={13} /></button></div>
    <div className="conversation-search"><Search size={14} /><input type="search" aria-label="搜索历史对话" placeholder="搜索对话" value={query} onChange={event => setQuery(event.target.value)} /></div>
    <label className="conversation-archive-filter"><input type="checkbox" checked={includeArchived} onChange={event => setIncludeArchived(event.target.checked)} />包含归档</label>
    {failed && <p className="warn-text" role="status">对话目录读取失败。</p>}
    {loading && <p className="context-line" role="status">正在读取对话…</p>}
    {!loading && !failed && !items.length && <p className="context-line">{query ? '没有匹配的对话' : '暂无历史对话'}</p>}
    <ul className="conversation-list">
      {items.map(entry => <li key={entry.id} className={entry.id === currentId ? 'current' : ''}>
        {editing === entry.id ? <form className="conversation-rename" onSubmit={event => { event.preventDefault(); void mutate({ kind: 'rename_conversation', commandId: newId('cmd-rename'), conversationId: entry.id, expectedTitleRevision: entry.titleRevision, title: title.trim() }).then(ok => { if (ok) setEditing(undefined) }) }}>
          <input autoFocus aria-label="对话名称" maxLength={512} value={title} onChange={event => setTitle(event.target.value)} onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); setEditing(undefined) } }} />
          <button type="submit" className="icon-button" disabled={busy || !title.trim()} title="保存对话名称" aria-label="保存对话名称"><Check size={14} /></button>
          <button type="button" className="icon-button" disabled={busy} title="取消重命名" aria-label="取消重命名" onClick={() => setEditing(undefined)}><X size={14} /></button>
        </form> : <><button type="button" className="conversation-select" aria-current={entry.id === currentId ? 'true' : undefined} title={entry.title} onClick={() => onSelect(entry)}><MessageSquare size={13} /><span>{entry.title}</span>{entry.attention && <i className="conversation-attention" title="有进行中工作或待办" />}{entry.archivedAt && <Archive size={12} />}</button>
          <div className="conversation-tools"><button type="button" className="icon-button" disabled={busy} title={`重命名：${entry.title}`} aria-label={`重命名：${entry.title}`} onClick={() => { setEditing(entry.id); setTitle(entry.title) }}><SquarePen size={13} /></button>
          <button type="button" className="icon-button" disabled={busy} title={entry.archivedAt ? `取消归档：${entry.title}` : `归档：${entry.title}`} aria-label={entry.archivedAt ? `取消归档：${entry.title}` : `归档：${entry.title}`} onClick={() => void mutate({ kind: 'archive_conversation', commandId: newId('cmd-archive'), conversationId: entry.id, expectedArchiveRevision: entry.archiveRevision, archived: !entry.archivedAt })}>{entry.archivedAt ? <ArchiveRestore size={13} /> : <Archive size={13} />}</button></div>
        </>}
      </li>)}
    </ul>
    {nextCursor && <button type="button" className="quiet catalog-more" disabled={loading} onClick={() => void load(nextCursor)}>加载更多</button>}
  </section>
}

function WorkDirectory({ works, loading, configuration, onSelect, onCreate }: {
  works: readonly WorkView[]
  loading: boolean
  configuration: ApplicationConfiguration | undefined
  onSelect: (work: WorkView) => void
  onCreate: () => void
}) {
  const [filter, setFilter] = useState('all')
  const [query, setQuery] = useState('')
  const project = (id: string) => configuration?.projects.find(item => item.id === id)?.displayName ?? id
  const shown = works.filter(work => {
    const matches = filter === 'all' || (filter === 'active' && ['evaluating', 'queued', 'working', 'verifying', 'switching'].includes(work.phase)) ||
      (filter === 'decisions' && work.phase === 'needs_user') || (filter === 'delivered' && work.phase === 'delivered')
    return matches && `${work.work.title} ${work.contract.goal} ${project(work.work.projectId)}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())
  })
  return <div className="workspace-view">
    <div className="view-header"><div><h2 className="view-title">工作与交付</h2><p className="view-description">当前对话 · {works.length} 项工作</p></div><button type="button" className="view-command" onClick={onCreate}><Plus size={15} />新建委托</button></div>
    <div className="view-filters">
      <div className="view-tabs" role="group" aria-label="工作状态筛选">{[['all', '全部'], ['active', '进行中'], ['decisions', '待决定'], ['delivered', '已交付']].map(([value, label]) => <button key={value} type="button" className={filter === value ? 'active' : ''} aria-pressed={filter === value} onClick={() => setFilter(value!)}>{label}</button>)}</div>
      <label className="work-search"><Search size={15} /><input aria-label="搜索当前对话的工作" placeholder="搜索工作" value={query} onChange={event => setQuery(event.target.value)} /></label>
    </div>
    <div className="view-content"><div className="work-table" aria-label="工作列表与交付">
      {shown.map(work => <button type="button" key={work.work.id} className="work-row" onClick={() => onSelect(work)}>
        <span className={`work-icon phase-icon-${work.phase}`}>{work.phase === 'delivered' ? <CheckCheck size={18} /> : <Layers3 size={18} />}</span>
        <span className="work-row-main"><strong>{work.work.title}</strong><span className="work-row-meta">{project(work.work.projectId)}<span>合同 {work.contract.revision}</span>{work.artifactIds.length > 0 && <span>{work.artifactIds.length} 项产物</span>}</span></span>
        <span className="work-row-status"><span className={`phase phase-${work.phase}`}>{phaseLabel[work.phase]}</span><ArrowUpRight size={15} /></span>
      </button>)}
      {!shown.length && <div className="empty-view"><Search size={23} /><h3>{loading ? '正在读取工作…' : query || filter !== 'all' ? '没有匹配的工作' : '还没有工作'}</h3>{!loading && (query || filter !== 'all') && <button type="button" className="quiet" onClick={() => { setQuery(''); setFilter('all') }}>清除筛选</button>}</div>}
    </div></div>
  </div>
}

function ExecutorDirectory({ configuration, state, onReload }: {
  configuration: ApplicationConfiguration | undefined
  state: 'loading' | 'ready' | 'unavailable' | 'failed'
  onReload: () => void
}) {
  const profiles = configuration?.profiles ?? []
  const native = profiles.filter(profile => profile.kind === 'native')
  const controlled = profiles.filter(profile => profile.kind === 'controlled_fixture')
  const row = (profile: ApplicationConfiguration['profiles'][number]) => <div className="executor-row" key={profile.id}>
    <span className="executor-icon"><Bot size={22} /></span>
    <div className="executor-info"><h3>{profile.displayName}</h3><p>{profile.driverId}<span>配置 {profile.revision}</span></p></div>
    <div className="executor-readiness"><span className={`phase ${profile.dispatchAllowed ? 'phase-delivered' : 'phase-uncertain'}`}>{profile.kind === 'controlled_fixture' ? '固定流程' : profile.dispatchAllowed ? '已准入' : blockedLabel(profile.blockedReason)}</span><span>{configuration?.projects.filter(project => project.profileIds.includes(profile.id)).length ?? 0} 个项目</span></div>
  </div>
  return <div className="workspace-view"><div className="view-header"><div><h2 className="view-title">执行器连接</h2><p className="view-description">{native.length} 个原生执行器 · {native.filter(profile => profile.dispatchAllowed).length} 个已准入</p></div><button type="button" className="icon-button" title="刷新执行器" aria-label="刷新执行器" onClick={onReload}><RefreshCw size={17} /></button></div>
    <div className="view-content"><div className="executor-directory">{native.map(row)}
      {state === 'loading' && <p className="empty">正在读取执行器…</p>}
      {state === 'failed' && <p className="warn-text" role="alert">执行器配置读取失败。</p>}
      {state === 'unavailable' && <p className="empty">执行器信息暂不可用。</p>}
      {state === 'ready' && !native.length && <div className="empty-view"><Bot size={26} /><h3>暂无已连接的原生执行器</h3></div>}
      {controlled.length > 0 && <details className="test-profiles"><summary>固定流程测试 <span>{controlled.length}</span></summary>{controlled.map(row)}</details>}
    </div></div>
  </div>
}

function WorkStageStrip({ work, questionCount, onInspect, onDecisions }: { work: WorkView; questionCount: number; onInspect: () => void; onDecisions: () => void }) {
  const index = work.phase === 'delivered' ? 3 : work.phase === 'needs_user' && questionCount > 0 ? 1 : work.phase === 'verifying' || (work.phase === 'needs_user' && work.actions.currentCandidate) ? 2
    : work.phase === 'working' || work.phase === 'needs_user' ? 1 : ['uncertain', 'stopping', 'ended'].includes(work.phase) ? -1 : 0
  return <div className="work-stage-strip" aria-label="当前工作阶段"><div className="stage-context"><button type="button" className="stage-work" title={work.work.title} onClick={onInspect}><Layers3 size={13} /><span>{work.work.title}</span><ArrowUpRight size={13} /></button>{questionCount > 0 && <button type="button" className="stage-pending" title="打开待决定列表" onClick={onDecisions}><CircleHelp size={12} />{questionCount} 项待决定</button>}</div><div className="stage-steps">{['已委托', '执行', '验证', '交付'].map((label, position) => <span key={label} className={`stage-step${position === index ? ' active' : ''}${position < index || work.phase === 'delivered' ? ' complete' : ''}`}>
    <span className="stage-dot">{position < index || work.phase === 'delivered' ? <Check size={10} /> : null}</span>{label}
  </span>)}{index === -1 && <span className={`phase phase-${work.phase}`}>{phaseLabel[work.phase]}</span>}</div></div>
}

function ModelPanel({
  status,
  onClose,
  onSelect,
  onReload,
  onSuggestions,
}: {
  status: AssistantProviderStatus | undefined
  onClose: () => void
  onSelect: (model: string) => Promise<void>
  onReload: () => Promise<void>
  onSuggestions: ((enabled: boolean) => Promise<void>) | undefined
}) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | undefined>()
  return (
    <section className="model-panel" aria-label="模型设置">
      <div className="section-head">
        <h2>
          <Sparkles size={17} />
          对话模型
        </h2>
        <div className="section-tools"><button type="button" className="icon-button" title="刷新模型设置" aria-label="刷新模型设置" disabled={pending} onClick={() => void onReload()}><RefreshCw size={16} /></button><button className="icon-button" type="button" onClick={onClose} aria-label="关闭模型设置" title="关闭">
          <X size={16} />
        </button></div>
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
      {status?.suggestionsEnabled !== undefined && onSuggestions && <label className="settings-toggle model-suggestion-setting">
        <input type="checkbox" checked={status.suggestionsEnabled} disabled={!status.configured || pending || status.state === 'responding'}
          onChange={async event => {
            const enabled = event.target.checked; setPending(true); setError(undefined)
            try { await onSuggestions(enabled) } catch { setError('设置结果尚未确认，请刷新核对。') } finally { setPending(false) }
          }} /><span>提案建议</span>
      </label>}
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
            <span className="artifact-name">
              {(ids.length === 3
                ? ['交付清单', '完整变更补丁', '检查证据']
                : ids.length === 4
                  ? ['交付清单', '完整变更补丁', '输出文件', '检查证据']
                  : [])[index] ?? `产物 ${index + 1}`}
            </span>
            <span className="artifact-actions">
              {reader && (
                <button
                  type="button"
                  className="icon-button"
                  aria-label="查看"
                  title="查看"
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
                  <Eye size={14} />
                </button>
              )}
              <a
                className="icon-button"
                aria-label="下载"
                title="下载"
                href={`/v1/artifacts/${encodeURIComponent(id)}`}
                download={
                  index === 1
                    ? 'changes.patch'
                    : index === 0
                      ? 'delivery-manifest.json'
                      : ids.length === 4 && index === 2
                        ? 'product-output.txt'
                        : 'check-evidence.json'
                }
              >
                <Download size={14} />
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
            {preview.text.length > 1000000 ? `${preview.text.slice(0, 1000000)}\n…` : preview.text}
          </pre>
          {preview.text.length > 1000000 && <p className="context-line">预览已截断。</p>}
          <button type="button" className="quiet" onClick={() => setPreview(undefined)}>
            关闭预览
          </button>
        </div>
      )}
    </div>
  )
}

function ProjectImportForm({
  onImport,
  onCancel,
}: {
  onImport: (input: ProjectRegistrationInput) => Promise<void>
  onCancel: () => void
}) {
  const [path, setPath] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [check, setCheck] = useState<ProjectRegistrationInput['check']>('node_test')
  const [environmentPolicy, setEnvironmentPolicy] = useState<'none' | 'existing_only' | 'offline_install'>('none')
  const [storeDir, setStoreDir] = useState('')
  const [pending, setPending] = useState(false)
  const [failure, setFailure] = useState<string | undefined>()
  return (
    <form
      className="project-import"
      aria-label="导入本地项目"
      onSubmit={async (event) => {
        event.preventDefault()
        if (!path.trim() || pending) return
        setPending(true)
        setFailure(undefined)
        try {
          await onImport({
            path: path.trim(),
            check,
            ...(environmentPolicy === 'existing_only' ? { environment: { policy: 'existing_only' as const } }
              : environmentPolicy === 'offline_install' ? { environment: { policy: 'offline_install' as const, storeDir: storeDir.trim() } } : {}),
            ...(displayName.trim() ? { displayName: displayName.trim() } : {}),
          })
        } catch (error) {
          setFailure(problemOf(error).message)
        } finally {
          setPending(false)
        }
      }}
    >
      <div className="section-head">
        <h3>导入本地项目</h3>
        <button
          type="button"
          className="icon-button"
          aria-label="取消导入"
          title="取消"
          disabled={pending}
          onClick={onCancel}
        >
          <X size={15} />
        </button>
      </div>
      <label>
        <span>Git 仓库根目录</span>
        <input
          name="project-path"
          value={path}
          onChange={(event) => setPath(event.target.value)}
          required
          maxLength={4096}
          autoComplete="off"
          placeholder="/Users/you/projects/my-app"
        />
      </label>
      <label>
        <span>项目名称</span>
        <input
          name="project-name"
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
          maxLength={160}
          autoComplete="off"
        />
      </label>
      <label>
        <span>验收命令</span>
        <select
          name="project-check"
          aria-label="验收命令"
          value={check}
          onChange={(event) => setCheck(event.target.value as ProjectRegistrationInput['check'])}
        >
          <option value="node_test">node --test</option>
          <option value="pnpm_test">pnpm test</option>
          <option value="npm_test">npm test</option>
        </select>
      </label>
      <label>
        <span>依赖准备</span>
        <select name="environment-policy" aria-label="依赖准备" value={environmentPolicy}
          onChange={event => setEnvironmentPolicy(event.target.value as typeof environmentPolicy)} disabled={pending}>
          <option value="none">不准备依赖</option>
          <option value="existing_only">仅验证已有依赖</option>
          <option value="offline_install">从授权缓存离线准备</option>
        </select>
      </label>
      {environmentPolicy === 'offline_install' && (
        <label>
          <span>授权 pnpm 缓存目录</span>
          <input name="environment-store" aria-label="授权 pnpm 缓存目录" value={storeDir}
            onChange={event => setStoreDir(event.target.value)} required maxLength={4096}
            autoComplete="off" placeholder="/Users/you/.local/share/pnpm/store" disabled={pending} />
        </label>
      )}
      {failure && (
        <p role="alert" className="warn-text">
          {failure}
        </p>
      )}
      <div className="actions">
        <button type="submit" disabled={pending || !path.trim()}>
          {pending ? '导入中…' : '导入项目'}
        </button>
      </div>
    </form>
  )
}

function NewWorkForm({
  initialGoal = '',
  initialProjectId = '',
  configuration,
  state,
  problem,
  pending,
  onReload,
  onCreate,
  onCancel,
}: {
  initialGoal?: string
  initialProjectId?: string
  configuration: ApplicationConfiguration | undefined
  state: 'loading' | 'ready' | 'unavailable' | 'failed'
  problem: Problem | undefined
  pending: boolean
  onReload: () => void
  onCreate: (goal: string, project: ConfiguredProjectView, profileId: string) => Promise<unknown>
  onCancel: () => void
}) {
  const [goal, setGoal] = useState(initialGoal)
  const [projectChoice, setProjectChoice] = useState(initialProjectId)
  const [profileChoice, setProfileChoice] = useState('')
  const projects = configuration?.projects ?? []
  const nativeProfiles = new Set(
    configuration?.profiles.filter((profile) => profile.kind === 'native').map((profile) => profile.id) ?? [],
  )
  const nativeProject = projects.find((item) => item.profileIds.some((id) => nativeProfiles.has(id)))
  const project = projects.find((item) => item.id === projectChoice) ?? nativeProject ?? projects[0]
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
          {configuration?.executionAvailability?.state === 'unavailable'
            ? `新委托已禁用：${executionUnavailableLabel[configuration.executionAvailability.reason]}。历史记录保留。`
            : project.discussionOnly ? '当前工作区仅用于讨论。'
            : `新委托已禁用：${blockedLabel(project.blockedReason)}。`}
        </p>
      )}
      <label>
        <span>目标</span>
        <textarea rows={3} required value={goal} onChange={(event) => setGoal(event.target.value)} />
      </label>
      <label>
        <span>项目</span>
        <select
          aria-label="项目"
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
        <span>开发执行器</span>
        <select
          aria-label="开发执行器"
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
          {project.scope.excludedPaths.length > 0 && (
            <p>
              <span>排除路径</span>
              <code>{project.scope.excludedPaths.join(', ')}</code>
            </p>
          )}
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
  title,
  initialDraft,
  onDraftChange,
  settledContextDraft,
  contextTransport,
  candidateTransport,
  configuration,
  onCandidatePrepared,
  snapshot,
  projectFilter,
  selectedWork,
  selectedProjectName,
  selectedQuestionCount,
  onInspectWork,
  onDecisions,
  onRecordDecision,
  onPropose,
  pending,
  offline,
  assistant,
  waiting,
  streamReplies,
  activateWorkId,
  canDelegate,
  executionBlocked,
  onDelegate,
  onSend,
  onLoadOlder,
}: {
  title: string
  initialDraft: string
  onDraftChange: (value: string) => void
  settledContextDraft: { text: string; commandId: string } | undefined
  contextTransport: ConsoleTransport | undefined
  candidateTransport: ConsoleTransport | undefined
  configuration: ApplicationConfiguration | undefined
  onCandidatePrepared: (value: CandidateDraft) => void
  snapshot: Snapshot | undefined
  projectFilter: string | undefined
  selectedWork: WorkView | undefined
  selectedProjectName: string
  selectedQuestionCount: number
  onInspectWork: () => void
  onDecisions: () => void
  onRecordDecision: ((message: ConversationMessage) => void) | undefined
  onPropose: ((message: ConversationMessage) => void) | undefined
  pending: boolean
  offline: boolean
  assistant: AssistantProviderStatus | undefined
  waiting: boolean
  streamReplies: readonly AssistantStreamUpdate[]
  activateWorkId: string | undefined
  canDelegate: boolean
  executionBlocked: boolean
  onDelegate: (text: string) => void
  onSend: (text: string, useWorkContext: boolean) => Promise<boolean>
  onLoadOlder: (before: number) => Promise<void>
}) {
  const [draft, setDraft] = useState(initialDraft)
  useEffect(() => { onDraftChange(draft) }, [draft, onDraftChange])
  useEffect(() => { if (settledContextDraft) setDraft(current => current === settledContextDraft.text ? '' : current) }, [settledContextDraft])
  const [useWorkContext, setUseWorkContext] = useState(false)
  useEffect(() => {
    if (!executionBlocked && activateWorkId && selectedWork?.work.id === activateWorkId) {
      setUseWorkContext(true)
      setDraft('')
    } else setUseWorkContext(false)
  }, [activateWorkId, selectedWork?.work.id, executionBlocked])
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
        <div className="conversation-heading">
          <span className="section-icon"><MessageSquare size={17} /></span><div>
          <h2 title={useWorkContext && selectedWork ? '当前工作' : title}>{useWorkContext && selectedWork ? '当前工作' : title}</h2>
          <p className="context-line">
            {useWorkContext && selectedWork ? selectedWork.work.title : selectedProjectName}
          </p>
          </div>
        </div>
        <div className="conversation-head-tools">{offline ? <span className="badge warn">模型离线</span> : <span className="context-line">{assistant?.configured ? assistant.model : '本地会话'}</span>}</div>
      </div>
      {selectedWork && <WorkStageStrip work={selectedWork} questionCount={selectedQuestionCount} onInspect={onInspectWork} onDecisions={onDecisions} />}
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
              {message.role === 'user' && message.provenance === 'trusted_user' && message.projectId && onPropose &&
                <button type="button" className="icon-button message-proposal" title="转为提案" aria-label="转为提案" onClick={() => onPropose(message)}><FileCheck2 size={14} /></button>}
              {message.role === 'user' && message.provenance === 'trusted_user' && message.projectId && onRecordDecision &&
                <button type="button" className="icon-button message-decision" title="记录为项目决定" aria-label="记录为项目决定" onClick={() => onRecordDecision(message)}><Bookmark size={14} /></button>}
            </header>
            <MessageText text={message.text} />
            {message.role === 'assistant' && message.provenance === 'reasoner_reply' && message.sourceRefs[0] &&
              candidateTransport?.replyCandidates && configuration && <ReplyCandidates message={message} transport={candidateTransport}
                configuration={configuration} onPrepared={onCandidatePrepared} />}
            {message.role === 'user' && message.provenance === 'trusted_user' && !message.anchor && contextTransport?.assistantContext &&
              <MessageContextAudit message={message} transport={contextTransport} />}
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
            <h3>开始新的工作</h3>
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
                disabled={executionBlocked}
                onClick={() => setUseWorkContext(true)}
              >
                <Folder size={14} />
                当前工作
              </button>
            )}
          </div>
          <div className="composer-submit-actions" role="group" aria-label="发送与委托">
            {canDelegate && (
              <button
                type="button"
                className="delegate-button"
                title="委托执行"
                aria-label="委托执行"
                disabled={pending || waiting || streaming || !draft.trim()}
                onClick={() => onDelegate(draft.trim())}
              >
                <Play size={17} />
              </button>
            )}
            <button
              className="send-button"
              type="submit"
              disabled={pending || waiting || streaming || !draft.trim()}
              aria-label="发送消息"
              title={useWorkContext ? '补充当前工作' : '发送到对话模型'}
            >
              <ArrowUp size={20} />
            </button>
          </div>
        </div>
      </form>
    </div>
  )
}

function MessageContextAudit({ message, transport }: { message: ConversationMessage; transport: ConsoleTransport }) {
  const [binding, setBinding] = useState<AssistantContextBinding>(), [loaded, setLoaded] = useState(false)
  const [loading, setLoading] = useState(false), [failed, setFailed] = useState(false)
  const sequence = useRef(0)
  useEffect(() => () => { sequence.current++ }, [message.id])
  const load = async () => {
    const request = ++sequence.current
    setLoading(true); setFailed(false)
    try {
      const result = await transport.assistantContext!(message.id)
      if (request !== sequence.current) return
      if (result && (result.projectId !== message.projectId || result.conversationId !== message.conversationId))
        throw new Error('Context message identity mismatch')
      setBinding(result); setLoaded(true)
    } catch { if (request === sequence.current) setFailed(true) }
    finally { if (request === sequence.current) setLoading(false) }
  }
  return <details className="message-context-audit" onToggle={event => {
    if (event.currentTarget.open && !loaded && !loading && !failed) void load()
  }}><summary><Layers3 size={13} />上下文来源{binding ? ` · ${binding.sources.length}` : ''}</summary>
    {loading && <p role="status">正在核对来源</p>}
    {failed && <p role="alert">来源记录暂时无法核对。<button type="button" className="icon-button" title="重新读取来源" aria-label="重新读取来源" onClick={() => void load()}><RefreshCw size={13} /></button></p>}
    {loaded && !binding && <p>本条消息未附加上下文</p>}
    {binding && <><p>记录于 {new Date(binding.confirmedAt).toLocaleString('zh-CN')}{binding.contract ? ` · 合同版本 ${binding.contract.revision}` : ''}</p>
      <ContextSourceRecord transport={transport} messageId={message.id} projectId={binding.projectId} conversationId={binding.conversationId} binding={binding} /></>}
  </details>
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
    <article className="question-card" aria-labelledby={`q-${question.id}`} tabIndex={-1}>
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
  transport,
  work,
  location,
  environment,
  locationFailure,
  verification,
  operationStatus,
  operationFailure,
  artifactReader,
  pending,
  onPause,
  onStop,
  onRetry,
  onRecheck,
  onContinue,
  onAccept,
  onRevise,
}: {
  transport: ConsoleTransport
  work: WorkView | undefined
  location: WorkLocation | undefined
  environment: WorkEnvironment | undefined
  locationFailure: string | undefined
  verification: VerificationDetail | undefined
  operationStatus: WorkVerificationStatus | undefined
  operationFailure: string | undefined
  artifactReader: ((id: string) => Promise<{ contentType: string; text: string } | undefined>) | undefined
  pending: string | undefined
  onPause: (work: WorkView) => Promise<unknown>
  onStop: (work: WorkView) => Promise<unknown>
  onRetry: (assignment: AssignmentRef, token: string) => Promise<unknown>
  onRecheck: (status: WorkVerificationStatus) => Promise<unknown>
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
      (result) =>
        work.contract.criteria.some(
          (criterion) => criterion.id === result.criterionId && criterion.kind === 'machine' && criterion.required,
        ) &&
        (result.outcome === 'FAIL' || result.outcome === 'SKIPPED' || result.outcome === 'NOT_TESTED'),
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
      {environment && environment.status !== 'not_configured' && (
        <section className="work-location" aria-label="依赖环境">
          <h4>依赖环境</h4>
          <p role="status" className={environment.status === 'blocked' ? 'warn-text' : 'context-line'}>
            {{ waiting: '等待执行', preparing: '正在准备', ready: '已准备并复验', blocked: '准备受阻' }[environment.status]}
            {' · '}{environment.policy === 'offline_install' ? '离线缓存' : '现有依赖'}
          </p>
          {environment.status === 'blocked' && <p className="context-line">
            {environment.code === 'offline_cache_missing' ? '授权缓存缺少依赖，请补齐缓存后重新委托。'
              : environment.code === 'dependencies_missing' ? '隔离工作区缺少依赖，请使用离线准备策略。'
                : environment.code === 'project_hooks_unsupported' ? '项目安装钩子或配置暂不支持，请检查项目设置。'
                  : environment.code === 'environment_drift' ? '依赖或项目声明已变化，当前环境不能用于交付。'
                    : '环境未获确认，请检查项目设置与执行记录。'}
          </p>}
          {environment.fingerprint && <details className="technical-details"><summary>环境指纹</summary><code>{environment.fingerprint}</code></details>}
        </section>
      )}
      {(location || locationFailure) && (
        <section className="work-location" aria-label="代码位置">
          <h4>代码位置</h4>
          {location && (
            <dl>
              <dt>原项目</dt>
              <dd>
                <PathValue value={location.projectPath} />
              </dd>
              <dt>工作区</dt>
              <dd>
                {location.workspacePath ? (
                  <PathValue value={location.workspacePath} />
                ) : (
                  <span className="context-line">准备中</span>
                )}
              </dd>
              <dt>基线</dt>
              <dd>
                {location.baseCommit ? (
                  <code title={location.baseCommit}>{location.baseCommit.slice(0, 12)}</code>
                ) : (
                  <span className="context-line">准备中</span>
                )}
              </dd>
            </dl>
          )}
          {locationFailure && (
            <p className="warn-text" role="status">
              {locationFailure}
            </p>
          )}
        </section>
      )}
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
      {operationFailure && <p className="warn-text" role="status">{operationFailure}</p>}
      {operationStatus?.workId === work.work.id && operationStatus.state !== 'not_ready' && operationStatus.state !== 'finished' && (
        <section className="work-location verification-operation" aria-label="验证运行状态">
          <p role="status" className={operationStatus.state === 'blocked' ? 'warn-text' : 'context-line'}>
            {{ queued: '等待验证', running: '正在运行注册检查', retry_wait: '验证暂时受阻，正在有限重试', blocked: '验证受阻，自动重试已停止' }[operationStatus.state]}
          </p>
          {operationStatus.failure && <>
            <p className="context-line">{operationStatus.failure.code === 'verification_failed'
              ? '请核对候选文件和依赖环境，修复后重新检查。'
              : '请确认本地存储和磁盘可用，恢复后重新检查。'}</p>
            {operationStatus.retryAvailable && <button type="button" className="quiet" disabled={!!pending}
              onClick={() => void onRecheck(operationStatus)}><RefreshCw size={15} />{pending === 'recheck' ? '正在提交' : '重新检查'}</button>}
            {!operationStatus.retryAvailable && <p className="context-line">当前资源状态不允许重新检查，请核对执行记录。</p>}
          </>}
        </section>
      )}
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
      <WorkEvidencePanel key={work.work.id} work={work} transport={transport} />
      <h4>可用动作</h4>
      <div className="actions">
        {available.includes('accept_candidate') && work.actions.currentCandidate && (
          <button
            type="button"
            disabled={pending === 'accept' || stale || failed || environment?.status === 'blocked'}
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

function PathValue({ value }: { value: string }) {
  const [copied, setCopied] = useState(false)
  const [failed, setFailed] = useState(false)
  return (
    <span className="path-value">
      <code>{value}</code>
      <button
        type="button"
        className="icon-button"
        title={failed ? '复制失败' : copied ? '已复制路径' : '复制路径'}
        aria-label="复制路径"
        onClick={() => {
          void navigator.clipboard
            .writeText(value)
            .then(() => {
              setCopied(true)
              setFailed(false)
            })
            .catch(() => setFailed(true))
        }}
      >
        {copied ? <Check size={13} /> : <Copy size={13} />}
      </button>
    </span>
  )
}
