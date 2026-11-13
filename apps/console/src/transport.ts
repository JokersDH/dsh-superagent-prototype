/**
 * The console transport boundary. The browser sends only a `UserCommand`; the trusted actor is
 * added by the backend after authentication. Both adapters validate everything they return with the
 * frozen runtime schemas, so a fixture cannot smuggle a shape the real product would reject.
 */
import {
  AnswerDeliverySchema,
  ApplicationConfigurationSchema,
  ChangeSchema,
  CommandReceiptSchema,
  ConversationPageSchema,
  SnapshotSchema,
  VerificationSchema,
  AssistantProviderStatusSchema,
  AssistantCandidatesSchema,
  AssistantCandidatePrepareSchema,
  AssistantSuggestionsSettingSchema,
  AssistantStreamUpdateSchema,
  ProjectRegistrationInputSchema,
  WorkLocationSchema,
  WorkEnvironmentSchema,
  WorkVerificationStatusSchema,
  VerificationRetryCommandSchema,
  ConversationCatalogQuerySchema,
  ConversationCatalogSchema,
  ConversationCommandSchema,
  ProjectSettingsPageSchema,
  ProjectSettingsCommandSchema,
  ReviewActivitySchema,
  AttentionPageSchema,
  AttentionQuerySchema,
  DecisionPrepareSchema,
  DecisionPreviewSchema,
  DecisionCommandSchema,
  DecisionQuerySchema,
  DecisionPageSchema,
  ProposalPrepareSchema,
  ProposalPreviewSchema,
  ProposalCommandSchema,
  WorkEvidenceSchema,
  WorkEvidenceHistorySchema,
  WorkEvidenceHistoryQuerySchema,
  ContextPreviewInputSchema,
  ContextPreviewSchema,
  AssistantContextPrepareSchema,
  AssistantContextPreparedSchema,
  AssistantContextSendSchema,
  AssistantContextBindingSchema,
  ContextHistoryQuerySchema,
  ContextHistorySchema,
  ContextSourcesSchema,
} from '@personal-agent/contracts'
import type {
  AgentProfile,
  ApplicationConfiguration,
  AssistantProviderStatus,
  AssistantCandidates,
  AssistantCandidatePrepare,
  AssistantStreamUpdate,
  Change,
  CommandReceipt,
  ConversationPage,
  InspectQuery,
  ProbeReport,
  Snapshot,
  UserCommand,
  ProjectRegistrationInput,
  WorkLocation,
  WorkEnvironment,
  WorkVerificationStatus,
  VerificationRetryCommand,
  ConversationCatalog,
  ConversationCatalogQuery,
  ConversationCommand,
  ProjectSettingsPage,
  ProjectSettingsCommand,
  ReviewActivity,
  AttentionPage,
  AttentionQuery,
  DecisionPrepare,
  DecisionPreview,
  DecisionCommand,
  DecisionQuery,
  DecisionPage,
  ProposalPrepare,
  ProposalPreview,
  ProposalCommand,
  WorkEvidence,
  WorkEvidenceHistory,
  WorkEvidenceHistoryQuery,
  ContextPreviewInput,
  ContextPreview,
  AssistantContextPrepare,
  AssistantContextPrepared,
  AssistantContextSend,
  AssistantContextBinding,
  ContextHistoryQuery,
  ContextHistory,
  ContextSources,
} from '@personal-agent/contracts'

export interface VerificationDetail {
  id: string
  artifactDigest: string
  results: readonly {
    criterionId: string
    outcome: 'PASS' | 'FAIL' | 'SKIPPED' | 'NOT_TESTED' | 'NOT_APPLICABLE'
    evidenceRefs: readonly string[]
  }[]
  stale: boolean
  note?: string
}

export interface ExecutorSnapshot {
  profile: AgentProfile
  report: ProbeReport
}

export interface TargetDelivery {
  targetBindingId: string
  status: 'local_recorded' | 'response_written' | 'native_applied' | 'indeterminate' | 'expired'
}

export interface ConsoleTransport {
  dispatch(command: UserCommand): Promise<CommandReceipt>
  snapshot(query: InspectQuery): Promise<Snapshot>
  messages(conversationId: string, options?: { before?: number; limit?: number }): Promise<ConversationPage>
  changes(after: number, signal?: AbortSignal): AsyncIterable<Change>
  /** Detail readers: the fixture lane and the product HTTP routes both provide them; a transport may omit them. */
  verification?(id: string): Promise<VerificationDetail | undefined>
  deliveries?(questionId: string): Promise<readonly TargetDelivery[]>
  /** AgentProfile/ProbeReport fixture until the main transport publishes the Catalog read entry. */
  executors?(): Promise<readonly ExecutorSnapshot[]>
  /** Approved artifact bytes through the product reader (returns undefined when no reader is wired). */
  artifact?(id: string): Promise<{ contentType: string; text: string } | undefined>
  /** Trusted startup configuration for the create-work form; undefined when the entry has no config port. */
  configuration?(): Promise<ApplicationConfiguration | undefined>
  assistant?(): Promise<AssistantProviderStatus | undefined>
  assistantChanges?(conversationId: string, signal: AbortSignal): AsyncIterable<AssistantStreamUpdate>
  selectModel?(model: string): Promise<AssistantProviderStatus>
  setAssistantSuggestions?(enabled: boolean): Promise<AssistantProviderStatus>
  replyCandidates?(messageId: string): Promise<AssistantCandidates>
  prepareReplyCandidate?(input: AssistantCandidatePrepare): Promise<ProposalPreview>
  registerProject?(input: ProjectRegistrationInput): Promise<ApplicationConfiguration>
  workLocation?(workId: string): Promise<WorkLocation | undefined>
  workEnvironment?(workId: string): Promise<WorkEnvironment | undefined>
  workVerification?(workId: string): Promise<WorkVerificationStatus | undefined>
  retryVerification?(command: VerificationRetryCommand): Promise<CommandReceipt>
  conversations?(query: ConversationCatalogQuery): Promise<ConversationCatalog | undefined>
  conversationCommand?(command: ConversationCommand): Promise<CommandReceipt>
  projectSettings?(projectId: string): Promise<ProjectSettingsPage>
  projectSettingsCommand?(command: ProjectSettingsCommand): Promise<CommandReceipt>
  reviewActivity?(activity: ReviewActivity): Promise<CommandReceipt>
  attention?(query: AttentionQuery): Promise<AttentionPage | undefined>
  prepareDecision?(input: DecisionPrepare): Promise<DecisionPreview>
  decisionCommand?(command: DecisionCommand): Promise<CommandReceipt>
  decisions?(query: DecisionQuery): Promise<DecisionPage>
  prepareProposal?(input: ProposalPrepare): Promise<ProposalPreview>
  proposalCommand?(command: ProposalCommand): Promise<CommandReceipt>
  workEvidence?(workId: string): Promise<WorkEvidence | undefined>
  workEvidenceHistory?(workId: string, query: WorkEvidenceHistoryQuery): Promise<WorkEvidenceHistory | undefined>
  contextPreview?(input: ContextPreviewInput): Promise<ContextPreview>
  prepareAssistantContext?(input: AssistantContextPrepare): Promise<AssistantContextPrepared>
  sendAssistantContext?(input: AssistantContextSend): Promise<CommandReceipt>
  assistantContext?(messageId: string): Promise<AssistantContextBinding | undefined>
  contextHistory?(query: ContextHistoryQuery): Promise<ContextHistory>
  contextSources?(messageId: string): Promise<ContextSources | undefined>
  /** Authenticated local session check/bootstrap (HTTP lane); the fixture lane is always authenticated. */
  session?(): Promise<boolean>
  bootstrap?(bootstrapToken: string): Promise<void>
}

export class TransportError extends Error {
  readonly code: string
  readonly retry: 'safe' | 'reconcile' | 'user_action' | 'none'
  constructor(code: string, message: string, retry: 'safe' | 'reconcile' | 'user_action' | 'none' = 'user_action') {
    super(message)
    this.code = code
    this.retry = retry
  }
}

const errorOf = (status: number, body: unknown): TransportError => {
  const value = body as { error?: { code?: string; message?: string; retry?: string } } | null
  if (value?.error?.code) {
    return new TransportError(
      value.error.code,
      value.error.message ?? `HTTP ${status}`,
      (value.error.retry as TransportError['retry']) ?? 'user_action',
    )
  }
  return new TransportError(
    status === 401 || status === 403 ? 'auth_required' : 'storage_unavailable',
    `HTTP ${status}`,
    'user_action',
  )
}
const missingOptionalResource = Symbol('missing optional product resource')

/** Product HTTP transport: POST /v1/commands, GET /v1/snapshot, messages page and the SSE change stream. */
export class HttpTransport implements ConsoleTransport {
  private readonly base: string
  constructor(base = '') {
    this.base = base
  }

  private async request(path: string, init?: RequestInit, optionalResource: boolean | 'json404' = false, receiptCommandId?: string): Promise<unknown> {
    let response: Response
    try {
      response = await fetch(`${this.base}${path}`, {
        ...init,
        credentials: 'include',
        headers: { accept: 'application/json', ...(init?.body ? { 'content-type': 'application/json' } : {}) },
      })
    } catch (error) {
      throw new TransportError('storage_unavailable', `无法连接产品服务：${String(error)}`, 'safe')
    }
    const text = await response.text()
    let body: unknown = undefined
    if (text) {
      try {
        body = JSON.parse(text)
      } catch {
        body = undefined
      }
    }
    if (optionalResource && response.status === 404 && (body === undefined || optionalResource === 'json404')) return missingOptionalResource
    if (!response.ok) {
      if (receiptCommandId) {
        const receipt = CommandReceiptSchema.safeParse(body)
        if (receipt.success) {
          if (receipt.data.commandId !== receiptCommandId) throw new TransportError('schema_mismatch', '回执命令身份不匹配')
          if (receipt.data.status === 'rejected') return receipt.data
        }
      }
      throw errorOf(response.status, body)
    }
    return body
  }

  async dispatch(command: UserCommand): Promise<CommandReceipt> {
    const body = await this.request('/v1/commands', { method: 'POST', body: JSON.stringify(command) })
    const parsed = CommandReceiptSchema.safeParse(body)
    if (!parsed.success) throw new TransportError('schema_mismatch', '命令回执不符合公共 schema', 'user_action')
    if (parsed.data.commandId !== command.commandId)
      throw new TransportError('schema_mismatch', '回执命令 ID 不匹配', 'user_action')
    return parsed.data
  }

  async snapshot(query: InspectQuery): Promise<Snapshot> {
    const params = new URLSearchParams()
    for (const [key, value] of Object.entries(query)) if (value !== undefined) params.set(key, String(value))
    const body = await this.request(`/v1/snapshot?${params.toString()}`)
    const parsed = SnapshotSchema.safeParse(body)
    if (!parsed.success) throw new TransportError('schema_mismatch', '快照不符合公共 schema', 'user_action')
    return parsed.data
  }

  async session(): Promise<boolean> {
    try {
      await this.request('/v1/session')
      return true
    } catch (error) {
      if (error instanceof TransportError && error.code === 'auth_required') return false
      throw error
    }
  }

  async bootstrap(bootstrapToken: string): Promise<void> {
    await this.request('/v1/session', { method: 'POST', body: JSON.stringify({ bootstrapToken }) })
  }

  async verification(id: string): Promise<VerificationDetail | undefined> {
    let body: unknown
    try {
      body = await this.request(`/v1/verifications/${encodeURIComponent(id)}`)
    } catch (error) {
      if (error instanceof TransportError && error.code === 'unsupported_capability') return undefined
      throw error
    }
    const parsed = VerificationSchema.safeParse(body)
    if (!parsed.success) throw new TransportError('schema_mismatch', '验证记录不符合公共 schema', 'user_action')
    return {
      id: parsed.data.id,
      artifactDigest: parsed.data.artifactDigest,
      results: parsed.data.results,
      stale: false,
      note: '产品验证记录（过期判定以当前候选与可用动作为准）',
    }
  }

  async deliveries(questionId: string): Promise<readonly TargetDelivery[]> {
    let body: unknown
    try {
      body = await this.request(`/v1/questions/${encodeURIComponent(questionId)}/deliveries`)
    } catch (error) {
      if (error instanceof TransportError && error.code === 'unsupported_capability') return []
      throw error
    }
    const parsed = AnswerDeliverySchema.array().safeParse(body)
    if (!parsed.success) throw new TransportError('schema_mismatch', '投递记录不符合公共 schema', 'user_action')
    return parsed.data.map((delivery) => ({ targetBindingId: delivery.targetBindingId, status: delivery.status }))
  }

  async configuration(): Promise<ApplicationConfiguration | undefined> {
    let body: unknown
    try {
      body = await this.request('/v1/configuration')
    } catch (error) {
      if (error instanceof TransportError && error.code === 'unsupported_capability') return undefined
      throw error
    }
    const parsed = ApplicationConfigurationSchema.safeParse(body)
    if (!parsed.success) throw new TransportError('schema_mismatch', '应用配置不符合公共 schema', 'user_action')
    return parsed.data
  }

  async assistant(): Promise<AssistantProviderStatus | undefined> {
    try {
      return AssistantProviderStatusSchema.parse(await this.request('/v1/assistant'))
    } catch (error) {
      if (error instanceof TransportError && error.code === 'unsupported_capability') return undefined
      throw error
    }
  }
  async registerProject(input: ProjectRegistrationInput): Promise<ApplicationConfiguration> {
    const body = await this.request('/v1/projects', {
      method: 'POST',
      body: JSON.stringify(ProjectRegistrationInputSchema.parse(input)),
    })
    return ApplicationConfigurationSchema.parse(body)
  }
  async workLocation(workId: string): Promise<WorkLocation | undefined> {
    try {
      return WorkLocationSchema.parse(await this.request(`/v1/works/${encodeURIComponent(workId)}/location`))
    } catch (error) {
      if (error instanceof TransportError && error.code === 'unsupported_capability') return undefined
      throw error
    }
  }
  async workEnvironment(workId: string): Promise<WorkEnvironment | undefined> {
    try {
      const value = WorkEnvironmentSchema.parse(await this.request(`/v1/works/${encodeURIComponent(workId)}/environment`))
      if (value.workId !== workId) throw new TransportError('schema_mismatch', '环境状态属于另一项工作')
      return value
    } catch (error) {
      if (error instanceof TransportError && error.code === 'unsupported_capability') return undefined
      throw error
    }
  }
  async selectModel(model: string): Promise<AssistantProviderStatus> {
    return AssistantProviderStatusSchema.parse(
      await this.request('/v1/assistant/model', { method: 'POST', body: JSON.stringify({ model }) }),
    )
  }
  async setAssistantSuggestions(enabled: boolean): Promise<AssistantProviderStatus> {
    const input = AssistantSuggestionsSettingSchema.parse({ enabled })
    const value = AssistantProviderStatusSchema.parse(await this.request('/v1/assistant/suggestions', { method: 'POST', body: JSON.stringify(input) }))
    if (value.suggestionsEnabled !== enabled) throw new TransportError('schema_mismatch', '提案建议设置结果尚未确认')
    return value
  }
  async replyCandidates(messageId: string): Promise<AssistantCandidates> {
    const value = AssistantCandidatesSchema.parse(await this.request(`/v1/messages/${encodeURIComponent(messageId)}/candidates`))
    if (value.messageId !== messageId) throw new TransportError('schema_mismatch', '建议属于另一条消息')
    return value
  }
  async prepareReplyCandidate(input: AssistantCandidatePrepare): Promise<ProposalPreview> {
    const value = AssistantCandidatePrepareSchema.parse(input)
    const preview = ProposalPreviewSchema.parse(await this.request('/v1/assistant/candidates/prepare', { method: 'POST', body: JSON.stringify(value) }))
    if (preview.record.sourceMessageId !== value.messageId || preview.record.payloadDigest !== value.payloadDigest || preview.record.payload.kind === 'reply')
      throw new TransportError('schema_mismatch', '建议预览与原选择不符')
    return preview
  }
  async workVerification(workId: string): Promise<WorkVerificationStatus | undefined> {
    try {
      const body = await this.request(`/v1/works/${encodeURIComponent(workId)}/verification`, undefined, true)
      if (body === missingOptionalResource) return undefined
      const value = WorkVerificationStatusSchema.parse(body)
      if (value.workId !== workId) throw new TransportError('schema_mismatch', '验证状态属于另一项工作')
      return value
    } catch (error) {
      if (error instanceof TransportError && error.code === 'unsupported_capability') return undefined
      throw error
    }
  }
  async retryVerification(input: VerificationRetryCommand): Promise<CommandReceipt> {
    const command = VerificationRetryCommandSchema.parse(input)
    const receipt = CommandReceiptSchema.parse(await this.request(`/v1/works/${encodeURIComponent(command.candidate.contract.workId)}/verification/retry`, {
      method: 'POST', body: JSON.stringify(command),
    }))
    if (receipt.commandId !== command.commandId || (receipt.workId && receipt.workId !== command.candidate.contract.workId))
      throw new TransportError('schema_mismatch', '验证恢复回执身份不匹配')
    return receipt
  }
  async conversations(input: ConversationCatalogQuery): Promise<ConversationCatalog | undefined> {
    const query = ConversationCatalogQuerySchema.parse(input), params = new URLSearchParams()
    for (const [key, value] of Object.entries(query)) if (value !== undefined) params.set(key, String(value))
    try {
      const body = await this.request(`/v1/conversations?${params}`, undefined, true)
      return body === missingOptionalResource ? undefined : ConversationCatalogSchema.parse(body)
    } catch (error) {
      if (error instanceof TransportError && error.code === 'unsupported_capability') return undefined
      throw error
    }
  }
  async conversationCommand(input: ConversationCommand): Promise<CommandReceipt> {
    const command = ConversationCommandSchema.parse(input)
    const receipt = CommandReceiptSchema.parse(await this.request('/v1/conversations/commands', { method: 'POST', body: JSON.stringify(command) }))
    if (receipt.commandId !== command.commandId) throw new TransportError('schema_mismatch', '会话回执身份不匹配')
    return receipt
  }
  async projectSettings(projectId: string): Promise<ProjectSettingsPage> {
    const value = ProjectSettingsPageSchema.parse(await this.request(`/v1/projects/${encodeURIComponent(projectId)}/settings`))
    if (value.current.projectId !== projectId) throw new TransportError('schema_mismatch', '项目设置身份不匹配')
    return value
  }
  async projectSettingsCommand(input: ProjectSettingsCommand): Promise<CommandReceipt> {
    const command = ProjectSettingsCommandSchema.parse(input)
    const receipt = CommandReceiptSchema.parse(await this.request(`/v1/projects/${encodeURIComponent(command.projectId)}/settings`, { method: 'POST', body: JSON.stringify(command) }))
    if (receipt.commandId !== command.commandId) throw new TransportError('schema_mismatch', '项目设置回执身份不匹配')
    return receipt
  }
  async prepareDecision(input: DecisionPrepare): Promise<DecisionPreview> {
    const value = DecisionPrepareSchema.parse(input)
    const preview = DecisionPreviewSchema.parse(await this.request('/v1/decisions/prepare', { method: 'POST', body: JSON.stringify(value) }))
    if (preview.sourceMessageId !== value.sourceMessageId || preview.conversationId !== value.conversationId || preview.decision.scope.projectId !== value.projectId)
      throw new TransportError('schema_mismatch', '决定预览来源不匹配')
    return preview
  }
  async decisionCommand(input: DecisionCommand): Promise<CommandReceipt> {
    const command = DecisionCommandSchema.parse(input)
    const receipt = CommandReceiptSchema.parse(await this.request('/v1/decisions/commands', { method: 'POST', body: JSON.stringify(command), signal: AbortSignal.timeout(10000) }))
    if (receipt.commandId !== command.commandId) throw new TransportError('schema_mismatch', '决定回执身份不匹配')
    return receipt
  }
  async decisions(input: DecisionQuery): Promise<DecisionPage> {
    const query = DecisionQuerySchema.parse(input), params = new URLSearchParams()
    for (const [key, value] of Object.entries(query)) if (value !== undefined) params.set(key, String(value))
    const page = DecisionPageSchema.parse(await this.request(`/v1/decisions?${params}`))
    if (page.decisions.some(value => value.record.decision.scope.projectId !== query.projectId)) throw new TransportError('schema_mismatch', '决定目录项目不匹配')
    return page
  }
  async prepareProposal(input: ProposalPrepare): Promise<ProposalPreview> {
    const value = ProposalPrepareSchema.parse(input)
    const preview = ProposalPreviewSchema.parse(await this.request('/v1/proposals/prepare', {
      method: 'POST', body: JSON.stringify(value), signal: AbortSignal.timeout(10000),
    }))
    const record = preview.record
    if (record.projectId !== value.projectId || record.conversationId !== value.conversationId || record.sourceMessageId !== value.sourceMessageId ||
      JSON.stringify(record.payload) !== JSON.stringify(value.payload))
      throw new TransportError('schema_mismatch', '提案预览与原消息或内容不匹配')
    return preview
  }
  async proposalCommand(input: ProposalCommand): Promise<CommandReceipt> {
    const command = ProposalCommandSchema.parse(input)
    const receipt = CommandReceiptSchema.parse(await this.request('/v1/proposals/commands', {
      method: 'POST', body: JSON.stringify(command), signal: AbortSignal.timeout(10000),
    }, false, command.commandId))
    if (receipt.commandId !== command.commandId) throw new TransportError('schema_mismatch', '提案回执命令身份不匹配')
    return receipt
  }
  async contextPreview(input: ContextPreviewInput): Promise<ContextPreview> {
    const value = ContextPreviewInputSchema.parse(input)
    const preview = ContextPreviewSchema.parse(await this.request('/v1/context/preview', {
      method: 'POST', body: JSON.stringify(value), signal: AbortSignal.timeout(10000),
    }))
    if (preview.projectId !== value.projectId || preview.conversationId !== value.conversationId ||
      preview.contract?.workId !== value.workId || [...preview.selections].sort().join() !== [...value.selections].sort().join())
      throw new TransportError('schema_mismatch', '上下文预览与所选项目、会话或工作不匹配')
    return preview
  }
  async prepareAssistantContext(input: AssistantContextPrepare): Promise<AssistantContextPrepared> {
    const value = AssistantContextPrepareSchema.parse(input)
    const prepared = AssistantContextPreparedSchema.parse(await this.request('/v1/assistant/context/prepare', {
      method: 'POST', body: JSON.stringify(value), signal: AbortSignal.timeout(10000),
    }))
    if (prepared.commandId !== value.commandId || prepared.text !== value.text || prepared.preview.projectId !== value.context.projectId ||
      prepared.preview.conversationId !== value.context.conversationId || prepared.preview.contract?.workId !== value.context.workId ||
      [...prepared.preview.selections].sort().join() !== [...value.context.selections].sort().join())
      throw new TransportError('schema_mismatch', '消息确认与原文、会话或所选来源不匹配')
    return prepared
  }
  async sendAssistantContext(input: AssistantContextSend): Promise<CommandReceipt> {
    const command = AssistantContextSendSchema.parse(input)
    const receipt = CommandReceiptSchema.parse(await this.request('/v1/assistant/context/send', {
      method: 'POST', body: JSON.stringify(command), signal: AbortSignal.timeout(10000),
    }, false, command.commandId))
    if (receipt.commandId !== command.commandId) throw new TransportError('schema_mismatch', '消息回执身份不匹配')
    return receipt
  }
  async assistantContext(messageId: string): Promise<AssistantContextBinding | undefined> {
    try {
      const body = await this.request(`/v1/messages/${encodeURIComponent(messageId)}/context`, undefined, 'json404')
      if (body === missingOptionalResource) return undefined
      const binding = AssistantContextBindingSchema.parse(body)
      if (binding.messageId !== messageId) throw new TransportError('schema_mismatch', '上下文记录属于另一条消息')
      return binding
    } catch (error) {
      if (error instanceof TransportError && error.code === 'unsupported_capability') return undefined
      throw error
    }
  }
  async contextHistory(input: ContextHistoryQuery): Promise<ContextHistory> {
    const query = ContextHistoryQuerySchema.parse(input), params = new URLSearchParams({ projectId: query.projectId })
    if (query.conversationId) params.set('conversationId', query.conversationId)
    if (query.workId) params.set('workId', query.workId)
    if (query.limit !== undefined) params.set('limit', String(query.limit))
    if (query.cursor) params.set('cursor', query.cursor)
    const page = ContextHistorySchema.parse(await this.request(`/v1/context/history?${params}`, { signal: AbortSignal.timeout(10000) }))
    if (page.projectId !== query.projectId || page.conversationId !== query.conversationId || page.workId !== query.workId ||
      page.entries.length > (query.limit ?? 20)) throw new TransportError('schema_mismatch', '使用记录与所选项目、会话或工作不匹配')
    return page
  }
  async contextSources(messageId: string): Promise<ContextSources | undefined> {
    try {
      const body = await this.request(`/v1/messages/${encodeURIComponent(messageId)}/context/sources`, { signal: AbortSignal.timeout(10000) }, 'json404')
      if (body === missingOptionalResource) return undefined
      const value = ContextSourcesSchema.parse(body)
      if (value.binding.messageId !== messageId) throw new TransportError('schema_mismatch', '来源正文属于另一条消息')
      return value
    } catch (error) {
      if (error instanceof TransportError && error.code === 'unsupported_capability') return undefined
      throw error
    }
  }
  async workEvidence(workId: string): Promise<WorkEvidence | undefined> {
    try {
      const body = await this.request(`/v1/works/${encodeURIComponent(workId)}/evidence`, undefined, true)
      if (body === missingOptionalResource) return undefined
      const value = WorkEvidenceSchema.parse(body)
      if (value.workId !== workId) throw new TransportError('schema_mismatch', '交付记录属于另一项工作')
      return value
    } catch (error) {
      if (error instanceof TransportError && error.code === 'unsupported_capability') return undefined
      throw error
    }
  }
  async workEvidenceHistory(workId: string, input: WorkEvidenceHistoryQuery): Promise<WorkEvidenceHistory | undefined> {
    const query = WorkEvidenceHistoryQuerySchema.parse(input), params = new URLSearchParams()
    for (const [key, value] of Object.entries(query)) if (value !== undefined) params.set(key, String(value))
    try {
      const body = await this.request(`/v1/works/${encodeURIComponent(workId)}/evidence/history?${params}`, undefined, true)
      if (body === missingOptionalResource) return undefined
      const page = WorkEvidenceHistorySchema.parse(body)
      if (page.workId !== workId) throw new TransportError('schema_mismatch', '交付历史属于另一项工作')
      return page
    } catch (error) {
      if (error instanceof TransportError && error.code === 'unsupported_capability') return undefined
      throw error
    }
  }
  async attention(input: AttentionQuery): Promise<AttentionPage | undefined> {
    const query = AttentionQuerySchema.parse(input), params = new URLSearchParams()
    for (const [key, value] of Object.entries(query)) if (value !== undefined) params.set(key, String(value))
    let body: unknown
    try { body = await this.request(`/v1/attention?${params}`, undefined, true) }
    catch (error) { if (error instanceof TransportError && error.code === 'unsupported_capability') return undefined; throw error }
    if (body === missingOptionalResource) return undefined
    const page = AttentionPageSchema.parse(body)
    if (query.projectId && page.items.some(item => item.projectId !== query.projectId))
      throw new TransportError('schema_mismatch', '待办与所选项目不匹配')
    return page
  }
  async reviewActivity(input: ReviewActivity): Promise<CommandReceipt> {
    const activity = ReviewActivitySchema.parse(input)
    const receipt = CommandReceiptSchema.parse(await this.request(`/v1/works/${encodeURIComponent(activity.candidate.contract.workId)}/review-activity`, {
      method: 'POST', body: JSON.stringify(activity), signal: AbortSignal.timeout(1000),
    }))
    if (receipt.commandId !== activity.commandId) throw new TransportError('schema_mismatch', 'Review activity receipt identity mismatch')
    return receipt
  }
  async *assistantChanges(conversationId: string, signal: AbortSignal): AsyncIterable<AssistantStreamUpdate> {
    if (signal.aborted) return
    const source = new EventSource(`${this.base}/v1/assistant/stream?${new URLSearchParams({ conversationId })}`)
    const queue = new Map<string, AssistantStreamUpdate>()
    let wake: (() => void) | undefined
    source.addEventListener('assistant_update', (event) => {
      try {
        const update = AssistantStreamUpdateSchema.parse(JSON.parse((event as MessageEvent).data))
        if (update.conversationId !== conversationId) return
        queue.set(update.messageId, update)
        wake?.()
      } catch {
        /* Display updates are advisory; the authenticated snapshot remains authoritative. */
      }
    })
    const abort = () => {
      source.close()
      wake?.()
    }
    signal.addEventListener('abort', abort)
    try {
      while (!signal.aborted) {
        const next = queue.entries().next()
        if (!next.done) {
          queue.delete(next.value[0])
          yield next.value[1]
          continue
        }
        await new Promise<void>((resolve) => {
          wake = resolve
        }).finally(() => {
          wake = undefined
        })
      }
    } finally {
      signal.removeEventListener('abort', abort)
      source.close()
    }
  }
  async artifact(id: string): Promise<{ contentType: string; text: string } | undefined> {
    let response: Response
    try {
      response = await fetch(`${this.base}/v1/artifacts/${encodeURIComponent(id)}`, {
        credentials: 'include',
        headers: { accept: 'text/plain, application/json, */*' },
      })
    } catch (error) {
      throw new TransportError('storage_unavailable', `无法读取产物：${String(error)}`, 'safe')
    }
    if (response.status === 422) return undefined
    if (!response.ok) {
      let body: unknown
      try {
        body = await response.json()
      } catch {
        body = undefined
      }
      throw errorOf(response.status, body)
    }
    return {
      contentType: response.headers.get('content-type') ?? 'application/octet-stream',
      text: await response.text(),
    }
  }

  async messages(conversationId: string, options: { before?: number; limit?: number } = {}): Promise<ConversationPage> {
    const params = new URLSearchParams()
    if (options.before !== undefined) params.set('before', String(options.before))
    if (options.limit !== undefined) params.set('limit', String(options.limit))
    const body = await this.request(
      `/v1/conversations/${encodeURIComponent(conversationId)}/messages?${params.toString()}`,
    )
    const parsed = ConversationPageSchema.safeParse(body)
    if (!parsed.success) throw new TransportError('schema_mismatch', '消息分页不符合公共 schema', 'user_action')
    return parsed.data
  }

  async *changes(after: number, signal?: AbortSignal): AsyncIterable<Change> {
    const source = new EventSource(`${this.base}/v1/events?after=${after}`)
    const queue: Change[] = []
    let wake: (() => void) | undefined
    let failure: TransportError | undefined
    let ended = false
    const push = (change: Change): void => {
      queue.push(change)
      wake?.()
    }
    const fail = (error: TransportError): void => {
      failure = error
      ended = true
      wake?.()
    }
    source.onmessage = (event) => {
      try {
        const parsed = ChangeSchema.safeParse(JSON.parse(event.data))
        if (parsed.success) push(parsed.data)
        else fail(new TransportError('schema_mismatch', '事件不符合公共 schema', 'user_action'))
      } catch {
        fail(new TransportError('schema_mismatch', '事件不是 JSON', 'user_action'))
      }
    }
    source.addEventListener('cursor_expired', () =>
      fail(new TransportError('cursor_expired', '事件游标已过期，请重新获取快照', 'safe')),
    )
    source.addEventListener('error', (event) => {
      try {
        const parsed = JSON.parse((event as MessageEvent).data) as {
          error?: { code?: string; message?: string; retry?: string }
        }
        const code = parsed.error?.code ?? 'storage_unavailable'
        fail(
          new TransportError(
            code,
            parsed.error?.message ?? '事件流不可用',
            (parsed.error?.retry as TransportError['retry']) ?? 'safe',
          ),
        )
      } catch {
        fail(new TransportError('storage_unavailable', '事件流不可用', 'safe'))
      }
    })
    source.onerror = () => {
      if (!ended) fail(new TransportError('storage_unavailable', '事件流断开', 'safe'))
    }
    const abort = (): void => {
      ended = true
      source.close()
      wake?.()
    }
    signal?.addEventListener('abort', abort)
    try {
      while (!ended) {
        if (failure) throw failure
        const change = queue.shift()
        if (change) {
          yield change
          continue
        }
        await new Promise<void>((resolve) => {
          wake = resolve
        }).finally(() => {
          wake = undefined
        })
      }
      if (failure) throw failure
    } finally {
      signal?.removeEventListener('abort', abort)
      source.close()
    }
  }
}

export const createConsoleTransport = (): ConsoleTransport => new HttpTransport()
