import { ConversationCatalogQuerySchema, ConversationCatalogSchema, ConversationCommandSchema,
  ConversationSummarySchema, CommandReceiptSchema, TrustedActorSchema } from '@personal-agent/contracts'
import type { ConversationCatalog, ConversationCatalogQuery, ConversationCommand, ConversationSummary,
  CommandReceipt, TrustedActor } from '@personal-agent/contracts'
import { WorkflowConflict, canonicalDigest } from '@personal-agent/storage'
import type { Conversation, ProductStore } from '@personal-agent/storage'
import type { Ticket } from '@personal-agent/orchestrator-core'
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { ApplicationFault } from './errors.ts'

/** Authenticated catalog composition over the storage owner's ports, without another SQL writer. */
export class ApplicationConversations {
  private readonly membership = new Map<string, { sequence: number; projects: readonly string[] }>()
  private readonly store: ProductStore
  private readonly principal: { userId: string; authorityRef: string }
  private readonly projectIds: () => readonly string[]
  private readonly cursorKey: Buffer
  constructor(store: ProductStore, principal: { userId: string; authorityRef: string },
    projectIds: () => readonly string[], cursorSecret: Uint8Array) {
    if (cursorSecret.byteLength < 32) throw new TypeError('Catalog cursors need a private 256-bit secret')
    this.store = store
    this.principal = structuredClone(principal)
    this.projectIds = projectIds
    this.cursorKey = createHash('sha256').update(cursorSecret).update('conversation-catalog/1').digest()
  }
  private cursor(value: string, scope: string, decode = false): string {
    try {
      if (decode) {
        const bytes = Buffer.from(value, 'base64url')
        if (bytes.length < 29 || bytes.toString('base64url') !== value) throw new Error('Invalid cursor')
        const cipher = createDecipheriv('aes-256-gcm', this.cursorKey, bytes.subarray(0, 12))
        cipher.setAAD(Buffer.from(scope))
        cipher.setAuthTag(bytes.subarray(12, 28))
        return Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]).toString('utf8')
      }
      const nonce = randomBytes(12), cipher = createCipheriv('aes-256-gcm', this.cursorKey, nonce)
      cipher.setAAD(Buffer.from(scope))
      const bytes = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
      return Buffer.concat([nonce, cipher.getAuthTag(), bytes]).toString('base64url')
    } catch { throw new ApplicationFault('invalid_request', 'Catalog cursor expired or belongs to another query') }
  }

  private projects(entry: Conversation, budget: { remaining: number }): readonly string[] {
    const prior = this.membership.get(entry.id)
    if (prior?.sequence === entry.lastSequence) return [...new Set([...(entry.projectId ? [entry.projectId] : []), ...prior.projects])]
    // Legacy/mixed-project catalogs need the persisted message scope checked before revealing a title or search hit.
    const projects = new Set<string>()
    let before: number | undefined
    for (;;) {
      if (budget.remaining <= 0) throw new ApplicationFault('budget_exceeded', 'Conversation membership needs a smaller catalog page')
      const page = this.store.product.messages.page(entry.id, { limit: Math.min(200, budget.remaining), ...(before ? { before } : {}) })
      budget.remaining -= Math.max(1, page.messages.length)
      for (const message of page.messages) if (message.projectId) projects.add(message.projectId)
      if (!page.hasMore) break
      if (!page.beforeCursor || page.beforeCursor === before)
        throw new ApplicationFault('storage_unavailable', 'Conversation message cursor is unavailable', 'none')
      before = page.beforeCursor
    }
    if (this.membership.size >= 512) this.membership.delete(this.membership.keys().next().value!)
    this.membership.set(entry.id, { sequence: entry.lastSequence, projects: [...projects] })
    if (entry.projectId) projects.add(entry.projectId)
    return [...projects]
  }
  private visible(entry: Conversation, allowed: ReadonlySet<string>, budget: { remaining: number }) {
    const projects = this.projects(entry, budget)
    return projects.length && projects.every(id => allowed.has(id)) ? projects : undefined
  }
  private attention(): ReadonlySet<string> {
    const result = new Set<string>()
    for (const ticket of this.store.domain.tickets.list<Ticket>()) {
      const ref = ticket.completion?.contract
      if (!ref) continue
      const binding = this.store.bindings.current(ticket.id)
      if (!ticket.ended || (binding && binding.state !== 'ended')) {
        const work = this.store.product.works.get(ref.workId)
        if (work) result.add(work.conversationId)
      }
    }
    return result
  }
  private summary(entry: Conversation, projects: readonly string[], attention: ReadonlySet<string>): ConversationSummary {
    return ConversationSummarySchema.parse({ id: entry.id, title: entry.title, titleRevision: entry.titleRevision,
      archiveRevision: entry.archiveRevision, ...(entry.projectId ? { projectId: entry.projectId } : {}), projectIds: projects,
      createdAt: entry.createdAt, updatedAt: entry.updatedAt, ...(entry.archivedAt ? { archivedAt: entry.archivedAt } : {}),
      messageCount: entry.messageCount, workCount: entry.workCount, attention: entry.attention || attention.has(entry.id) })
  }
  list(input: ConversationCatalogQuery): ConversationCatalog {
    const query = ConversationCatalogQuerySchema.parse(input), allowed = new Set(this.projectIds())
    if (query.projectId && !allowed.has(query.projectId)) throw new ApplicationFault('forbidden', 'Project is not configured', 'none')
    if (!allowed.size) return { protocol: 'conversation-catalog/1', conversations: [], hasMore: false }
    const cursorScope = JSON.stringify({ projects: [...allowed].sort(), projectId: query.projectId ?? null,
      query: query.query ?? null, includeArchived: query.includeArchived ?? false })
    const cursor = query.cursor ? this.cursor(query.cursor, cursorScope, true) : undefined
    return this.store.uow.atomic(() => {
      // Empty project scope is an internal discovery read only; every result is filtered through visible() below.
      const page = query.query
        ? this.store.workflows.conversations.search({ query: query.query, projectIds: [], includeArchived: true, limit: query.limit ?? 30, ...(cursor ? { cursor } : {}) })
        : this.store.workflows.conversations.list({ projectIds: [], includeArchived: true, limit: query.limit ?? 30, ...(cursor ? { cursor } : {}) })
      const entries = 'hits' in page ? page.hits.map(hit => hit.conversation) : page.conversations
      const attention = this.attention(), budget = { remaining: 10000 }
      const conversations = entries.flatMap(entry => {
        const projects = this.visible(entry, allowed, budget)
        if (!projects || (query.projectId && !projects.includes(query.projectId))) return []
        const value = this.summary(entry, projects, attention)
        return !value.archivedAt || query.includeArchived || value.attention ? [value] : []
      })
      return ConversationCatalogSchema.parse({ protocol: 'conversation-catalog/1', conversations, hasMore: page.hasMore,
        ...(page.nextCursor ? { nextCursor: this.cursor(page.nextCursor, cursorScope) } : {}) })
    })
  }
  get(id: string): ConversationSummary {
    return this.store.uow.atomic(() => {
      const entry = this.store.workflows.conversations.get(id)
      const projects = entry && this.visible(entry, new Set(this.projectIds()), { remaining: 10000 })
      if (!entry || !projects) throw new ApplicationFault('forbidden', 'Conversation is not in the configured projects', 'none')
      return this.summary(entry, projects, this.attention())
    })
  }
  dispatch(input: ConversationCommand, inputActor: TrustedActor): CommandReceipt {
    const command = ConversationCommandSchema.parse(input), actor = TrustedActorSchema.parse(inputActor)
    if (actor.userId !== this.principal.userId || actor.authorityRef !== this.principal.authorityRef || actor.source === 'explicit_rule')
      throw new ApplicationFault('forbidden', 'Caller is not the configured local principal', 'none')
    if (this.store.uow.nesting) throw new ApplicationFault('invalid_request', 'Catalog dispatch owns the outer commit')
    const digest = canonicalDigest(JSON.parse(JSON.stringify({ command, actor })))
    return this.store.uow.atomic(() => {
      const prior = this.store.commands.get(command.commandId)
      if (prior) {
        if (prior.payloadDigest !== digest) throw new ApplicationFault('conflict', 'Command ID already names another request')
        return CommandReceiptSchema.parse({ ...(prior.result as object), commandId: command.commandId, seq: prior.seq })
      }
      let result: { status: 'recorded' } | { status: 'rejected'; error: { code: string; message: string; retry: string } }
      try {
        result = this.store.uow.atomic(() => {
          const conversations = this.store.workflows.conversations
          if (command.kind === 'create_conversation') {
            if (!this.projectIds().includes(command.projectId)) throw new ApplicationFault('forbidden', 'Project is not configured', 'none')
            conversations.create({ id: command.conversationId, projectId: command.projectId, title: command.title })
          } else {
            this.get(command.conversationId)
            if (command.kind === 'rename_conversation') conversations.rename(command.conversationId, command.expectedTitleRevision, command.title)
            else conversations.setArchived(command.conversationId, command.expectedArchiveRevision, command.archived)
          }
          this.store.events.append({ topic: 'application.conversation.changed', entityRef: command.conversationId,
            payload: { conversationId: command.conversationId } })
          return { status: 'recorded' as const }
        })
      } catch (error) {
        if (error instanceof ApplicationFault) result = { status: 'rejected', error: error.error }
        else if (error instanceof WorkflowConflict) result = { status: 'rejected', error: { code: 'conflict', message: 'Conversation changed; reload and retry', retry: 'user_action' } }
        else throw error
      }
      const receipt = this.store.commands.record(command.commandId, digest, () => result, result.status)
      return CommandReceiptSchema.parse({ ...receipt.result, commandId: command.commandId, seq: receipt.seq })
    })
  }
}
