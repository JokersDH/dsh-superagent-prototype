import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { closeSync, constants, fstatSync, openSync, readSync } from 'node:fs'
import { z } from 'zod'
import {
  AssistantContextBindingSchema, AssistantContextHistoryPageSchema, CommandReceiptSchema,
  ContextHistoryQuerySchema, ContextHistorySchema, ContextSourcesSchema, DigestSchema, IdSchema, ScopeSchema, TimestampSchema,
} from '@personal-agent/contracts'
import type {
  AssistantContextBinding, AssistantContextBindings, AssistantContextHistory, ContextHistory, ContextHistoryQuery,
  ContextSources, ConversationMessage, Scope,
} from '@personal-agent/contracts'
import { ApplicationFault } from '@personal-agent/application'
import { key } from '@personal-agent/orchestrator-core'
import { scopeWithin } from '@personal-agent/questions'
import { canonicalDigest } from '@personal-agent/storage'
import type { ProductStore } from '@personal-agent/storage'
import { AssistantContextBundleSchema } from './assistant-context-use.ts'

const digest = (value: unknown) => canonicalDigest(JSON.parse(JSON.stringify(value ?? null)))
const sha = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex')
const FiltersSchema = ContextHistoryQuerySchema.omit({ cursor: true }).extend({ limit: z.number().int().min(1).max(50) })
const CursorSchema = z.strictObject({ version: z.literal(1), principal: z.strictObject({ userId: IdSchema, authorityRef: IdSchema }),
  filters: FiltersSchema, scopeDigest: DigestSchema, sourceCursor: z.string().min(1).max(4096), issuedAt: TimestampSchema, expiresAt: TimestampSchema })
const unavailable = () => new ApplicationFault('storage_unavailable', 'Historical context identity could not be verified', 'none')

interface Options {
  store: ProductStore
  bindings: AssistantContextBindings
  history?: AssistantContextHistory
  principal: { userId: string; authorityRef: string }
  projects(): readonly { id: string; scope: Scope }[]
  secret: Uint8Array
  now?: () => string
}

/** Read-only original context. Neither a historical record nor its cursor grants another send. */
export class ProductContextRecords {
  private readonly options: Options
  private readonly principal: Options['principal']
  private readonly secret: Buffer
  constructor(options: Options) {
    if (options.secret.byteLength < 32) throw new TypeError('Context history requires a private cursor key')
    this.options = options; this.principal = structuredClone(options.principal); this.secret = Buffer.from(options.secret)
  }
  get historyAvailable() { return !!this.options.history }
  private now() { return this.options.now?.() ?? new Date().toISOString() }
  private project(projectId: string) {
    const project = this.options.projects().find(value => value.id === projectId)
    if (!project) throw new ApplicationFault('forbidden', 'Historical context project is outside the configured scope', 'none')
    return { id: project.id, scope: ScopeSchema.parse(project.scope) }
  }
  private record(input: AssistantContextBinding): { binding: AssistantContextBinding; message?: ConversationMessage } {
    const { store, bindings } = this.options, binding = AssistantContextBindingSchema.parse(input)
    this.project(binding.projectId)
    if (digest(binding.principal) !== digest(this.principal))
      throw new ApplicationFault('forbidden', 'Historical context belongs to another principal', 'none')
    const message = store.product.messages.getById(binding.messageId), receipt = store.commands.get(binding.commandId)
    if (binding.messageId !== key('message', binding.commandId) ||
      digest(bindings.forMessage(binding.messageId)) !== digest(binding) || digest(bindings.forCommand(binding.commandId)) !== digest(binding) ||
      !receipt || receipt.status !== 'recorded') throw unavailable()
    const parsed = CommandReceiptSchema.safeParse({ ...(receipt.result as object), commandId: binding.commandId, seq: receipt.seq })
    if (!parsed.success || parsed.data.status !== 'recorded') throw unavailable()
    if (message) {
      const command = { kind: 'chat', commandId: binding.commandId, projectId: binding.projectId, conversationId: binding.conversationId, text: message.text }
      if (message.role !== 'user' || message.provenance !== 'trusted_user' || message.anchor ||
        message.projectId !== binding.projectId || message.conversationId !== binding.conversationId || sha(message.text) !== binding.userTextDigest ||
        !(['local_ui', 'local_cli'] as const).some(source => receipt.payloadDigest === digest({ command, actor: { ...this.principal, source } })))
        throw unavailable()
    }
    return { binding, ...(message ? { message } : {}) }
  }
  private sign(body: string) { return createHmac('sha256', this.secret).update(`context-history/1:${body}`).digest('base64url') }
  history(input: ContextHistoryQuery): ContextHistory {
    const query = ContextHistoryQuerySchema.parse(input), { store, history } = this.options
    if (!history) throw new ApplicationFault('unsupported_capability', 'Context history is not connected')
    return store.uow.atomic(() => {
      this.project(query.projectId)
      if (query.workId) {
        const work = store.product.works.get(query.workId)
        if (!work || work.projectId !== query.projectId || (query.conversationId && work.conversationId !== query.conversationId))
          throw new ApplicationFault('forbidden', 'Context history work is outside the selected scope', 'none')
      }
      const { cursor: publicCursor, ...selected } = query, filters = FiltersSchema.parse({ ...selected, limit: query.limit ?? 20 })
      const scopeDigest = digest(this.options.projects().map(value => ({ id: value.id, scope: value.scope })).sort((a, b) => a.id.localeCompare(b.id)))
      let sourceCursor: string | undefined
      if (publicCursor) {
        try {
          const parts = publicCursor.split('.')
          if (parts.length !== 2) throw new Error('Invalid cursor')
          const [body, signature] = parts as [string, string], expected = Buffer.from(this.sign(body)), actual = Buffer.from(signature)
          if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw new Error('Invalid cursor signature')
          const value = CursorSchema.parse(JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))), now = Date.parse(this.now())
          if (digest(value.principal) !== digest(this.principal) || digest(value.filters) !== digest(filters) || value.scopeDigest !== scopeDigest ||
            Date.parse(value.issuedAt) > now || Date.parse(value.expiresAt) <= now) throw new Error('Cursor scope changed')
          sourceCursor = value.sourceCursor
        } catch { throw new ApplicationFault('conflict', 'Context history continuation changed or expired; reload the history') }
      }
      let page
      try {
        page = AssistantContextHistoryPageSchema.parse(history.page({ projectIds: [query.projectId], limit: filters.limit,
          ...(query.conversationId ? { conversationId: query.conversationId } : {}), ...(query.workId ? { workId: query.workId } : {}),
          ...(sourceCursor ? { cursor: sourceCursor } : {}) }))
      } catch { throw unavailable() }
      if ((page.hasMore && (!page.records.length || page.nextCursor === sourceCursor)) || page.records.length > filters.limit || page.records.some(binding => binding.projectId !== query.projectId ||
        (query.conversationId && binding.conversationId !== query.conversationId) || (query.workId && binding.contract?.workId !== query.workId)))
        throw unavailable()
      const entries = page.records.map(input => {
        const { binding, message } = this.record(input)
        return { messageId: binding.messageId, projectId: binding.projectId, conversationId: binding.conversationId,
          confirmedAt: binding.confirmedAt, expiresAt: binding.expiresAt, ...(binding.contract ? { contract: binding.contract } : {}),
          selections: binding.selections, sourceCount: binding.sources.length,
          message: message ? { state: 'available', text: message.text.slice(0, 320), truncated: message.text.length > 320 }
            : { state: 'missing', truncated: false } }
      })
      const observedAt = this.now(), body = page.nextCursor ? Buffer.from(JSON.stringify(CursorSchema.parse({ version: 1,
        principal: this.principal, filters, scopeDigest, sourceCursor: page.nextCursor, issuedAt: observedAt,
        expiresAt: new Date(Date.parse(observedAt) + 300000).toISOString() }))).toString('base64url') : undefined
      return ContextHistorySchema.parse({ protocol: 'context-history/1', projectId: query.projectId,
        ...(query.conversationId ? { conversationId: query.conversationId } : {}), ...(query.workId ? { workId: query.workId } : {}),
        observedAt, entries, hasMore: page.hasMore, ...(body ? { nextCursor: `${body}.${this.sign(body)}` } : {}) })
    })
  }
  sources(messageId: string): ContextSources | undefined {
    const id = IdSchema.parse(messageId), { store, bindings } = this.options
    return store.uow.atomic(() => {
      const input = bindings.forMessage(id)
      if (!input) return undefined
      if (input.messageId !== id) throw unavailable()
      const { binding, message } = this.record(input), observedAt = this.now()
      const empty = (state: ContextSources['state']) => ContextSourcesSchema.parse({ protocol: 'context-sources/1',
        observedAt, binding, state, sources: [], omitted: [], injectionFlags: [] })
      if (!scopeWithin(binding.scope, this.project(binding.projectId).scope)) return empty('scope_changed')
      if (!message) return empty('unverified')
      if (binding.bundleRef !== binding.bundleDigest) return empty('unverified')
      const artifact = store.artifacts.get(binding.bundleRef)
      if (!artifact) return empty('missing')
      try {
        if (artifact.id !== binding.bundleDigest || artifact.digest !== binding.bundleDigest ||
          !Number.isSafeInteger(artifact.bytes) || artifact.bytes < 1 || artifact.bytes > 1048576) return empty('unverified')
        const fd = openSync(artifact.absolutePath, constants.O_RDONLY | constants.O_NOFOLLOW)
        let data: Buffer
        try {
          const stat = fstatSync(fd)
          if (!stat.isFile() || stat.size !== artifact.bytes) return empty('unverified')
          data = Buffer.alloc(artifact.bytes + 1)
          let offset = 0, count: number
          while (offset < data.length && (count = readSync(fd, data, offset, data.length - offset, null))) offset += count
          if (offset !== artifact.bytes) return empty('unverified')
          data = data.subarray(0, offset)
        } finally { closeSync(fd) }
        if (sha(data) !== binding.bundleDigest) return empty('unverified')
        const frozen = AssistantContextBundleSchema.parse(JSON.parse(data.toString('utf8'))), preview = frozen.preview
        if (frozen.input.projectId !== binding.projectId || frozen.input.conversationId !== binding.conversationId ||
          frozen.input.workId !== binding.contract?.workId || digest(frozen.input.selections) !== digest(binding.selections) ||
          digest(frozen.scope) !== digest(binding.scope) || preview.projectId !== binding.projectId || preview.conversationId !== binding.conversationId ||
          preview.requestId !== binding.requestId || preview.expiresAt !== binding.expiresAt || digest(preview.contract) !== digest(binding.contract) ||
          digest(preview.selections) !== digest(binding.selections) || preview.sources.some(source =>
            sha(source.content) !== source.previewDigest || Buffer.byteLength(source.content) !== source.bytes)) return empty('unverified')
        return ContextSourcesSchema.parse({ protocol: 'context-sources/1', observedAt, binding, state: 'verified',
          sources: preview.sources, omitted: preview.omitted, injectionFlags: preview.injectionFlags })
      } catch (error) {
        return empty((error as NodeJS.ErrnoException).code === 'ENOENT' ? 'missing' : 'unverified')
      }
    })
  }
}
