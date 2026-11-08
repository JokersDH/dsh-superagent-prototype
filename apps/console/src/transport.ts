/**
 * The console transport boundary. The browser sends only a `UserCommand`; the trusted actor is
 * added by the backend after authentication. Both adapters validate everything they return with the
 * frozen runtime schemas, so a fixture cannot smuggle a shape the real product would reject.
 */
import {
  ChangeSchema, CommandReceiptSchema, ConversationPageSchema, SnapshotSchema,
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
  /** Fixture-only evidence surfaces; a real transport may omit them until the product publishes routes. */
  verification?(id: string): Promise<VerificationDetail | undefined>
  deliveries?(questionId: string): Promise<readonly TargetDelivery[]>
  /** AgentProfile/ProbeReport fixture until the main transport publishes the Catalog read entry. */
  executors?(): Promise<readonly ExecutorSnapshot[]>
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
      response = await fetch(`${this.base}${path}`, { ...init, headers: { accept: 'application/json', ...(init?.body ? { 'content-type': 'application/json' } : {}) } })
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
