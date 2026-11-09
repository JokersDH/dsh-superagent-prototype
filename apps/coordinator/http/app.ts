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
  AssistantStreamUpdateSchema,
  ProjectRegistrationInputSchema,
  WorkLocationSchema,
  ChangeSchema,
  CommandReceiptSchema,
  ConversationPageSchema,
  IdSchema,
  InspectQuerySchema,
  SnapshotSchema,
  TrustedActorSchema,
  UserCommandSchema,
  VerificationSchema,
  WorkViewSchema,
} from '@personal-agent/contracts'
import type {
  AnswerDelivery,
  ApplicationConfiguration,
  AssistantProviderStatus,
  AssistantStreamUpdate,
  ProjectRegistrationInput,
  WorkLocation,
  AppError,
  ApplicationService,
  TrustedActor,
  Verification,
} from '@personal-agent/contracts'
import { ApplicationFault } from '@personal-agent/application'
import { QuestionFault } from '@personal-agent/questions'

const COOKIE = 'pa_local_session'
const sameSecret = (input: string | undefined, expected: string): boolean =>
  !!input &&
  Buffer.byteLength(input) === Buffer.byteLength(expected) &&
  timingSafeEqual(Buffer.from(input), Buffer.from(expected))
const sessionInput = z.strictObject({ bootstrapToken: z.string().regex(/^[a-f0-9]{64}$/) })
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
  /** Explicit loopback-only fixture convenience; normal entries still require credentials. */
  localDevelopmentAccess?: boolean
  now?: () => number
  read?: {
    assistant?(): Promise<AssistantProviderStatus>
    assistantStream?(conversationId: string, signal: AbortSignal): AsyncIterable<AssistantStreamUpdate>
    selectModel?(model: string): Promise<AssistantProviderStatus>
    guide?(): Promise<string>
    registerProject?(input: ProjectRegistrationInput): Promise<ApplicationConfiguration>
    workLocation?(workId: string): Promise<WorkLocation>
    configuration?(): Promise<ApplicationConfiguration>
    verification?(id: string): Promise<Verification | undefined>
    deliveries?(questionId: string): Promise<readonly AnswerDelivery[]>
    artifact?(id: string): Promise<{ body: ReadableStream<Uint8Array>; contentType: string } | undefined>
  }
}

/** The HTTP module owns identity. Request bodies never contain actor or direct core/native access. */
export function createLocalHttpApp(options: LocalHttpOptions) {
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
    bodyLimit({
      maxSize: 64 * 1024,
      onError: (c) =>
        c.json(
          { error: { code: 'invalid_request', message: 'Request body exceeds the local limit', retry: 'none' } },
          413,
        ),
    }),
  )
  app.get('/v1/health', (c) =>
    c.json({
      status: 'ok',
      mode: options.mode,
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
  app.get('/v1/configuration', async (c) => {
    if (Object.keys(c.req.query()).length)
      throw new ApplicationFault('invalid_request', 'Configuration does not accept query parameters')
    if (!options.read?.configuration)
      throw new ApplicationFault('unsupported_capability', 'Configuration read port is not connected')
    return c.json(ApplicationConfigurationSchema.parse(await options.read.configuration()))
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
    return c.json(SnapshotSchema.parse(await options.application.inspect(InspectQuerySchema.parse(input))))
  })
  app.get('/v1/works/:id', async (c) => {
    const snapshot = await options.application.inspect({ workId: IdSchema.parse(c.req.param('id')) })
    return c.json(WorkViewSchema.parse(snapshot.works[0]))
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
