import { randomBytes, timingSafeEqual } from 'node:crypto'
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { cors } from 'hono/cors'
import { getCookie, setCookie, deleteCookie } from 'hono/cookie'
import { secureHeaders } from 'hono/secure-headers'
import { streamSSE } from 'hono/streaming'
import { z, ZodError } from 'zod'
import {
  AnswerDeliverySchema,
  AppErrorSchema,
  ApplicationConfigurationSchema,
  AssistantProviderStatusSchema,
  AssistantModelSelectionSchema,
  AssistantSuggestionsSettingSchema,
  AssistantCandidatePrepareSchema,
  AssistantCandidatesSchema,
  AssistantStreamUpdateSchema,
  ProjectRegistrationInputSchema,
  WorkLocationSchema,
  WorkEnvironmentSchema,
  ChangeSchema,
  CommandReceiptSchema,
  ConversationPageSchema,
  IdSchema,
  DigestSchema,
  InspectQuerySchema,
  SnapshotSchema,
  TrustedActorSchema,
  UserCommandSchema,
  VerificationSchema,
  WorkViewSchema,
  VerificationRetryCommandSchema,
  WorkVerificationStatusSchema,
  ConversationCatalogQuerySchema,
  ConversationCatalogSchema,
  ConversationSummarySchema,
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
  RecoveryInspectionSchema,
  RecoveryPrepareSchema,
  RecoveryPlanSchema,
  RecoveryActivationRecordSchema,
  RecoverySourcePrepareSchema,
  RecoverySourcePreparedSchema,
  RecoverySourceConfirmSchema,
  ContextPreviewInputSchema,
  ContextPreviewSchema,
  RecoveryTargetPrepareInputSchema,
  RecoveryTargetStatusSchema,
  AssistantContextPrepareSchema,
  AssistantContextPreparedSchema,
  AssistantContextSendSchema,
  AssistantContextBindingSchema,
  ContextHistoryQuerySchema,
  ContextHistorySchema,
  ContextSourcesSchema,
} from '@personal-agent/contracts'
import type {
  RecoveryTargetPrepareInput,
  RecoveryTargetStatus,
  AssistantContextPrepare,
  AssistantContextPrepared,
  AssistantContextSend,
  AssistantContextBinding,
  ContextHistoryQuery,
  ContextHistory,
  ContextSources,
  ContextPreviewInput,
  ContextPreview,
  AnswerDelivery,
  ApplicationConfiguration,
  AssistantProviderStatus,
  AssistantCandidatePrepare,
  AssistantCandidates,
  AssistantStreamUpdate,
  ProjectRegistrationInput,
  WorkLocation,
  WorkEnvironment,
  AppError,
  ApplicationService,
  TrustedActor,
  Verification,
  CommandReceipt,
  VerificationRetryCommand,
  WorkVerificationStatus,
  ConversationCatalog,
  ConversationCatalogQuery,
  ConversationSummary,
  ConversationCommand,
  WorkView,
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
  RecoveryInspection,
  RecoveryPrepare,
  RecoveryPlan,
  RecoveryActivationRecord,
  RecoverySourcePrepare,
  RecoverySourcePrepared,
  RecoverySourceConfirm,
} from '@personal-agent/contracts'
import { ApplicationFault } from '@personal-agent/application'
import { QuestionFault } from '@personal-agent/questions'

const COOKIE = 'pa_local_session'
const sameSecret = (input: string | undefined, expected: string): boolean =>
  !!input &&
  Buffer.byteLength(input) === Buffer.byteLength(expected) &&
  timingSafeEqual(Buffer.from(input), Buffer.from(expected))
const sessionInput = z.strictObject({ bootstrapToken: z.string().regex(/^[a-f0-9]{64}$/) })
const readonlyWork = (work: WorkView): WorkView => {
  const { retryActionToken: _, ...actions } = work.actions
  return { ...work, actions: { ...actions, available: [] } }
}
const statusOf = (error: AppError): 400 | 401 | 403 | 409 | 422 | 503 =>
  error.code === 'auth_required'
    ? 401
    : error.code === 'forbidden'
      ? 403
      : [
            'conflict',
            'stale_contract',
            'stale_candidate',
            'stale_binding',
            'cursor_expired',
            'question_expired',
            'state_in_use',
          ].includes(error.code)
        ? 409
        : error.code === 'storage_unavailable'
          ? 503
          : error.code === 'invalid_request' || error.code === 'schema_mismatch'
            ? 400
            : 422
export interface LocalHttpOptions {
  application: ApplicationService
  principal: { userId: string; authorityRef: string }
  bootstrapToken: string
  apiToken: string
  allowedOrigins: readonly string[]
  sessionTtlMs?: number
  mode: 'fixture' | 'product' | 'personal'
  startupMode?: 'normal' | 'recovery_readonly'
  restoredReviewDigest?: string
  /** Explicit loopback-only fixture convenience; normal entries still require credentials. */
  localDevelopmentAccess?: boolean
  now?: () => number
  operations?: {
    retryVerification(command: VerificationRetryCommand, actor: TrustedActor): Promise<CommandReceipt>
    conversation?(command: ConversationCommand, actor: TrustedActor): Promise<CommandReceipt>
    projectSettings?(command: ProjectSettingsCommand, actor: TrustedActor): Promise<CommandReceipt>
    reviewActivity?(activity: ReviewActivity, actor: TrustedActor): Promise<CommandReceipt>
    prepareDecision?(input: DecisionPrepare, actor: TrustedActor): Promise<DecisionPreview>
    decision?(command: DecisionCommand, actor: TrustedActor): Promise<CommandReceipt>
    recoveryPrepare?(input: RecoveryPrepare, actor: TrustedActor): Promise<RecoveryPlan>
    recoverySourcePrepare?(input: RecoverySourcePrepare, actor: TrustedActor): Promise<RecoverySourcePrepared>
    recoverySourceConfirm?(input: RecoverySourceConfirm, actor: TrustedActor): Promise<RecoveryActivationRecord>
    prepareProposal?(input: ProposalPrepare, actor: TrustedActor): Promise<ProposalPreview>
    prepareReplyCandidate?(input: AssistantCandidatePrepare, actor: TrustedActor): Promise<ProposalPreview>
    proposal?(command: ProposalCommand, actor: TrustedActor): Promise<CommandReceipt>
    contextPreview?(input: ContextPreviewInput, actor: TrustedActor): Promise<ContextPreview>
    recoveryTargetPrepare?(input: RecoveryTargetPrepareInput, actor: TrustedActor): Promise<RecoveryTargetStatus>
    assistantContextPrepare?(input: AssistantContextPrepare, actor: TrustedActor): Promise<AssistantContextPrepared>
    assistantContextSend?(input: AssistantContextSend, actor: TrustedActor): Promise<CommandReceipt>
  }
  read?: {
    attention?(query: AttentionQuery): Promise<AttentionPage>
    decisions?(query: DecisionQuery): Promise<DecisionPage>
    recovery?(): Promise<RecoveryInspection>
    recoveryActivation?(activationId: string): Promise<RecoveryActivationRecord | undefined>
    recoveryTarget?(activationId: string): Promise<RecoveryTargetStatus | undefined>
    assistantContext?(messageId: string): Promise<AssistantContextBinding | undefined>
    contextHistory?(query: ContextHistoryQuery): Promise<ContextHistory>
    contextSources?(messageId: string): Promise<ContextSources | undefined>
    conversations?(query: ConversationCatalogQuery): Promise<ConversationCatalog>
    conversation?(id: string): Promise<ConversationSummary>
    projectSettings?(projectId: string): Promise<ProjectSettingsPage>
    assistant?(): Promise<AssistantProviderStatus>
    assistantStream?(conversationId: string, signal: AbortSignal): AsyncIterable<AssistantStreamUpdate>
    selectModel?(model: string): Promise<AssistantProviderStatus>
    setAssistantSuggestions?(enabled: boolean): Promise<AssistantProviderStatus>
    replyCandidates?(messageId: string): Promise<AssistantCandidates>
    guide?(): Promise<string>
    registerProject?(input: ProjectRegistrationInput): Promise<ApplicationConfiguration>
    workLocation?(workId: string): Promise<WorkLocation>
    workEnvironment?(workId: string): Promise<WorkEnvironment>
    workVerification?(workId: string): Promise<WorkVerificationStatus>
    workEvidence?(workId: string): Promise<WorkEvidence>
    workEvidenceHistory?(workId: string, query: WorkEvidenceHistoryQuery): Promise<WorkEvidenceHistory>
    configuration?(): Promise<ApplicationConfiguration>
    verification?(id: string): Promise<Verification | undefined>
    deliveries?(questionId: string): Promise<readonly AnswerDelivery[]>
    artifact?(id: string): Promise<{ body: ReadableStream<Uint8Array>; contentType: string } | undefined>
  }
}

/** The HTTP module owns identity. Request bodies never contain actor or direct core/native access. */
export function createLocalHttpApp(options: LocalHttpOptions) {
  const restoredReviewDigest = options.restoredReviewDigest === undefined ? undefined : DigestSchema.parse(options.restoredReviewDigest)
  if (restoredReviewDigest && (options.mode !== 'personal' || options.startupMode !== 'recovery_readonly'))
    throw new TypeError('A review identity is valid only for a restored personal process')
  if (options.localDevelopmentAccess && !['fixture', 'personal'].includes(options.mode))
    throw new TypeError('Automatic local access is restricted to fixture/personal loopback entries')
  for (const secret of [options.bootstrapToken, options.apiToken])
    if (!/^[a-f0-9]{64}$/.test(secret)) throw new TypeError('Local HTTP credentials need 256 random bits')
  const actorBase = {
    userId: IdSchema.parse(options.principal.userId),
    authorityRef: IdSchema.parse(options.principal.authorityRef),
  }
  const origins = new Set(options.allowedOrigins)
  for (const value of origins) {
    const url = new URL(value)
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.origin !== value ||
      !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
    )
      throw new TypeError('Console origins must be exact loopback origins')
  }
  const now = options.now ?? Date.now,
    ttl = options.sessionTtlMs ?? 8 * 60 * 60 * 1000
  if (!Number.isSafeInteger(ttl) || ttl < 1000 || ttl > 24 * 60 * 60 * 1000)
    throw new TypeError('Invalid local session lifetime')
  const sessions = new Map<string, number>()
  const app = new Hono<{ Variables: { actor: TrustedActor } }>()
  app.use('*', secureHeaders())
  app.use('*', async (c, next) => {
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(new URL(c.req.url).hostname))
      throw new ApplicationFault('forbidden', 'Unrecognized local host', 'none')
    const host = c.req.header('host')
    if (host) {
      const parsed = new URL(`http://${host}`)
      if (
        !['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname) ||
        parsed.username ||
        parsed.password ||
        parsed.pathname !== '/' ||
        parsed.search ||
        parsed.hash
      )
        throw new ApplicationFault('forbidden', 'Unrecognized Host header', 'none')
    }
    const origin = c.req.header('origin')
    if (origin && !origins.has(origin))
      throw new ApplicationFault('forbidden', 'Origin is not an authorized console', 'none')
    c.header('cache-control', 'no-store')
    await next()
    c.header('cache-control', 'no-store')
  })
  app.use(
    '*',
    cors({
      origin: (origin) => (origins.has(origin) ? origin : undefined),
      credentials: true,
      allowMethods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Authorization', 'Last-Event-ID'],
      exposeHeaders: ['Content-Type'],
    }),
  )
  app.use(
    '*',
    (c, next) => bodyLimit({
      maxSize: ['/v1/proposals/commands', '/v1/decisions/commands', '/v1/assistant/context/prepare', '/v1/assistant/context/send', '/v1/recovery/source/prepare', '/v1/recovery/source/confirm'].includes(c.req.path) ? 256 * 1024 : 64 * 1024,
      onError: (c) =>
        c.json(
          { error: { code: 'invalid_request', message: 'Request body exceeds the local limit', retry: 'none' } },
          413,
        ),
    })(c, next),
  )
  app.get('/v1/health', (c) =>
    c.json({
      status: 'ok',
      mode: options.mode,
      ...(options.startupMode === 'recovery_readonly' ? { startupMode: options.startupMode } : {}),
      ...(restoredReviewDigest ? { restoredReviewDigest } : {}),
      ...(options.localDevelopmentAccess ? { access: 'local-development' } : {}),
    }),
  )
  app.post('/v1/session', async (c) => {
    if (options.localDevelopmentAccess) {
      if (!origins.has(c.req.header('origin') ?? ''))
        throw new ApplicationFault('forbidden', 'Local writes require the console Origin', 'none')
      return c.json({ status: 'authenticated' })
    }
    if (!c.req.header('content-type')?.toLowerCase().startsWith('application/json'))
      throw new ApplicationFault('invalid_request', 'Session bootstrap needs JSON', 'none')
    const body = sessionInput.parse(await c.req.json())
    if (!sameSecret(body.bootstrapToken, options.bootstrapToken))
      throw new ApplicationFault('auth_required', 'Local bootstrap credential is required', 'user_action')
    for (const [id, expires] of sessions) if (expires <= now()) sessions.delete(id)
    if (sessions.size >= 64) throw new ApplicationFault('budget_exceeded', 'Local session limit reached', 'user_action')
    const id = randomBytes(32).toString('hex')
    sessions.set(id, now() + ttl)
    setCookie(c, COOKIE, id, { httpOnly: true, sameSite: 'Strict', path: '/', maxAge: Math.floor(ttl / 1000) })
    return c.json({ status: 'authenticated' })
  })
  app.use('/v1/*', async (c, next) => {
    const bearer = c.req.header('authorization')
    if (bearer && sameSecret(bearer, `Bearer ${options.apiToken}`)) {
      c.set('actor', TrustedActorSchema.parse({ ...actorBase, source: 'local_cli' }))
      await next()
      return
    }
    if (bearer) throw new ApplicationFault('auth_required', 'Invalid local API credential', 'user_action')
    if (options.localDevelopmentAccess) {
      if (
        c.req.header('sec-fetch-site') === 'cross-site' ||
        (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method) && !origins.has(c.req.header('origin') ?? ''))
      )
        throw new ApplicationFault('forbidden', 'Local requests must come from the configured console', 'none')
      c.set('actor', TrustedActorSchema.parse({ ...actorBase, source: 'local_ui' }))
      await next()
      return
    }
    const id = getCookie(c, COOKIE),
      expiry = id && sessions.get(id)
    if (!id || !expiry || expiry <= now()) {
      if (id) sessions.delete(id)
      throw new ApplicationFault('auth_required', 'An authenticated local session is required', 'user_action')
    }
    // Cookie-authenticated writes require an exact Origin and JSON, in addition to SameSite=Strict.
    if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method) && !origins.has(c.req.header('origin') ?? ''))
      throw new ApplicationFault('forbidden', 'Cookie writes require the authorized console Origin', 'none')
    c.set('actor', TrustedActorSchema.parse({ ...actorBase, source: 'local_ui' }))
    await next()
  })
  app.get('/v1/session', (c) => c.json({ status: 'authenticated' }))
  app.use('/v1/*', async (c, next) => {
    const readOnlyRecoveryPreparation = c.req.method === 'POST' && ['/v1/recovery/prepare', '/v1/recovery/targets/prepare', '/v1/recovery/source/prepare', '/v1/recovery/source/confirm'].includes(c.req.path)
    if (options.startupMode === 'recovery_readonly' && !readOnlyRecoveryPreparation && !['GET', 'HEAD', 'OPTIONS', 'DELETE'].includes(c.req.method))
      throw new ApplicationFault('unsupported_capability', 'Restored state is read-only until explicit recovery and local revalidation', 'none')
    await next()
  })
  app.get('/v1/recovery/inspect', async (c) => {
    if (Object.keys(c.req.query()).length) throw new ApplicationFault('invalid_request', 'Recovery inspection accepts no query')
    if (!options.read?.recovery) throw new ApplicationFault('unsupported_capability', 'Recovery inspection is not connected')
    return c.json(RecoveryInspectionSchema.parse(await options.read.recovery()))
  })
  app.get('/v1/recovery/activations/:id', async (c) => {
    if (Object.keys(c.req.query()).length) throw new ApplicationFault('invalid_request', 'Recovery record accepts no query')
    if (!options.read?.recoveryActivation) throw new ApplicationFault('unsupported_capability', 'Recovery record reader is not connected')
    const id = IdSchema.parse(c.req.param('id')), record = await options.read.recoveryActivation(id)
    if (!record) return c.json({ error: { code: 'invalid_request', message: 'Recovery record was not found', retry: 'user_action' } }, 404)
    const value = RecoveryActivationRecordSchema.parse(record)
    if (value.committed.intent.activationId !== id) throw new ApplicationFault('storage_unavailable', 'Recovery record identity mismatch', 'none')
    return c.json(value)
  })
  app.post('/v1/recovery/prepare', async (c) => {
    if (options.startupMode !== 'recovery_readonly') throw new ApplicationFault('unsupported_capability', 'Recovery preflight requires read-only startup')
    if (!c.req.header('content-type')?.toLowerCase().startsWith('application/json')) throw new ApplicationFault('invalid_request', 'Recovery preflight requires JSON')
    if (!options.operations?.recoveryPrepare) throw new ApplicationFault('unsupported_capability', 'Recovery preparation is not connected')
    return c.json(RecoveryPlanSchema.parse(await options.operations.recoveryPrepare(RecoveryPrepareSchema.parse(await c.req.json()), c.get('actor'))))
  })
  app.post('/v1/recovery/source/prepare', async c => {
    if (options.startupMode !== 'recovery_readonly') throw new ApplicationFault('unsupported_capability', 'Source preparation requires restored read-only startup')
    if (Object.keys(c.req.query()).length || !c.req.header('content-type')?.toLowerCase().startsWith('application/json'))
      throw new ApplicationFault('invalid_request', 'Source preparation requires JSON without a query')
    if (!options.operations?.recoverySourcePrepare) throw new ApplicationFault('unsupported_capability', 'Source confirmation is not connected')
    return c.json(RecoverySourcePreparedSchema.parse(await options.operations.recoverySourcePrepare(RecoverySourcePrepareSchema.parse(await c.req.json()), c.get('actor'))))
  })
  app.post('/v1/recovery/source/confirm', async c => {
    if (options.startupMode !== 'recovery_readonly') throw new ApplicationFault('unsupported_capability', 'Source confirmation requires restored read-only startup')
    if (Object.keys(c.req.query()).length || !c.req.header('content-type')?.toLowerCase().startsWith('application/json'))
      throw new ApplicationFault('invalid_request', 'Source confirmation requires JSON without a query')
    if (!options.operations?.recoverySourceConfirm) throw new ApplicationFault('unsupported_capability', 'Source confirmation is not connected')
    return c.json(RecoveryActivationRecordSchema.parse(await options.operations.recoverySourceConfirm(RecoverySourceConfirmSchema.parse(await c.req.json()), c.get('actor'))))
  })
  app.get('/v1/recovery/targets/:id', async c => {
    if (Object.keys(c.req.query()).length) throw new ApplicationFault('invalid_request', 'Target status accepts no query')
    if (!options.read?.recoveryTarget) throw new ApplicationFault('unsupported_capability', 'Target preparation is not connected')
    const id = IdSchema.parse(c.req.param('id')), result = await options.read.recoveryTarget(id)
    if (!result) return c.json({ error: { code: 'invalid_request', message: 'Recovery target was not found', retry: 'user_action' } }, 404)
    const value = RecoveryTargetStatusSchema.parse(result)
    if (value.activationId !== id) throw new ApplicationFault('storage_unavailable', 'Target status identity mismatch', 'none')
    return c.json(value)
  })
  app.post('/v1/recovery/targets/prepare', async c => {
    if (options.startupMode !== 'recovery_readonly') throw new ApplicationFault('unsupported_capability', 'Target preparation requires restored read-only startup')
    if (Object.keys(c.req.query()).length) throw new ApplicationFault('invalid_request', 'Target preparation accepts no query')
    if (!c.req.header('content-type')?.toLowerCase().startsWith('application/json')) throw new ApplicationFault('invalid_request', 'Target preparation requires JSON')
    if (!options.operations?.recoveryTargetPrepare) throw new ApplicationFault('unsupported_capability', 'Target preparation is not connected')
    const input = RecoveryTargetPrepareInputSchema.parse(await c.req.json())
    const result = RecoveryTargetStatusSchema.parse(await options.operations.recoveryTargetPrepare(input, c.get('actor')))
    if (result.activationId !== input.activationId) throw new ApplicationFault('storage_unavailable', 'Target preparation identity mismatch', 'none')
    return c.json(result)
  })
  app.get('/v1/configuration', async (c) => {
    if (Object.keys(c.req.query()).length)
      throw new ApplicationFault('invalid_request', 'Configuration does not accept query parameters')
    if (!options.read?.configuration)
      throw new ApplicationFault('unsupported_capability', 'Configuration read port is not connected')
    const value = ApplicationConfigurationSchema.parse(await options.read.configuration())
    return c.json(options.startupMode === 'recovery_readonly' ? ApplicationConfigurationSchema.parse({ ...value, reviewActivityAvailable: false, decisionsAvailable: false, proposalsAvailable: false, contextPreviewAvailable: false, assistantContextAvailable: false,
      executionAvailability: { state: 'unavailable', reason: 'recovery_readonly' },
      profiles: value.profiles.map(profile => ({ ...profile, dispatchAllowed: false, blockedReason: 'writer_indeterminate' })),
      projects: value.projects.map(project => { const { defaultProfileId: _, ...rest } = project; return { ...rest, profileIds: [], dispatchAllowed: false, blockedReason: 'writer_indeterminate' } }),
    }) : value)
  })
  app.post('/v1/context/preview', async (c) => {
    if (!c.req.header('content-type')?.toLowerCase().startsWith('application/json')) throw new ApplicationFault('invalid_request', 'Context preview requires JSON')
    if (!options.operations?.contextPreview) throw new ApplicationFault('unsupported_capability', 'Context preview is not connected')
    return c.json(ContextPreviewSchema.parse(await options.operations.contextPreview(ContextPreviewInputSchema.parse(await c.req.json()), c.get('actor'))))
  })
  app.post('/v1/assistant/context/prepare', async c => {
    if (Object.keys(c.req.query()).length) throw new ApplicationFault('invalid_request', 'Context confirmation accepts no query')
    if (!c.req.header('content-type')?.toLowerCase().startsWith('application/json')) throw new ApplicationFault('invalid_request', 'Context confirmation requires JSON')
    if (!options.operations?.assistantContextPrepare) throw new ApplicationFault('unsupported_capability', 'Context discussion is not connected')
    const input = AssistantContextPrepareSchema.parse(await c.req.json())
    const result = AssistantContextPreparedSchema.parse(await options.operations.assistantContextPrepare(input, c.get('actor')))
    if (result.commandId !== input.commandId || result.text !== input.text || result.preview.projectId !== input.context.projectId ||
      result.preview.conversationId !== input.context.conversationId || result.preview.contract?.workId !== input.context.workId ||
      JSON.stringify(result.preview.selections) !== JSON.stringify(input.context.selections))
      throw new ApplicationFault('storage_unavailable', 'Context confirmation identity mismatch', 'none')
    return c.json(result)
  })
  app.post('/v1/assistant/context/send', async c => {
    if (Object.keys(c.req.query()).length) throw new ApplicationFault('invalid_request', 'Context message accepts no query')
    if (!c.req.header('content-type')?.toLowerCase().startsWith('application/json')) throw new ApplicationFault('invalid_request', 'Context message requires JSON')
    if (!options.operations?.assistantContextSend) throw new ApplicationFault('unsupported_capability', 'Context discussion is not connected')
    const input = AssistantContextSendSchema.parse(await c.req.json())
    const receipt = CommandReceiptSchema.parse(await options.operations.assistantContextSend(input, c.get('actor')))
    if (receipt.commandId !== input.commandId) throw new ApplicationFault('storage_unavailable', 'Context message receipt identity mismatch', 'none')
    return c.json(receipt, receipt.status === 'rejected' ? statusOf(receipt.error) : 200)
  })
  app.get('/v1/context/history', async c => {
    const params = new URL(c.req.url).searchParams
    for (const key of params.keys()) if (params.getAll(key).length !== 1)
      throw new ApplicationFault('invalid_request', 'Context history does not accept repeated parameters')
    const value = { ...c.req.query() } as Record<string, unknown>
    if (typeof value.limit === 'string') {
      if (!/^\d+$/.test(value.limit)) throw new ApplicationFault('invalid_request', 'Context history limit must be an integer')
      value.limit = Number(value.limit)
    }
    const input = ContextHistoryQuerySchema.parse(value)
    if (!options.read?.contextHistory) throw new ApplicationFault('unsupported_capability', 'Context history is not connected')
    const page = ContextHistorySchema.parse(await options.read.contextHistory(input))
    if (page.projectId !== input.projectId || page.conversationId !== input.conversationId || page.workId !== input.workId ||
      page.entries.length > (input.limit ?? 20)) throw new ApplicationFault('storage_unavailable', 'Context history scope mismatch', 'none')
    return c.json(page)
  })
  app.get('/v1/messages/:id/candidates', async c => {
    if (Object.keys(c.req.query()).length) throw new ApplicationFault('invalid_request', 'Reply candidates accept no query')
    if (!options.read?.replyCandidates) throw new ApplicationFault('unsupported_capability', 'Reply candidates are not connected')
    const id = IdSchema.parse(c.req.param('id')), value = AssistantCandidatesSchema.parse(await options.read.replyCandidates(id))
    if (value.messageId !== id) throw new ApplicationFault('storage_unavailable', 'Reply candidate source mismatch', 'none')
    return c.json(value)
  })
  app.post('/v1/assistant/candidates/prepare', async c => {
    if (!c.req.header('content-type')?.startsWith('application/json')) throw new ApplicationFault('invalid_request', 'Reply candidate preparation requires JSON')
    if (!options.operations?.prepareReplyCandidate) throw new ApplicationFault('unsupported_capability', 'Reply candidate preparation is not connected')
    const input = AssistantCandidatePrepareSchema.parse(await c.req.json())
    const value = ProposalPreviewSchema.parse(await options.operations.prepareReplyCandidate(input, c.get('actor')))
    if (value.record.sourceMessageId !== input.messageId || value.record.payloadDigest !== input.payloadDigest)
      throw new ApplicationFault('storage_unavailable', 'Reply candidate preview mismatch', 'none')
    return c.json(value)
  })
  app.get('/v1/messages/:id/context/sources', async c => {
    if (Object.keys(c.req.query()).length) throw new ApplicationFault('invalid_request', 'Historical sources accept no query')
    if (!options.read?.contextSources) throw new ApplicationFault('unsupported_capability', 'Historical sources are not connected')
    const id = IdSchema.parse(c.req.param('id')), value = await options.read.contextSources(id)
    if (!value) return c.json({ error: { code: 'invalid_request', message: 'Message context was not found', retry: 'user_action' } }, 404)
    const sources = ContextSourcesSchema.parse(value)
    if (sources.binding.messageId !== id) throw new ApplicationFault('storage_unavailable', 'Historical source identity mismatch', 'none')
    return c.json(sources)
  })
  app.get('/v1/messages/:id/context', async c => {
    if (Object.keys(c.req.query()).length) throw new ApplicationFault('invalid_request', 'Message context accepts no query')
    if (!options.read?.assistantContext) throw new ApplicationFault('unsupported_capability', 'Context audit is not connected')
    const id = IdSchema.parse(c.req.param('id')), value = await options.read.assistantContext(id)
    if (!value) return c.json({ error: { code: 'invalid_request', message: 'Message context was not found', retry: 'user_action' } }, 404)
    const binding = AssistantContextBindingSchema.parse(value)
    if (binding.messageId !== id) throw new ApplicationFault('storage_unavailable', 'Message context identity mismatch', 'none')
    return c.json(binding)
  })
  app.post('/v1/proposals/prepare', async (c) => {
    if (!c.req.header('content-type')?.toLowerCase().startsWith('application/json')) throw new ApplicationFault('invalid_request', 'Proposal preview requires JSON')
    if (!options.operations?.prepareProposal) throw new ApplicationFault('unsupported_capability', 'Proposal preparation is not connected')
    return c.json(ProposalPreviewSchema.parse(await options.operations.prepareProposal(ProposalPrepareSchema.parse(await c.req.json()), c.get('actor'))))
  })
  app.post('/v1/proposals/commands', async (c) => {
    if (!c.req.header('content-type')?.toLowerCase().startsWith('application/json')) throw new ApplicationFault('invalid_request', 'Proposal command requires JSON')
    if (!options.operations?.proposal) throw new ApplicationFault('unsupported_capability', 'Proposal commands are not connected')
    const command = ProposalCommandSchema.parse(await c.req.json())
    const receipt = CommandReceiptSchema.parse(await options.operations.proposal(command, c.get('actor')))
    if (receipt.commandId !== command.commandId) throw new ApplicationFault('storage_unavailable', 'Proposal receipt identity mismatch', 'none')
    return c.json(receipt, receipt.status === 'rejected' ? statusOf(receipt.error) : 200)
  })
  app.get('/v1/decisions', async (c) => {
    if (!options.read?.decisions) throw new ApplicationFault('unsupported_capability', 'Decision reader is not connected')
    const input = { ...c.req.query() } as Record<string, unknown>
    if (typeof input.limit === 'string') {
      if (!/^[1-9][0-9]*$/.test(input.limit)) throw new ApplicationFault('invalid_request', 'Invalid decision page size')
      input.limit = Number(input.limit)
    }
    return c.json(DecisionPageSchema.parse(await options.read.decisions(DecisionQuerySchema.parse(input))))
  })
  app.post('/v1/decisions/prepare', async (c) => {
    if (!c.req.header('content-type')?.toLowerCase().startsWith('application/json')) throw new ApplicationFault('invalid_request', 'Decision preview requires JSON')
    if (!options.operations?.prepareDecision) throw new ApplicationFault('unsupported_capability', 'Decision preparation is not connected')
    return c.json(DecisionPreviewSchema.parse(await options.operations.prepareDecision(DecisionPrepareSchema.parse(await c.req.json()), c.get('actor'))))
  })
  app.post('/v1/decisions/commands', async (c) => {
    if (!c.req.header('content-type')?.toLowerCase().startsWith('application/json')) throw new ApplicationFault('invalid_request', 'Decision command requires JSON')
    if (!options.operations?.decision) throw new ApplicationFault('unsupported_capability', 'Decision commands are not connected')
    const command = DecisionCommandSchema.parse(await c.req.json())
    const receipt = CommandReceiptSchema.parse(await options.operations.decision(command, c.get('actor')))
    if (receipt.commandId !== command.commandId) throw new ApplicationFault('storage_unavailable', 'Decision receipt identity mismatch', 'none')
    return c.json(receipt)
  })
  app.get('/v1/attention', async (c) => {
    if (!options.read?.attention) throw new ApplicationFault('unsupported_capability', 'Attention reader is not connected')
    const input = { ...c.req.query() } as Record<string, unknown>
    if (typeof input.limit === 'string') {
      if (!/^[1-9][0-9]*$/.test(input.limit)) throw new ApplicationFault('invalid_request', 'Invalid attention page size')
      input.limit = Number(input.limit)
    }
    return c.json(AttentionPageSchema.parse(await options.read.attention(AttentionQuerySchema.parse(input))))
  })
  app.get('/v1/conversations', async (c) => {
    if (!options.read?.conversations) throw new ApplicationFault('unsupported_capability', 'Conversation catalog is not connected')
    const raw = c.req.query(), input: Record<string, unknown> = { ...raw }
    if (raw.limit !== undefined) input.limit = /^\d+$/.test(raw.limit) ? Number(raw.limit) : NaN
    if (raw.includeArchived !== undefined) {
      if (!['true', 'false'].includes(raw.includeArchived)) throw new ApplicationFault('invalid_request', 'Invalid archive filter')
      input.includeArchived = raw.includeArchived === 'true'
    }
    return c.json(ConversationCatalogSchema.parse(await options.read.conversations(ConversationCatalogQuerySchema.parse(input))))
  })
  app.get('/v1/conversations/:id', async (c) => {
    if (!options.read?.conversation) throw new ApplicationFault('unsupported_capability', 'Conversation reader is not connected')
    if (Object.keys(c.req.query()).length) throw new ApplicationFault('invalid_request', 'Conversation read does not accept query parameters')
    const id = IdSchema.parse(c.req.param('id')), value = ConversationSummarySchema.parse(await options.read.conversation(id))
    if (value.id !== id) throw new ApplicationFault('storage_unavailable', 'Conversation reader identity mismatch', 'none')
    return c.json(value)
  })
  app.post('/v1/conversations/commands', async (c) => {
    if (!c.req.header('content-type')?.toLowerCase().startsWith('application/json')) throw new ApplicationFault('invalid_request', 'Conversation commands require JSON')
    if (!options.operations?.conversation) throw new ApplicationFault('unsupported_capability', 'Conversation commands are not connected')
    const command = ConversationCommandSchema.parse(await c.req.json())
    const receipt = CommandReceiptSchema.parse(await options.operations.conversation(command, c.get('actor')))
    if (receipt.commandId !== command.commandId) throw new ApplicationFault('storage_unavailable', 'Conversation receipt identity mismatch', 'none')
    return c.json(receipt)
  })
  app.get('/v1/assistant', async (c) => {
    if (!options.read?.assistant)
      throw new ApplicationFault('unsupported_capability', 'Model conversation is not configured')
    return c.json(AssistantProviderStatusSchema.parse(await options.read.assistant()))
  })
  app.post('/v1/projects', async (c) => {
    if (!c.req.header('content-type')?.toLowerCase().startsWith('application/json'))
      throw new ApplicationFault('invalid_request', 'Project registration requires JSON')
    if (!options.read?.registerProject)
      throw new ApplicationFault('unsupported_capability', 'Project registration is not connected')
    const input = ProjectRegistrationInputSchema.parse(await c.req.json())
    return c.json(ApplicationConfigurationSchema.parse(await options.read.registerProject(input)))
  })
  app.get('/v1/projects/:id/settings', async (c) => {
    if (Object.keys(c.req.query()).length) throw new ApplicationFault('invalid_request', 'Project settings do not accept query parameters')
    if (!options.read?.projectSettings) throw new ApplicationFault('unsupported_capability', 'Project settings are not connected')
    const id = IdSchema.parse(c.req.param('id')), value = ProjectSettingsPageSchema.parse(await options.read.projectSettings(id))
    if (value.current.projectId !== id) throw new ApplicationFault('storage_unavailable', 'Project settings identity mismatch', 'none')
    return c.json(value)
  })
  app.post('/v1/projects/:id/settings', async (c) => {
    if (!c.req.header('content-type')?.toLowerCase().startsWith('application/json')) throw new ApplicationFault('invalid_request', 'Project settings require JSON')
    if (!options.operations?.projectSettings) throw new ApplicationFault('unsupported_capability', 'Project settings are not connected')
    const id = IdSchema.parse(c.req.param('id')), command = ProjectSettingsCommandSchema.parse(await c.req.json())
    if (command.projectId !== id) throw new ApplicationFault('invalid_request', 'Project settings command belongs to another project')
    const receipt = CommandReceiptSchema.parse(await options.operations.projectSettings(command, c.get('actor')))
    if (receipt.commandId !== command.commandId) throw new ApplicationFault('storage_unavailable', 'Project settings receipt identity mismatch', 'none')
    return c.json(receipt)
  })
  app.get('/v1/works/:id/evidence/history', async (c) => {
    if (!options.read?.workEvidenceHistory) throw new ApplicationFault('unsupported_capability', 'Work history reader is not connected')
    const input = { ...c.req.query() } as Record<string, unknown>
    if ('limit' in input) {
      if (typeof input.limit !== 'string' || !/^[1-9][0-9]{0,2}$/.test(input.limit)) throw new ApplicationFault('invalid_request', 'Invalid evidence page size')
      input.limit = Number(input.limit)
    }
    const id = IdSchema.parse(c.req.param('id'))
    const page = WorkEvidenceHistorySchema.parse(await options.read.workEvidenceHistory(id, WorkEvidenceHistoryQuerySchema.parse(input)))
    if (page.workId !== id) throw new ApplicationFault('storage_unavailable', 'History identity mismatch', 'none')
    return c.json(page)
  })
  app.get('/v1/works/:id/evidence', async (c) => {
    if (!options.read?.workEvidence) throw new ApplicationFault('unsupported_capability', 'Work evidence is not connected')
    return c.json(WorkEvidenceSchema.parse(await options.read.workEvidence(IdSchema.parse(c.req.param('id')))))
  })
  app.get('/v1/works/:id/location', async (c) => {
    if (!options.read?.workLocation)
      throw new ApplicationFault('unsupported_capability', 'Work location is not connected')
    return c.json(WorkLocationSchema.parse(await options.read.workLocation(IdSchema.parse(c.req.param('id')))))
  })
  app.get('/v1/guide', async (c) => {
    if (!options.read?.guide) throw new ApplicationFault('unsupported_capability', 'Guide is not connected')
    c.header('content-type', 'text/markdown; charset=utf-8')
    c.header('content-disposition', 'attachment; filename="assistant-guide.zh-CN.md"')
    return c.body(await options.read.guide())
  })
  app.get('/v1/works/:id/environment', async (c) => {
    if (!options.read?.workEnvironment) throw new ApplicationFault('unsupported_capability', 'Environment read port is not connected')
    return c.json(WorkEnvironmentSchema.parse(await options.read.workEnvironment(IdSchema.parse(c.req.param('id')))))
  })
  app.get('/v1/works/:id/verification', async (c) => {
    if (Object.keys(c.req.query()).length)
      throw new ApplicationFault('invalid_request', 'Verification status does not accept query parameters')
    if (!options.read?.workVerification)
      throw new ApplicationFault('unsupported_capability', 'Verification status is not connected')
    const workId = IdSchema.parse(c.req.param('id'))
    const value = WorkVerificationStatusSchema.parse(await options.read.workVerification(workId))
    if (value.workId !== workId)
      throw new ApplicationFault('storage_unavailable', 'Verification status identity mismatch', 'none')
    return c.json(options.startupMode === 'recovery_readonly' ? { ...value, retryAvailable: false } : value)
  })
  app.post('/v1/works/:id/verification/retry', async (c) => {
    if (!c.req.header('content-type')?.toLowerCase().startsWith('application/json'))
      throw new ApplicationFault('invalid_request', 'Verification recovery requires JSON')
    if (!options.operations?.retryVerification)
      throw new ApplicationFault('unsupported_capability', 'Verification recovery is not connected')
    const workId = IdSchema.parse(c.req.param('id'))
    const command = VerificationRetryCommandSchema.parse(await c.req.json())
    if (command.candidate.contract.workId !== workId)
      throw new ApplicationFault('invalid_request', 'Recovery command belongs to another work')
    const receipt = CommandReceiptSchema.parse(await options.operations.retryVerification(command, c.get('actor')))
    if (receipt.commandId !== command.commandId || (receipt.workId && receipt.workId !== workId))
      throw new ApplicationFault('storage_unavailable', 'Recovery receipt identity mismatch', 'none')
    return c.json(receipt)
  })
  app.post('/v1/works/:id/review-activity', async (c) => {
    if (!c.req.header('content-type')?.toLowerCase().startsWith('application/json')) throw new ApplicationFault('invalid_request', 'Review activity requires JSON')
    if (!options.operations?.reviewActivity) throw new ApplicationFault('unsupported_capability', 'Review activity is not connected')
    const workId = IdSchema.parse(c.req.param('id')), activity = ReviewActivitySchema.parse(await c.req.json())
    if (activity.candidate.contract.workId !== workId) throw new ApplicationFault('invalid_request', 'Review activity belongs to another work')
    const receipt = CommandReceiptSchema.parse(await options.operations.reviewActivity(activity, c.get('actor')))
    if (receipt.commandId !== activity.commandId) throw new ApplicationFault('storage_unavailable', 'Activity receipt identity mismatch', 'none')
    return c.json(receipt)
  })
  app.get('/v1/assistant/stream', (c) => {
    const { conversationId } = z.strictObject({ conversationId: IdSchema }).parse(c.req.query())
    if (!options.read?.assistantStream)
      throw new ApplicationFault('unsupported_capability', 'Assistant streaming is not connected')
    const controller = new AbortController()
    const updates = options.read.assistantStream(conversationId, controller.signal)
    c.header('x-accel-buffering', 'no')
    return streamSSE(c, async (stream) => {
      stream.onAbort(() => controller.abort())
      const heartbeat = setInterval(() => {
        void stream.writeSSE({ event: 'heartbeat', data: '{}' }).catch(() => controller.abort())
      }, 20000)
      try {
        for await (const value of updates) {
          const update = AssistantStreamUpdateSchema.parse(value)
          if (update.conversationId !== conversationId) throw new Error('Assistant stream identity mismatch')
          await stream.writeSSE({ event: 'assistant_update', data: JSON.stringify(update) })
        }
      } finally {
        clearInterval(heartbeat)
        controller.abort()
      }
    })
  })
  app.post('/v1/assistant/model', async (c) => {
    if (!c.req.header('content-type')?.startsWith('application/json'))
      throw new ApplicationFault('invalid_request', 'Model selection requires JSON')
    if (!options.read?.selectModel)
      throw new ApplicationFault('unsupported_capability', 'Model selection is not configured')
    const input = AssistantModelSelectionSchema.parse(await c.req.json())
    return c.json(AssistantProviderStatusSchema.parse(await options.read.selectModel(input.model)))
  })
  app.post('/v1/assistant/suggestions', async c => {
    if (!c.req.header('content-type')?.startsWith('application/json')) throw new ApplicationFault('invalid_request', 'Suggestion settings require JSON')
    if (!options.read?.setAssistantSuggestions) throw new ApplicationFault('unsupported_capability', 'Suggestion settings are not configured')
    const input = AssistantSuggestionsSettingSchema.parse(await c.req.json())
    return c.json(AssistantProviderStatusSchema.parse(await options.read.setAssistantSuggestions(input.enabled)))
  })
  app.delete('/v1/session', (c) => {
    const id = getCookie(c, COOKIE)
    if (id) sessions.delete(id)
    deleteCookie(c, COOKIE, { path: '/' })
    return c.json({ status: 'signed_out' })
  })
  app.post('/v1/commands', async (c) => {
    if (!c.req.header('content-type')?.toLowerCase().startsWith('application/json'))
      throw new ApplicationFault('invalid_request', 'Commands require JSON', 'none')
    const command = UserCommandSchema.parse(await c.req.json())
    const receipt = CommandReceiptSchema.parse(await options.application.dispatch(command, c.get('actor')))
    if (receipt.commandId !== command.commandId)
      throw new ApplicationFault('storage_unavailable', 'Application receipt identity mismatch', 'none')
    return c.json(receipt)
  })
  app.get('/v1/snapshot', async (c) => {
    const raw = c.req.query(),
      input: Record<string, unknown> = { ...raw }
    for (const field of ['limit', 'beforeMessageCursor'])
      if (raw[field] !== undefined) input[field] = /^\d+$/.test(raw[field]!) ? Number(raw[field]) : NaN
    if (raw.includeLearning !== undefined) {
      if (!['true', 'false'].includes(raw.includeLearning))
        throw new ApplicationFault('invalid_request', 'Invalid includeLearning value')
      input.includeLearning = raw.includeLearning === 'true'
    }
    const value = SnapshotSchema.parse(await options.application.inspect(InspectQuerySchema.parse(input)))
    return c.json(options.startupMode === 'recovery_readonly' ? { ...value, works: value.works.map(readonlyWork) } : value)
  })
  app.get('/v1/works/:id', async (c) => {
    const snapshot = await options.application.inspect({ workId: IdSchema.parse(c.req.param('id')) })
    const value = WorkViewSchema.parse(snapshot.works[0])
    return c.json(options.startupMode === 'recovery_readonly' ? readonlyWork(value) : value)
  })
  app.get('/v1/conversations/:id/messages', async (c) => {
    const id = IdSchema.parse(c.req.param('id')),
      raw = c.req.query()
    if (Object.keys(raw).some((key) => !['before', 'limit'].includes(key)))
      throw new ApplicationFault('invalid_request', 'Unknown message query field')
    const query = InspectQuerySchema.parse({
      conversationId: id,
      ...(raw.before === undefined ? {} : { beforeMessageCursor: /^\d+$/.test(raw.before) ? Number(raw.before) : NaN }),
      ...(raw.limit === undefined ? {} : { limit: /^\d+$/.test(raw.limit) ? Number(raw.limit) : NaN }),
    })
    const snapshot = await options.application.inspect(query)
    return c.json(ConversationPageSchema.parse(snapshot.conversation))
  })
  app.get('/v1/events', (c) => {
    const raw = c.req.header('last-event-id') ?? c.req.query('after') ?? '0'
    if (!/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw)))
      throw new ApplicationFault('invalid_request', 'Invalid event cursor')
    const after = Number(raw)
    let events: AsyncIterable<import('@personal-agent/contracts').Change>
    try {
      events = options.application.changes(after)
    } catch (error) {
      if (
        error instanceof ApplicationFault &&
        error.error.code === 'cursor_expired' &&
        c.req.header('accept')?.includes('text/event-stream')
      )
        return streamSSE(c, async (stream) => {
          await stream.writeSSE({ event: 'cursor_expired', data: JSON.stringify({ error: error.error }) })
        })
      throw error
    }
    const response = streamSSE(c, async (stream) => {
      const iterator = events[Symbol.asyncIterator]()
      let aborted = false
      const heartbeat = setInterval(() => {
        void stream.writeSSE({ event: 'heartbeat', data: '{}' }).catch(() => {
          aborted = true
          void iterator.return?.()
        })
      }, 20_000)
      stream.onAbort(() => {
        aborted = true
        void iterator.return?.()
      })
      try {
        for (;;) {
          const item = await iterator.next()
          if (item.done || aborted) break
          const change = ChangeSchema.parse(item.value)
          await stream.writeSSE({ id: String(change.seq), data: JSON.stringify(change) })
        }
      } catch (error) {
        if (!aborted) {
          const appError =
            error instanceof ApplicationFault
              ? error.error
              : { code: 'storage_unavailable' as const, message: 'Event stream is unavailable', retry: 'safe' as const }
          await stream.writeSSE({
            event: appError.code === 'cursor_expired' ? 'cursor_expired' : 'error',
            data: JSON.stringify({ error: appError }),
          })
        }
      } finally {
        clearInterval(heartbeat)
        await iterator.return?.()
      }
    })
    response.headers.set('cache-control', 'no-store')
    return response
  })
  app.get('/v1/questions/:id/deliveries', async (c) => {
    if (!options.read?.deliveries)
      throw new ApplicationFault('unsupported_capability', 'Delivery read port is not connected')
    const values = await options.read.deliveries(IdSchema.parse(c.req.param('id')))
    return c.json(z.array(AnswerDeliverySchema).max(128).parse(values))
  })
  app.get('/v1/verifications/:id', async (c) => {
    if (!options.read?.verification)
      throw new ApplicationFault('unsupported_capability', 'Verification read port is not connected')
    const value = await options.read.verification(IdSchema.parse(c.req.param('id')))
    if (!value) throw new ApplicationFault('invalid_request', 'Unknown visible verification')
    return c.json(VerificationSchema.parse(value))
  })
  app.get('/v1/artifacts/:id', async (c) => {
    const id = IdSchema.parse(c.req.param('id'))
    if (!options.read?.artifact)
      throw new ApplicationFault('unsupported_capability', 'Artifact reader is not connected')
    const value = await options.read.artifact(id)
    if (!value) throw new ApplicationFault('invalid_request', 'Unknown allowed artifact reference')
    c.header('content-type', value.contentType)
    c.header('content-disposition', 'attachment')
    return c.body(value.body)
  })
  app.notFound((c) =>
    c.json({ error: { code: 'invalid_request', message: 'Unknown product route', retry: 'none' } }, 404),
  )
  app.onError((error, c) => {
    const value: AppError =
      error instanceof ApplicationFault || error instanceof QuestionFault
        ? error.error
        : error instanceof ZodError || error instanceof SyntaxError
          ? { code: 'invalid_request', message: 'Request or response does not match the product schema', retry: 'none' }
          : { code: 'storage_unavailable', message: 'Local product operation is unavailable', retry: 'safe' }
    return c.json({ error: AppErrorSchema.parse(value) }, statusOf(value))
  })
  return app
}
