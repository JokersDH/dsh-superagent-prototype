/**
 * The console transport boundary. The browser sends only a `UserCommand`; the trusted actor is
 * added by the backend after authentication. Both adapters validate everything they return with the
 * frozen runtime schemas, so a fixture cannot smuggle a shape the real product would reject.
 */
import {
  AnswerDeliverySchema, ChangeSchema, CommandReceiptSchema, ConversationPageSchema, SnapshotSchema, VerificationSchema,
} from '@personal-agent/contracts'
import type { AgentProfile, Change, CommandReceipt, ConversationPage, InspectQuery, ProbeReport, Snapshot, UserCommand } from '@personal-agent/contracts'

export interface VerificationDetail {
  id: string
  artifactDigest: string
  results: readonly { criterionId: string; outcome: 'PASS' | 'FAIL' | 'SKIPPED' | 'NOT_TESTED' | 'NOT_APPLICABLE'; evidenceRefs: readonly string[] }[]
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
    return new TransportError(value.error.code, value.error.message ?? `HTTP ${status}`, (value.error.retry as TransportError['retry']) ?? 'user_action')
  }
  return new TransportError(status === 401 || status === 403 ? 'auth_required' : 'storage_unavailable', `HTTP ${status}`, 'user_action')
}

/** Product HTTP transport: POST /v1/commands, GET /v1/snapshot, messages page and the SSE change stream. */
export class HttpTransport implements ConsoleTransport {
  private readonly base: string
  constructor(base = '') { this.base = base }

  private async request(path: string, init?: RequestInit): Promise<unknown> {
    let response: Response
    try {
      response = await fetch(`${this.base}${path}`, { ...init, credentials: 'include', headers: { accept: 'application/json', ...(init?.body ? { 'content-type': 'application/json' } : {}) } })
    } catch (error) {
      throw new TransportError('storage_unavailable', `无法连接产品服务：${String(error)}`, 'safe')
    }
    const text = await response.text()
    let body: unknown = undefined
    if (text) {
      try { body = JSON.parse(text) } catch { body = undefined }
    }
    if (!response.ok) throw errorOf(response.status, body)
    return body
  }

  async dispatch(command: UserCommand): Promise<CommandReceipt> {
    const body = await this.request('/v1/commands', { method: 'POST', body: JSON.stringify(command) })
    const parsed = CommandReceiptSchema.safeParse(body)
    if (!parsed.success) throw new TransportError('schema_mismatch', '命令回执不符合公共 schema', 'user_action')
    if (parsed.data.commandId !== command.commandId) throw new TransportError('schema_mismatch', '回执命令 ID 不匹配', 'user_action')
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
    return parsed.data.map(delivery => ({ targetBindingId: delivery.targetBindingId, status: delivery.status }))
  }

  async artifact(id: string): Promise<{ contentType: string; text: string } | undefined> {
    let response: Response
    try {
      response = await fetch(`${this.base}/v1/artifacts/${encodeURIComponent(id)}`, { credentials: 'include', headers: { accept: 'text/plain, application/json, */*' } })
    } catch (error) {
      throw new TransportError('storage_unavailable', `无法读取产物：${String(error)}`, 'safe')
    }
    if (response.status === 422) return undefined
    if (!response.ok) {
      let body: unknown
      try { body = await response.json() } catch { body = undefined }
      throw errorOf(response.status, body)
    }
    return { contentType: response.headers.get('content-type') ?? 'application/octet-stream', text: await response.text() }
  }

  async messages(conversationId: string, options: { before?: number; limit?: number } = {}): Promise<ConversationPage> {
    const params = new URLSearchParams()
    if (options.before !== undefined) params.set('before', String(options.before))
    if (options.limit !== undefined) params.set('limit', String(options.limit))
    const body = await this.request(`/v1/conversations/${encodeURIComponent(conversationId)}/messages?${params.toString()}`)
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
    const push = (change: Change): void => { queue.push(change); wake?.() }
    const fail = (error: TransportError): void => { failure = error; ended = true; wake?.() }
    source.onmessage = event => {
      try {
        const parsed = ChangeSchema.safeParse(JSON.parse(event.data))
        if (parsed.success) push(parsed.data)
        else fail(new TransportError('schema_mismatch', '事件不符合公共 schema', 'user_action'))
      } catch { fail(new TransportError('schema_mismatch', '事件不是 JSON', 'user_action')) }
    }
    source.addEventListener('cursor_expired', () => fail(new TransportError('cursor_expired', '事件游标已过期，请重新获取快照', 'safe')))
    source.addEventListener('error', event => {
      try {
        const parsed = JSON.parse((event as MessageEvent).data) as { error?: { code?: string; message?: string; retry?: string } }
        const code = parsed.error?.code ?? 'storage_unavailable'
        fail(new TransportError(code, parsed.error?.message ?? '事件流不可用', (parsed.error?.retry as TransportError['retry']) ?? 'safe'))
      } catch { fail(new TransportError('storage_unavailable', '事件流不可用', 'safe')) }
    })
    source.onerror = () => { if (!ended) fail(new TransportError('storage_unavailable', '事件流断开', 'safe')) }
    const abort = (): void => { ended = true; source.close(); wake?.() }
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
      source.close()
    }
  }
}

export const createConsoleTransport = (): ConsoleTransport =>
  new HttpTransport()
