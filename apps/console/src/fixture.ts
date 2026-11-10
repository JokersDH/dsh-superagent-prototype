/**
 * Isolated fixture adapter (development/test only). It implements the same ConsoleTransport as the
 * product HTTP client and validates every returned value with the public schemas, so the console can
 * be exercised without pretending the real backend exists. State lives in sessionStorage for the
 * page session; it is never a production business-state source.
 */
import {
  AgentProfileSchema, ApplicationConfigurationSchema, ChangeSchema, CommandReceiptSchema, ConversationPageSchema,
  ProbeReportSchema, SnapshotSchema,
} from '@personal-agent/contracts'
import type {
  AgentProfile, ApplicationConfiguration, Change, CommandReceipt, ContractRef, ConversationMessage, ConversationPage, Criterion,
  InspectQuery, ProbeReport, Scope, Snapshot, UserCommand, UserQuestion, WorkView,
} from '@personal-agent/contracts'
import type { ConsoleTransport, ExecutorSnapshot, TargetDelivery, VerificationDetail } from './transport.ts'
import { TransportError } from './transport.ts'

const STORAGE_KEY = 'pa-console-fixture-v2'
export const executorFixture = (): ExecutorSnapshot[] => {
  const profile: AgentProfile = AgentProfileSchema.parse({
    id: 'profile-codex-local', revision: 1, driverId: 'driver-codex', driverApiMajor: 1, driverRelease: '0.1.0-fixture',
    executable: '/usr/local/bin/fixture-codex', argv: [], expectedVersion: '1.0.0-test', nativeConfigRef: 'config-1',
    permissionPolicyRevision: 'perm-1', requiredFeatures: ['chat'],
  })
  const report: ProbeReport = ProbeReportSchema.parse({
    identity: {
      profileId: profile.id, profileRevision: profile.revision, executableDigest: digest('7'), nativeVersion: '1.0.0-test',
      driverRelease: profile.driverRelease, driverApiMajor: 1, wireVersion: '1', schemaDigest: digest('8'),
      resolvedConfigFingerprint: digest('9'), permissionPolicyRevision: 'perm-1', configStability: 'frozen',
      platform: 'darwin', architecture: 'arm64', runtimeVersion: 'node-24.21.0',
    },
    capabilities: [
      { feature: 'chat', advertised: { supported: true }, observed: { supported: true }, test: 'PASS', policy: 'allowed', evidenceRefs: ['probe-1'] },
      { feature: 'permission_prompt', advertised: { supported: true }, observed: {}, test: 'NOT_TESTED', policy: 'requires_review', evidenceRefs: [] },
    ],
    readiness: 'inspection_passed', checkedAt: at, evidenceRefs: ['probe-report-1'],
  })
  return [{ profile, report }]
}
const at = '2026-11-08T09:00:00.000Z'
const digest = (char: string): string => char.repeat(64)
const conversation = 'conv-main'

interface DispatchHold { paused: boolean; revision: number }
interface FixtureState {
  cursor: number
  works: WorkView[]
  questions: UserQuestion[]
  messages: ConversationMessage[]
  verifications: Record<string, VerificationDetail>
  deliveries: Record<string, TargetDelivery[]>
  changes: Change[]
  minRetainedSeq: number
  modelOffline: boolean
}

const criteria: [Criterion, ...Criterion[]] = [
  { id: 'unit', kind: 'machine', description: '单元检查通过', required: true, checkDefinitionRef: 'unit-check' },
  { id: 'review', kind: 'human', description: '用户验收结果', required: true },
]
const scopeOf = (projectId: string): Scope => ({ projectId, allowedPaths: ['src/'], excludedPaths: ['.env'], externalActions: [] })
const contractOf = (workId: string, projectId: string, revision = 1, char = 'a') => ({
  workId, revision, digest: digest(char), goal: '整理支付模块的错题重试逻辑，交付可验证变更。', scope: scopeOf(projectId),
  criteria, authorityRef: 'authority-1', createdAt: at,
})
const refOf = (contract: ContractRef): ContractRef => ({ workId: contract.workId, revision: contract.revision, digest: contract.digest })
const attempt = (id: string, contract: ContractRef) => ({
  ticketId: `ticket-${id}`, assignmentId: `assignment-${id}`, attemptId: `attempt-${id}`, fenceEpoch: 1, contract: refOf(contract),
})

const question = (input: {
  id: string; kind: UserQuestion['kind']; contract: ReturnType<typeof contractOf>; prompt: string
  presentation: UserQuestion['presentation']; expiresAt?: string
}): UserQuestion => ({
  id: input.id, version: 1, kind: input.kind, contract: refOf(input.contract), scope: input.contract.scope,
  prompt: input.prompt, nativePayloadRef: `payload-${input.id}`,
  presentation: input.presentation,
  targets: [{
    ...attempt('alpha', input.contract), id: `target-${input.id}`, connectionEpoch: 1,
    nativeRequestId: { kind: 'string', value: `native-${input.id}` }, nativeMethod: 'request_user_input', provenanceRef: `prov-${input.id}`,
  }],
  openedAt: at, ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}), validity: 'open',
})

const view = (input: {
  id: string; projectId: string; title: string; phase: WorkView['phase']; resourceStatus: WorkView['resourceStatus']
  available: WorkView['actions']['available']; paused?: boolean; holdRevision?: number; candidateGeneration?: number
  verificationId?: string; retryToken?: string; openQuestionIds?: string[]
}): WorkView => {
  const contract = contractOf(input.id, input.projectId, 1, input.id === 'work-stale' ? 'd' : input.id === 'work-beta' ? 'b' : 'a')
  const ticketId = `ticket-${input.id}`, assignmentId = `assignment-${input.id}`
  return {
    work: { id: input.id, projectId: input.projectId, conversationId: conversation, title: input.title, createdAt: at },
    contract,
    links: [{ contract: refOf(contract), ticketId, role: 'primary', authorityRef: 'authority-1' }],
    phase: input.phase,
    coreSnapshotRef: `snapshot-${input.id}`,
    openQuestionIds: input.openQuestionIds ?? [],
    artifactIds: [],
    resourceStatus: input.resourceStatus,
    evidenceRefs: [],
    actions: {
      dispatchHold: { paused: input.paused ?? false, revision: input.holdRevision ?? 1 },
      ...(input.available.some(action => action !== 'pause_dispatch' && action !== 'resume_dispatch') || input.verificationId
        ? { currentAssignment: { ticketId, assignmentId, contract: refOf(contract) } } : {}),
      ...(input.candidateGeneration ? { currentCandidate: { ticketId, assignmentId, candidateGeneration: input.candidateGeneration, contract: refOf(contract) } } : {}),
      ...(input.verificationId ? { currentVerificationId: input.verificationId } : {}),
      ...(input.retryToken ? { retryActionToken: input.retryToken } : {}),
      available: input.available,
    },
  }
}

export const seedState = (): FixtureState => {
  const alpha = contractOf('work-alpha', 'project-atlas')
  const beta = contractOf('work-beta', 'project-atlas', 1, 'b')
  const stale = contractOf('work-stale', 'project-atlas', 1, 'd')
  const questions: UserQuestion[] = [
    question({
      id: 'q-choice', kind: 'clarification', contract: alpha, prompt: '重试窗口应采用哪种策略？',
      presentation: {
        kind: 'choices', multiple: false,
        options: [
          { id: 'opt-backoff', label: '指数退避（推荐）', semantic: 'business_choice' },
          { id: 'opt-fixed', label: '固定间隔 5 秒', semantic: 'business_choice' },
        ],
      },
      expiresAt: '2026-11-09T09:00:00.000Z',
    }),
    question({
      id: 'q-form', kind: 'clarification', contract: alpha, prompt: '补充重试上限与告警方式。',
      presentation: {
        kind: 'form',
        fields: [
          { id: 'max', label: '最大重试次数', kind: 'text', required: true },
          { id: 'alert', label: '失败时发送通知', kind: 'boolean', required: false },
        ],
      },
    }),
    question({
      id: 'q-free', kind: 'clarification', contract: alpha, prompt: '还有需要补充的业务约束吗？',
      presentation: { kind: 'free_text' },
    }),
    question({
      id: 'q-url', kind: 'authentication', contract: alpha, prompt: '请在原生客户端完成登录授权。',
      presentation: { kind: 'url_flow', vettedUrl: 'https://auth.example.invalid/device', purpose: '登录支付沙箱账户', statusRef: 'auth-status-1' },
    }),
    question({
      id: 'q-review', kind: 'review', contract: beta, prompt: '允许执行本次发布检查吗？',
      presentation: {
        kind: 'review', summary: '将运行只读版本检查并写入候选摘要，不修改生产数据。',
        options: [
          { id: 'opt-allow', label: '允许本次', semantic: 'allow_once' },
          { id: 'opt-deny', label: '拒绝', semantic: 'deny' },
        ],
      },
    }),
  ]
  const messages: ConversationMessage[] = [
    { id: 'msg-1', conversationId: conversation, sequence: 1, role: 'user', projectId: 'project-atlas', provenance: 'trusted_user', text: '帮我把支付模块的错题重试逻辑整理成可交付变更。', sourceRefs: [], createdAt: '2026-11-08T08:40:00.000Z' },
    { id: 'msg-2', conversationId: conversation, sequence: 2, role: 'assistant', provenance: 'reasoner_reply', text: '已建立委托 work-alpha 并开始执行；请在右侧处理待决定问题。', sourceRefs: ['work-alpha'], createdAt: '2026-11-08T08:41:00.000Z' },
    {
      id: 'msg-3', conversationId: conversation, sequence: 3, role: 'user', projectId: 'project-atlas', provenance: 'trusted_user',
      text: '补充：失败重试需要保留原始错误码与 request id，日志里要能看到 PaymentRetryCoordinator::terminalFailure 的上下文；另外这条消息故意很长，用来验证桌面与窄屏下的换行和横向溢出 —— retry-window / exponential-backoff / idempotency-key 这几个词混排也不应该撑破布局。',
      sourceRefs: [], createdAt: '2026-11-08T08:42:00.000Z',
    },
    { id: 'msg-4', conversationId: conversation, sequence: 4, role: 'assistant', provenance: 'reasoner_reply', text: '已收到补充，正在核对候选验证结果。', sourceRefs: [], createdAt: '2026-11-08T08:43:00.000Z' },
  ]
  const works: WorkView[] = [
    view({
      id: 'work-alpha', projectId: 'project-atlas', title: '支付错题重试：指数退避与错误码保留', phase: 'needs_user', resourceStatus: 'active',
      available: ['stop_work', 'pause_dispatch', 'continue_work'], candidateGeneration: 2, verificationId: 'verification-alpha',
      openQuestionIds: ['q-choice', 'q-form', 'q-free', 'q-url'],
    }),
    view({
      id: 'work-beta', projectId: 'project-atlas', title: '发布前只读检查与候选摘要', phase: 'verifying', resourceStatus: 'quiescent',
      available: ['accept_candidate', 'stop_work', 'retry_assignment'], candidateGeneration: 1, verificationId: 'verification-beta',
      retryToken: 'retry-token-beta', openQuestionIds: ['q-review'],
    }),
    view({
      id: 'work-gamma', projectId: 'project-atlas', title: '知识库索引重建（进行中）', phase: 'stopping', resourceStatus: 'indeterminate',
      available: [],
    }),
    view({
      id: 'work-stale', projectId: 'project-atlas', title: '旧候选：重试窗口已变更', phase: 'verifying', resourceStatus: 'quiescent',
      available: ['accept_candidate'], candidateGeneration: 1, verificationId: 'verification-stale',
    }),
    view({
      id: 'work-long', projectId: 'project-labs', title: '一个非常长的委托标题：跨项目依赖梳理、错误预算与回滚演练，以及 English Mixed Title That Must Wrap Without Breaking The Layout',
      phase: 'working', resourceStatus: 'active', available: ['stop_work', 'pause_dispatch'],
    }),
  ]
  return {
    cursor: 4,
    works,
    questions,
    messages,
    verifications: {
      'verification-alpha': {
        id: 'verification-alpha', artifactDigest: digest('e'), stale: false,
        results: [
          { criterionId: 'unit', outcome: 'PASS', evidenceRefs: ['check-unit-1'] },
          { criterionId: 'review', outcome: 'NOT_TESTED', evidenceRefs: [] },
        ],
        note: '机器检查通过；等待用户对交付结果验收。',
      },
      'verification-beta': {
        id: 'verification-beta', artifactDigest: digest('f'), stale: false,
        results: [{ criterionId: 'unit', outcome: 'PASS', evidenceRefs: ['check-unit-2'] }],
        note: '机器检查已通过；等待用户接受当前候选。',
      },
      'verification-stale': {
        id: 'verification-stale', artifactDigest: digest('1'), stale: true,
        results: [{ criterionId: 'unit', outcome: 'PASS', evidenceRefs: ['check-unit-old'] }],
        note: '该验证对应旧候选；新增输入后候选已过期。',
      },
    },
    deliveries: {
      'q-review': [{ targetBindingId: 'target-q-review', status: 'local_recorded' }],
    },
    changes: [],
    minRetainedSeq: 1,
    modelOffline: false,
  }
}

export const fixtureConfiguration = (): ApplicationConfiguration => {
  const project = (id: string): ApplicationConfiguration['projects'][number] => ({
    id,
    displayName: id === 'project-atlas' ? 'Atlas 项目' : 'Labs 项目',
    scope: { projectId: id, allowedPaths: ['src/'], excludedPaths: [], externalActions: [] },
    profileIds: ['profile-codex-local'],
    defaultProfileId: 'profile-codex-local',
    defaultCriteria: [
      { id: 'unit', kind: 'machine', description: '单元检查通过', required: true, checkDefinitionRef: 'check:unit' },
      { id: 'review', kind: 'human', description: '用户验收结果', required: true },
    ],
    dispatchAllowed: true,
  })
  return ApplicationConfigurationSchema.parse({
    protocol: 'application-configuration/1',
    revision: digest('c'),
    projects: [project('project-atlas'), project('project-labs')],
    profiles: [{
      id: 'profile-codex-local', revision: 1, displayName: 'Fixture local profile', driverId: 'fixture-local',
      kind: 'controlled_fixture', readiness: 'fixture_ready', dispatchAllowed: true,
    }],
    checks: [{ id: 'check:unit', revision: 1, displayName: 'Fixture unit check' }],
  })
}

type Listener = { push: (change: Change) => void; fail: (error: TransportError) => void }
const pageOf = (messages: readonly ConversationMessage[], conversationId: string, before?: number, limit = 50): ConversationPage => {
  const eligible = messages.filter(message => message.conversationId === conversationId && message.sequence < (before ?? Number.MAX_SAFE_INTEGER))
  const newest = eligible.slice(-limit)
  return ConversationPageSchema.parse({
    conversationId,
    messages: newest,
    ...(newest.length ? { beforeCursor: newest[0]!.sequence } : {}),
    hasMore: eligible.length > newest.length,
  })
}

export class FixtureAdapter implements ConsoleTransport {
  private state: FixtureState
  private readonly listeners = new Set<Listener>()
  private readonly storage: Storage | undefined
  private readonly receipts = new Map<string, { digest: string; receipt: CommandReceipt }>()
  readonly kind = 'fixture' as const

  constructor(storage?: Storage) {
    this.storage = storage
    this.state = this.load() ?? seedState()
  }

  private load(): FixtureState | undefined {
    try {
      const raw = this.storage?.getItem(STORAGE_KEY)
      if (!raw) return undefined
      const value = JSON.parse(raw) as FixtureState
      // Re-validate everything against the public schemas before trusting the snapshot.
      for (const work of value.works) SnapshotSchema.parse({ cursor: value.cursor, works: [work], questions: [] })
      for (const message of value.messages) ConversationPageSchema.parse({ conversationId: message.conversationId, messages: [message], hasMore: false })
      return value
    } catch { return undefined }
  }

  private persist(): void {
    try { this.storage?.setItem(STORAGE_KEY, JSON.stringify(this.state)) } catch { /* storage quota is not business state */ }
  }

  private emit(topic: string, entityRef: string, payload: Record<string, unknown>): Change {
    const change = ChangeSchema.parse({ seq: this.state.cursor + 1, topic, entityRef, payload })
    this.state.cursor = change.seq
    this.state.changes.push(change)
    const retained = Math.max(1, this.state.minRetainedSeq)
    if (this.state.changes.length > 60) this.state.changes = this.state.changes.slice(-60)
    for (const listener of this.listeners) listener.push(change)
    this.state.minRetainedSeq = Math.max(retained, this.state.changes[0]?.seq ?? this.state.cursor)
    this.persist()
    return change
  }

  async snapshot(query: InspectQuery): Promise<Snapshot> {
    const works = query.workId ? this.state.works.filter(work => work.work.id === query.workId) : this.state.works
    const open = this.state.questions.filter(question => question.validity === 'open')
    const limit = query.limit ?? 50
    const snapshot = SnapshotSchema.parse({
      cursor: this.state.cursor,
      works: works.map(work => ({ ...work, openQuestionIds: open.filter(question => question.contract.workId === work.work.id).map(question => question.id) })),
      questions: open,
      conversation: query.conversationId
        ? pageOf(this.state.messages, query.conversationId, query.beforeMessageCursor, limit)
        : pageOf(this.state.messages, conversation, undefined, limit),
    })
    return structuredClone(snapshot)
  }

  async messages(conversationId: string, options: { before?: number; limit?: number } = {}): Promise<ConversationPage> {
    return structuredClone(pageOf(this.state.messages, conversationId, options.before, options.limit ?? 50))
  }

  async verification(id: string): Promise<VerificationDetail | undefined> {
    const value = this.state.verifications[id]
    return value ? structuredClone(value) : undefined
  }

  async deliveries(questionId: string): Promise<readonly TargetDelivery[]> {
    return structuredClone(this.state.deliveries[questionId] ?? [])
  }

  async executors(): Promise<readonly ExecutorSnapshot[]> {
    return structuredClone(executorFixture())
  }

  async configuration(): Promise<ApplicationConfiguration | undefined> {
    return structuredClone(fixtureConfiguration())
  }

  async dispatch(command: UserCommand): Promise<CommandReceipt> {
    const body = JSON.stringify(command)
    const prior = this.receipts.get(command.commandId)
    if (prior) {
      if (prior.digest === body) return structuredClone(prior.receipt)
      return this.receipt(command, { code: 'conflict', message: '命令 ID 已用于不同正文', retry: 'user_action' })
    }
    const receipt = this.apply(command)
    this.receipts.set(command.commandId, { digest: body, receipt: structuredClone(receipt) })
    return receipt
  }

  private receipt(command: UserCommand, error?: { code: string; message: string; retry: 'safe' | 'reconcile' | 'user_action' | 'none' }, workId?: string): CommandReceipt {
    this.state.cursor += 1
    this.persist()
    return CommandReceiptSchema.parse(error
      ? { commandId: command.commandId, status: 'rejected', error, seq: this.state.cursor }
      : { commandId: command.commandId, status: 'recorded', seq: this.state.cursor, ...(workId ? { workId } : {}) })
  }

  private apply(command: UserCommand): CommandReceipt {
    switch (command.kind) {
      case 'chat': {
        if (this.state.modelOffline) {
          return this.receipt(command, { code: 'unsupported_capability', message: '模型离线：消息未发送。仍可查询、回答问题或停止工作。', retry: 'user_action' })
        }
        const user = this.appendMessage({ id: `msg-${crypto.randomUUID()}`, role: 'user', provenance: 'trusted_user', text: command.text, projectId: command.projectId, ...(command.anchor ? { anchor: command.anchor } : {}) })
        this.emit('conversation.message', conversation, { message: user })
        const reply = this.appendMessage({ id: `msg-${crypto.randomUUID()}`, role: 'assistant', provenance: 'reasoner_reply', text: '已记录你的补充，正在结合当前候选处理。', ...(command.anchor ? { anchor: command.anchor } : {}) })
        this.emit('conversation.message', conversation, { message: reply })
        return this.receipt(command)
      }
      case 'create_work': {
        const id = `work-${++this.state.cursor}`
        const contract = { ...contractOf(id, command.projectId), goal: command.goal, scope: command.scope, criteria: command.criteria }
        const work = view({ id, projectId: command.projectId, title: command.goal.slice(0, 60), phase: 'queued', resourceStatus: 'active', available: ['stop_work', 'pause_dispatch'] })
        this.state.works.unshift({ ...work, work: { ...work.work, title: command.goal.slice(0, 60) }, contract, links: [{ contract: refOf(contract), ticketId: `ticket-${id}`, role: 'primary', authorityRef: 'authority-1' }] })
        this.emit('work.created', id, { workId: id })
        return this.receipt(command, undefined, id)
      }
      case 'revise_work': {
        const work = this.workByContract(command.expected)
        if (!work) return this.receipt(command, { code: 'stale_contract', message: '合同版本已变化，请刷新后重试', retry: 'safe' })
        const contract = { ...work.contract, revision: work.contract.revision + 1, digest: digest('9'), goal: command.goal, scope: command.scope, criteria: command.criteria }
        work.contract = contract
        work.phase = 'evaluating'
        work.actions.dispatchHold = { ...work.actions.dispatchHold, revision: work.actions.dispatchHold.revision + 1 }
        this.emit('work.updated', work.work.id, { phase: work.phase })
        return this.receipt(command, undefined, work.work.id)
      }
      case 'stop_work': {
        const work = this.state.works.find(item => item.work.id === command.workId)
        if (!work) return this.receipt(command, { code: 'invalid_request', message: '未知工作', retry: 'user_action' })
        work.phase = 'stopping'
        work.resourceStatus = 'indeterminate'
        work.actions = { ...work.actions, available: [] }
        this.emit('work.updated', work.work.id, { phase: work.phase })
        return this.receipt(command, undefined, work.work.id)
      }
      case 'pause_dispatch':
      case 'resume_dispatch': {
        const work = this.workByContract(command.expected)
        if (!work) return this.receipt(command, { code: 'stale_contract', message: '合同版本已变化，请刷新后重试', retry: 'safe' })
        if (work.actions.dispatchHold.revision !== command.expectedHoldRevision) {
          return this.receipt(command, { code: 'conflict', message: '派工控制已被其他操作更新，请刷新后重试', retry: 'safe' })
        }
        const paused = command.kind === 'pause_dispatch'
        work.actions.dispatchHold = { paused, revision: work.actions.dispatchHold.revision + 1 }
        work.actions.available = work.actions.available.filter(action => action !== 'pause_dispatch' && action !== 'resume_dispatch')
        work.actions.available = [...work.actions.available, paused ? 'resume_dispatch' : 'pause_dispatch']
        this.emit('work.dispatch', work.work.id, { paused, revision: work.actions.dispatchHold.revision })
        return this.receipt(command, undefined, work.work.id)
      }
      case 'continue_work': {
        const work = this.workByContract(command.expected)
        if (!work) return this.receipt(command, { code: 'stale_contract', message: '合同版本已变化，请刷新后重试', retry: 'safe' })
        work.phase = 'working'
        this.emit('work.updated', work.work.id, { phase: work.phase })
        return this.receipt(command, undefined, work.work.id)
      }
      case 'retry_assignment': {
        const work = this.state.works.find(item => item.actions.currentAssignment?.assignmentId === command.expected.assignmentId)
        if (!work) return this.receipt(command, { code: 'stale_binding', message: '当前 assignment 已变化', retry: 'safe' })
        if (!work.actions.retryActionToken || work.actions.retryActionToken !== command.actionToken) {
          return this.receipt(command, { code: 'stale_binding', message: '重试令牌已过期，请刷新后重试', retry: 'safe' })
        }
        work.phase = 'working'
        this.emit('work.updated', work.work.id, { phase: work.phase })
        return this.receipt(command, undefined, work.work.id)
      }
      case 'answer_question': {
        const question = this.state.questions.find(item => item.id === command.questionId)
        if (!question) return this.receipt(command, { code: 'invalid_request', message: '未知问题', retry: 'user_action' })
        if (question.validity !== 'open') return this.receipt(command, { code: 'question_expired', message: '问题已过期或被处理', retry: 'safe' })
        if (question.version !== command.expectedVersion) return this.receipt(command, { code: 'conflict', message: '问题版本已变化，请刷新后重试', retry: 'safe' })
        const cancelled = command.answer.kind === 'url_action' && command.answer.action === 'cancel'
        this.state.deliveries[question.id] = question.targets.map(target => ({
          targetBindingId: target.id,
          status: cancelled ? 'expired' : 'local_recorded',
        }))
        question.validity = cancelled ? 'cancelled' : 'answered'
        this.emit('question.answered', question.id, { validity: question.validity, deliveries: this.state.deliveries[question.id] })
        return this.receipt(command)
      }
      case 'accept_candidate': {
        const work = this.state.works.find(item => item.actions.currentCandidate?.ticketId === command.candidate.ticketId
          && item.actions.currentCandidate?.assignmentId === command.candidate.assignmentId)
        if (!work) return this.receipt(command, { code: 'stale_candidate', message: '当前候选已变化', retry: 'safe' })
        const detail = work.actions.currentVerificationId ? this.state.verifications[work.actions.currentVerificationId] : undefined
        if (!detail || detail.stale || work.actions.currentCandidate?.candidateGeneration !== command.candidate.candidateGeneration) {
          return this.receipt(command, { code: 'stale_candidate', message: '该候选已过期，不能接受；请刷新或重新生成候选', retry: 'safe' })
        }
        const failed = detail.results.some(result => result.outcome !== 'PASS' && result.outcome !== 'NOT_APPLICABLE')
        if (failed) return this.receipt(command, { code: 'verification_failed', message: '存在未通过的必需检查，人工接受不能覆盖机器失败', retry: 'user_action' })
        work.phase = 'delivered'
        work.actions = { ...work.actions, available: [] }
        this.emit('work.delivered', work.work.id, { phase: work.phase })
        return this.receipt(command, undefined, work.work.id)
      }
      default:
        return this.receipt(command, { code: 'unsupported_capability', message: '该动作尚未接入工作台', retry: 'user_action' })
    }
  }

  private appendMessage(input: { id: string; role: ConversationMessage['role']; provenance: ConversationMessage['provenance']; text: string; projectId?: string; anchor?: ConversationMessage['anchor'] }): ConversationMessage {
    const sequence = (this.state.messages.at(-1)?.sequence ?? 0) + 1
    const message: ConversationMessage = {
      id: input.id, conversationId: conversation, sequence, role: input.role, provenance: input.provenance, text: input.text,
      sourceRefs: [], createdAt: new Date().toISOString(),
      ...(input.projectId ? { projectId: input.projectId } : {}),
      ...(input.anchor ? { anchor: input.anchor } : {}),
    }
    this.state.messages.push(message)
    return message
  }

  private workByContract(ref: { workId: string; revision: number; digest: string }): WorkView | undefined {
    return this.state.works.find(work => work.contract.workId === ref.workId && work.contract.revision === ref.revision && work.contract.digest === ref.digest)
  }

  async *changes(after: number, signal?: AbortSignal): AsyncIterable<Change> {
    if (after < this.state.cursor && after < this.state.minRetainedSeq - 1) {
      throw new TransportError('cursor_expired', '事件游标已过期，请重新获取快照', 'safe')
    }
    for (const change of this.state.changes.filter(item => item.seq > after)) yield change
    const queue: Change[] = []
    let wake: (() => void) | undefined
    let failure: TransportError | undefined
    let ended = false
    const listener: Listener = {
      push: change => { queue.push(change); wake?.() },
      fail: error => { failure = error; ended = true; wake?.() },
    }
    this.listeners.add(listener)
    const abort = (): void => { ended = true; wake?.() }
    signal?.addEventListener('abort', abort)
    try {
      while (!ended) {
        if (failure) throw failure
        const change = queue.shift()
        if (change) { yield change; continue }
        await new Promise<void>(resolve => { wake = resolve }).finally(() => { wake = undefined })
      }
      if (failure) throw failure
    } finally {
      signal?.removeEventListener('abort', abort)
      this.listeners.delete(listener)
    }
  }

  // ---- Development controls (fixture surface only; not product API) ----

  /** Simulates a dropped event stream; the transport itself works again immediately. */
  disconnect(): void {
    for (const listener of [...this.listeners]) listener.fail(new TransportError('storage_unavailable', '事件流断开（fixture）', 'safe'))
    this.listeners.clear()
  }

  /** Simulates missed events beyond the retained log so a stale reconnect sees `cursor_expired`. */
  expireCursor(): void {
    this.state.cursor += 5
    this.state.minRetainedSeq = this.state.cursor + 1
    this.state.changes = []
    this.persist()
  }

  setModelOffline(offline: boolean): void {
    this.state.modelOffline = offline
    this.persist()
  }

  modelOffline(): boolean { return this.state.modelOffline }
}
